// POST /functions/v1/create-upi-order
// Same body as create-order:
//   { mode: "new",   board: "all"|"today", bid, email, listing: {...} }
//   { mode: "raise", board: "all"|"today", bid, email, listing_id }
// Reserves a UNIQUE payable amount (bid charge + random 1-99 paise, unique among live pending UPI orders)
// and returns everything the buyer needs to pay by UPI. The listing is credited the whole-rupee charge;
// the paise only identify the payment. Confirmation arrives later through upi-notify (or admin-upi).
//
// Returns: { order_id, order_code, amount_paise, amount ("1.07"), vpa, payee_name, upi_link, expires_at,
//            listing_id, charge, bid, email }
// Errors: 503 upi_not_configured when the UPI_VPA secret is missing.
import { preflight, readJson, json, fail } from "../_shared/http.ts";
import { biddingOpenNow } from "../_shared/settings.ts";
import { admin } from "../_shared/db.ts";
import { prepareBid } from "../_shared/bid.ts";
import { VPA_RE, paiseToString, upiLink } from "../_shared/upi.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const vpa = (Deno.env.get("UPI_VPA") ?? "").trim();
  const payee = (Deno.env.get("UPI_PAYEE_NAME") ?? "Boli").trim() || "Boli";
  if (!vpa || !VPA_RE.test(vpa)) return fail(req, 503, "upi_not_configured", "UPI not configured.");

  if (!(await biddingOpenNow())) return fail(req, 403, "bidding_closed", "Bidding opens on 16 November 2026, 8 PM IST.");

  const body = await readJson(req);
  if (!body) return fail(req, 400, "bad_request", "Send a JSON body.");

  const p = await prepareBid(req, body);
  if (p instanceof Response) return p;

  const db = admin();
  let listingId = p.listingId;
  if (p.mode === "new") {
    const ins = await db.from("listings").insert({ ...p.newListing!, approved: false }).select("id").single();
    if (ins.error || !ins.data) return fail(req, 500, "db_error", "Could not save the listing.");
    listingId = ins.data.id;
  }

  // Atomic reservation (advisory lock inside): picks a free amount, inserts the pending payment row.
  const r = await db.rpc("reserve_upi_payment", {
    p_listing_id: listingId, p_board: p.board, p_amount: p.charge, p_bid_total: p.bid,
  });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (r.error || !row) {
    console.error("create-upi-order: reserve", r.error);
    if (p.mode === "new") await db.from("listings").delete().eq("id", listingId!).eq("approved", false);
    const busy = r.error?.message?.includes("no free upi amount");
    return fail(req, busy ? 503 : 500, busy ? "busy" : "db_error", busy ? "Too many open payments at this amount. Try a slightly different bid." : "Could not create the order.");
  }

  const paise = Number(row.amount_paise);
  return json(req, 200, {
    order_id: row.id,
    order_code: row.order_code,
    amount_paise: paise,
    amount: paiseToString(paise),
    vpa,
    payee_name: payee,
    upi_link: upiLink(vpa, payee, paise, row.order_code),
    expires_at: row.expires_at,
    listing_id: listingId,
    charge: p.charge,
    bid: p.bid,
    email: p.email,
  });
});
