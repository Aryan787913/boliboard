// GET  /functions/v1/upi-status?id=<order uuid>      (POST { id } also works)
// Returns only the order's status: { status: "pending" | "paid" | "expired" | "failed" }.
// The order id is an unguessable UUID handed to the buyer by create-upi-order; nothing else is exposed.
import { preflight, readJson, json, fail } from "../_shared/http.ts";
import { admin } from "../_shared/db.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req, ["GET", "POST"]);
  if (pre) return pre;

  let id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id && req.method === "POST") id = String((await readJson(req))?.id ?? "");
  if (!UUID_RE.test(id)) return fail(req, 400, "bad_request", "id is required.");

  const r = await admin().from("payments").select("status,expires_at").eq("id", id).eq("provider", "upi").maybeSingle();
  if (r.error) return fail(req, 500, "db_error", "Could not read the order.");
  if (!r.data) return fail(req, 404, "unknown_order", "Unknown order.");

  let status = String(r.data.status);
  if (status === "pending" && r.data.expires_at && Date.parse(r.data.expires_at) <= Date.now()) status = "expired";
  if (status === "created" || status === "refunded") status = "failed";
  return json(req, 200, { status });
});
