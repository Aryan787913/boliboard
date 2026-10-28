// POST /functions/v1/admin-upi       (used by admin.html)
// Header: x-boli-notify-token: <NOTIFY_TOKEN>
// Body:
//   { action: "list" }                                         -> { pending: [...], unmatched: [...] }
//   { action: "approve", payment_id, unmatched_id? }           -> marks paid + activates listing (links the notification)
//   { action: "reject",  payment_id }                          -> marks the order failed (listing stays hidden)
//   { action: "dismiss", unmatched_id }                        -> marks an unmatched notification rejected
import { preflight, readJson, json, fail } from "../_shared/http.ts";
import { admin } from "../_shared/db.ts";
import { checkToken } from "../_shared/upi.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const auth = await checkToken(req);
  if (auth === "missing") return fail(req, 503, "not_configured", "NOTIFY_TOKEN is not set.");
  if (auth === "bad") return fail(req, 401, "unauthorized", "Wrong admin token.");

  const body = await readJson(req);
  const action = String(body?.action ?? "");
  const db = admin();

  if (action === "list") {
    const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const [p, u] = await Promise.all([
      db.from("payments")
        .select("id,order_code,amount,amount_paise,bid_total,board,status,created_at,expires_at,listing_id,listings(name,contact_email,approved)")
        .eq("provider", "upi").in("status", ["pending", "expired"]).gte("created_at", since)
        .order("created_at", { ascending: false }).limit(200),
      db.from("upi_unmatched").select("id,title,body,app,amount_paise,reason,created_at")
        .eq("status", "open").order("created_at", { ascending: false }).limit(200),
    ]);
    if (p.error || u.error) {
      console.error("admin-upi list", p.error ?? u.error);
      return fail(req, 500, "db_error", "Could not load.");
    }
    const now = Date.now();
    const pending = (p.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      status: r.status === "pending" && Date.parse(String(r.expires_at)) <= now ? "expired" : r.status,
    }));
    return json(req, 200, { pending, unmatched: u.data ?? [] });
  }

  if (action === "approve") {
    const pid = String(body?.payment_id ?? "");
    const uid = body?.unmatched_id == null || body?.unmatched_id === "" ? null : Number(body.unmatched_id);
    if (!UUID_RE.test(pid) || (uid !== null && !Number.isInteger(uid))) return fail(req, 400, "bad_request", "payment_id required.");
    const r = await db.rpc("admin_approve_upi", { p_payment_id: pid, p_unmatched_id: uid });
    if (r.error) return fail(req, 409, "cannot_approve", r.error.message);
    return json(req, 200, { ok: true, ...(Array.isArray(r.data) ? r.data[0] : r.data) });
  }

  if (action === "reject") {
    const pid = String(body?.payment_id ?? "");
    if (!UUID_RE.test(pid)) return fail(req, 400, "bad_request", "payment_id required.");
    const r = await db.from("payments").update({ status: "failed" })
      .eq("id", pid).eq("provider", "upi").in("status", ["pending", "expired"]).select("id");
    if (r.error) return fail(req, 500, "db_error", "Could not reject.");
    if (!r.data?.length) return fail(req, 409, "cannot_reject", "Order is not pending.");
    return json(req, 200, { ok: true });
  }

  if (action === "dismiss") {
    const uid = Number(body?.unmatched_id);
    if (!Number.isInteger(uid)) return fail(req, 400, "bad_request", "unmatched_id required.");
    const r = await db.from("upi_unmatched").update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", uid).eq("status", "open").select("id");
    if (r.error) return fail(req, 500, "db_error", "Could not dismiss.");
    if (!r.data?.length) return fail(req, 409, "cannot_dismiss", "Already resolved.");
    return json(req, 200, { ok: true });
  }

  return fail(req, 400, "bad_request", "Unknown action.");
});
