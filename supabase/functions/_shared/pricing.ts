// Pure pricing rules for Boli. No Deno or network APIs, so it can be unit-tested anywhere.
//
// Rules (from the public rules on the site):
//  * Amounts are whole rupees.
//  * A board total ("bid") is at least ₹199.
//  * Taking #1 costs at least ₹100 more than the current #1. A total that would sit between the
//    current #1 and #1 + ₹99 is rejected: either stay at or below the #1 total, or pay the full step.
//  * Raising an existing listing only charges the difference between the new total and its current
//    total on that board.

export const MIN_BID = 199; // default; override with MIN_BID_RUPEES
export const TOP_STEP = 100;
export const DEFAULT_MAX_BID = 500_000; // ₹5,00,000 per order; override with MAX_BID_RUPEES

export interface QuoteInput {
  bid: unknown;                 // requested new total on the board (rupees)
  currentTotal: number;         // the listing's current total on that board (0 for a new listing)
  top: { id: string; total: number } | null; // current #1 on that board, if any
  listingId: string | null;     // null for a new listing
  maxBid?: number;
  minBid?: number;
}

export type Quote =
  | { ok: true; bid: number; charge: number; takesTop: boolean }
  | { ok: false; error: string; message: string; minForTop?: number };

export function quote(input: QuoteInput): Quote {
  const { bid, currentTotal, top, listingId } = input;
  const maxBid = input.maxBid ?? DEFAULT_MAX_BID;
  const minBid = input.minBid ?? MIN_BID;
  if (typeof bid !== "number" || !Number.isFinite(bid) || !Number.isInteger(bid)) {
    return { ok: false, error: "not_whole_rupees", message: "Bids are in whole rupees only." };
  }
  if (bid < minBid) return { ok: false, error: "below_minimum", message: `The minimum total is ₹${minBid}.` };
  if (bid > maxBid) return { ok: false, error: "above_maximum", message: `The maximum total per order is ₹${maxBid}.` };
  if (!Number.isInteger(currentTotal) || currentTotal < 0) {
    return { ok: false, error: "bad_state", message: "Could not read the current total." };
  }
  if (bid <= currentTotal) {
    return { ok: false, error: "not_a_raise", message: `This listing already has ₹${currentTotal} on this board. Enter a higher total.` };
  }
  const isTop = !!top && !!listingId && top.id === listingId;
  if (top && !isTop && bid > top.total && bid < top.total + TOP_STEP) {
    return {
      ok: false,
      error: "top_step",
      message: `To take #1 you need at least ₹${top.total + TOP_STEP}. At ₹${top.total} or less you list below #1.`,
      minForTop: top.total + TOP_STEP,
    };
  }
  const charge = bid - currentTotal;
  if (charge > maxBid) return { ok: false, error: "above_maximum", message: `The maximum charge per order is ₹${maxBid}.` };
  const takesTop = !top || isTop || bid >= top.total + TOP_STEP;
  return { ok: true, bid, charge, takesTop };
}
