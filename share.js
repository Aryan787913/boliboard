/* Boli share cards. Draws a rank card on a canvas (no server, no paid service) and shares it.
 * Post: 1200x630 (LinkedIn, X, WhatsApp link previews). Story: 1080x1920 (Instagram / WhatsApp status).
 * Progressive enhancement: without canvas the dialog still offers links. */
(function () {
  "use strict";
  var W = window, D = document;
  var box, panel, lastFocus, cur = null, blob = null, fmt = "post";
  var SIZES = { post: [1200, 630], story: [1080, 1920] };
  var FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif';

  function $(s, r) { return (r || D).querySelector(s); }
  function inr(n) { return "\u20b9" + Math.round(Number(n) || 0).toLocaleString("en-IN"); }
  function host() { try { return new URL(cur.url).host; } catch (e) { return "boliboard.pages.dev"; } }

  function boardLabel(i) {
    return (i.board === "today" ? "Today's board" : i.board === "daily" ? "Daily board" : "All-time board") + (i.dayLabel ? " \u00b7 " + i.dayLabel : "");
  }
  function shareText(i) {
    var where = (i.board === "today" ? "today's board" : i.board === "daily" ? "the daily board" + (i.dayLabel ? " for " + i.dayLabel : "") : "the all-time board");
    return i.name + " is #" + i.rank + " on " + where + " at Boli, the public pay-to-rank board for Indian D2C brands." +
      (i.code ? " Shop with code " + i.code + "." : "");
  }

  /* ---------- drawing ---------- */
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function fitText(c, text, max, size, weight) {
    var s = size;
    do { c.font = weight + " " + s + "px " + FONT; s -= 2; } while (c.measureText(text).width > max && s > 24);
    if (c.measureText(text).width <= max) return text;
    var t = text; while (t.length > 1 && c.measureText(t + "\u2026").width > max) t = t.slice(0, -1);
    return t + "\u2026";
  }
  function mark(c, x, y, s) {
    var k = s / 32;
    c.fillStyle = "#ff9f1c"; rr(c, x, y, s, s, 9 * k); c.fill();
    c.fillStyle = "#140d00";
    [[6, 17, 9], [13.25, 8, 18], [20.5, 13, 13]].forEach(function (b) { rr(c, x + b[0] * k, y + b[1] * k, 5.5 * k, b[2] * k, 1.5 * k); c.fill(); });
  }
  function draw(i, f) {
    var sz = SIZES[f], Wd = sz[0], H = sz[1], story = f === "story";
    var cv = D.createElement("canvas"); cv.width = Wd; cv.height = H;
    var c = cv.getContext && cv.getContext("2d");
    if (!c || typeof c.measureText !== "function") return null;
    var top = i.rank === 1, gold = "#e9c46a", ink = "#f4f1ea", muted = "#a6aab6";
    // background: deep ink with one soft warm light, never loud
    c.fillStyle = "#0b0c10"; c.fillRect(0, 0, Wd, H);
    var g = c.createRadialGradient(Wd * 0.82, story ? H * 0.28 : -40, 10, Wd * 0.82, story ? H * 0.28 : -40, story ? 900 : 760);
    g.addColorStop(0, top ? "rgba(233,196,106,0.20)" : "rgba(255,159,28,0.14)"); g.addColorStop(1, "rgba(11,12,16,0)");
    c.fillStyle = g; c.fillRect(0, 0, Wd, H);
    // hairline frame
    c.strokeStyle = top ? "rgba(233,196,106,0.55)" : "rgba(255,255,255,0.12)"; c.lineWidth = 2;
    rr(c, 28, 28, Wd - 56, H - 56, 28); c.stroke();

    var P = story ? 96 : 72, y = story ? 150 : 70;
    mark(c, P, y, story ? 64 : 48);
    c.fillStyle = ink; c.font = "800 " + (story ? 46 : 36) + "px " + FONT; c.textBaseline = "middle";
    c.fillText("boli", P + (story ? 84 : 64), y + (story ? 33 : 25));
    // paid listing tag, top right
    var tag = i.sample ? "SAMPLE DATA" : "PAID LISTING";
    c.font = "800 " + (story ? 24 : 19) + "px " + FONT;
    var tw = c.measureText(tag).width + (story ? 36 : 28), th = story ? 48 : 38;
    c.strokeStyle = "rgba(255,255,255,0.22)"; rr(c, Wd - P - tw, y + ((story ? 64 : 48) - th) / 2, tw, th, 8); c.stroke();
    c.fillStyle = muted; c.textAlign = "center"; c.fillText(tag, Wd - P - tw / 2, y + (story ? 33 : 25)); c.textAlign = "left";

    // rank
    var boardLine = boardLabel(i).toUpperCase();
    c.textBaseline = "alphabetic";
    y = story ? 700 : 300;
    c.fillStyle = top ? gold : ink; c.font = "800 " + (story ? 300 : 168) + "px " + FONT;
    var rankTxt = "#" + i.rank; c.fillText(rankTxt, P - (story ? 8 : 4), y);
    var rw = c.measureText(rankTxt).width;
    if (!story) {
      c.fillStyle = muted; c.font = "750 22px " + FONT; c.fillText(boardLine, P + rw + 28, y - 96);
      c.fillStyle = ink; c.fillText(fitText(c, i.name, Wd - P * 2 - rw - 28, 54, 800), P + rw + 28, y - 34);
    } else {
      c.fillStyle = muted; c.font = "750 34px " + FONT; c.fillText(boardLine, P, y + 90);
      c.fillStyle = ink; c.fillText(fitText(c, i.name, Wd - P * 2, 92, 800), P, y + 210);
    }
    // facts row
    var facts = [["Total bid", inr(i.total)], ["Category", i.category || "D2C"], ["City", i.city || "India"]];
    var fy = story ? 1120 : 420, colW = (Wd - P * 2) / (story ? 1 : 3);
    facts.forEach(function (fa, k) {
      var fx = story ? P : P + colW * k, yy = story ? fy + k * 150 : fy;
      c.fillStyle = muted; c.font = "700 " + (story ? 30 : 20) + "px " + FONT; c.fillText(fa[0].toUpperCase(), fx, yy);
      c.fillStyle = k === 0 && top ? gold : ink;
      c.fillText(fitText(c, fa[1], colW - 24, story ? 64 : 40, 800), fx, yy + (story ? 72 : 48));
    });
    // footer
    var fyy = H - (story ? 150 : 72);
    c.strokeStyle = "rgba(255,255,255,0.10)"; c.beginPath(); c.moveTo(P, fyy - (story ? 70 : 52)); c.lineTo(Wd - P, fyy - (story ? 70 : 52)); c.stroke();
    c.fillStyle = muted; c.font = "650 " + (story ? 30 : 22) + "px " + FONT;
    var left = i.code ? (i.offer ? i.offer + " with code " : "Code ") + i.code : "The public pay-to-rank board for Indian D2C brands";
    c.fillText(fitText(c, left, story ? Wd - P * 2 : Wd * 0.55, story ? 30 : 22, 650), P, fyy);
    c.fillStyle = ink; c.font = "750 " + (story ? 30 : 22) + "px " + FONT;
    var right = i.nextTop ? "Beat this rank \u00b7 " + host() : host();
    if (story) c.fillText(right, P, fyy + 56);
    else { c.textAlign = "right"; c.fillText(right, Wd - P, fyy); c.textAlign = "left"; }
    return cv;
  }

  /* ---------- dialog ---------- */
  function render() {
    var i = cur, img = $("#share-img"), dl = $("#share-dl"), nat = $("#share-native");
    blob = null; img.hidden = true; dl.hidden = true; nat.hidden = true;
    var cv = null; try { cv = draw(i, fmt); } catch (e) { cv = null; }
    if (cv) {
      var url = cv.toDataURL("image/png");
      img.src = url; img.width = SIZES[fmt][0]; img.height = SIZES[fmt][1];
      img.alt = i.name + " ranked #" + i.rank + " on the Boli " + i.boardName + " board";
      img.hidden = false;
      dl.href = url; dl.setAttribute("download", "boli-" + String(i.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + fmt + ".png");
      dl.hidden = false;
      $(".sharebox__frame").setAttribute("data-fmt", fmt);
      if (cv.toBlob && W.File && navigator.canShare) cv.toBlob(function (b) {
        if (!b || cur !== i) return;
        var file = new W.File([b], dl.getAttribute("download"), { type: "image/png" });
        try { if (navigator.canShare({ files: [file] })) { blob = file; nat.hidden = false; } } catch (e) {}
      }, "image/png");
    }
  }
  function open(id, board, opener) {
    if (!W.BoliApp) return;
    var i = W.BoliApp.info(id, board);
    if (!i) return;
    cur = i; lastFocus = opener || D.activeElement;
    var text = shareText(i);
    $("#share-title").textContent = i.name + " \u00b7 #" + i.rank;
    $("#share-kicker").textContent = i.sample ? "Share card \u00b7 sample data" : "Share card";
    $("#share-line").textContent = text;
    $("#share-wa").href = "https://wa.me/?text=" + encodeURIComponent(text + " " + i.url);
    $("#share-x").href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(i.url);
    $("#share-li").href = "https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(i.url);
    box.hidden = false; D.body.classList.add("no-scroll");
    render();
    setTimeout(function () { panel.focus(); }, 20);
  }
  function close() {
    box.hidden = true; cur = null; blob = null;
    // keep the claim drawer's scroll lock if it is still open
    var drawer = $("#claim"); if (!drawer || drawer.hidden) D.body.classList.remove("no-scroll");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function init() {
    box = $("#share"); if (!box) return;
    panel = $(".sharebox__panel", box);
    D.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-share]");
      if (b) { e.preventDefault(); open(b.getAttribute("data-share"), b.getAttribute("data-share-board"), b); }
    });
    [].forEach.call(box.querySelectorAll("[data-close-share]"), function (x) { x.addEventListener("click", close); });
    [].forEach.call(box.querySelectorAll('input[name="share-fmt"]'), function (r) {
      r.addEventListener("change", function () { fmt = r.value === "story" ? "story" : "post"; if (cur) render(); });
    });
    $("#share-copy").addEventListener("click", function () { if (cur && W.BoliApp) W.BoliApp.copy(cur.url, "Link copied"); });
    $("#share-native").addEventListener("click", function () {
      if (!cur || !blob) return;
      navigator.share({ files: [blob], title: "Boli", text: shareText(cur) + " " + cur.url }).catch(function () {});
    });
    box.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== "Tab") return;
      var f = [].filter.call(box.querySelectorAll('a[href]:not([hidden]), button:not([disabled]):not([hidden]), input'), function (el) { return el.offsetParent !== null || el === D.activeElement; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && D.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && D.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  W.BoliShare = { open: open, draw: draw };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", init); else init();
})();
