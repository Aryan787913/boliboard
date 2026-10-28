/* Boli #1 card layer: sparse gold motes (desktop only) and the "new #1" moment. Progressive enhancement only. */
(function () {
"use strict";
var W = window, D = document;
var mm = W.matchMedia ? function (q) { return W.matchMedia(q).matches; } : function () { return false; };
var reduce = mm("(prefers-reduced-motion: reduce)");
var desktop = mm("(pointer: fine)") && mm("(hover: hover)") && mm("(min-width: 760px)");
var raf = W.requestAnimationFrame, caf = W.cancelAnimationFrame;
var CROWN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3.2 8.6l4.3 3.3 4-6.1a.6.6 0 0 1 1 0l4 6.1 4.3-3.3a.6.6 0 0 1 1 .6l-1.9 8.6a1 1 0 0 1-1 .8H5.1a1 1 0 0 1-1-.8L2.2 9.2a.6.6 0 0 1 1-.6zM5.5 19.6h13a.7.7 0 0 1 0 1.4h-13a.7.7 0 0 1 0-1.4z"/></svg>';

/* ---------- gold motes: one small canvas per #1 card ---------- */
var MAX = 12, motes = {}, live = [];
function light() {
  var t = D.documentElement.getAttribute("data-theme");
  return t === "light" || (t !== "dark" && mm("(prefers-color-scheme: light)"));
}
function seed(w, h, fresh) {
  return { x: Math.random() * w, y: fresh ? h * (0.55 + Math.random() * 0.45) : h + 4, r: 0.6 + Math.random() * 0.9,
    vy: 5 + Math.random() * 7, vx: (Math.random() - 0.5) * 2, a: 0.18 + Math.random() * 0.27, ph: Math.random() * 6.28, life: 0.35 + Math.random() * 0.35 };
}
function Motes(card, kind) {
  var c = D.createElement("canvas"), fx = card.querySelector(".t1-fx");
  c.className = "t1-motes"; c.setAttribute("aria-hidden", "true");
  (fx || card).appendChild(c);
  this.c = c; this.ctx = c.getContext && c.getContext("2d"); this.card = card; this.kind = kind;
  // keep particles across re-renders of the same slot so the drift never restarts
  this.p = motes[kind] || (motes[kind] = []);
  this.vis = false; this.id = 0; this.t = 0;
  var self = this;
  this.io = "IntersectionObserver" in W ? new IntersectionObserver(function (es) { self.vis = es[es.length - 1].isIntersecting; self.go(); }) : null;
  if (this.io) this.io.observe(card); else { this.vis = true; }
  this.size(); this.go();
}
Motes.prototype.size = function () {
  var dpr = Math.min(2, W.devicePixelRatio || 1), w = this.card.offsetWidth, h = this.card.offsetHeight;
  if (!w || !h) return false;
  if (w !== this.w || h !== this.h) {
    this.w = w; this.h = h; this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return true;
};
Motes.prototype.go = function () {
  var on = this.vis && !D.hidden && this.card.isConnected && !!this.ctx;
  if (on && !this.id) { var self = this; this.t = 0; this.id = raf(function f(ts) { self.id = raf(f); self.step(ts); }); }
  else if (!on && this.id) { caf(this.id); this.id = 0; }
};
Motes.prototype.step = function (ts) {
  if (!this.card.isConnected) return this.stop();
  var dt = this.t ? Math.min(0.05, (ts - this.t) / 1000) : 0; this.t = ts;
  if (!this.size()) return;
  var p = this.p, w = this.w, h = this.h, g = this.ctx;
  while (p.length < MAX) p.push(seed(w, h, true));
  g.clearRect(0, 0, w, h);
  g.fillStyle = light() ? "#b7860b" : "#ffd27a";
  for (var i = 0; i < p.length; i++) {
    var m = p[i];
    m.y -= m.vy * dt; m.x += (m.vx + Math.sin(ts / 1400 + m.ph) * 1.5) * dt;
    var k = (h - m.y) / (h * m.life); // 0 at the bottom edge, 1 where it fades out
    if (k >= 1 || m.x < -4 || m.x > w + 4) { p[i] = seed(w, h, false); continue; }
    g.globalAlpha = m.a * Math.min(1, k * 4) * (1 - k);
    g.beginPath(); g.arc(m.x, m.y, m.r, 0, 6.2832); g.fill();
  }
  g.globalAlpha = 1;
};
Motes.prototype.stop = function () {
  if (this.id) caf(this.id); this.id = 0;
  if (this.io) this.io.disconnect();
  var i = live.indexOf(this); if (i >= 0) live.splice(i, 1);
};
function attach() {
  live.slice().forEach(function (m) { if (!m.card.isConnected) m.stop(); });
  [["pod", "#podium > .is-top1"], ["hero", "#hero-top .is-top1"]].forEach(function (s) {
    var card = D.querySelector(s[1]);
    if (!card || card._t1) return;
    card._t1 = 1;
    live.push(new Motes(card, s[0]));
  });
}
if (!reduce && desktop && raf) {
  if ("MutationObserver" in W) {
    var mo = new MutationObserver(attach);
    ["podium", "hero-top"].forEach(function (id) { var n = D.getElementById(id); if (n) mo.observe(n, { childList: true }); });
  }
  D.addEventListener("visibilitychange", function () { live.forEach(function (m) { m.go(); }); });
  attach();
}

/* ---------- new #1 moment: gold ring pulse + toast ---------- */
var toastEl = null, toastT = 0, last = { id: null, at: 0 };
function toast(name) {
  if (!toastEl) {
    toastEl = D.createElement("div");
    toastEl.className = "t1-toast"; toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite");
    toastEl.innerHTML = '<span class="t1-toast__icon">' + CROWN + '</span><span class="t1-toast__text"></span>';
    D.body.appendChild(toastEl);
  }
  toastEl.querySelector(".t1-toast__text").textContent = name + " is now #1";
  toastEl.classList.remove("is-on");
  void toastEl.offsetWidth; // restart the entrance transition
  toastEl.classList.add("is-on");
  clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2800);
}
function ring(card) {
  if (reduce || !card || !card.animate) return;
  var fx = card.querySelector(".t1-fx") || card, s = D.createElement("span");
  s.className = "t1-pulse"; s.setAttribute("aria-hidden", "true");
  fx.appendChild(s);
  var a = s.animate([{ opacity: 0 }, { opacity: 1, offset: 0.22 }, { opacity: 0.35, offset: 0.55 }, { opacity: 0.8, offset: 0.7 }, { opacity: 0 }],
    { duration: 1500, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  a.onfinish = a.oncancel = function () { s.remove(); };
}
D.addEventListener("boli:newtop", function (e) {
  var d = e.detail || {}; if (!d.id) return;
  var now = Date.now(), dupe = last.id === d.id && now - last.at < 2000;
  last = { id: d.id, at: now };
  // the board re-renders synchronously before the event; pulse whichever #1 cards now show this brand
  var pod = D.querySelector("#podium > .is-top1"), hero = D.querySelector("#hero-top .is-top1");
  if (!dupe) {
    if (pod && pod.getAttribute("data-key") === d.id) ring(pod);
    if (hero && d.board === "all") ring(hero);
    if (d.name) toast(d.name);
  }
});
W.BoliTop1 = { reduce: reduce, desktop: desktop };
})();
