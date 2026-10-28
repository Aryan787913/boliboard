// POST /functions/v1/verify-payment
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }  (exactly what Razorpay Checkout returns)
// 1. Verifies the HMAC-SHA256 signature server-side with RAZORPAY_KEY_SECRET.
// 2. Confirms with Razorpay that the payment belongs to the order and the amount matches; captures it if only authorized.
// 3. Calls record_payment() which atomically marks the payment paid, adds it to listings.total_paid and approves the listing.
import { preflight, readJson, json, fail } from "../_shared/http.ts";
import { admin } from "../_shared/db.ts";
import { verifySignature, fetchPayment, capturePayment } from "../_shared/razorpay.ts";

const ID_RE = /^[A-Za-z0-9_]{6,64}$/;
const SIG_RE = /^[a-f0-9]{64}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const body = await readJson(req);
  const orderId = String(body?.razorpay_order_id ?? "");
  const paymentId = String(body?.razorpay_payment_id ?? "");
  const signature = String(body?.razorpay_signature ?? "");
  if (!ID_RE.test(orderId) || !ID_RE.test(paymentId) || !SIG_RE.test(signature)) {
    return fail(req, 400, "bad_request", "Missing or malformed Razorpay fields.");
  }

  if (!(await verifySignature(orderId, paymentId, signature))) {
    return fail(req, 400, "bad_signature", "Payment signature could not be verified.");
  }

  const db = admin();
  const row = await db.from("payments").select("id,amount,status,listing_id").eq("razorpay_order_id", orderId).maybeSingle();
  if (row.error) return fail(req, 500, "db_error", "Could not read the order.");
  if (!row.data) return fail(req, 404, "unknown_order", "We don't know that order.");
  if (row.data.status === "paid") return json(req, 200, { ok: true, already: true, listing_id: row.data.listing_id, charge: row.data.amount });

  const expectedPaise = Number(row.data.amount) * 100;
  try {
    let p = await fetchPayment(paymentId);
    if (p.order_id !== orderId) return fail(req, 400, "order_mismatch", "That payment doesn't belong to this order.");
    if (p.amount !== expectedPaise || p.currency !== "INR") return fail(req, 400, "amount_mismatch", "Payment amount doesn't match the order.");
    if (p.status === "authorized") p = await capturePayment(paymentId, expectedPaise);
    if (p.status !== "captured") return fail(req, 402, "not_captured", `Payment is ${p.status}.`);
  } catch (err) {
    console.error("verify-payment: razorpay", err);
    return fail(req, 502, "payment_provider_error", "Couldn't confirm the payment with Razorpay yet. It will not be charged twice.");
  }

  const rec = await db.rpc("record_payment", { p_order_id: orderId, p_payment_id: paymentId, p_signature: signature });
  if (rec.error) {
    console.error("verify-payment: record_payment", rec.error);
    return fail(req, 500, "db_error", "Payment verified but not recorded. Contact us with your payment ID.");
  }
  const r = Array.isArray(rec.data) ? rec.data[0] : rec.data;
  return json(req, 200, { ok: true, already: !!r?.already_paid, listing_id: r?.listing_id, charge: r?.amount });
});
