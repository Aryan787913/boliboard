// UPI helpers: notification parsing, token check, deep link. Pure functions except checkToken (reads env).

/** Constant-time string compare (compares SHA-256 digests so length differences don't leak either). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(da), y = new Uint8Array(db);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** "missing" when NOTIFY_TOKEN isn't configured, otherwise whether the x-boli-notify-token header matches. */
export async function checkToken(req: Request): Promise<"ok" | "bad" | "missing"> {
  const secret = Deno.env.get("NOTIFY_TOKEN") ?? "";
  if (secret.length < 16) return "missing";
  const given = req.headers.get("x-boli-notify-token") ?? "";
  if (!given) return "bad";
  return (await safeEqual(given.trim(), secret)) ? "ok" : "bad";
}

export const VPA_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$/;

export function paiseToString(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

/** upi://pay?pa=VPA&pn=NAME&am=1.07&cu=INR&tn=Boli+CODE */
export function upiLink(vpa: string, payee: string, paise: number, code: string): string {
  return `upi://pay?pa=${vpa}&pn=${encodeURIComponent(payee)}&am=${paiseToString(paise)}&cu=INR&tn=Boli+${code}`;
}

// ---------------------------------------------------------------------------------------------
// Notification parsing
// ---------------------------------------------------------------------------------------------

const REQUEST_RE = /\b(request(?:ed|ing|s)?|collect|reminder|failed|declined|pending|expired|cancel(?:led|ed)?|reversed)\b/i;
const DEBIT_RE = /\b(debited|you paid|paid to|sent to|you sent|transferred to|withdrawn|withdrawal|spent|deducted|payment to|paid successfully to)\b/i;
const CREDIT_RE = /\b(received|credited|paid you|sent you|added to your|deposited)\b/i;
const STRONG_CREDIT_RE = /\b(received|paid you|sent you|credited (?:to|in|into) (?:your|a\/c|ac|acct|account))\b/i;

export type Classification = "credit" | "debit" | "request" | "unknown";

export function classify(text: string): Classification {
  const t = text.replace(/\s+/g, " ");
  if (REQUEST_RE.test(t)) return "request";
  const debit = DEBIT_RE.test(t);
  if (debit && !STRONG_CREDIT_RE.test(t)) return "debit";
  if (CREDIT_RE.test(t)) return "credit";
  return "unknown";
}

// ₹1.07 | ₹ 1,250.5 | Rs.1.07 | Rs 1.07 | INR 1.07 | 1.07 INR | 1.07 Rs
const AMT_PREFIX = /(?:₹|\u20B9|\bRs\.?|\bINR)\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi;
const AMT_SUFFIX = /\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*(?:₹|\u20B9|Rs\b\.?|INR\b|rupees\b)/gi;
const BALANCE_BEFORE = /(bal(?:ance)?|avl|available|limit)[^0-9₹]{0,12}$/i;

function toPaise(s: string): number | null {
  const clean = s.replace(/,/g, "");
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(clean)) return null;
  const [r, p = ""] = clean.split(".");
  const v = Number(r) * 100 + Number((p + "00").slice(0, 2));
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}

/** Returns the single credited amount in paise, or null when there is none or several different candidates. */
export function parseAmountPaise(text: string): number | null {
  const found = new Set<number>();
  for (const re of [AMT_PREFIX, AMT_SUFFIX]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 20), m.index);
      if (BALANCE_BEFORE.test(before)) continue; // "Avl bal Rs 5,000"
      const v = toPaise(m[1]);
      if (v !== null) found.add(v);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

export function cleanText(v: unknown, max = 500): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}
