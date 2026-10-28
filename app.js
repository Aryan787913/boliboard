/*
 * Boli front end. Vanilla JS, no build step.
 * Live mode: reads public views from Supabase (anon key, RLS-protected) and pays through
 * PAYMENT_MODE "upi" (default): create-upi-order gives a unique exact amount + upi:// link + QR, then
 *   upi-status is polled until the payee's phone confirms it through upi-notify.
 * PAYMENT_MODE "razorpay" (kept, off): Razorpay via the create-order / verify-payment edge functions.
 * Sample mode: when config.js is empty (or the live board is still empty), renders clearly
 * labelled fictional sample data.
 */
(function () {
  "use strict";

  var C = window.BOLI_CONFIG || {};
  var SAMPLE = window.BOLI_SAMPLE || { board: function () { return []; }, dailyCount: 0, activity: [] };
  var CATS = ["Skincare & Beauty", "Snacks & Food", "Fashion", "Health & Fitness", "Home", "Startups"];
  var CITIES = ["Mumbai", "Delhi NCR", "Bengaluru", "Hyderabad", "Pune", "Jaipur", "Other"];
  var MIN_BID = (C.MIN_BID && C.MIN_BID >= 1) ? Math.floor(C.MIN_BID) : 199, TOP_STEP = 100;
  var LAUNCH = Date.parse(C.LAUNCH_AT || "2026-11-16T20:00:00+05:30");
  var SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  var RAZORPAY_CDN = "https://checkout.razorpay.com/v1/checkout.js";
  var BOARD_NAME = { all: "All-time", today: "Today", daily: "Daily" };
  var PAYMENT_MODE = C.PAYMENT_MODE === "razorpay" ? "razorpay" : "upi";
  var UPI = C.UPI || {};
  var UPI_KEY = "boli-upi-order";

  var doc = document, root = doc.documentElement;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canAnimate = !reduce && typeof Element !== "undefined" && "animate" in Element.prototype;
  var EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
  var configured = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  var sb = null;

  var state = {
    board: "all", city: "All", cat: "All", day: 0,
    days: [],            // daily archive: list of ISO dates (newest first)
    rows: [],            // rows of the board being shown (unfiltered, ranked)
    cache: {},           // board name -> rows (all, today) for the claim drawer
    source: "sample",    // "live" | "sample"
    reason: "",          // why sample data is shown
    ranks: {},           // viewKey -> {id: rank} from the previous data load
    deltas: {},          // id -> rank change on the current view
    seen: false
  };

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || doc).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function inr(n) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString("en-IN"); }
  function initials(n) {
    return String(n || "?").split(/\s+/).filter(function (w) { return /^[A-Za-z0-9]/.test(w); })
      .slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase() || "?";
  }
  function hue(s) { var h = 0; s = String(s || ""); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function istDate(offsetDays) {
    var d = new Date(Date.now() + 5.5 * 3600e3 - (offsetDays || 0) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  function fmtDay(iso) {
    var d = new Date(iso + "T12:00:00+05:30");
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  }
  function ago(mins) {
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var h = Math.floor(mins / 60);
    return h < 24 ? h + " hr ago" : Math.floor(h / 24) + " d ago";
  }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254; }
  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = doc.createElement("script");
      s.src = src; s.async = true; s.onload = ok; s.onerror = function () { fail(new Error("Could not load " + src)); };
      doc.head.appendChild(s);
    });
  }
  function toast(msg) {
    var t = $("#toast"); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function biddingOpen() { return C.BIDDING_OPEN === true; }
  function fnUrl(name) { return String(C.SUPABASE_URL).replace(/\/+$/, "") + "/functions/v1/" + name; }
  function callFn(name, body) {
    return fetch(fnUrl(name), {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + C.SUPABASE_ANON_KEY },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.message || j.error || "Request failed (" + r.status + ")"); e.code = j.error; throw e; }
        return j;
      });
    });
  }
  function tickTo(el, from, to, fmt) {
    fmt = fmt || inr;
    if (reduce || from === to || !window.requestAnimationFrame) { el.textContent = fmt(to); return; }
    var t0 = null, token = {}; el._tick = token;
    (function step(ts) {
      if (el._tick !== token) return;
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / 600), e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) window.requestAnimationFrame(step);
    })(performance.now());
  }

  /* ---------- theme ---------- */
  function initTheme() {
    // CSS is dark unless the system asks for light, so mirror exactly that here
    var btn = $("#theme-btn"), mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : { matches: false };
    function cur() { var t = root.getAttribute("data-theme"); return t === "light" || t === "dark" ? t : (mq.matches ? "light" : "dark"); }
    function sync() { btn.setAttribute("aria-label", cur() === "dark" ? "Switch to light theme" : "Switch to dark theme"); }
    btn.addEventListener("click", function () {
      var next = cur() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("boli-theme", next); } catch (e) { /* storage blocked: lasts this visit */ }
      sync();
    });
    sync();
  }

  /* ---------- countdown ---------- */
  function initCountdown() {
    var els = {}; $$("[data-cd]").forEach(function (e) { els[e.getAttribute("data-cd")] = e; });
    function tick() {
      var ms = LAUNCH - Date.now();
      if (ms <= 0) {
        $("#countdown").classList.add("is-done");
        ["d", "h", "m", "s"].forEach(function (k) { if (els[k]) els[k].textContent = "00"; });
        $("#countdown-note").textContent = biddingOpen() ? "The board is open. Bid boldly." : "Launch time has passed. Bidding opens shortly.";
        return false;
      }
      var s = Math.floor(ms / 1000);
      var v = { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
      Object.keys(v).forEach(function (k) { if (els[k]) els[k].textContent = pad2(v[k]); });
      return true;
    }
    if (tick()) var iv = setInterval(function () { if (!tick()) clearInterval(iv); }, 1000);
    if (biddingOpen()) $("#status-line").textContent = "Live · bidding is open";
  }

  /* ---------- data layer ---------- */
  function sampleDays() {
    var out = []; for (var i = 1; i <= SAMPLE.dailyCount; i++) out.push(istDate(i)); return out;
  }
  function normalise(r) {
    return {
      id: r.id, name: r.name, url: r.url, city: r.city, category: r.category,
      founder_name: r.founder_name || "", story: r.story || "", offer: r.offer || "",
      discount_code: r.discount_code || "", clicks: Number(r.clicks) || 0, total: Number(r.total) || 0, sample: !!r.sample
    };
  }
  function sampleBoard(board, dayIdx) { return SAMPLE.board(board, dayIdx).map(normalise); }

  function fetchLive(board, day) {
    var q;
    if (board === "all") q = sb.from("board_all_time").select("*").order("rank", { ascending: true }).limit(500);
    else if (board === "today") q = sb.from("board_today").select("*").order("rank", { ascending: true }).limit(500);
    else q = sb.from("board_daily").select("*").eq("day", day).order("rank", { ascending: true }).limit(500);
    return q.then(function (res) { if (res.error) throw res.error; return (res.data || []).map(normalise); });
  }
  function fetchDays() {
    return sb.from("daily_days").select("day").order("day", { ascending: false }).limit(90).then(function (res) {
      if (res.error) throw res.error; return (res.data || []).map(function (d) { return d.day; });
    });
  }

  function loadBoard(opts) {
    opts = opts || {};
    var board = state.board;
    var p;
    if (sb) {
      p = (board === "daily" && (!state.days.length || opts.refreshDays) ? fetchDays().then(function (d) { state.days = d; }) : Promise.resolve())
        .then(function () {
          if (board === "daily" && !state.days.length) return [];
          return fetchLive(board, state.days[state.day]);
        })
        .then(function (rows) {
          if (rows.length) return { rows: rows, source: "live", liveRows: rows };
          if (board === "daily") state.days = sampleDays();
          return { rows: sampleBoard(board, state.day), source: "sample", reason: "empty", liveRows: [] };
        })
        .catch(function (err) {
          if (window.console) console.warn("Boli: live board unavailable, showing sample data.", err && err.message);
          if (board === "daily") state.days = sampleDays();
          return { rows: sampleBoard(board, state.day), source: "sample", reason: "error" };
        });
    } else {
      if (board === "daily" && !state.days.length) state.days = sampleDays();
      p = Promise.resolve({ rows: sampleBoard(board, state.day), source: "sample", reason: configured ? "error" : "unconfigured" });
    }
    return p.then(function (res) {
      if (board !== state.board) return; // the user switched tabs while this loaded
      applyRows(res.rows, res.source, res.reason, opts.animate, res.liveRows);
    });
  }

  function viewKey() { return state.board + "|" + (state.board === "daily" ? state.days[state.day] : ""); }

  function applyRows(rows, source, reason, animate, liveRows) {
    var key = viewKey(), prev = state.ranks[key], next = {};
    rows.forEach(function (r, i) { next[r.id] = i + 1; });
    var deltas = {};
    if (prev) rows.forEach(function (r, i) { deltas[r.id] = prev[r.id] ? prev[r.id] - (i + 1) : "new"; });
    state.ranks[key] = next;
    state.deltas = deltas;
    state.rows = rows;
    state.source = source; state.reason = reason || "";
    // the claim drawer prices against live rows whenever the database answered (even if empty)
    if (state.board !== "daily") state.cache[state.board] = liveRows !== undefined ? liveRows : rows;
    // an empty live board shows the open #1 card, never a sample brand next to a real price
    if (state.board === "all") renderHero(source === "sample" && reason === "empty" ? null : rows[0]);
    else if (!state.cache.all) ensureBoard("all").then(function () { renderHero(sb ? (state.cache.all || [])[0] : sampleBoard("all")[0]); });
    render(animate !== false);
  }

  /* ---------- rendering ---------- */
  var PAID = '<span class="tag" title="Every rank on Boli is bought">Paid listing</span>';
  function avatar(r, size) {
    return '<span class="avatar' + (size ? " avatar--" + size : "") + '" style="--h:' + hue(r.name) + '" aria-hidden="true">' + esc(initials(r.name)) + "</span>";
  }
  function codeChip(r) {
    if (!r.discount_code) return "";
    return '<button type="button" class="code" data-copy="' + esc(r.discount_code) + '" aria-label="Copy code ' + esc(r.discount_code) + '">' +
      '<span class="code__offer">' + esc(r.offer || "Code") + "</span><span class=\"code__val\">" + esc(r.discount_code) + "</span></button>";
  }
  function visit(r, cls) {
    if (r.sample || !r.url || r.url === "#") return '<span class="' + (cls || "visit") + ' is-disabled" aria-hidden="true">Sample</span>';
    return '<a class="' + (cls || "visit") + '" href="' + esc(r.url) + '" target="_blank" rel="sponsored noopener" data-track="' + esc(r.id) + '">Visit<span class="sr-only"> ' + esc(r.name) + " (opens in a new tab)</span> ↗</a>";
  }
  function deltaBadge(id) {
    var d = state.deltas[id];
    if (d === "new") return '<span class="delta delta--new">New</span>';
    if (!d) return "";
    return d > 0 ? '<span class="delta delta--up" aria-label="Up ' + d + '">▲' + d + "</span>" : '<span class="delta delta--down" aria-label="Down ' + -d + '">▼' + -d + "</span>";
  }
  function meta(r, clicksLabel) {
    var bits = [r.city, r.category];
    if (clicksLabel !== false) bits.push(num(r.clicks) + " clicks");
    return bits.map(esc).join(" · ");
  }
  function filtered() {
    return state.rows.filter(function (r) {
      return (state.city === "All" || r.city === state.city) && (state.cat === "All" || r.category === state.cat);
    });
  }
  function topOf(board) { var rows = state.cache[board] || []; return rows[0] || null; }
  function nextTopPrice(board) { var t = topOf(board || "all"); return t ? t.total + TOP_STEP : MIN_BID; }

  function renderHero(top) {
    var el = $("#hero-top");
    if (!top) {
      el.innerHTML = '<div class="topcard__in topcard--open"><p class="crown">#1 · All-time</p><h3 class="topcard__name">The #1 spot is open.</h3>' +
        '<p class="muted">The first paid listing takes it. ₹' + MIN_BID + ' is all it costs to list.</p>' +
        '<button class="btn btn--accent" type="button" data-open-claim="top">Claim #1 for ₹' + MIN_BID + '</button></div>';
      return;
    }
    el.innerHTML = '<article class="topcard__in" data-key="hero">' +
      (top.sample ? '<span class="ribbon">Sample data</span>' : "") +
      '<div class="topcard__head"><p class="crown"><span aria-hidden="true">♛</span> #1 · All-time</p>' + PAID + "</div>" +
      '<div class="topcard__id">' + avatar(top, "xl") + '<div><h3 class="topcard__name">' + esc(top.name) + "</h3>" +
      (top.founder_name ? '<p class="muted">Founder: ' + esc(top.founder_name) + "</p>" : "") + "</div></div>" +
      (top.story ? '<p class="topcard__story">' + esc(top.story) + "</p>" : "") +
      '<div class="topcard__amt"><span class="label">Total paid</span><span class="amt amt--xl" data-amt="' + top.total + '">' + inr(top.total) + "</span></div>" +
      '<p class="topcard__meta">' + meta(top) + "</p>" +
      '<div class="topcard__foot">' + codeChip(top) + visit(top, "btn btn--ghost btn--sm") + "</div>" +
      '<button class="btn btn--accent btn--block" type="button" data-open-claim="top">Take #1 for ' + inr(nextTopPrice("all")) + "</button>" +
      "</article>";
  }

  function podiumCard(r, i) {
    var cls = ["gold", "silver", "bronze"][i];
    return '<li class="pod pod--' + cls + '" data-key="' + esc(r.id) + '">' +
      '<div class="pod__rank"><span class="medal">#' + (i + 1) + "</span>" + deltaBadge(r.id) + "</div>" +
      '<div class="pod__id">' + avatar(r, "lg") + '<div class="pod__names"><h3 class="pod__name">' + esc(r.name) + "</h3>" +
      (r.founder_name ? '<p class="muted small">Founder: ' + esc(r.founder_name) + "</p>" : "") + "</div></div>" +
      (r.story ? '<p class="pod__story">' + esc(r.story) + "</p>" : "") +
      '<p class="amt amt--lg" data-amt="' + r.total + '">' + inr(r.total) + "</p>" +
      '<p class="small muted">' + meta(r) + "</p>" +
      '<div class="pod__foot">' + PAID + codeChip(r) + visit(r) + "</div></li>";
  }
  function rowItem(r, i) {
    return '<li class="row" data-key="' + esc(r.id) + '">' +
      '<span class="row__rank">' + (i + 1) + "</span>" + avatar(r) +
      '<div class="row__main"><div class="row__title"><span class="row__name">' + esc(r.name) + "</span>" + PAID + deltaBadge(r.id) + "</div>" +
      '<p class="row__meta">' + (r.founder_name ? esc(r.founder_name) + " · " : "") + meta(r) + "</p>" +
      (r.story ? '<p class="row__story">' + esc(r.story) + "</p>" : "") + "</div>" +
      '<div class="row__side"><span class="amt" data-amt="' + r.total + '">' + inr(r.total) + "</span>" +
      '<div class="row__acts">' + codeChip(r) + visit(r) + "</div></div></li>";
  }

  function render(animate) {
    var panel = $("#board-panel");
    var before = {};
    if (animate && state.seen) $$("[data-key]", panel).forEach(function (el) {
      var a = el.querySelector("[data-amt]");
      before[el.getAttribute("data-key")] = { rect: el.getBoundingClientRect(), amt: a ? +a.getAttribute("data-amt") : null };
    });

    var list = filtered(), top3 = list.slice(0, 3), rest = list.slice(3);
    $("#podium").innerHTML = top3.map(podiumCard).join("");
    $("#rows").innerHTML = rest.map(function (r, k) { return rowItem(r, k + 3); }).join("");
    $("#podium").hidden = !top3.length;
    $("#rows").hidden = !rest.length;
    var empty = $("#board-empty");
    empty.hidden = !!list.length;
    if (!list.length) {
      empty.innerHTML = "<p><strong>No listings here yet.</strong> The first paid listing on this board takes #1.</p>" +
        '<button class="btn btn--accent btn--sm" type="button" data-open-claim="empty">Claim #1 for ₹' + MIN_BID + '</button>';
    }

    var scope = [BOARD_NAME[state.board] + " board"];
    if (state.board === "daily" && state.days[state.day]) scope.push(fmtDay(state.days[state.day]));
    if (state.city !== "All") scope.push(state.city);
    if (state.cat !== "All") scope.push(state.cat);
    $("#board-scope").textContent = scope.join(" · ") + " · " + list.length + (list.length === 1 ? " listing" : " listings");

    // daily nav
    var dn = $("#daynav");
    dn.hidden = state.board !== "daily" || !state.days.length;
    if (!dn.hidden) {
      $("#day-label").textContent = fmtDay(state.days[state.day]);
      $("#day-prev").disabled = state.day >= state.days.length - 1;
      $("#day-next").disabled = state.day <= 0;
    }

    // notice
    var n = $("#data-notice");
    if (state.source === "sample") {
      var why = state.reason === "empty" ? "The live board is empty until launch, so you're looking at sample data."
        : state.reason === "error" ? "The live board couldn't be reached just now, so you're looking at sample data."
        : "You're looking at sample data.";
      n.innerHTML = '<strong>Sample data.</strong> ' + why + " Every brand and founder here is fictional. Real boards open 16 Nov, 8 PM IST.";
      n.hidden = false;
    } else n.hidden = true;
    $("#demo-bid").hidden = state.source !== "sample" || state.board === "daily";

    // motion
    if (animate && state.seen) {
      $$("[data-key]", panel).forEach(function (el) {
        var k = el.getAttribute("data-key"), b = before[k];
        var a = el.querySelector("[data-amt]");
        if (a && b && b.amt != null) tickTo(a, b.amt, +a.getAttribute("data-amt"));
        if (!canAnimate) return;
        if (b) {
          var now = el.getBoundingClientRect(), dx = b.rect.left - now.left, dy = b.rect.top - now.top;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) el.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }], { duration: 520, easing: EASE });
          if (state.deltas[k] && state.deltas[k] !== "new" && state.deltas[k] > 0) el.animate([{ boxShadow: "0 0 0 2px var(--up)" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1400, easing: "ease-out" });
        } else {
          el.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: EASE, fill: "backwards" });
        }
      });
    }
    state.seen = true;
    renderStatsTop();
  }

  /* ---------- chips & tabs ---------- */
  function initFilters() {
    function chips(el, items, allLabel, key) {
      el.innerHTML = ["All"].concat(items).map(function (v) {
        return '<button type="button" class="chip" aria-pressed="' + (v === "All") + '" data-v="' + esc(v) + '">' + esc(v === "All" ? allLabel : v) + "</button>";
      }).join("");
      el.addEventListener("click", function (e) {
        var b = e.target.closest("[data-v]"); if (!b) return;
        state[key] = b.getAttribute("data-v");
        $$("button", el).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        render(true);
      });
    }
    chips($("#city-chips"), CITIES, "All India", "city");
    chips($("#cat-chips"), CATS, "All categories", "cat");

    var tabs = $$('[role="tab"]');
    function select(b, focus) {
      tabs.forEach(function (t) { var on = t === b; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
      $("#board-panel").setAttribute("aria-labelledby", b.id);
      if (focus) b.focus();
      state.board = b.getAttribute("data-board"); state.day = 0;
      loadBoard({ animate: true });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(t); });
      t.addEventListener("keydown", function (e) {
        var j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
        if (j === null) return;
        e.preventDefault(); select(tabs[(j + tabs.length) % tabs.length], true);
      });
    });
    $("#day-prev").addEventListener("click", function () { if (state.day < state.days.length - 1) { state.day++; loadBoard({ animate: true }); } });
    $("#day-next").addEventListener("click", function () { if (state.day > 0) { state.day--; loadBoard({ animate: true }); } });

    $("#demo-bid").addEventListener("click", function () {
      var rows = state.rows.slice();
      if (rows.length < 2) return;
      var i = 1 + Math.floor(Math.random() * (rows.length - 1));
      var j = Math.floor(Math.random() * i);
      var mover = Object.assign({}, rows[i]);
      var raise = rows[j].total + TOP_STEP - mover.total;
      mover.total += raise;
      rows[i] = mover;
      rows.sort(function (a, b) { return b.total - a.total; });
      applyRows(rows, "sample", state.reason, true);
      addFeed({ name: mover.name, amount: raise, board: state.board, minsAgo: 0, demo: true }, true);
      toast("Demo only: " + mover.name + " moved to #" + (j + 1) + ". Nothing was charged.");
    });
  }

  /* ---------- stats ---------- */
  var statVals = {};
  function setStat(key, val, fmt) {
    var el = $('[data-stat="' + key + '"]'); if (!el) return;
    if (val == null) { el.textContent = "—"; statVals[key] = null; return; }
    tickTo(el, statVals[key] || 0, val, fmt); statVals[key] = val;
  }
  function renderStatsTop() {
    // price to take #1 comes from the live all-time board; sample boards never feed the stats strip
    var liveAll = state.source === "live" && state.cache.all ? state.cache.all : null;
    if (state.liveStats) setStat("nextTop", state.liveStats.top_total ? Number(state.liveStats.top_total) + TOP_STEP : MIN_BID);
    else if (!sb) setStat("nextTop", liveAll && liveAll[0] ? liveAll[0].total + TOP_STEP : MIN_BID);
  }
  function loadStats() {
    if (!sb) {
      setStat("visitors", null);
      setStat("revenue", 0);
      setStat("listings", 0, num);
      setStat("nextTop", MIN_BID);
      $("#stats-note").textContent = "Real numbers, not the sample board: nothing has been sold yet, so revenue and listings are zero and ₹" + MIN_BID + " takes #1. Visitor counts start once the live database is connected.";
      return Promise.resolve();
    }
    return sb.from("public_stats").select("*").maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      var s = res.data || {};
      state.liveStats = s;
      setStat("visitors", Number(s.visitors) || 0, num);
      setStat("revenue", Number(s.revenue) || 0);
      setStat("listings", Number(s.listings) || 0, num);
      setStat("nextTop", s.top_total ? Number(s.top_total) + TOP_STEP : MIN_BID);
      $("#stats-note").textContent = "Live from the database (unique visitors, rupees paid, live listings), never from the sample board." + (Date.now() < LAUNCH ? " Zero until launch." : "");
    }).catch(function (err) {
      if (window.console) console.warn("Boli: stats unavailable.", err && err.message);
      ["visitors", "revenue", "listings"].forEach(function (k) { setStat(k, null); });
      $("#stats-note").textContent = "Stats are unavailable right now.";
    });
  }

  /* ---------- activity feed ---------- */
  function feedItem(a) {
    var where = a.board === "today" ? "Today" : "All-time";
    return '<li class="feed__item' + (a.demo ? " is-demo" : "") + '"><span class="feed__dot" aria-hidden="true"></span><p><strong>' + esc(a.name) + "</strong> raised " +
      '<span class="amt">' + inr(a.amount) + "</span> on the " + where + " board" + (a.demo ? ' <span class="tag tag--muted">Demo</span>' : "") +
      '</p><time class="small muted">' + ago(a.minsAgo) + "</time></li>";
  }
  function addFeed(a, prepend) {
    var f = $("#feed"), empty = $(".feed__empty", f);
    if (empty) empty.remove();
    f.insertAdjacentHTML(prepend ? "afterbegin" : "beforeend", feedItem(a));
    if (prepend && canAnimate) f.firstElementChild.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: EASE });
    while (f.children.length > 8) f.lastElementChild.remove();
  }
  function loadFeed() {
    var f = $("#feed");
    function sample(note) {
      f.innerHTML = '<li class="feed__label"><span class="tag tag--muted">Sample data</span> ' + esc(note) + "</li>";
      SAMPLE.activity.forEach(function (a) { addFeed(a); });
    }
    if (!sb) { sample("Fictional raises, to show how the feed works."); return Promise.resolve(); }
    return sb.from("public_activity").select("*").order("paid_at", { ascending: false }).limit(8).then(function (res) {
      if (res.error) throw res.error;
      var rows = res.data || [];
      if (!rows.length) { f.innerHTML = '<li class="feed__empty muted">No raises yet. The first one lands after the board opens on 16 Nov, 8 PM IST.</li>'; return; }
      f.innerHTML = "";
      rows.forEach(function (r) { addFeed({ name: r.name, amount: Number(r.amount), board: r.board, minsAgo: Math.max(0, Math.round((Date.now() - Date.parse(r.paid_at)) / 60000)) }); });
    }).catch(function () { sample("The live feed couldn't be reached just now."); });
  }

  /* ---------- tracking (live only) ---------- */
  function beacon(body) {
    if (!sb) return;
    var url = fnUrl("track-click"), data = JSON.stringify(body);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([data], { type: "text/plain" }))) return;
    } catch (e) { /* fall through to fetch */ }
    fetch(url, { method: "POST", body: data, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(function () {});
  }
  function trackVisit() {
    if (!sb) return;
    try { if (sessionStorage.getItem("boli-visit") === istDate(0)) return; sessionStorage.setItem("boli-visit", istDate(0)); } catch (e) { /* still count it */ }
    beacon({ kind: "visit" });
  }

  /* ---------- copy codes, outbound clicks, focus links ---------- */
  function initClicks() {
    doc.addEventListener("click", function (e) {
      var c = e.target.closest("[data-copy]");
      if (c) {
        var val = c.getAttribute("data-copy");
        var done = function () { toast("Copied " + val); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(val).then(done, function () { toast("Code: " + val); });
        else toast("Code: " + val);
        return;
      }
      var t = e.target.closest("[data-track]");
      if (t) beacon({ kind: "click", listing_id: t.getAttribute("data-track") });
      var o = e.target.closest("[data-open-claim]");
      if (o) { e.preventDefault(); openClaim(o.getAttribute("data-open-claim"), o); return; }
      var f = e.target.closest("[data-focus]");
      if (f) { var target = $(f.getAttribute("data-focus")); if (target) setTimeout(function () { target.focus({ preventScroll: true }); }, reduce ? 0 : 400); }
    });
  }

  /* ---------- min price text ---------- */
  Array.prototype.forEach.call(document.querySelectorAll("[data-min-bid]"), function (el) { el.textContent = String(MIN_BID); });

  /* ---------- waitlist ---------- */
  function joinWaitlist(email, brand) {
    if (!sb) return Promise.resolve({ preview: true });
    return sb.from("waitlist").insert({ email: email.toLowerCase(), brand: brand || null }).then(function (res) {
      if (res.error && res.error.code !== "23505") throw res.error; // 23505 = already on the list
      return { ok: true };
    });
  }
  function initWaitlist() {
    var form = $("#wait-form"), msg = $("#wait-msg");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.elements.email.value.trim(), brand = form.elements.brand.value.trim();
      if (!isEmail(email)) { msg.className = "form-msg is-err"; msg.textContent = "Enter a valid email address."; form.elements.email.setAttribute("aria-invalid", "true"); form.elements.email.focus(); return; }
      form.elements.email.removeAttribute("aria-invalid");
      var btn = form.querySelector("button"); btn.disabled = true;
      joinWaitlist(email, brand).then(function (r) {
        msg.className = "form-msg is-ok";
        msg.textContent = r.preview ? "Preview mode: the waitlist isn't connected on this deployment yet, so nothing was sent." : "You're in. We'll email you before the gavel drops.";
        if (!r.preview) form.reset();
      }).catch(function () {
        msg.className = "form-msg is-err"; msg.textContent = "That didn't go through. Please try again in a moment.";
      }).then(function () { btn.disabled = false; });
    });
    $("#claim-wait-btn").addEventListener("click", function () {
      var inp = $("#claim-wait-email"), m = $("#claim-wait-msg"), v = inp.value.trim();
      if (!isEmail(v)) { m.className = "form-msg is-err"; m.textContent = "Enter a valid email address."; inp.focus(); return; }
      joinWaitlist(v, $("#c-name").value.trim()).then(function (r) {
        m.className = "form-msg is-ok";
        m.textContent = r.preview ? "Preview mode: the waitlist isn't connected yet, so nothing was sent." : "You're in. We'll email you before bidding opens.";
      }).catch(function () { m.className = "form-msg is-err"; m.textContent = "That didn't go through. Please try again in a moment."; });
    });
  }

  /* ---------- claim drawer ---------- */
  var drawer, form, lastFocus;
  function fieldVal(name) { var el = form.elements[name]; return el ? String(el.value || "").trim() : ""; }
  function radio(name) { var el = form.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ""; }
  function boardRows(board) { return state.cache[board] || []; }
  function ensureBoard(board) {
    if (state.cache[board]) return Promise.resolve();
    if (sb) return fetchLive(board).then(function (rows) { state.cache[board] = rows; })
      .catch(function () { state.cache[board] = sampleBoard(board); });
    state.cache[board] = sampleBoard(board);
    return Promise.resolve();
  }
  function parseBid() {
    var raw = String($("#c-amt").value || "").replace(/[₹,\s]/g, "");
    if (!raw) return { err: "Enter an amount." };
    if (!/^\d+$/.test(raw)) return { err: "Whole rupees only. No paise or decimals." };
    var n = parseInt(raw, 10);
    if (n > 10000000) return { err: "That's above the maximum single bid." };
    return { n: n };
  }
  function computeQuote() {
    var board = radio("board"), mode = radio("mode"), rows = boardRows(board);
    var selfId = mode === "raise" ? fieldVal("listing_id") : null;
    var self = null; rows.forEach(function (r) { if (r.id === selfId) self = r; });
    var current = self ? self.total : 0;
    var top = rows[0] || null;
    var selfIsTop = !!(top && self && top.id === self.id);
    var p = parseBid(), q = { board: board, mode: mode, top: top, self: self, selfIsTop: selfIsTop, current: current };
    if (p.err) { q.err = p.err; return q; }
    var bid = q.bid = p.n;
    if (mode === "raise" && !selfId) q.err = "Pick your listing.";
    else if (bid < MIN_BID) q.err = "Minimum is ₹" + MIN_BID + ".";
    else if (bid <= current) q.err = "Your total here is already " + inr(current) + ". Enter a higher total.";
    else if (top && !selfIsTop && bid > top.total && bid < top.total + TOP_STEP)
      q.err = "To pass #1 you need at least " + inr(top.total + TOP_STEP) + ". At " + inr(top.total) + " or less you list just below.";
    var others = rows.filter(function (r) { return r.id !== selfId; });
    q.rank = 1 + others.filter(function (r) { return r.total >= bid; }).length;
    q.charge = bid - current;
    return q;
  }
  function renderQuote() {
    var q = computeQuote();
    $("#amt-err").textContent = q.err || "";
    $("#c-amt").setAttribute("aria-invalid", q.err ? "true" : "false");
    var sampleNote = state.cache[q.board] && state.cache[q.board][0] && state.cache[q.board][0].sample;
    var topLabel = q.top ? inr(q.top.total) + " · " + esc(q.top.name) : "Open";
    var html = '<dl class="quote__grid">' +
      "<div><dt>Current #1 · " + BOARD_NAME[q.board] + "</dt><dd>" + topLabel + "</dd></div>" +
      "<div><dt>Your total after this</dt><dd>" + (q.bid ? inr(q.bid) : "—") + "</dd></div>" +
      (q.mode === "raise" ? "<div><dt>Already paid on this board</dt><dd>" + inr(q.current) + "</dd></div>" : "") +
      "<div><dt>You'd rank</dt><dd>" + (q.err ? "—" : "#" + q.rank + " on " + BOARD_NAME[q.board]) + "</dd></div>" +
      "</dl>" +
      '<div class="quote__pay"><span>You pay now</span><strong class="amt amt--lg">' + (q.err ? "—" : inr(q.charge)) + "</strong></div>" +
      (q.mode === "raise" && !q.err ? '<p class="small muted">Only the difference is charged.</p>' : "") +
      (sampleNote ? '<p class="small muted">Previewed against sample data. Real boards open 16 Nov, 8 PM IST.</p>' : "");
    $("#quote").innerHTML = html;
    var tb = $("#q-top");
    tb.textContent = q.selfIsTop ? "You're #1" : "Take #1 · " + inr(q.top ? q.top.total + TOP_STEP : MIN_BID);
    tb.disabled = q.selfIsTop;
    return q;
  }
  function setBid(n) { $("#c-amt").value = String(Math.max(0, Math.round(n))); renderQuote(); }
  function syncMode() {
    var raise = radio("mode") === "raise";
    $("#f-existing").hidden = !raise;
    $("#f-new").hidden = raise;
    $$("#f-new input, #f-new select").forEach(function (el) { el.disabled = raise; });
    if (raise) {
      var all = boardRows("all");
      $("#c-listing").innerHTML = '<option value="">Choose your listing</option>' + all.map(function (r) {
        return '<option value="' + esc(r.id) + '">' + esc(r.name) + " · " + inr(r.total) + " all-time</option>";
      }).join("");
    }
    renderQuote();
  }
  function syncPayButton() {
    var btn = $("#pay-btn"), open = biddingOpen();
    $("#claim-wait").hidden = open;
    $("#claim-status").textContent = open ? "Bidding is open" : "Preview · bidding opens 16 Nov, 8 PM IST";
    if (!open) { btn.disabled = true; btn.textContent = "Bidding opens 16 Nov, 8 PM IST"; }
    else if (PAYMENT_MODE === "upi") {
      if (!configured) { btn.disabled = true; btn.textContent = "Payments not connected yet"; }
      else { btn.disabled = false; btn.textContent = UPI.PAY_CTA || "Continue to UPI payment"; }
    }
    else if (!sb || !C.RAZORPAY_KEY_ID) { btn.disabled = true; btn.textContent = "Payments not connected yet"; }
    else { btn.disabled = false; btn.textContent = "Pay with Razorpay"; }
  }
  function openClaim(src, opener) {
    lastFocus = opener || doc.activeElement;
    drawer.hidden = false;
    doc.body.classList.add("no-scroll");
    var pending = PAYMENT_MODE === "upi" && upiLoad();
    if (pending) { showUpi(pending); return; }
    showForm();
    $("#claim-msg").textContent = "";
    syncPayButton();
    Promise.all([ensureBoard("all"), ensureBoard("today")]).then(function () {
      syncMode();
      if (!$("#c-amt").value || src === "top") setBid(src === "top" || src === "empty" ? nextTopPrice(radio("board")) : MIN_BID);
      else renderQuote();
    });
    if (canAnimate) $(".drawer__panel", drawer).animate([{ transform: "translateY(16px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: EASE });
    setTimeout(function () { var f = $("#c-name"); (f && !f.disabled ? f : $(".drawer__panel", drawer)).focus(); }, 30);
  }
  function closeClaim() {
    stopUpiPoll();
    drawer.hidden = true;
    doc.body.classList.remove("no-scroll");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function normaliseUrl(v) {
    v = v.trim();
    if (/^@[A-Za-z0-9._]{1,30}$/.test(v)) return "https://www.instagram.com/" + v.slice(1) + "/";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    return v;
  }
  function validateNew() {
    var errs = [];
    if (fieldVal("name").length < 2) errs.push("brand name");
    if (!fieldVal("url")) errs.push("website or Instagram handle");
    if (!fieldVal("category")) errs.push("category");
    if (!fieldVal("city")) errs.push("city");
    var code = fieldVal("code").toUpperCase();
    if (code && !/^[A-Z0-9]{3,20}$/.test(code)) errs.push("discount code (3 to 20 letters or numbers)");
    if (fieldVal("founder") && !form.elements.consent.checked) errs.push("founder consent (or leave the founder name empty)");
    return errs;
  }
  function submitClaim(e) {
    e.preventDefault();
    var msg = $("#claim-msg");
    var q = renderQuote();
    function fail(t) { msg.className = "form-msg is-err"; msg.textContent = t; }
    if (!biddingOpen()) return fail("Bidding opens 16 Nov, 8 PM IST.");
    if (q.err) { $("#c-amt").focus(); return fail(q.err); }
    var mode = radio("mode");
    var email = fieldVal("email");
    if (mode === "new") { var errs = validateNew(); if (errs.length) return fail("Please check: " + errs.join(", ") + "."); }
    if (!isEmail(email)) return fail("Enter a valid contact email for your receipt.");
    if (!form.elements.terms.checked) return fail("Please accept the rules to continue.");
    if (PAYMENT_MODE === "upi" ? !configured : (!sb || !C.RAZORPAY_KEY_ID)) return fail("Payments aren't connected on this deployment yet.");
    if (q.self && q.self.sample) return fail("That's a sample listing. Pick a live listing.");

    var body = { mode: mode, board: q.board, bid: q.bid, email: email };
    if (mode === "raise") body.listing_id = fieldVal("listing_id");
    else body.listing = {
      name: fieldVal("name"), url: normaliseUrl(fieldVal("url")), category: fieldVal("category"), city: fieldVal("city"),
      story: fieldVal("story"), offer: fieldVal("offer"), discount_code: fieldVal("code").toUpperCase(),
      founder_name: fieldVal("founder"), founder_consent: form.elements.consent.checked,
      rivalry_opt_in: form.elements.rivalry.checked, business_details: fieldVal("business")
    };
    var btn = $("#pay-btn"); btn.disabled = true; btn.textContent = "Creating order…";
    msg.className = "form-msg"; msg.textContent = "";
    if (PAYMENT_MODE === "upi") {
      callFn("create-upi-order", body).then(function (o) {
        var order = {
          id: o.order_id, code: o.order_code, paise: o.amount_paise, amount: o.amount, vpa: o.vpa, payee: o.payee_name,
          link: o.upi_link, expires: Date.parse(o.expires_at) || (Date.now() + 864e5), bid: o.bid, board: q.board, created: Date.now(),
          status: "pending"
        };
        upiSave(order);
        syncPayButton();
        showUpi(order);
      }).catch(function (err) {
        fail(err.code === "bidding_closed" ? "Bidding isn't open yet." :
          err.code === "upi_not_configured" ? "UPI payments aren't set up yet. Please try again later." :
          err.message || "Couldn't start the payment.");
        syncPayButton();
      });
      return;
    }
    Promise.all([callFn("create-order", body), window.Razorpay ? Promise.resolve() : loadScript(RAZORPAY_CDN)]).then(function (res) {
      var order = res[0];
      btn.textContent = "Waiting for payment…";
      var rz = new window.Razorpay({
        key: order.key_id || C.RAZORPAY_KEY_ID,
        amount: order.amount, currency: order.currency || "INR", order_id: order.order_id,
        name: "Boli", description: "Paid listing · " + BOARD_NAME[q.board] + " board · total " + inr(q.bid),
        prefill: { email: email }, notes: { listing_id: order.listing_id },
        theme: { color: "#ff9f1c" },
        handler: function (resp) {
          btn.textContent = "Confirming…";
          callFn("verify-payment", resp).then(function () {
            msg.className = "form-msg is-ok";
            msg.textContent = "Paid. Your listing is live at " + inr(q.bid) + ". Razorpay emails the payment receipt to " + email + ".";
            toast("Payment confirmed. Welcome to the board.");
            state.cache = {};
            loadBoard({ animate: true }); loadStats(); loadFeed();
          }).catch(function (err) {
            fail("Payment received but not confirmed yet (" + err.message + "). Keep your Razorpay payment ID: " + resp.razorpay_payment_id + ".");
          }).then(syncPayButton);
        },
        modal: { ondismiss: function () { syncPayButton(); msg.className = "form-msg"; msg.textContent = "Payment cancelled. Nothing was charged."; } }
      });
      rz.on("payment.failed", function (r) { fail("Payment failed: " + ((r && r.error && r.error.description) || "please try again") + "."); syncPayButton(); });
      rz.open();
    }).catch(function (err) {
      fail(err.code === "bidding_closed" ? "Bidding isn't open yet." : err.message || "Couldn't start the payment.");
      syncPayButton();
    });
  }
  /* ---------- UPI checkout ---------- */
  var upiTimer = null, upiCurrent = null;
  function fill(t, o) {
    return String(t || "").replace(/\{amount\}/g, "₹" + o.amount).replace(/\{bid\}/g, inr(o.bid)).replace(/\{code\}/g, o.code || "");
  }
  function upiSave(o) { try { localStorage.setItem(UPI_KEY, JSON.stringify(o)); } catch (e) {} }
  function upiClear() { try { localStorage.removeItem(UPI_KEY); } catch (e) {} }
  function upiLoad() {
    try {
      var o = JSON.parse(localStorage.getItem(UPI_KEY) || "null");
      if (!o || !o.id || !o.amount) return null;
      if (Date.now() - (o.created || 0) > 2 * 864e5) { upiClear(); return null; }
      return o;
    } catch (e) { return null; }
  }
  function showForm() {
    stopUpiPoll();
    form.hidden = false;
    $("#upi-pay").hidden = true;
    $("#claim-title").textContent = "Claim your rank";
  }
  function stopUpiPoll() { if (upiTimer) { clearInterval(upiTimer); upiTimer = null; } }
  var UPI_APP_SCHEMES = { gpay: "tez://upi/pay?", phonepe: "phonepe://pay?", paytm: "paytmmp://pay?", any: "upi://pay?" };
  function drawQr(link) {
    var box = $("#upi-qr");
    if (!window.qrcode) { box.textContent = "QR unavailable. Use the UPI ID below."; return; }
    try {
      var qr = window.qrcode(0, "M"); qr.addData(link); qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    } catch (e) { box.textContent = "QR unavailable. Use the UPI ID below."; }
  }
  function setUpiState(o) {
    var st = $("#upi-status"), txt = $("#upi-status-text"), state = o.status;
    if (state === "pending" && o.expires && Date.now() > o.expires) state = "expired";
    st.setAttribute("data-state", state);
    var paying = state === "pending";
    $("#upi-apps").hidden = !paying;
    $("#upi-qr-wrap").hidden = !paying;
    $(".upi__vpa").hidden = !paying;
    $("#upi-note").hidden = !paying;
    if (state === "paid") {
      txt.textContent = fill(UPI.SUCCESS || "Payment received. Your listing is live at {bid}.", o);
      $("#claim-title").textContent = "You're on the board";
    } else if (state === "expired") {
      txt.textContent = fill(UPI.EXPIRED || "This payment window has closed. Order {code}.", o);
    } else if (state === "failed") {
      txt.textContent = fill(UPI.FAILED || "This order was cancelled. Order {code}.", o);
    } else {
      txt.textContent = UPI.WAITING || "Waiting for payment… confirms automatically, can take a few minutes.";
    }
    return state;
  }
  function pollUpi() {
    var o = upiCurrent; if (!o) return;
    if (doc.hidden && upiTimer) return; // checked again on visibilitychange
    fetch(fnUrl("upi-status") + "?id=" + encodeURIComponent(o.id), { cache: "no-store" })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (res) {
        if (upiCurrent !== o) return;
        if (res.status === 404) { o.status = "failed"; }
        else if (res.ok && res.j && res.j.status) { o.status = res.j.status; }
        else return;
        var st = setUpiState(o);
        if (st === "pending") { upiSave(o); return; }
        stopUpiPoll();
        if (st === "paid") {
          upiClear();
          toast("Payment confirmed. Welcome to the board.");
          state.cache = {};
          if (sb) { loadBoard({ animate: true }); loadStats(); loadFeed(); }
        } else upiSave(o);
      }).catch(function () { /* network blip: keep polling */ });
  }
  function showUpi(o) {
    upiCurrent = o;
    form.hidden = true;
    $("#upi-pay").hidden = false;
    $("#claim-title").textContent = "Complete your payment";
    $("#upi-code").textContent = o.code || "—";
    $("#upi-headline").textContent = fill(UPI.HEADLINE || "Pay exactly {amount}", o);
    $("#upi-note").textContent = UPI.EXACT_NOTE || "";
    // Direct app buttons: same pa/pn/am/cu/tn params as the QR's upi://pay link, different app schemes.
    var params = String(o.link || "").split("?")[1] || "";
    $$("#upi-apps [data-upi-app]").forEach(function (a) {
      var scheme = UPI_APP_SCHEMES[a.getAttribute("data-upi-app")] || "upi://pay?";
      a.setAttribute("href", scheme + params);
    });
    var touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    $("#upi-qr-hint").textContent = touch ? (UPI.QR_HINT || "Scan with any UPI app.") : "Scan with any UPI app";
    $("#upi-vpa-label").textContent = UPI.VPA_LABEL || "Or pay to this UPI ID";
    $("#upi-vpa").textContent = o.vpa || "—";
    $("#upi-new").textContent = UPI.NEW_BID || "Start a new bid";
    $("#upi-pay").classList.toggle("upi--touch", !!touch);
    $("#upi-qr-wrap").open = !touch;
    drawQr(o.link);
    var state = setUpiState(o);
    stopUpiPoll();
    if (state === "pending") {
      pollUpi();
      upiTimer = setInterval(pollUpi, Math.max(2000, Number(UPI.POLL_MS) || 4000));
    }
  }
  function initUpi() {
    $("#upi-copy").addEventListener("click", function () {
      var v = $("#upi-vpa").textContent, b = this;
      function done() { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () { toast(v); });
      else {
        var r = doc.createRange(); r.selectNodeContents($("#upi-vpa"));
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        try { doc.execCommand("copy"); done(); } catch (e) { toast(v); }
      }
    });
    $("#upi-new").addEventListener("click", function () {
      var o = upiCurrent;
      if (o && setUpiState(o) === "pending" && !window.confirm("Start a new bid? If you've already paid " + "₹" + o.amount + ", stay here: it will confirm automatically.")) return;
      upiCurrent = null; upiClear(); showForm(); syncPayButton();
      $("#claim-msg").textContent = "";
      Promise.all([ensureBoard("all"), ensureBoard("today")]).then(function () { syncMode(); });
    });
    doc.addEventListener("visibilitychange", function () { if (!doc.hidden && upiCurrent && upiTimer) pollUpi(); });
    var note = $("#pay-note"), notes = C.PAYMENT_NOTE || {};
    if (note && notes[PAYMENT_MODE]) note.textContent = notes[PAYMENT_MODE];
  }
  function resumeUpi() {
    if (PAYMENT_MODE !== "upi" || !configured) return;
    var o = upiLoad();
    if (!o || o.status !== "pending") return;
    if (o.expires && Date.now() > o.expires) return;
    lastFocus = doc.activeElement;
    drawer.hidden = false;
    doc.body.classList.add("no-scroll");
    showUpi(o);
  }

  function initClaim() {
    drawer = $("#claim"); form = $("#claim-form");
    $("#c-cat").innerHTML = '<option value="">Pick a category</option>' + CATS.map(function (c) { return '<option>' + esc(c) + "</option>"; }).join("");
    $("#c-city").innerHTML = '<option value="">Pick a city</option>' + CITIES.map(function (c) { return '<option>' + esc(c) + "</option>"; }).join("");
    $$("[data-close-claim]", drawer).forEach(function (b) { b.addEventListener("click", closeClaim); });
    $$('input[name="mode"]', form).forEach(function (r) { r.addEventListener("change", syncMode); });
    $$('input[name="board"]', form).forEach(function (r) { r.addEventListener("change", renderQuote); });
    $("#c-listing").addEventListener("change", renderQuote);
    $("#c-amt").addEventListener("input", renderQuote);
    $("#amt-minus").addEventListener("click", function () { var p = parseBid(); setBid(Math.max(MIN_BID, (p.n || MIN_BID) - 100)); });
    $("#amt-plus").addEventListener("click", function () { var p = parseBid(); setBid((p.n || MIN_BID - 100) + 100); });
    $("#q-list").addEventListener("click", function () { var q = computeQuote(); setBid(q.mode === "raise" ? Math.max(MIN_BID, q.current + 1) : MIN_BID); });
    $("#q-top").addEventListener("click", function () { var q = computeQuote(); setBid(q.top ? q.top.total + TOP_STEP : MIN_BID); });
    form.addEventListener("submit", submitClaim);
    initUpi();
    drawer.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeClaim(); return; }
      if (e.key !== "Tab") return;
      var f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', drawer)
        .filter(function (el) { return el.offsetParent !== null || el === doc.activeElement; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---------- nav highlight ---------- */
  function initNav() {
    var links = $$(".topnav a");
    if (!("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { if (a.getAttribute("href") === "#" + en.target.id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    links.forEach(function (a) { var t = $(a.getAttribute("href")); if (t) io.observe(t); });
  }

  /* ---------- boot ---------- */
  function refreshLive() {
    if (!sb || doc.hidden) return;
    loadBoard({ animate: true, refreshDays: state.board === "daily" });
    loadStats(); loadFeed(); loadSettings();
    if (state.board !== "all") fetchLive("all").then(function (rows) { if (rows.length) { state.cache.all = rows; renderHero(rows[0]); } }).catch(function () {});
  }
  function connect() {
    if (!configured) return Promise.resolve();
    return (window.supabase ? Promise.resolve() : loadScript(SUPABASE_CDN)).then(function () {
      sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    }).catch(function (err) {
      if (window.console) console.warn("Boli: could not load Supabase, showing sample data.", err && err.message);
      sb = null;
    });
  }
  // Owner can open/close bidding from the admin site (app_settings.bidding_open, exposed via public_settings).
  // null means "no admin setting": keep config.js BIDDING_OPEN.
  function loadSettings() {
    if (!sb) return Promise.resolve();
    return sb.from("public_settings").select("bidding_open").maybeSingle().then(function (res) {
      var v = res && res.data ? res.data.bidding_open : null;
      if (typeof v !== "boolean" || v === C.BIDDING_OPEN) return;
      C.BIDDING_OPEN = v;
      $("#status-line").textContent = v ? "Live · bidding is open" : "Bidding is closed for now";
      syncPayButton();
    }, function () {});
  }
  function start() {
    initTheme(); initCountdown(); initFilters(); initClicks(); initWaitlist(); initClaim(); initNav();
    resumeUpi(); // a UPI payment in progress (stored on this device) reopens straight away
    connect().then(function () {
      loadBoard({ animate: false });
      loadStats(); loadFeed(); trackVisit(); loadSettings();
      if (sb) {
        setInterval(refreshLive, 15000);
        doc.addEventListener("visibilitychange", function () { if (!doc.hidden) refreshLive(); });
      }
    });
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();
})();
