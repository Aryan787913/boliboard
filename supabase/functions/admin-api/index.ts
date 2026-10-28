// POST /functions/v1/admin-api            (owner admin site only; gateway verify_jwt is off, this checks itself)
// Headers: Authorization: Bearer <Supabase Auth access token>, apikey: <publishable key>
// Body: { action: "...", ...params }
//
// Auth, in order:
//   1. Bearer token verified by Supabase Auth itself (GET /auth/v1/user)       -> 401 when missing/invalid/expired
//   2. email confirmed AND in ADMIN_EMAILS (comma-separated secret)             -> 403 otherwise
//   3. per-user rate limit (admin_rate table, RATE_LIMIT per minute)            -> 429
// CORS: only origins in ADMIN_ORIGINS get Access-Control-Allow-Origin; a browser request from any other origin is 403.
// Every mutating action writes one admin_audit row (actor email, action, target, details).
//
// Actions:
//   dashboard                                   -> stats + bidding state
//   listings                                    -> all listings (any status)
//   hide { id } / unhide { id }                 -> soft remove (listings.removed) / restore
//   delete { id, confirm: <listing name> }      -> permanent delete (listing + its payments + clicks)
//   edit { id, name?, url?, category?, city?, story? }
//   add_manual { board, amount, listing_id? | listing{...}, email?, note? }
//                                               -> paid row provider 'manual' via record_manual_payment()
//   upi_list                                    -> pending/expired UPI orders (3 days) + open unmatched notifications
//   upi_approve { payment_id, unmatched_id? } / upi_reject { payment_id } / upi_dismiss { unmatched_id }
//   payments                                    -> last 100 payments
//   set_bidding { open: boolean }               -> app_settings.bidding_open (create-order / create-upi-order read it)
//   audit                                       -> last 50 admin_audit rows
import { readJson } from "../_shared/http.ts";
import { admin } from "../_shared/db.ts";
import { CATEGORIES, CITIES, normaliseUrl, validateNewListing, EMAIL_RE } from "../_shared/validate.ts";
import { DEFAULT_MAX_BID } from "../_shared/pricing.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_LIMIT = 60;     // requests per user per window
const RATE_WINDOW = 60;    // seconds

