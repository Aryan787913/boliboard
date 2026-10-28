/*
 * Boli public config. Everything in this file is PUBLIC and ships to every visitor.
 * Never put the Supabase service role key or the Razorpay key SECRET here.
 *
 * Leave the values empty and the site runs on clearly labelled sample data.
 */
window.BOLI_CONFIG = {
  // Supabase > Project Settings > API > Project URL, e.g. "https://abcdefgh.supabase.co"
  SUPABASE_URL: "",
  // Supabase > Project Settings > API > anon / publishable key (safe to expose; RLS protects the data)
  SUPABASE_ANON_KEY: "",
  // Razorpay Dashboard (Test mode) > Account & Settings > API keys > Key Id, e.g. "rzp_test_XXXXXXXXXXXX"
  RAZORPAY_KEY_ID: "",
  // Keep false until launch. The edge functions also refuse orders unless their BIDDING_OPEN secret is "true".
  BIDDING_OPEN: false,
  // Launch moment (ISO 8601 with IST offset). Used by the countdown.
  LAUNCH_AT: "2026-11-16T20:00:00+05:30"
};
