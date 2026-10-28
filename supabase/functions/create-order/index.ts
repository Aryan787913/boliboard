// POST /functions/v1/create-order
// Body (new listing):  { mode: "new",   board: "all"|"today", bid: 4900, email, listing: { name, url, category, city, story?, offer?, discount_code?, founder_name?, founder_consent?, rivalry_opt_in?, business_details } }
// Body (raise):        { mode: "raise", board: "all"|"today", bid: 4900, email, listing_id }
// `bid` is the listing's NEW TOTAL on that board, in whole rupees. Only the difference is charged.
// Returns: { order_id, amount (paise), currency, key_id, listing_id, charge (rupees), bid }
import { preflight, readJson, json, fail } from "../_shared/http.ts";
import { biddingOpenNow } from "../_shared/settings.ts";
import { admin } from "../_shared/db.ts";
import { quote, DEFAULT_MAX_BID } from "../_shared/pricing.ts";
import { validateNewListing, EMAIL_RE } from "../_shared/validate.ts";
import { createOrder, keyId } from "../_shared/razorpay.ts";

type Board = "all" | "today";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (!(await biddingOpenNow())) return fail(req, 403, "bidding_closed", "Bidding opens on 16 November 2026, 8 PM IST.");

  const body = await readJson(req);
  if (!body) return fail(req, 400, "bad_request", "Send a JSON body.");

  const mode = body.mode === "raise" ? "raise" : body.mode === "new" ? "new" : null;
  const board: Board | null = body.board === "today" ? "today" : body.board === "all" ? "all" : null;
  if (!mode || !board) return fail(req, 400, "bad_request", "mode must be new|raise and board must be all|today.");

  const db = admin();
  const maxBid = Number(Deno.env.get("MAX_BID_RUPEES")) || DEFAULT_MAX_BID;
  const view = board === "all" ? "board_all_time" : "board_today";

  // Current #1 on the chosen board
  const topRes = await db.from(view).select("id,total").order("rank", { ascending: true }).limit(1).maybeSingle();
  if (topRes.error) return fail(req, 500, "db_error", "Could not read the board.");
  const top = topRes.data ? { id: String(topRes.data.id), total: Number(topRes.data.total) } : null;

  let listingId: string | null = null;
  let currentTotal = 0;
  let email: string;

  if (mode === "raise") {
    if (typeof body.listing_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.listing_id)) {
      return fail(req, 400, "bad_request", "listing_id is required.");
    }
    const l = await db.from("listings").select("id,approved,removed,total_paid,contact_email").eq("id", body.listing_id).maybeSingle();
    if (l.error) return fail(req, 500, "db_error", "Could not read the listing.");
    if (!l.data || !l.data.approved || l.data.removed) return fail(req, 404, "listing_not_found", "That listing isn't live.");
    listingId = l.data.id;
    if (board === "all") currentTotal = Number(l.data.total_paid) || 0;
    else {
      const t = await db.from("board_today").select("total").eq("id", listingId).maybeSingle();
      if (t.error) return fail(req, 500, "db_error", "Could not read today's board.");
      currentTotal = t.data ? Number(t.data.total) : 0;
    }
    const e = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    email = EMAIL_RE.test(e) ? e : l.data.contact_email;
  } else {
    const v = validateNewListing(body.listing, body.email);
    if (!v.listing) return fail(req, 422, "invalid_listing", v.errors.join(" "), { errors: v.errors });
    email = v.listing.contact_email;
  }

  // Pricing rules (whole rupees, >= ₹199, #1 needs current #1 + ₹100, raises charge the difference)
  const minEnv = Number(Deno.env.get("MIN_BID_RUPEES"));
  const minBid = Number.isInteger(minEnv) && minEnv >= 1 ? minEnv : undefined;
  const q = quote({ bid: body.bid, currentTotal, top, listingId, maxBid, minBid });
  if (!q.ok) return fail(req, 422, q.error, q.message, q.minForTop ? { min_for_top: q.minForTop } : {});

  // Create the listing row only after the price checks pass. It stays unapproved (invisible)
  // until verify-payment records a verified payment.
  if (mode === "new") {
    const v = validateNewListing(body.listing, body.email);
    const ins = await db.from("listings").insert({ ...v.listing!, approved: false }).select("id").single();
    if (ins.error || !ins.data) return fail(req, 500, "db_error", "Could not save the listing.");
    listingId = ins.data.id;
  }

  let order;
  try {
    order = await createOrder(q.charge * 100, `boli_${crypto.randomUUID().slice(0, 18)}`, {
      listing_id: listingId!, board, bid_total: String(q.bid), mode,
    });
  } catch (err) {
    console.error("create-order: razorpay", err);
    if (mode === "new") await db.from("listings").delete().eq("id", listingId!).eq("approved", false);
    return fail(req, 502, "payment_provider_error", "Couldn't start the payment. Please try again.");
  }

  const pay = await db.from("payments").insert({
    listing_id: listingId, board, amount: q.charge, bid_total: q.bid, razorpay_order_id: order.id, status: "created",
  });
  if (pay.error) {
    console.error("create-order: payments insert", pay.error);
    return fail(req, 500, "db_error", "Could not record the order.");
  }

  return json(req, 200, {
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    key_id: keyId(),
    listing_id: listingId,
    charge: q.charge,
    bid: q.bid,
    email,
  });
});
