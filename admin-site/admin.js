/* Boli owner admin. No libraries, no inline code (strict CSP).
 * Auth: Supabase Auth email OTP (POST /auth/v1/otp, create_user false; signups are disabled server-side).
 *       Sign in by 6-digit code, by clicking the emailed link on this device, or by pasting that link.
 * Session: sessionStorage only (gone when the tab closes); auto sign-out after 30 min without activity.
 * Every data call goes to the admin-api edge function, which re-verifies the token with Supabase Auth and checks the
 * ADMIN_EMAILS allowlist. Only the PUBLIC publishable key is here; there is no service key anywhere client-side. */
(function () {
  "use strict";
  var SUPABASE_URL = "https://oqdvnivyeaghyeisaylc.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_dR9Y6X57YP5Ui5o2YKLvDQ_1dT29DKR";
  var API = SUPABASE_URL + "/functions/v1/admin-api";
  var IDLE_MS = 30 * 60 * 1000;
  var KEY = "boli_admin_session";
  var CATEGORIES = ["Skincare & Beauty", "Snacks & Food", "Fashion", "Health & Fitness", "Home", "Startups"];
  var CITIES = ["Mumbai", "Delhi NCR", "Bengaluru", "Hyderabad", "Pune", "Jaipur", "Other"];

  var $ = function (s) { return document.querySelector(s); };
  var session = null, lastActive = Date.now(), pendingEmail = "", listingsCache = [], biddingOpen = null;

  /* ---------- helpers ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") el.textContent = attrs[k];
      else if (k === "class") el.className = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function msg(text, isErr) { var m = $("#msg"); m.textContent = text || ""; m.className = isErr ? "err" : text ? "ok" : ""; }
  var rupees = function (n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); };
  var paise = function (p) { return p == null ? "?" : "₹" + Math.floor(p / 100).toLocaleString("en-IN") + "." + String(p % 100).padStart(2, "0"); };
  var when = function (t) { return t ? new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—"; };
  function fillSelect(sel, items) { items.forEach(function (v) { sel.appendChild(h("option", { value: v, text: v })); }); }
  function table(cols, rows) {
    if (!rows.length) return h("p", { class: "muted", text: "Nothing here." });
    return h("table", null, [
      h("thead", null, [h("tr", null, cols.map(function (c) { return h("th", { text: c[0] }); }))]),
      h("tbody", null, rows.map(function (r) {
        return h("tr", null, cols.map(function (c) { var v = c[1](r); return h("td", null, [v instanceof Node ? v : String(v == null ? "" : v)]); }));
      }))
    ]);
  }

  /* ---------- auth ---------- */
  function save(s) {
    session = s;
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY);
  }
  function fromTokenResponse(j) {
    if (!j || !j.access_token || !j.refresh_token) throw new Error("Sign-in failed.");
    return { access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: j.expires_at ? j.expires_at * 1000 : Date.now() + (Number(j.expires_in) || 3600) * 1000,
      email: j.user && j.user.email || "" };
  }
  function authFetch(path, body) {
    return fetch(SUPABASE_URL + "/auth/v1" + path, {
      method: "POST", headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.msg || j.error_description || j.message || ("Error " + r.status));
        return j;
      });
    });
  }
  function sendCode(email) {
    var redirect = encodeURIComponent(location.origin + location.pathname);
    return authFetch("/otp?redirect_to=" + redirect, { email: email, create_user: false });
  }
  function verifyCode(email, code) { return authFetch("/verify", { type: "email", email: email, token: code }).then(fromTokenResponse); }
  function verifyLink(url) {
    var u; try { u = new URL(url.trim()); } catch (e) { return Promise.reject(new Error("That isn't a link.")); }
    if (u.origin !== SUPABASE_URL) return Promise.reject(new Error("Paste the link from the Boli sign-in email."));
    var th = u.searchParams.get("token"), type = u.searchParams.get("type") || "magiclink";
    if (!th) return Promise.reject(new Error("No token in that link."));
    return authFetch("/verify", { type: type, token_hash: th }).then(fromTokenResponse);
  }
  function refresh() {
    return authFetch("/token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(function (j) { var s = fromTokenResponse(j); s.email = s.email || session.email; save(s); });
  }
  function token() {
    if (!session) return Promise.reject(new Error("Signed out."));
    if (session.expires_at - Date.now() > 90 * 1000) return Promise.resolve(session.access_token);
    return refresh().then(function () { return session.access_token; });
  }
  function signOut(reason) {
    var t = session && session.access_token;
    save(null);
    if (t) fetch(SUPABASE_URL + "/auth/v1/logout?scope=global", { method: "POST", headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + t } }).catch(function () {});
    showLogin();
    msg(reason || "Signed out.", !!reason);
  }

  /* ---------- api ---------- */
  function api(action, params) {
    lastActive = Date.now();
    return token().then(function (t) {
      return fetch(API, {
        method: "POST",
        headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ action: action }, params || {}))
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { signOut("Session ended. Sign in again."); throw new Error("Signed out."); }
        if (r.status === 403 && j.error === "forbidden") { signOut("This account is not an admin."); throw new Error("Forbidden."); }
        if (!r.ok) throw new Error(j.message || j.error || ("Error " + r.status));
        return j;
      });
    });
  }
  function act(action, params, okText) {
    return api(action, params).then(function (j) { msg(okText || "Done."); loadAll(); return j; })
      .catch(function (e) { msg(e.message, true); });
  }

  /* ---------- views ---------- */
  function showLogin() {
    $("#app").hidden = true; $("#signout").hidden = true; $("#who").textContent = "";
    $("#login").hidden = false; $("#code-step").hidden = !pendingEmail; $("#email-form").hidden = !!pendingEmail;
  }
  function showApp() {
    $("#login").hidden = true; $("#app").hidden = false; $("#signout").hidden = false;
    $("#who").textContent = session.email;
    loadAll();
  }

  function loadAll() {
    return Promise.all([
      api("dashboard").then(renderDash),
      api("upi_list").then(renderUpi),
      api("listings").then(renderListings),
      api("payments").then(renderPayments),
      api("audit").then(renderAudit)
    ]).catch(function (e) { if (session) msg(e.message, true); });
  }

  function renderDash(d) {
    if (d.you) { session.email = d.you; $("#who").textContent = d.you; }
    var box = $("#stats"); box.textContent = "";
    [["Live listings", d.listings.live], ["Hidden", d.listings.hidden], ["Unpaid drafts", d.listings.unpaid_drafts],
     ["Revenue today", rupees(d.revenue.today)], ["Revenue all-time", rupees(d.revenue.all_time)],
     ["…excl. manual", rupees(d.revenue.all_time_excl_manual)], ["Pending UPI", d.pending_upi_orders], ["Unmatched UPI", d.open_unmatched]
    ].forEach(function (s) { box.appendChild(h("div", { class: "stat" }, [h("b", { text: String(s[1]) }), h("span", { text: s[0] })])); });
    biddingOpen = d.bidding.open;
    $("#bid-state").textContent = biddingOpen ? "OPEN" : "CLOSED";
    $("#bid-state").className = biddingOpen ? "good" : "bad";
    $("#bid-src").textContent = "(" + d.bidding.source + (d.bidding.updated_at ? ", " + when(d.bidding.updated_at) : "") + ")";
    $("#bid-toggle").textContent = biddingOpen ? "Close bidding" : "Open bidding";
  }

  function renderUpi(d) {
    var unmatched = d.unmatched || [];
    var pend = $("#upi-pending"); pend.textContent = "";
    pend.appendChild(table([
      ["Code", function (r) { return r.order_code; }],
      ["Pay", function (r) { return paise(r.amount_paise); }],
      ["Credit", function (r) { return rupees(r.amount) + " → " + rupees(r.bid_total) + " (" + r.board + ")"; }],
      ["Listing", function (r) { return (r.listings && r.listings.name || "?") + (r.listings && !r.listings.approved ? " (new)" : ""); }],
      ["Status", function (r) { return h("span", { class: "tag " + r.status, text: r.status }); }],
      ["Created", function (r) { return when(r.created_at); }],
      ["", function (r) {
        var sel = h("select", null, [h("option", { value: "", text: "no notification" })]);
        unmatched.filter(function (u) { return u.amount_paise === r.amount_paise || u.amount_paise == null; })
          .forEach(function (u) { sel.appendChild(h("option", { value: String(u.id), text: "#" + u.id + " " + paise(u.amount_paise) })); });
        return h("div", { class: "row" }, [sel,
          h("button", { class: "good-btn small", type: "button", text: "Approve", onclick: function () {
            if (confirm("Mark " + r.order_code + " paid and credit " + rupees(r.amount) + "?")) act("upi_approve", { payment_id: r.id, unmatched_id: sel.value || null }, "Approved " + r.order_code + ".");
          } }),
          h("button", { class: "bad-btn small", type: "button", text: "Reject", onclick: function () {
            if (confirm("Reject order " + r.order_code + "?")) act("upi_reject", { payment_id: r.id }, "Rejected " + r.order_code + ".");
          } })]);
      }]
    ], d.pending || []));
    var un = $("#upi-unmatched"); un.textContent = "";
    un.appendChild(table([
      ["#", function (u) { return u.id; }],
      ["Amount", function (u) { return paise(u.amount_paise); }],
      ["Reason", function (u) { return h("span", { class: "tag " + u.reason, text: u.reason }); }],
      ["Notification", function (u) { return h("pre", { text: (u.app ? "[" + u.app + "] " : "") + (u.title || "") + "\n" + (u.body || "") }); }],
      ["At", function (u) { return when(u.created_at); }],
      ["", function (u) { return h("button", { class: "small", type: "button", text: "Dismiss", onclick: function () {
        if (confirm("Dismiss notification #" + u.id + "?")) act("upi_dismiss", { unmatched_id: u.id }, "Dismissed.");
      } }); }]
    ], unmatched));
  }

  function renderListings(d) {
    listingsCache = d.listings || [];
    var sel = $("#add-existing"), keep = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    listingsCache.forEach(function (l) { sel.appendChild(h("option", { value: l.id, text: l.name + " (" + rupees(l.total_paid) + ", " + l.status + ")" })); });
    sel.value = keep;
    var box = $("#listings"); box.textContent = "";
    box.appendChild(table([
      ["Name", function (l) { return h("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", text: l.name }); }],
      ["Total", function (l) { return rupees(l.total_paid); }],
      ["Status", function (l) { return h("span", { class: "tag " + l.status.replace(/\s/g, "-"), text: l.status }); }],
      ["Cat / City", function (l) { return l.category + " · " + l.city; }],
      ["Contact", function (l) { return l.contact_email; }],
      ["Created", function (l) { return when(l.created_at); }],
      ["", function (l) {
        return h("div", { class: "row" }, [
          h("button", { class: "small", type: "button", text: "Edit", onclick: function () { openEdit(l); } }),
          l.removed
            ? h("button", { class: "small", type: "button", text: "Unhide", onclick: function () { act("unhide", { id: l.id }, "Unhidden."); } })
            : h("button", { class: "small", type: "button", text: "Hide", onclick: function () {
                if (confirm("Hide " + l.name + " from all public boards?")) act("hide", { id: l.id }, "Hidden.");
              } }),
          h("button", { class: "bad-btn small", type: "button", text: "Delete", onclick: function () {
            var typed = prompt("PERMANENTLY delete \"" + l.name + "\" and all its payments? Revenue totals will drop. Type the name exactly to confirm:");
            if (typed === null) return;
            if (typed !== l.name) { msg("Name didn't match. Nothing deleted.", true); return; }
            act("delete", { id: l.id, confirm: typed }, "Deleted " + l.name + ".");
          } })
        ]);
      }]
    ], listingsCache));
  }

  function renderPayments(d) {
    var box = $("#payments"); box.textContent = "";
    box.appendChild(table([
      ["When", function (p) { return when(p.paid_at || p.created_at); }],
      ["Listing", function (p) { return p.listings && p.listings.name || p.listing_id; }],
      ["Amount", function (p) { return rupees(p.amount) + (p.provider === "upi" ? " (paid " + paise(p.amount_paise) + ")" : ""); }],
      ["Board total", function (p) { return rupees(p.bid_total) + " · " + p.board; }],
      ["Via", function (p) { return p.provider + (p.confirmed_by ? " / " + p.confirmed_by : "") + (p.order_code ? " · " + p.order_code : ""); }],
      ["Status", function (p) { return h("span", { class: "tag " + p.status, text: p.status }); }],
      ["Note", function (p) { return p.admin_note || ""; }]
    ], d.payments || []));
  }

  function renderAudit(d) {
    var box = $("#audit"); box.textContent = "";
    box.appendChild(table([
      ["At", function (a) { return when(a.at); }],
      ["Who", function (a) { return a.actor; }],
      ["Action", function (a) { return a.action; }],
      ["Target", function (a) { return a.target || ""; }],
      ["Details", function (a) { return a.details && Object.keys(a.details).length ? h("code", { text: JSON.stringify(a.details) }) : ""; }]
    ], d.audit || []));
  }

  var editing = null;
  function openEdit(l) {
    editing = l;
    $("#ed-name").value = l.name; $("#ed-url").value = l.url; $("#ed-category").value = l.category;
    $("#ed-city").value = l.city; $("#ed-story").value = l.story || "";
    $("#edit-dlg").showModal();
  }

  /* ---------- wiring ---------- */
  function init() {
    fillSelect($("#add-category"), CATEGORIES); fillSelect($("#add-city"), CITIES);
    fillSelect($("#ed-category"), CATEGORIES); fillSelect($("#ed-city"), CITIES);

    $("#email-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("#email").value.trim().toLowerCase();
      msg("Sending…");
      sendCode(email).then(function () {
        pendingEmail = email; showLogin(); msg("Email sent to " + email + ". It can take a minute."); $("#code").focus();
      }).catch(function (err) { msg(err.message, true); });
    });
    $("#code-form").addEventListener("submit", function (e) {
      e.preventDefault();
      verifyCode(pendingEmail, $("#code").value.trim()).then(function (s) { save(s); pendingEmail = ""; msg(""); showApp(); })
        .catch(function (err) { msg(err.message, true); });
    });
    $("#link-form").addEventListener("submit", function (e) {
      e.preventDefault();
      verifyLink($("#link").value).then(function (s) { save(s); pendingEmail = ""; $("#link").value = ""; msg(""); showApp(); })
        .catch(function (err) { msg(err.message, true); });
    });
    $("#restart").addEventListener("click", function () { pendingEmail = ""; showLogin(); msg(""); });
    $("#signout").addEventListener("click", function () { signOut(); });
    $("#refresh").addEventListener("click", function () { msg(""); loadAll(); });
    $("#bid-toggle").addEventListener("click", function () {
      var next = !biddingOpen;
      if (confirm((next ? "OPEN" : "CLOSE") + " bidding for everyone now?")) act("set_bidding", { open: next }, "Bidding " + (next ? "opened" : "closed") + ".");
    });
    $("#add-existing").addEventListener("change", function () {
      var isNew = !this.value;
      Array.prototype.forEach.call(document.querySelectorAll(".newonly"), function (el) { el.hidden = !isNew; });
    });
    $("#add-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var existing = $("#add-existing").value, amount = Number($("#add-amount").value);
      var p = { board: $("#add-board").value, amount: amount, note: $("#add-note").value };
      if (existing) p.listing_id = existing;
      else {
        p.email = $("#add-email").value || (session && session.email);
        p.listing = { name: $("#add-name").value, url: $("#add-url").value, category: $("#add-category").value,
          city: $("#add-city").value, story: $("#add-story").value };
      }
      var label = existing ? (listingsCache.filter(function (l) { return l.id === existing; })[0] || {}).name : p.listing.name;
      if (!confirm("Record a manual payment of " + rupees(amount) + " for " + label + " (" + p.board + ")?")) return;
      act("add_manual", p, "Recorded " + rupees(amount) + " for " + label + ".").then(function (j) { if (j && j.ok) $("#add-form").reset(); });
    });
    $("#edit-form").addEventListener("submit", function (e) {
      if (e.submitter && e.submitter.value === "cancel") return;
      if (!editing) return;
      act("edit", { id: editing.id, name: $("#ed-name").value, url: $("#ed-url").value, category: $("#ed-category").value,
        city: $("#ed-city").value, story: $("#ed-story").value }, "Saved.");
    });

    ["click", "keydown", "pointermove", "touchstart", "scroll"].forEach(function (ev) {
      document.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true });
    });
    setInterval(function () {
      if (session && Date.now() - lastActive > IDLE_MS) signOut("Signed out after 30 minutes of inactivity.");
      else if (session) sessionStorage.setItem(KEY + "_active", String(lastActive));
    }, 30 * 1000);

    // Returning from the emailed link: #access_token=…&refresh_token=…  (or #error_description=…)
    if (location.hash.length > 1) {
      var hp = new URLSearchParams(location.hash.slice(1));
      history.replaceState(null, "", location.pathname);
      if (hp.get("access_token") && hp.get("refresh_token")) {
        save({ access_token: hp.get("access_token"), refresh_token: hp.get("refresh_token"),
          expires_at: hp.get("expires_at") ? Number(hp.get("expires_at")) * 1000 : Date.now() + (Number(hp.get("expires_in")) || 3600) * 1000, email: "" });
      } else if (hp.get("error_description")) msg(hp.get("error_description").replace(/\+/g, " "), true);
    }
    if (!session) { try { session = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { session = null; } }
    var prevActive = Number(sessionStorage.getItem(KEY + "_active")) || Date.now();
    if (session && Date.now() - prevActive > IDLE_MS) { signOut("Signed out after 30 minutes of inactivity."); return; }
    if (session) showApp(); else showLogin();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
