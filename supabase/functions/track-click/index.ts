// POST /functions/v1/track-click
// Body (JSON, may arrive as text/plain from navigator.sendBeacon):
//   { kind: "click", listing_id }   -> one unique click per visitor per listing per IST day
//   { kind: "visit" }               -> one unique visit per visitor per IST day
// The visitor key is SHA-256(CLICK_SALT | ip | user-agent). Raw IPs are never stored.
import { preflight, readJson, fail, corsHeaders } from "../_shared/http.ts";
import { admin, sha256Hex } from "../_shared/db.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const body = await readJson(req);
  const kind = body?.kind;
  if (kind !== "click" && kind !== "visit") return fail(req, 400, "bad_request", "kind must be click or visit.");

  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300);
  if (!ip && !ua) return fail(req, 400, "bad_request", "Unidentifiable request.");
  const salt = Deno.env.get("CLICK_SALT") ?? "";
  const visitorHash = await sha256Hex(`${salt}|${ip}|${ua}`);
  const db = admin();

  if (kind === "visit") {
    const r = await db.from("visits").upsert({ visitor_hash: visitorHash }, { onConflict: "visitor_hash,day", ignoreDuplicates: true });
    if (r.error) { console.error("track-click visit", r.error); return fail(req, 500, "db_error", "Not recorded."); }
  } else {
    const id = body?.listing_id;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return fail(req, 400, "bad_request", "listing_id is required.");
    const l = await db.from("listings").select("id").eq("id", id).eq("approved", true).eq("removed", false).maybeSingle();
    if (l.error) return fail(req, 500, "db_error", "Not recorded.");
    if (!l.data) return fail(req, 404, "listing_not_found", "Unknown listing.");
    const r = await db.from("clicks").upsert({ listing_id: id, visitor_hash: visitorHash }, { onConflict: "listing_id,visitor_hash,day", ignoreDuplicates: true });
    if (r.error) { console.error("track-click click", r.error); return fail(req, 500, "db_error", "Not recorded."); }
  }
  return new Response(null, { status: 204, headers: corsHeaders(req) });
});
