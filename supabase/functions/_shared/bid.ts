// Bid validation shared by the payment entry points. Same rules as create-order (which keeps its own
// copy so the Razorpay path stays untouched): new listing fields via validateNewListing, pricing via quote(),
// minimum from MIN_BID_RUPEES, maximum from MAX_BID_RUPEES.
import { fail } from "./http.ts";
import { admin } from "./db.ts";
import { quote, DEFAULT_MAX_BID } from "./pricing.ts";
import { validateNewListing, EMAIL_RE, type NewListing } from "./validate.ts";

export type Board = "all" | "today";

export interface PreparedBid {
  mode: "new" | "raise";
  board: Board;
  bid: number;       // new total on the board (rupees)
  charge: number;    // rupees to collect (difference)
  email: string;
  listingId: string | null;      // existing listing (raise) or null (new; insert after reserving)
  newListing: NewListing | null; // validated fields for a new listing
}

export async function prepareBid(req: Request, body: Record<string, unknown>): Promise<PreparedBid | Response> {
  const mode = body.mode === "raise" ? "raise" : body.mode === "new" ? "new" : null;
  const board: Board | null = body.board === "today" ? "today" : body.board === "all" ? "all" : null;
  if (!mode || !board) return fail(req, 400, "bad_request", "mode must be new|raise and board must be all|today.");

  const db = admin();
  const maxBid = Number(Deno.env.get("MAX_BID_RUPEES")) || DEFAULT_MAX_BID;
  const view = board === "all" ? "board_all_time" : "board_today";

  const topRes = await db.from(view).select("id,total").order("rank", { ascending: true }).limit(1).maybeSingle();
  if (topRes.error) return fail(req, 500, "db_error", "Could not read the board.");
  const top = topRes.data ? { id: String(topRes.data.id), total: Number(topRes.data.total) } : null;

  let listingId: string | null = null;
  let currentTotal = 0;
  let email: string;
  let newListing: NewListing | null = null;

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
    newListing = v.listing;
    email = v.listing.contact_email;
  }

  const minEnv = Number(Deno.env.get("MIN_BID_RUPEES"));
  const minBid = Number.isInteger(minEnv) && minEnv >= 1 ? minEnv : undefined;
  const q = quote({ bid: body.bid, currentTotal, top, listingId, maxBid, minBid });
  if (!q.ok) return fail(req, 422, q.error, q.message, q.minForTop ? { min_for_top: q.minForTop } : {});

  return { mode, board, bid: q.bid, charge: q.charge, email, listingId, newListing };
}
