/*
 * Boli public config. Everything in this file is PUBLIC and ships to every visitor.
 * Never put the Supabase service role key or the Razorpay key SECRET here.
 *
 * Leave the values empty and the site runs on clearly labelled sample data.
 */
window.BOLI_CONFIG = {
  // Supabase > Project Settings > API > Project URL, e.g. "https://abcdefgh.supabase.co"
  SUPABASE_URL: "https://oqdvnivyeaghyeisaylc.supabase.co",
  // Supabase > Project Settings > API > anon / publishable key (safe to expose; RLS protects the data)
  SUPABASE_ANON_KEY: "sb_publishable_dR9Y6X57YP5Ui5o2YKLvDQ_1dT29DKR",
  // Active payment method: "upi" (direct UPI to the payee VPA, confirmed automatically from the payee's phone
  // notifications via upi-notify) or "razorpay" (Razorpay Checkout via create-order / verify-payment, kept but off).
  PAYMENT_MODE: "upi",
  // Razorpay Dashboard (Test mode) > Account & Settings > API keys > Key Id, e.g. "rzp_test_XXXXXXXXXXXX"
  RAZORPAY_KEY_ID: "rzp_test_TtJ7dPa5VPNNVh",
  // Keep false until launch. The edge functions also refuse orders unless their BIDDING_OPEN secret is "true".
  BIDDING_OPEN: true,
  // Minimum listing price in whole rupees. Must match the MIN_BID_RUPEES backend secret.
  MIN_BID: 1,
  // Text shown in the UPI checkout. {amount}, {bid} and {code} are filled in. The VPA comes from the backend (UPI_VPA secret).
  UPI: {
    POLL_MS: 4000,
    PAY_CTA: "Continue to UPI payment",
    HEADLINE: "Pay exactly {amount}",
    EXACT_NOTE: "Pay this exact amount, paise included. The paise tag your payment so it confirms automatically.",
    QR_HINT: "Scan with any UPI app (GPay, PhonePe, Paytm, BHIM).",
    VPA_LABEL: "Or pay to this UPI ID",
    WAITING: "Waiting for payment… confirms automatically, can take a few minutes. You can close this page and come back.",
    SUCCESS: "Payment received. Your listing is live at {bid}.",
    EXPIRED: "This payment window has closed. If you already paid {amount}, contact us with your UPI reference and order code {code}.",
    FAILED: "This order was cancelled. If you already paid, contact us with your UPI reference and order code {code}.",
    NEW_BID: "Start a new bid"
  },
  // Payments line in the rules section, per mode (follows the bold word "Payments").
  PAYMENT_NOTE: {
    upi: "via UPI (any UPI app). Pay the exact amount shown; it confirms automatically. A confirmed payment claims the rank. Receipt for every payment. Payments are otherwise non-refundable.",
    razorpay: "via UPI, cards and netbanking (Razorpay). A completed payment claims the rank. Receipt/invoice for every payment. Payments are otherwise non-refundable."
  },
  // Launch moment (ISO 8601 with IST offset). Used by the countdown.
  LAUNCH_AT: "2026-11-16T20:00:00+05:30"
};
