# Auto-confirm UPI payments with MacroDroid

Your Android phone tells Boli when money arrives. When Google Pay or JioFinance shows a
"₹1.07 received" notification, MacroDroid sends it to Boli, Boli finds the order with exactly
that amount, and the brand's listing goes live by itself.

You need:

- The Android phone where your UPI app (Google Pay / JioFinance) gets payment notifications.
- The free **MacroDroid** app from the Play Store.
- Your secret token. It is kept private; replace `<YOUR_TOKEN>` below with it. Never share it or put it on the website.
- This web address (the "URL"):

```
https://oqdvnivyeaghyeisaylc.supabase.co/functions/v1/upi-notify
```

---

## Part 1 · Install and allow MacroDroid

1. Open the **Play Store**, search **MacroDroid**, and install it.
2. Open MacroDroid. Skip or close any intro screens.
3. When MacroDroid asks for **Notification access**, tap **Allow**. (If it doesn't ask: phone **Settings → Notifications → Device & app notifications** (or "Notification access") → turn on **MacroDroid**.)
4. Stop the phone from killing MacroDroid in the background:
   - **Settings → Apps → MacroDroid → Battery** → choose **Unrestricted** (or "Don't optimise").
   - On OnePlus / Oppo / Realme phones also: **Settings → Apps → MacroDroid → Battery → Allow background activity** and **Allow auto launch** (turn both on).
   - Open the recent-apps screen, find MacroDroid, and tap the **lock** icon (or long-press → Lock) so it isn't cleared.
5. Make sure Google Pay / JioFinance notifications are **on** (Settings → Apps → Google Pay → Notifications → On). Boli can only see what shows up as a notification.

## Part 2 · Create the macro

6. In MacroDroid tap **Add Macro** (the big **+**).
7. At the top, name it **Boli UPI**.

### Trigger (when it runs)

8. Tap **+** in the red **Triggers** box.
9. Choose **Device Events → Notification → Notification Received** (on some versions: **Applications → Notification**).
10. Choose **Select Application(s)** and tick:
    - **Google Pay** (shown as "GPay" or "Google Pay")
    - **JioFinance**
    - **Jio Payments Bank** / **MyJio** (tick whichever you have)
    Tap **OK**.
11. For **Text content**, choose **Contains** and type: `received`
    Tap **OK**.
12. Add a second trigger the same way (steps 8 to 10 again, same apps), but this time type `credited` in step 11.
    (Now the macro runs when a notification contains "received" **or** "credited".)

### Action (what it does)

13. Tap **+** in the blue **Actions** box.
14. Choose **Web Interactions → HTTP Request**.
15. **Request method:** choose **POST**.
16. **URL:** paste:
    ```
    https://oqdvnivyeaghyeisaylc.supabase.co/functions/v1/upi-notify
    ```
17. Open the **Headers** tab (or "Add header") and add one header:
    - Name: `x-boli-notify-token`
    - Value: `<YOUR_TOKEN>`
18. Open the **Body** / **Content body** tab:
    - Content type: **application/json**
    - Body: paste exactly this (the parts in `{ }` are MacroDroid "magic text" it fills in by itself):
    ```
    {"title": "{not_title}", "text": "{not_text}", "app": "{not_app_name}"}
    ```
    Tip: instead of typing `{not_title}` you can tap the **…** / magic-text button and pick **Notification title**, **Notification text** and **Notification app name**.
19. Leave timeouts as they are. Tap **OK** / the back arrow to save the action.

### Save

20. Leave **Constraints** empty.
21. Tap the **save** (tick / disk) icon. Make sure the macro's switch is **on**.

## Part 3 · Test it

22. Ask a friend to start a Boli bid (or start one yourself from another phone) and pay the exact amount shown, for example **₹1.07**.
23. When the "₹1.07 received" notification appears, wait up to a minute. The buyer's page should switch to **Payment received** by itself.
24. To check MacroDroid ran: open MacroDroid → **☰ menu → System Log**. You should see "Boli UPI" and an HTTP request with result **200**.

## If something goes wrong

- **Nothing happens:** check step 3 (notification access) and step 4 (battery). Restart the phone once.
- **Log shows 401:** the token in step 17 is wrong. Copy it again carefully, with no spaces.
- **Log shows 200 but the order didn't confirm:** the amount didn't match an open order (buyer paid a different amount, or more than 24 hours later). Open the admin page (`/admin.html` on the Boli site), find it under **Unmatched notifications**, pick the right order and tap **Approve**, or approve the order directly under **Pending orders** after checking the money arrived.
- Money you send ("paid to…", "debited") and payment requests are ignored on purpose.
- Notification texts with line breaks or quotes are handled; if one ever fails to confirm, approve it from the admin page.
