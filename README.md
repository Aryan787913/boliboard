# Boli: the public pay-to-rank board for Indian D2C brands

**Live:** https://boliboard.pages.dev

**Bid boldly. Hold #1.**

Boli is a public pay-to-rank leaderboard where Indian D2C brands and startups pay for visibility. Every rupee and every click is shown openly. Inspired by the pay-to-rank idea behind outbid.lol, built for the Indian market with its own design.

> Status: pre-launch. Bidding opens **Monday 16 November 2026, 8:00 PM IST**. Until real listings exist, the board shows clearly labelled **sample data** with fictional brands.

## How it works
- **₹199** gets a brand onto the board.
- To take **#1**, bid at least **₹100 more** than the current #1 (whole rupees only).
- Already listed? Raise on the same listing and pay **only the difference**.
- Boards: **All-time** (total ever paid), **Today** (resets at midnight IST), and the archived **Daily** boards.
- **City boards** (Mumbai, Delhi NCR, Bengaluru, Hyderabad, Pune, Jaipur, Other) and **category boards** (Skincare & Beauty, Snacks & Food, Fashion, Health & Fitness, Home, Startups).
- Equal amounts: the earlier listing ranks higher.

## Trust and compliance (India)
- A bid buys a **paid listing**, nothing more. No chance, no prize, no winnings.
- Every listing is tagged **Paid listing**.
- Prohibited: adult content; betting or real-money gaming; alcohol, tobacco and vapes; drugs; weapons; crypto or investment schemes; MLM; medical cure claims; political or religious content; hate, caste or communal content; counterfeit goods; misleading claims; chat or invite links, URL shorteners and tracking parameters.
- **Visibility only.** No guarantees of clicks, traffic, followers or sales.
- Founder names appear only with the founder's consent. Rivalry posts only tag brands that opted in.
- Payments through Razorpay (UPI, cards, netbanking), with a receipt for every payment.

## Architecture

```
index.html  styles.css  app.js        static site, vanilla JS, no build step (Cloudflare Pages)
config.js                             PUBLIC config only (Supabase URL + anon key, Razorpay key id, BIDDING_OPEN)
sample-data.js                        fictional sample brands, used until the live board has data
_headers                              Cloudflare Pages security/caching headers
supabase/schema.sql                   tables, RLS, public views, record_payment()
supabase/functions/create-order       validates the bid, creates a Razorpay order
supabase/functions/verify-payment     verifies the Razorpay signature, records the payment
supabase/functions/track-click        unique visits and outbound clicks (salted hash, no raw IPs)
supabase/config.toml                  turns off gateway JWT checks for the three functions (they validate themselves)
```

**Data rules enforced in the database and functions**
- `anon` can only insert into `waitlist` and read approved listings (public columns) plus the public views (`board_all_time`, `board_today`, `board_daily`, `daily_days`, `public_stats`, `public_activity`). Emails, GST details and Razorpay ids are never readable from the browser. `anon` cannot write payments, listings, clicks or visits.
- Every verified payment adds to the listing's All-time total and to the IST day it was paid on (Today board and Daily archive).
- `create-order` re-checks every price rule server-side: whole rupees, total ≥ ₹199, a total above the current #1 must be at least #1 + ₹100, raises charge only the difference, max ₹5,00,000 per order (change with `MAX_BID_RUPEES`).
- `verify-payment` checks `HMAC_SHA256(order_id|payment_id, key_secret)`, confirms the order, amount and status with Razorpay (capturing an authorized payment), then calls `record_payment()`, which is atomic and idempotent.
- New listings stay hidden until their first payment is verified. To take a listing down: `update listings set removed = true where id = '…';`

The site works without any keys: it renders sample data, the claim drawer previews price math, and the pay button stays disabled.

## Setup