function list(name: string): string[] {
  return (Deno.env.get(name) ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && list("ADMIN_ORIGINS").includes(origin.toLowerCase())) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function out(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
const err = (req: Request, status: number, error: string, message: string) => out(req, status, { error, message });

interface AdminUser { id: string; email: string }

async function authenticate(req: Request): Promise<AdminUser | Response> {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+([A-Za-z0-9._-]{20,4096})$/);
  if (!m) return err(req, 401, "unauthorized", "Sign in first.");
  const url = Deno.env.get("SUPABASE_URL")!;
  const apikey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${m[1]}`, apikey } });
  } catch {
    return err(req, 503, "auth_unavailable", "Could not reach Supabase Auth.");
  }
  if (res.status !== 200) return err(req, 401, "unauthorized", "Session expired or invalid. Sign in again.");
  const u = await res.json().catch(() => null) as { id?: string; email?: string; email_confirmed_at?: string | null } | null;
  const email = (u?.email ?? "").toLowerCase();
  const allowed = list("ADMIN_EMAILS");
  if (!u?.id || !email || !u.email_confirmed_at || allowed.length === 0 || !allowed.includes(email)) {
    return err(req, 403, "forbidden", "This account is not an admin.");
  }
  return { id: u.id, email };
}

async function audit(actor: string, action: string, target: string | null, details: Record<string, unknown> = {}) {
  const r = await admin().from("admin_audit").insert({ actor, action, target, details });
  if (r.error) console.error("admin-api: audit insert failed", r.error);
}

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : null;
}

const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const origin = req.headers.get("origin");
  if (origin && !list("ADMIN_ORIGINS").includes(origin.toLowerCase())) return err(req, 403, "origin_not_allowed", "Origin not allowed.");
  if (req.method !== "POST") return err(req, 405, "method_not_allowed", "Use POST.");

  const who = await authenticate(req);
  if (who instanceof Response) return who;

  const db = admin();
  const rl = await db.rpc("admin_rate_hit", { p_user: who.id, p_limit: RATE_LIMIT, p_window_sec: RATE_WINDOW });
  if (rl.error) { console.error("admin-api: rate", rl.error); return err(req, 500, "db_error", "Rate check failed."); }
  if (rl.data !== true) return err(req, 429, "rate_limited", "Too many requests. Wait a minute.");

  const body = await readJson(req);
  if (!body) return err(req, 400, "bad_request", "Send a JSON body.");
  const action = String(body.action ?? "");

  try {
    switch (action) {
      // ------------------------------------------------------------------ read
      case "dashboard": {
        const today = istDay();
        const [l, p, pend, un] = await Promise.all([
          db.from("listings").select("approved,removed,total_paid"),
          db.from("payments").select("amount,provider,paid_at").eq("status", "paid"),
          db.from("payments").select("id", { count: "exact", head: true }).eq("provider", "upi").eq("status", "pending").gt("expires_at", new Date().toISOString()),
          db.from("upi_unmatched").select("id", { count: "exact", head: true }).eq("status", "open"),
        ]);
        if (l.error || p.error || pend.error || un.error) throw l.error ?? p.error ?? pend.error ?? un.error;
        const ls = l.data ?? [];
        const ps = (p.data ?? []) as { amount: number; provider: string; paid_at: string }[];
        const sum = (a: typeof ps) => a.reduce((s, x) => s + Number(x.amount), 0);
        const todayRows = ps.filter((x) => istDay(new Date(x.paid_at)) === today);
        const setting = await db.from("app_settings").select("value,updated_at,updated_by").eq("key", "bidding_open").maybeSingle();
        return out(req, 200, {
          listings: {
            total: ls.length,
            live: ls.filter((x) => x.approved && !x.removed && x.total_paid > 0).length,
            hidden: ls.filter((x) => x.removed).length,
            unpaid_drafts: ls.filter((x) => !x.approved && !x.removed).length,
          },
          revenue: {
            today: sum(todayRows), all_time: sum(ps),
            today_excl_manual: sum(todayRows.filter((x) => x.provider !== "manual")),
            all_time_excl_manual: sum(ps.filter((x) => x.provider !== "manual")),
            paid_count: ps.length,
          },
          pending_upi_orders: pend.count ?? 0,
          open_unmatched: un.count ?? 0,
          bidding: {
            open: setting.data ? setting.data.value === true : (Deno.env.get("BIDDING_OPEN") ?? "").toLowerCase() === "true",
            source: setting.data ? "admin setting" : "BIDDING_OPEN secret",
            updated_at: setting.data?.updated_at ?? null,
            updated_by: setting.data?.updated_by ?? null,
          },
          ist_day: today,
          you: who.email,
        });
      }

      case "listings": {
        const r = await db.from("listings")
          .select("id,name,url,category,city,story,contact_email,total_paid,approved,removed,created_at,first_paid_at")
          .order("total_paid", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
        if (r.error) throw r.error;
        const rows = (r.data ?? []).map((x) => ({
          ...x,
          status: x.removed ? "hidden" : x.approved && x.total_paid > 0 ? "live" : "unpaid draft",
        }));
        return out(req, 200, { listings: rows });
      }

      case "payments": {
        const r = await db.from("payments")
          .select("id,listing_id,board,amount,amount_paise,bid_total,provider,status,order_code,confirmed_by,admin_note,created_at,paid_at,listings(name)")
          .order("created_at", { ascending: false }).limit(100);
        if (r.error) throw r.error;
        return out(req, 200, { payments: r.data ?? [] });
      }

      case "audit": {
        const r = await db.from("admin_audit").select("id,actor,action,target,details,at").order("at", { ascending: false }).limit(50);
        if (r.error) throw r.error;
        return out(req, 200, { audit: r.data ?? [] });
      }

      case "upi_list": {
        const since = new Date(Date.now() - 3 * 864e5).toISOString();
        const [p, u] = await Promise.all([
          db.from("payments")
            .select("id,order_code,amount,amount_paise,bid_total,board,status,created_at,expires_at,listing_id,listings(name,contact_email,approved)")
            .eq("provider", "upi").in("status", ["pending", "expired"]).gte("created_at", since)
            .order("created_at", { ascending: false }).limit(200),
          db.from("upi_unmatched").select("id,title,body,app,amount_paise,reason,created_at")
            .eq("status", "open").order("created_at", { ascending: false }).limit(200),
        ]);
        if (p.error || u.error) throw p.error ?? u.error;
        const now = Date.now();
        const pending = (p.data ?? []).map((r: Record<string, unknown>) => ({
          ...r,
          status: r.status === "pending" && Date.parse(String(r.expires_at)) <= now ? "expired" : r.status,
        }));
        return out(req, 200, { pending, unmatched: u.data ?? [] });
      }

      // ------------------------------------------------------------------ write
      case "hide":
      case "unhide": {
        const id = String(body.id ?? "");
        if (!UUID_RE.test(id)) return err(req, 400, "bad_request", "id required.");
        const r = await db.rpc("admin_set_hidden", { p_listing_id: id, p_hidden: action === "hide" });
        if (r.error) throw r.error;
        if (r.data !== true) return err(req, 404, "not_found", "No such listing.");
        await audit(who.email, action, id);
        return out(req, 200, { ok: true });
      }

      case "delete": {
        const id = String(body.id ?? "");
        if (!UUID_RE.test(id)) return err(req, 400, "bad_request", "id required.");
        const l = await db.from("listings").select("name").eq("id", id).maybeSingle();
        if (l.error) throw l.error;
        if (!l.data) return err(req, 404, "not_found", "No such listing.");
        if (String(body.confirm ?? "") !== l.data.name) return err(req, 400, "confirm_required", "Type the listing name exactly to confirm.");
        const r = await db.rpc("admin_delete_listing", { p_listing_id: id });
        if (r.error) throw r.error;
        await audit(who.email, "delete", id, (r.data ?? {}) as Record<string, unknown>);
        return out(req, 200, { ok: true, ...(r.data as Record<string, unknown>) });
      }

      case "edit": {
        const id = String(body.id ?? "");
        if (!UUID_RE.test(id)) return err(req, 400, "bad_request", "id required.");
        const patch: Record<string, unknown> = {};
        const errors: string[] = [];
        if (body.name !== undefined) {
          const n = cleanStr(body.name, 60);
          if (!n || n.length < 2) errors.push("Name must be 2 to 60 characters."); else patch.name = n;
        }
        if (body.url !== undefined) {
          const r = normaliseUrl(String(body.url ?? ""));
          if (r.error) errors.push(r.error); else patch.url = r.url;
        }
        if (body.category !== undefined) {
          if (!(CATEGORIES as readonly string[]).includes(String(body.category))) errors.push("Pick a valid category."); else patch.category = body.category;
        }
        if (body.city !== undefined) {
          if (!(CITIES as readonly string[]).includes(String(body.city))) errors.push("Pick a valid city."); else patch.city = body.city;
        }
        if (body.story !== undefined) patch.story = cleanStr(body.story, 140);
        if (errors.length) return err(req, 422, "invalid", errors.join(" "));
        if (!Object.keys(patch).length) return err(req, 400, "bad_request", "Nothing to change.");
        const before = await db.from("listings").select("name,url,category,city,story").eq("id", id).maybeSingle();
        if (before.error) throw before.error;
        if (!before.data) return err(req, 404, "not_found", "No such listing.");
        const r = await db.from("listings").update(patch).eq("id", id).select("id");
        if (r.error) return err(req, 422, "invalid", r.error.message);
        const changed: Record<string, unknown> = {};
        for (const k of Object.keys(patch)) changed[k] = { from: (before.data as Record<string, unknown>)[k], to: patch[k] };
        await audit(who.email, "edit", id, changed);
        return out(req, 200, { ok: true });
      }

      case "add_manual": {
        const board = body.board === "today" ? "today" : body.board === "all" ? "all" : null;
        const amount = body.amount;
        const maxBid = Number(Deno.env.get("MAX_BID_RUPEES")) || DEFAULT_MAX_BID;
        if (!board) return err(req, 400, "bad_request", "board must be all or today.");
        if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > maxBid) {
          return err(req, 422, "invalid_amount", `Amount must be whole rupees, 1 to ${maxBid}.`);
        }
        const note = cleanStr(body.note, 200);
        let listingId: string;
        let created = false;
        let current = 0;
        if (typeof body.listing_id === "string" && body.listing_id) {
          if (!UUID_RE.test(body.listing_id)) return err(req, 400, "bad_request", "Bad listing_id.");
          const l = await db.from("listings").select("id,total_paid").eq("id", body.listing_id).maybeSingle();
          if (l.error) throw l.error;
          if (!l.data) return err(req, 404, "not_found", "No such listing.");
          listingId = l.data.id;
          current = Number(l.data.total_paid) || 0;
        } else {
          const e = cleanStr(body.email, 254)?.toLowerCase() || who.email;
          if (!EMAIL_RE.test(e)) return err(req, 422, "invalid", "Bad contact email.");
          const v = validateNewListing(body.listing, e);
          if (!v.listing) return err(req, 422, "invalid_listing", v.errors.join(" "));
          const ins = await db.from("listings").insert({ ...v.listing, business_details: v.listing.business_details || null, approved: false })
            .select("id").single();
          if (ins.error || !ins.data) return err(req, 422, "invalid_listing", ins.error?.message ?? "Could not save.");
          listingId = ins.data.id;
          created = true;
        }
        const r = await db.rpc("record_manual_payment", {
          p_listing_id: listingId, p_board: board, p_amount: amount, p_bid_total: current + amount, p_note: note,
        });
        if (r.error) {
          if (created) await db.from("listings").delete().eq("id", listingId).eq("total_paid", 0);
          throw r.error;
        }
        const row = Array.isArray(r.data) ? r.data[0] : r.data;
        await audit(who.email, "add_manual", listingId, { board, amount, created_listing: created, payment_id: row?.payment_id, note });
        return out(req, 200, { ok: true, listing_id: listingId, payment_id: row?.payment_id, created_listing: created });
      }

      case "upi_approve": {
        const pid = String(body.payment_id ?? "");
        const uid = body.unmatched_id == null || body.unmatched_id === "" ? null : Number(body.unmatched_id);
        if (!UUID_RE.test(pid) || (uid !== null && !Number.isInteger(uid))) return err(req, 400, "bad_request", "payment_id required.");
        const r = await db.rpc("admin_approve_upi", { p_payment_id: pid, p_unmatched_id: uid });
        if (r.error) return err(req, 409, "cannot_approve", r.error.message);
        const row = Array.isArray(r.data) ? r.data[0] : r.data;
        await audit(who.email, "upi_approve", pid, { unmatched_id: uid, ...(row ?? {}) });
        return out(req, 200, { ok: true, ...(row ?? {}) });
      }

      case "upi_reject": {
        const pid = String(body.payment_id ?? "");
        if (!UUID_RE.test(pid)) return err(req, 400, "bad_request", "payment_id required.");
        const r = await db.from("payments").update({ status: "failed" })
          .eq("id", pid).eq("provider", "upi").in("status", ["pending", "expired"]).select("id");
        if (r.error) throw r.error;
        if (!r.data?.length) return err(req, 409, "cannot_reject", "Order is not pending.");
        await audit(who.email, "upi_reject", pid);
        return out(req, 200, { ok: true });
      }

      case "upi_dismiss": {
        const uid = Number(body.unmatched_id);
        if (!Number.isInteger(uid)) return err(req, 400, "bad_request", "unmatched_id required.");
        const r = await db.from("upi_unmatched").update({ status: "rejected", resolved_at: new Date().toISOString() })
          .eq("id", uid).eq("status", "open").select("id");
        if (r.error) throw r.error;
        if (!r.data?.length) return err(req, 409, "cannot_dismiss", "Already resolved.");
        await audit(who.email, "upi_dismiss", String(uid));
        return out(req, 200, { ok: true });
      }

      case "set_bidding": {
        if (typeof body.open !== "boolean") return err(req, 400, "bad_request", "open must be true or false.");
        const r = await db.from("app_settings").upsert({
          key: "bidding_open", value: body.open, updated_at: new Date().toISOString(), updated_by: who.email,
        });
        if (r.error) throw r.error;
        await audit(who.email, "set_bidding", "bidding_open", { open: body.open });
        return out(req, 200, { ok: true, open: body.open });
      }

      default:
        return err(req, 400, "bad_request", "Unknown action.");
    }
  } catch (e) {
    console.error("admin-api", action, e);
    return err(req, 500, "server_error", "Something went wrong. Check the function logs.");
  }
});
