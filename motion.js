/* Boli motion layer. Progressive enhancement only. */
(function () {
"use strict";
var W = window, D = document, mm = W.matchMedia ? function (q) { return W.matchMedia(q).matches; } : function () { return false; };
var reduce = mm("(prefers-reduced-motion: reduce)");
var fine = mm("(pointer: fine)") && mm("(hover: hover)");
var raf = W.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
function $$(s, r) { return [].slice.call((r || D).querySelectorAll(s)); }
function inr(n) { return "\u20b9" + Math.round(Number(n) || 0).toLocaleString("en-IN"); }
function pulse(el, strong) {
if (reduce || !el || !el.animate) return;
var g = D.createElement("span");
g.className = "glowpulse" + (strong ? " glowpulse--top" : "");
g.setAttribute("aria-hidden", "true");
el.appendChild(g);
var a = g.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: strong ? 1600 : 1200, easing: "ease-out" });
a.onfinish = a.oncancel = function () { g.remove(); };
}
function countUp(el) {
if (reduce || !el || el._cu) return;
var to = +el.getAttribute("data-amt"); if (!(to > 0)) return;
el._cu = 1;
var cs = W.getComputedStyle(el), inl = cs.display === "inline";
if (inl) el.style.display = "inline-block";
el.style.minWidth = el.getBoundingClientRect().width + "px";
var t0 = null;
(function step(ts) {
if (!el.isConnected || +el.getAttribute("data-amt") !== to) return;
if (t0 === null) t0 = ts;
var p = Math.min(1, (ts - t0) / 900), e = 1 - Math.pow(1 - p, 4);
el.textContent = inr(to * e);
if (p < 1) raf(step); else { el.style.minWidth = ""; if (inl) el.style.display = ""; }
})(performance.now());
}
W.BoliMotion = { pulse: pulse, reduce: reduce };
if (reduce) return;
var io = "IntersectionObserver" in W ? new IntersectionObserver(function (es) {
var k = 0;
es.forEach(function (e) {
if (!e.isIntersecting) return;
var el = e.target; io.unobserve(el);
el.style.setProperty("--rv-d", Math.min(k++, 6) * 70 + "ms");
el.classList.add("rv-in");
$$("[data-amt]", el).forEach(function (a) { setTimeout(function () { countUp(a); }, Math.min(k, 6) * 70 + 120); });
});
}, { rootMargin: "0px 0px -6% 0px" }) : null;
function reveal(el) {
if (!io || !el || el.classList.contains("rv")) return;
el.classList.add("rv");
el.addEventListener("animationend", function done(ev) {
if (ev.target !== el || ev.animationName !== "rv-up") return;
el.removeEventListener("animationend", done);
el.classList.remove("rv", "rv-in");
});
io.observe(el);
}
var LISTS = ".steps,.faq,.legal,#board-panel";
$$("main > section:not(.hero) > *").forEach(function (el) { if (!el.matches(LISTS)) reveal(el); });
$$(".steps > li, .faq > *, .legal > *").forEach(reveal);
var boardDone = false, heroDone = false;
function onBoard() {
if (boardDone) return;
var items = $$("#podium > .pod, #rows > .row");
if (!items.length) return;
boardDone = true;
items.forEach(reveal);
}
function onHero() {
if (heroDone) return;
var a = D.querySelector("#hero-top [data-amt]");
if (!a) return;
heroDone = true; countUp(a);
}
if ("MutationObserver" in W) {
var mo = new MutationObserver(function () { onBoard(); onHero(); });
["podium", "rows", "hero-top"].forEach(function (id) { var n = D.getElementById(id); if (n) mo.observe(n, { childList: true }); });
}
onBoard(); onHero();
if (!fine) return;
var glow = D.createElement("div");
glow.className = "cursor-glow"; glow.setAttribute("aria-hidden", "true");
D.body.appendChild(glow);
var card = null, btn = null, ev = null, queued = false;
function resetCard(c) {
c.classList.remove("is-tilt", "is-live");
c.style.setProperty("--rx", "0deg"); c.style.setProperty("--ry", "0deg");
clearTimeout(c._lt);
}
function resetBtn(b) { b.style.setProperty("--bx", "0px"); b.style.setProperty("--by", "0px"); }
function frame() {
queued = false;
var e = ev; if (!e) return;
glow.style.transform = "translate3d(" + e.clientX + "px," + e.clientY + "px,0)";
glow.classList.add("is-on");
var t = e.target && e.target.closest ? e.target : null;
var c = t && t.closest(".pod, .row");
if (card && (card !== c || !card.isConnected)) resetCard(card);
if (c && c !== card) {
c.classList.add("is-tilt");
c._lt = setTimeout(function () { c.classList.add("is-live"); }, 260);
}
card = c;
var r = c && c.getBoundingClientRect();
if (r && r.width && r.height) {
var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
var max = c.classList.contains("row") ? 2.5 : 6;
c.style.setProperty("--ry", ((px - 0.5) * 2 * max).toFixed(2) + "deg");
c.style.setProperty("--rx", ((0.5 - py) * 2 * max).toFixed(2) + "deg");
c.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
c.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
}
var b = t && t.closest(".btn:not(:disabled)");
if (b && b.closest(".drawer, .upi")) b = null;
if (btn && btn !== b) resetBtn(btn);
btn = b;
if (b) {
var q = b.getBoundingClientRect(), dx = e.clientX - (q.left + q.width / 2), dy = e.clientY - (q.top + q.height / 2);
b.style.setProperty("--bx", Math.max(-6, Math.min(6, dx * 0.18)).toFixed(1) + "px");
b.style.setProperty("--by", Math.max(-6, Math.min(6, dy * 0.3)).toFixed(1) + "px");
}
}
D.addEventListener("pointermove", function (e) {
if (e.pointerType !== "mouse") return;
ev = e;
if (!queued) { queued = true; raf(frame); }
}, { passive: true });
D.documentElement.addEventListener("pointerleave", function () {
ev = null; glow.classList.remove("is-on");
if (card) resetCard(card); if (btn) resetBtn(btn); card = btn = null;
});
})();
