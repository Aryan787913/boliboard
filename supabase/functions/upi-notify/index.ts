// POST /functions/v1/upi-notify      (called by MacroDroid on the payee's Android phone)
// Header: x-boli-notify-token: <NOTIFY_TOKEN>
// Body:   { "title": "...", "text": "...", "app": "..." }   (the payment app's notification)
//
// 1. Ignores debits, sent/paid-to messages, collect requests, failures.
// 2. Parses the credited amount (₹ / Rs / Rs. / INR, commas, decimals) to paise.
// 3. upi_match_notification() (atomic, idempotent): the single pending, unexpired UPI order with exactly
//    that amount is marked paid and its listing credited/activated like verify-payment does. No match or
//    several matches -> logged to upi_unmatched for manual review in admin.html. The same notification
//    delivered twice within 30 minutes is a no-op.
import { preflight, json, fail } from "../_shared/http.ts";
import { admin, sha256Hex } from "../_shared/db.ts";
import { checkToken, classify, parseAmountPaise, cleanText } from "../_shared/upi.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const auth = await checkToken(req);
  if (auth === "missing") return fail(req, 503, "not_configured", "NOTIFY_TOKEN is not set.");
  if (auth === "bad") return fail(req, 401, "unauthorized", "Bad or missing x-boli-notify-token.");

  const body = await readLenient(req);
  if (!body) return fail(req, 400, "bad_request", "Send a JSON body with title, text, app.");
  const title = cleanText(body.title, 300);
  const text = cleanText(body.text, 1000);
  const app = cleanText(body.app, 100);
  const all = `${title} ${text}`.trim();
  if (!all) return fail(req, 400, "bad_request", "Empty notification.");

  const kind = classify(all);
  if (kind !== "credit") return json(req, 200, { ok: true, result: "ignored", reason: kind });

  const paise = parseAmountPaise(all);
  const hash = await sha256Hex(`${app}|${title}|${text}`);

  const r = await admin().rpc("upi_match_notification", {
    p_amount_paise: paise, p_title: title, p_body: text, p_app: app, p_hash: hash,
  });
  if (r.error) {
    console.error("upi-notify: match", r.error);
    return fail(req, 500, "db_error", "Could not record the notification.");
  }
  return json(req, 200, { ok: true, amount_paise: paise, ...(r.data as Record<string, unknown>) });
});

// MacroDroid pastes raw notification text into the JSON template, so a newline or a stray double quote can
// make it invalid JSON. Accept that: flatten control characters, then fall back to pulling the three fields out.
async function readLenient(req: Request): Promise<Record<string, unknown> | null> {
  const raw = (await req.text()).slice(0, 16_384);
  const flat = raw.replace(/[\r\n\t]+/g, " ");
  try {
    const v = JSON.parse(flat);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fall through */ }
  const m = flat.match(/"title"\s*:\s*"(.*)"\s*,\s*"text"\s*:\s*"(.*)"\s*,\s*"app"\s*:\s*"(.*)"\s*}\s*$/s);
  if (m) return { title: m[1], text: m[2], app: m[3] };
  return flat.trim() ? { title: "", text: flat, app: "" } : null;
}