### 1. Supabase (free tier)
1. Create a project at https://supabase.com (region: Mumbai `ap-south-1`).
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, run it. (Safe to re-run.)
3. Install the CLI (https://supabase.com/docs/guides/cli), then from the repo root:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxxxxx RAZORPAY_KEY_SECRET=xxxxxxxx \
     BIDDING_OPEN=false CLICK_SALT=$(openssl rand -hex 16) \
     ALLOWED_ORIGINS=https://boliboard.pages.dev,http://localhost:8000
   supabase functions deploy create-order
   supabase functions deploy verify-payment
   supabase functions deploy track-click
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into functions automatically. Never put the service role key or the Razorpay secret in `config.js`.

### 2. Razorpay (test mode first)
1. Create an account at https://razorpay.com, switch the dashboard to **Test Mode**.
2. **Account & Settings → API Keys → Generate Test Key.** The Key Id goes into `config.js` and the function secrets; the Key Secret goes only into the function secrets.
3. Test card and UPI details: https://razorpay.com/docs/payments/payments/test-card-details/

### 2b. UPI payments (active, `PAYMENT_MODE: "upi"`)

Direct UPI to your own VPA, confirmed automatically from your phone's payment notifications. Razorpay code is
kept and switches back on with `PAYMENT_MODE: "razorpay"` in `config.js`.

- `create-upi-order`: validates the bid like `create-order`, reserves a unique payable amount (charge + random
  1-99 paise, unique among open orders for 24h), returns the exact amount, VPA, `upi://pay` link. 503 `UPI not configured`
  until the `UPI_VPA` secret is set. The board is credited the whole-rupee charge; the paise only tag the payment.
- `upi-status?id=`: returns only the order status (`pending | paid | expired | failed`); the checkout polls it every 4 s.
- `upi-notify`: webhook for MacroDroid (`x-boli-notify-token` = `NOTIFY_TOKEN`). Ignores debits/requests, parses the
  credited amount, marks the single matching pending order paid and activates the listing. Anything else lands in
  `upi_unmatched`. See `MACRODROID_SETUP.md`.
- `admin-upi` + `admin.html` (unlinked): list pending orders and unmatched notifications, Approve / Reject. Uses the same token.
- Secrets: `UPI_VPA` (your UPI ID, e.g. `name@okaxis`), `UPI_PAYEE_NAME` (`Boli`), `NOTIFY_TOKEN` (32 hex).
- SQL: the "Migration 2026-10-28" block at the end of `supabase/schema.sql`.

### 3. Fill `config.js`
```js
window.BOLI_CONFIG = {
  SUPABASE_URL: "https://<ref>.supabase.co",
  SUPABASE_ANON_KEY: "<anon or publishable key>",
  RAZORPAY_KEY_ID: "rzp_test_xxxxxxxx",
  BIDDING_OPEN: false,
  LAUNCH_AT: "2026-11-16T20:00:00+05:30"
};
```

### 4. Turn bidding on (test, then launch)
Bidding needs **both** switches: `BIDDING_OPEN: true` in `config.js` **and** `supabase secrets set BIDDING_OPEN=true`. With test keys, the whole flow (order → Razorpay Checkout → signature check → board update) runs in Razorpay test mode. For launch, swap in live keys (`rzp_live_…`) in both places.

### 5. Cloudflare Pages
The repo deploys as-is: **Build command:** none. **Output directory:** `/`. Every push to `main` deploys to https://boliboard.pages.dev; branches get preview URLs.

### Run locally
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Still to do before launch
- [ ] Contact & grievance email in the footer (currently `[contact email]`)
- [ ] Publish full Terms and Privacy Policy (promised before bidding opens)
- [ ] Razorpay webhook (`payment.captured`) as a backup for payments whose browser closes before verification
- [ ] Admin view for removals and refunds (today: SQL in the Supabase dashboard)
- [ ] Cleanup job for unpaid draft listings (`approved = false and total_paid = 0`)

## Changelog

### v2 (branch `v2-live`)
- New UI: mobile-first, dark/light mode, bold #1 hero card, top-3 podium, animated rank changes (FLIP + number tickers) with up/down badges, city and category filter chips, Daily archive with day navigation, claim drawer with live price math, public stats strip, movement feed, countdown. Keyboard and screen-reader friendly, respects reduced motion.
- Real backend: Supabase schema with RLS and public views; edge functions for Razorpay orders, signature verification and click tracking.
- Waitlist now saves to Supabase.
- `hark.css` / `hark.js` replaced by `styles.css` / `app.js`; `config.js` and `sample-data.js` added.
- Copy: removed the unproven "India's first" and "India's most-watched" claims; footer contact is a clear `[contact email]` placeholder.
- Dropped the launch-night guess slider and the sealed founding-brand tiles to keep the page focused.

### v1
- Front-end-only concept ("Ivory & Ink" design) with sample data.

## Author
Built by [@Aryan787913](https://github.com/Aryan787913), solo founder, ₹0 budget.
