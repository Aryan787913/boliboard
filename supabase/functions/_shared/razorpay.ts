// Minimal Razorpay REST client + signature verification (Web Crypto, no SDK).
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (use rzp_test_ keys until launch).

const API = "https://api.razorpay.com/v1";

function creds(): { id: string; secret: string } {
  const id = Deno.env.get("RAZORPAY_KEY_ID");
  const secret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!id || !secret) throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set");
  return { id, secret };
}

export function keyId(): string { return creds().id; }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { id, secret } = creds();
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: "Basic " + btoa(`${id}:${secret}`), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const desc = (data as { error?: { description?: string } })?.error?.description ?? `HTTP ${res.status}`;
    throw new Error(`Razorpay ${method} ${path}: ${desc}`);
  }
  return data as T;
}

export interface RzpOrder { id: string; amount: number; currency: string; status: string; receipt?: string }
export interface RzpPayment { id: string; order_id: string; amount: number; currency: string; status: string }

export function createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<RzpOrder> {
  return call<RzpOrder>("POST", "/orders", { amount: amountPaise, currency: "INR", receipt, notes });
}
export function fetchPayment(paymentId: string): Promise<RzpPayment> {
  return call<RzpPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
}
export function capturePayment(paymentId: string, amountPaise: number): Promise<RzpPayment> {
  return call<RzpPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: "INR" });
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Razorpay Standard Checkout: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret), hex. */
export async function verifySignature(orderId: string, paymentId: string, signature: string, secret?: string): Promise<boolean> {
  const expected = await hmacSha256Hex(secret ?? creds().secret, `${orderId}|${paymentId}`);
  return timingSafeEqual(expected, signature.toLowerCase());
}
