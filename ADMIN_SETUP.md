# Boli admin site: setup and login

The admin site is a separate website, only for you. It is not linked from boliboard.pages.dev.
Address after setup: **https://boli-admin.pages.dev**

## A. Put the admin site online (one time, about 3 minutes)

1. Download **boli-admin.zip** to your computer. Do not unzip it.
2. Open https://dash.cloudflare.com and sign in.
3. In the left menu click **Workers & Pages**.
4. Click **Create** (top right), then the **Pages** tab.
5. Click **Upload assets** (Direct Upload). Do not pick "Connect to Git".
6. Project name: type exactly **boli-admin**, then click **Create project**.
7. Drag **boli-admin.zip** into the upload box (or click to choose it).
8. Click **Deploy site**. Wait for "Success".
9. Open **https://boli-admin.pages.dev**. You should see "Boli · owner admin" and a sign-in box.

If Cloudflare says the name `boli-admin` is taken, stop and tell Hark the name you got instead. The backend only accepts
`https://boli-admin.pages.dev`, so the new address has to be added first.

**To update later:** Workers & Pages → boli-admin → **Create deployment** → upload the new zip.

## B. Log in

1. Open https://boli-admin.pages.dev
2. Type **aryansengar02@gmail.com** and click **Send sign-in email**. Only this email works; everyone else is refused.
3. Open Gmail and find the email from Supabase ("Your sign-in link" or "Your Boli admin code").
4. Sign in one of these ways:
   - **Code:** if the email shows a 6-digit code, type it into the admin page and click **Sign in with code**.
   - **Link, same device:** click **Sign in** in the email on the same phone or laptop where the admin page is open.
   - **Link, other device:** long-press **Sign in** in the email, choose "Copy link", paste it into the box on the admin
     page and click **Sign in with link**.
5. Done. The email works once and expires in 10 minutes.

Good to know:
- Today the email has a **link only**, no 6-digit code. Supabase's free email sender doesn't allow changing the email
  text. To get codes, do section C once.
- The free sender allows about **2 sign-in emails per hour**. If no email arrives, wait and try again later.
- You are signed out automatically after **30 minutes** without activity, and when you close the tab.
- Click **Sign out** when you finish on a shared computer.

## C. Optional: get a 6-digit code in the email

1. Turn on 2-Step Verification for your Google account (if it's off): https://myaccount.google.com/security
2. Open https://myaccount.google.com/apppasswords, create an app password named "Boli", and copy the 16 letters.
3. Open https://supabase.com/dashboard/project/oqdvnivyeaghyeisaylc/auth/smtp
4. Turn on **Enable custom SMTP** and fill in:
   - Sender email: aryansengar02@gmail.com · Sender name: Boli
   - Host: smtp.gmail.com · Port: 465
   - Username: aryansengar02@gmail.com · Password: the 16-letter app password
5. Click **Save**, then tell Hark "SMTP is on". Hark changes the sign-in email so it shows the 6-digit code.

## What the admin site does

- Dashboard: live listings, revenue today and all-time, pending UPI payments, and an open/close switch for bidding.
- UPI: approve or reject pending payments, and dismiss payment notifications that matched no order.
- Listings: edit, hide/unhide (hidden = gone from all public boards), delete permanently (type the name to confirm).
- Add a listing yourself for a free or offline payment. It shows on the board like a paid one; the dashboard also
  shows revenue without these manual entries.
- Recent payments, and an audit log of every change (who, what, when).

The old `boliboard.pages.dev/admin.html` page is removed. Re-upload the new **boli-deploy.zip** to the public
`boliboard` project so the old page disappears from the live site.
