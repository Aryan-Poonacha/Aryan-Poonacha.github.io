/* aryan-poonacha.github.io — one galaxy, v4.1: an open 2D space of tiles.
   The world is a DOM layer moved by a camera (translate + scale); the sky behind it is a canvas
   of dust and haze with parallax, plus the constellation lines. No dependencies. */
(function () {
  "use strict";
  var G = window.GALAXY, qs = new URLSearchParams(location.search);
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || qs.get("still") === "1";
  var stage = document.getElementById("stage"), world = document.getElementById("world");
  var canvas = document.getElementById("sky"), ctx = canvas.getContext("2d");
  var tip = document.getElementById("tip"), card = document.getElementById("card"), index = document.getElementById("index");
  var mini = document.getElementById("minimap"), mctx = mini.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0;
  var narrow = function () { return W < 720; };

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function withAlpha(hex, a) { var n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")"; }
  function h(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }

  var fieldById = {}; G.fields.forEach(function (f) { fieldById[f.id] = f; });
  var stars = G.stars, byId = {};
  stars.forEach(function (s) { byId[s.id] = s; s.near = []; });
  var edges = G.edges.map(function (e) { var a = byId[e[0]], b = byId[e[1]]; a.near.push(b); b.near.push(a); return [a, b]; });

  /* ---------- sizes ---------- */
  function sizeOf(s) {
    var wmap = { 5: 400, 4: 320, 3: 268, 2: 226, 1: 190 }, w = wmap[s.weight] || 200;
    if (s.kind === "interest") return { w: Math.min(330, 34 + s.title.length * 8.4), h: 38 };
    if (s.media && s.media.book) return { w: 190, h: 285 };
    if (s.id === "me") return { w: 210, h: 210 };
    if (s.field === "life") return { w: 200, h: 112 };
    if (s.media && (s.media.video || s.media.image)) return { w: w, h: Math.round(w * 9 / 16) + 24 };
    return { w: w, h: Math.round(w * 0.78) };
  }

  /* ---------- layout: loose clusters on arms, then rectangles pushed apart ---------- */
  var ARM = { software: 0, games: 72, writing: 144, research: 216, ventures: 288 };
  var aspect = { x: 1, y: 0.74 };
  function targetOf(s) {
    var rng = mulberry32(hash(s.id));
    if (s.id === "me") return { x: 0, y: 0 };
    if (s.field === "life") { var la = rng() * 6.283, lr = 250 + rng() * 110; return { x: Math.cos(la) * lr * 1.25 * aspect.x, y: Math.sin(la) * lr * aspect.y * 1.1 }; }
    var base = ARM[s.field] * Math.PI / 180;
    var r = s.kind === "interest" ? 1500 + (rng() - 0.5) * 140 : 470 + (s.year - 2016) * 84 + (rng() - 0.5) * 130;
    var a = base + r * 0.00075 + (rng() - 0.5) * 0.6;
    return { x: Math.cos(a) * r * aspect.x, y: Math.sin(a) * r * aspect.y };
  }
  var PAD = 54;
  function layout() {
    aspect = narrow() ? { x: 0.46, y: 1.55 } : { x: 1, y: 0.74 };
    stars.forEach(function (s) { var z = sizeOf(s); s.w = z.w; s.h = z.h; var t = targetOf(s); s.tx = t.x; s.ty = t.y; s.x = t.x; s.y = t.y; s.r0 = Math.hypot(t.x, t.y); });
    for (var it = 0; it < 600; it++) {
      var pull = 0.03 * (1 - it / 600);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i]; if (s.id === "me") continue;
        s.x += (s.tx - s.x) * pull; s.y += (s.ty - s.y) * pull;
      }
      for (var a = 0; a < stars.length; a++) for (var b = a + 1; b < stars.length; b++) {
        var p = stars[a], q = stars[b];
        var ox = (p.w + q.w) / 2 + PAD - Math.abs(p.x - q.x), oy = (p.h + q.h) / 2 + PAD - Math.abs(p.y - q.y);
        if (ox > 0 && oy > 0) {
          var sx = p.x < q.x ? -1 : 1, sy = p.y < q.y ? -1 : 1;
          var fp = p.id === "me" ? 0 : 0.5, fq = q.id === "me" ? 0 : 0.5; if (!fp) fq = 1; if (!fq) fp = 1;
          ox *= 1.04; oy *= 1.04; if (ox < oy) { p.x += sx * ox * fp; q.x -= sx * ox * fq; } else { p.y += sy * oy * fp; q.y -= sy * oy * fq; }
        }
      }
    }
    stars.forEach(function (s) { s.x = Math.round(s.x); s.y = Math.round(s.y); });
    bounds = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
    stars.forEach(function (s) { bounds.x0 = Math.min(bounds.x0, s.x - s.w / 2); bounds.y0 = Math.min(bounds.y0, s.y - s.h / 2); bounds.x1 = Math.max(bounds.x1, s.x + s.w / 2); bounds.y1 = Math.max(bounds.y1, s.y + s.h / 2); });
    G.fields.forEach(function (f) {
      var xs = stars.filter(function (s) { return s.field === f.id && s.kind !== "interest"; }), c = { x: 0, y: 0, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
      xs.forEach(function (s) { c.x += s.x / xs.length; c.y += s.y / xs.length; c.x0 = Math.min(c.x0, s.x - s.w / 2); c.y0 = Math.min(c.y0, s.y - s.h / 2); c.x1 = Math.max(c.x1, s.x + s.w / 2); c.y1 = Math.max(c.y1, s.y + s.h / 2); });
      f.centre = c;
    });
    makeDust();
  }
  var bounds;

  /* ---------- dust and haze ---------- */
  var dust = [], haze = [], sprites = {};
  function sprite(color, size, inner) {
    var c = document.createElement("canvas"); c.width = c.height = size; var g = c.getContext("2d");
    var grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, color); grd.addColorStop(inner, color); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.fillRect(0, 0, size, size); return c;
  }
  G.fields.forEach(function (f) { sprites[f.id] = { glow: sprite(withAlpha(f.color, 0.55), 128, 0.04), dot: sprite(withAlpha(f.color, 1), 16, 0.3) }; });
  sprites.w = sprite("rgba(237,233,226,1)", 16, 0.3);
  function makeDust() {
    var rng = mulberry32(7), arms = G.fields.filter(function (f) { return f.angle !== null; });
    function gauss() { var u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    function onArm(f, r) { var a = f.angle * Math.PI / 180 + r * 0.00075 + gauss() * 0.1, spread = gauss() * (40 + r * 0.08); return { x: (Math.cos(a) * r + Math.cos(a + 1.5708) * spread) * aspect.x, y: (Math.sin(a) * r + Math.sin(a + 1.5708) * spread) * aspect.y }; }
    dust = []; haze = [];
    for (var n = 0; n < 3400; n++) {
      var kind = rng(), x, y, tint = null, p, q;
      if (kind < 0.62) { var f = arms[Math.floor(rng() * arms.length)], r = 120 + Math.pow(rng(), 0.9) * 1650; q = onArm(f, r); x = q.x; y = q.y; tint = f.id; p = 0.6 + rng() * 0.4; }
      else if (kind < 0.8) { var rr = Math.abs(gauss()) * 260, aa = rng() * 6.283; x = Math.cos(aa) * rr * aspect.x; y = Math.sin(aa) * rr * aspect.y; tint = "life"; p = 0.6 + rng() * 0.4; }
      else { x = (rng() - 0.5) * 6000 * aspect.x; y = (rng() - 0.5) * 6000 * aspect.y; p = 0.22 + rng() * 0.45; }
      dust.push({ x: x, y: y, p: p, r: 0.35 + rng() * 1.05, a: 0.1 + rng() * 0.5, ph: rng() * 6.28, c: tint });
    }
    for (var m = 0; m < 760; m++) { var hf = arms[Math.floor(rng() * arms.length)], hr = 80 + Math.pow(rng(), 0.95) * 1650, hq = onArm(hf, hr); haze.push({ x: hq.x, y: hq.y, r: 30 + rng() * 70, a: 0.028 + rng() * 0.04, c: hf.id, p: 0.75 + rng() * 0.25 }); }
    for (var m2 = 0; m2 < 170; m2++) { var cr0 = Math.abs(gauss()) * 220, ca0 = rng() * 6.283; haze.push({ x: Math.cos(ca0) * cr0 * aspect.x, y: Math.sin(ca0) * cr0 * aspect.y, r: 40 + rng() * 80, a: 0.035 + rng() * 0.05, c: "life", p: 0.8 + rng() * 0.2 }); }
  }

  /* ---------- camera ---------- */
  var cam = { x: 0, y: 0, z: 0.4 }, camT = { x: 0, y: 0, z: 0.4 }, touched = false;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function fitTo(b, pad) {
    var bw = b.x1 - b.x0, bh = b.y1 - b.y0, z = Math.min((W - pad.x) / bw, (H - pad.y) / bh);
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 + (narrow() ? 0 : 0), z: clampZ(z) };
  }
  function clampZ(z) { return Math.max(0.12, Math.min(3, z)); }
  function home(immediate) {
    var f = fitTo(bounds, narrow() ? { x: 24, y: 220 } : { x: 120, y: 190 });
    if (narrow()) { f = { x: 0, y: 0, z: 0.3 }; }
    camT = f; if (immediate || reduced) cam = { x: f.x, y: f.y, z: f.z };
  }
  function flyTo(x, y, z) { camT = { x: x, y: y, z: clampZ(z) }; if (reduced) cam = { x: x, y: y, z: clampZ(z) }; touched = true; }
  function zoomAt(px, py, factor) {
    var z = clampZ(camT.z * factor), wx = camT.x + (px - W / 2) / camT.z, wy = camT.y + (py - H / 2) / camT.z;
    camT = { x: wx - (px - W / 2) / z, y: wy - (py - H / 2) / z, z: z }; cam = { x: camT.x, y: camT.y, z: camT.z }; touched = true;
  }
  function toScreen(x, y) { return { x: W / 2 + (x - cam.x) * cam.z, y: H / 2 + (y - cam.y) * cam.z }; }

  /* ---------- tiles ---------- */
  var tiles = {}, nebulae = [];
  function build() {
    world.innerHTML = "";
    G.fields.forEach(function (f) {
      if (f.angle === null) return;
      var n = h("div", "nebula", f.name); n.style.setProperty("--f", f.color); world.appendChild(n); nebulae.push([n, f]);
    });
    var order = stars.slice().sort(function (a, b) { return a.r0 - b.r0; });
    order.forEach(function (s, i) {
      var f = fieldById[s.field], t = h("a", "tile tile--" + s.kind + (s.media && s.media.video ? " tile--video" : "") + (s.media && s.media.book ? " tile--book" : "") + (s.id === "me" ? " tile--me" : "") + (s.field === "life" ? " tile--life" : ""));
      t.href = "#" + s.id; t.id = "tile-" + s.id; t.style.setProperty("--f", f.color); t.style.setProperty("--d", (reduced ? 0 : Math.min(2.2, s.r0 * 0.0011)) + "s");
      t.setAttribute("aria-label", s.title + (s.when ? ", " + s.when : "") + ", " + f.name);
      t.dataset.id = s.id; t.dataset.field = s.field;
      if (s.media && s.media.video) {
        var mv = h("div", "tile__media"), v = document.createElement("video");
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = "metadata"; v.poster = s.media.poster; v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
        var src = document.createElement("source"); src.src = s.media.video; src.type = "video/mp4"; v.appendChild(src);
        mv.appendChild(v); t.appendChild(mv);
      } else if (s.media && s.media.image) {
        var mi = h("div", "tile__media" + (s.media.square ? " tile__media--square" : "")), im = h("img"); im.src = s.media.image; im.alt = ""; im.loading = "lazy"; mi.appendChild(im); t.appendChild(mi);
      } else if (s.media && s.media.book) {
        t.innerHTML = '<span class="book__spine"></span><span class="book__cover"><span class="book__title">CURE<br>BEREFT</span><span class="book__author">Aryan Poonacha</span></span>';
      }
      if (s.kind === "interest") { t.appendChild(h("span", "tile__t", s.title)); }
      else if (!(s.media && s.media.book)) {
        var cap = h("div", "tile__cap"); cap.appendChild(h("span", "tile__t", s.title));
        var m = (s.when ? s.when : "") + (s.when && s.meta ? " · " : "") + (s.id === "me" ? "" : (s.meta || ""));
        if (s.id === "me") m = s.meta;
        if (m) cap.appendChild(h("span", "tile__m", m)); t.appendChild(cap);
      }
      world.appendChild(t); tiles[s.id] = t;
      t.addEventListener("mouseenter", function () { hot = s; showTip(s); });
      t.addEventListener("mouseleave", function () { if (hot === s) hot = null; hideTip(); });
      t.addEventListener("focus", function () { hot = s; showTip(s); });
      t.addEventListener("blur", function () { if (hot === s) hot = null; hideTip(); });
      t.addEventListener("click", function (e) { if (dragged) { e.preventDefault(); return; } if (location.hash === "#" + s.id) { e.preventDefault(); open(s); } });
    });
    place();
    requestAnimationFrame(function () { requestAnimationFrame(function () { stage.classList.add("is-born"); syncVideos(); }); });
    watchVideos();
  }
  function place() {
    stars.forEach(function (s) { var t = tiles[s.id]; t.style.left = (s.x - s.w / 2) + "px"; t.style.top = (s.y - s.h / 2) + "px"; t.style.width = s.w + "px"; t.style.height = s.h + "px"; });
    nebulae.forEach(function (n) { var c = n[1].centre; n[0].style.left = ((c.x0 + c.x1) / 2) + "px"; n[0].style.top = (c.y0 - (narrow() ? 70 : 90)) + "px"; });
  }

  /* ---------- videos: play what is on screen ---------- */
  var playing = new Set(), vids = [], lastSync = 0, lastCam = null;
  function syncVideos() {
    if (reduced || document.visibilityState !== "visible") return;
    var cx = W / 2, cy = H / 2, seen = [];
    vids.forEach(function (v) {
      var b = v.getBoundingClientRect(), on = b.right > -40 && b.bottom > -40 && b.left < W + 40 && b.top < H + 40;
      if (on) seen.push({ v: v, d: Math.hypot(b.left + b.width / 2 - cx, b.top + b.height / 2 - cy) });
    });
    seen.sort(function (a, b) { return a.d - b.d; });
    var keep = new Set(seen.slice(0, narrow() ? 8 : 24).map(function (o) { return o.v; }));
    vids.forEach(function (v) {
      if (keep.has(v)) { if (!playing.has(v) || v.paused) { playing.add(v); if (!(active && tiles[active.id].contains(v))) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } } }
      else if (playing.has(v)) { playing.delete(v); v.pause(); }
    });
  }
  function watchVideos() {
    vids = Array.prototype.slice.call(world.querySelectorAll("video"));
    if (reduced) return;
    document.addEventListener("visibilitychange", function () { if (document.visibilityState !== "visible") vids.forEach(function (v) { v.pause(); }); else syncVideos(); });
    syncVideos();
  }

  /* ---------- tooltip ---------- */
  var hot = null;
  function showTip(s) { tip.textContent = ""; tip.appendChild(h("span", "t", s.title)); if (s.when) tip.appendChild(h("span", "y", s.when)); tip.style.setProperty("--f", fieldById[s.field].color); tip.setAttribute("data-on", "true"); }
  function hideTip() { tip.setAttribute("data-on", "false"); }

  /* ---------- draw loop ---------- */
  var focusField = null, born = performance.now();
  function frame(now) {
    var t = (now - born) / 1000, k = reduced ? 1 : 0.12;
    cam.x += (camT.x - cam.x) * k; cam.y += (camT.y - cam.y) * k; cam.z = Math.exp(Math.log(cam.z) + (Math.log(camT.z) - Math.log(cam.z)) * k);
    world.style.transform = "translate(" + (W / 2 - cam.x * cam.z) + "px," + (H / 2 - cam.y * cam.z) + "px) scale(" + cam.z + ")";
    stage.style.setProperty("--z", cam.z.toFixed(3));
    ctx.clearRect(0, 0, W, H);
    var entrance = reduced ? 1 : Math.min(1, t / 1.4);
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < haze.length; i++) {
      var hb = haze[i], zz = Math.pow(cam.z, hb.p), hx = W / 2 + (hb.x - cam.x) * hb.p * zz, hy = H / 2 + (hb.y - cam.y) * hb.p * zz, hs = hb.r * 2 * Math.pow(cam.z, 0.9);
      if (hx < -hs || hy < -hs || hx > W + hs || hy > H + hs) continue;
      ctx.globalAlpha = hb.a * entrance * (focusField && focusField !== hb.c ? 0.35 : 1);
      ctx.drawImage(sprites[hb.c].glow, hx - hs / 2, hy - hs / 2, hs, hs);
    }
    for (var d = 0; d < dust.length; d++) {
      var p = dust[d], pz = Math.pow(cam.z, p.p), sx = W / 2 + (p.x - cam.x) * p.p * pz, sy = H / 2 + (p.y - cam.y) * p.p * pz;
      if (sx < -8 || sy < -8 || sx > W + 8 || sy > H + 8) continue;
      var tw = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 1.3 + p.ph), size = p.r * 2.4 * Math.pow(cam.z, 0.35) + 1.2;
      ctx.globalAlpha = p.a * tw * entrance * (focusField ? 0.6 : 1);
      ctx.drawImage(p.c ? sprites[p.c].dot : sprites.w, sx - size / 2, sy - size / 2, size, size);
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.lineWidth = 1;
    var lit = active || hot;
    for (var e = 0; e < edges.length; e++) {
      var a = edges[e][0], b = edges[e][1], al = 0.09, col = "#EDE9E2";
      if (lit && (a === lit || b === lit)) { al = 0.55; col = fieldById[lit.field].color; }
      else if (focusField) al = (a.field === focusField && b.field === focusField) ? 0.2 : 0.03;
      else if (active) al = 0.04;
      var pa = toScreen(a.x, a.y), pb = toScreen(b.x, b.y);
      ctx.strokeStyle = withAlpha(col, al * entrance); ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    if (hot) { var tb = tiles[hot.id].getBoundingClientRect(); tip.style.left = Math.max(8, Math.min(W - tip.offsetWidth - 8, tb.left)) + "px"; tip.style.top = (tb.top - tip.offsetHeight - 8 < 8 ? tb.bottom + 8 : tb.top - tip.offsetHeight - 8) + "px"; }
    if (now - lastSync > 400) { lastSync = now; var key = Math.round(cam.x) + ":" + Math.round(cam.y) + ":" + cam.z.toFixed(2); if (key !== lastCam) { lastCam = key; syncVideos(); } }
    drawMini();
    requestAnimationFrame(frame);
  }
  function drawMini() {
    if (narrow()) return;
    var mw = mini.width / dpr, mh = mini.height / dpr, bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0, s = Math.min((mw - 12) / bw, (mh - 12) / bh);
    var ox = (mw - bw * s) / 2 - bounds.x0 * s, oy = (mh - bh * s) / 2 - bounds.y0 * s;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.clearRect(0, 0, mw, mh);
    stars.forEach(function (st) { mctx.fillStyle = withAlpha(fieldById[st.field].color, st.kind === "interest" ? 0.35 : 0.9); mctx.fillRect(ox + (st.x - st.w / 2) * s, oy + (st.y - st.h / 2) * s, Math.max(1.5, st.w * s), Math.max(1.5, st.h * s)); });
    var vx = ox + (cam.x - W / 2 / cam.z) * s, vy = oy + (cam.y - H / 2 / cam.z) * s, vw = W / cam.z * s, vh = H / cam.z * s;
    mctx.strokeStyle = "rgba(237,233,226,0.7)"; mctx.lineWidth = 1; mctx.strokeRect(Math.max(0.5, vx), Math.max(0.5, vy), Math.min(mw - 1, vw), Math.min(mh - 1, vh));
    mini.dataset.s = s; mini.dataset.ox = ox; mini.dataset.oy = oy;
  }
  mini.addEventListener("click", function (e) { var r = mini.getBoundingClientRect(), s = +mini.dataset.s; flyTo((e.clientX - r.left - +mini.dataset.ox) / s, (e.clientY - r.top - +mini.dataset.oy) / s, Math.max(camT.z, 0.6)); });

  /* ---------- pointer: drag, wheel, pinch ---------- */
  var pointers = new Map(), last = null, down = null, dragged = false, pinch = null;
  stage.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".hud, .card, .index, #minimap")) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { down = { x: e.clientX, y: e.clientY }; last = down; dragged = false; }
    else if (pointers.size === 2) { var p = Array.from(pointers.values()); pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), z: camT.z }; dragged = true; }
  });
  stage.addEventListener("pointermove", function (e) {
    if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) { var p = Array.from(pointers.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); zoomAt((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, (pinch.z * d / pinch.d) / camT.z); return; }
    if (!down) return;
    if (!dragged && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { dragged = true; stage.classList.add("is-drag"); hideTip(); try { stage.setPointerCapture(e.pointerId); } catch (err) {} }
    if (dragged) { camT.x -= (e.clientX - last.x) / cam.z; camT.y -= (e.clientY - last.y) / cam.z; cam.x = camT.x; cam.y = camT.y; touched = true; }
    last = { x: e.clientX, y: e.clientY };
  });
  function up(e) {
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { var wasDrag = dragged; down = null; stage.classList.remove("is-drag"); setTimeout(function () { dragged = false; }, 0); if (!wasDrag && !e.target.closest(".tile, .hud, .card, .index, #minimap") && active) closeCard(); }
  }
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up); window.addEventListener("pointerup", function (e) { if (pointers.has(e.pointerId)) up(e); });
  stage.addEventListener("wheel", function (e) { if (e.target.closest(".card, .index")) return; e.preventDefault(); if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 || true) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0013)); }, { passive: false });
  stage.addEventListener("dblclick", function (e) { if (e.target.closest(".tile, .hud, .card, .index")) return; zoomAt(e.clientX, e.clientY, 1.8); });

  /* ---------- card ---------- */
  var active = null;
  function open(s, takeFocus) {
    if (!s) return; active = s; hideTip();
    var z = Math.max(camT.z, narrow() ? 0.62 : 0.95), freeW = narrow() ? W : W - 470 - 26, ax = freeW / 2, ay = narrow() ? Math.min(H * 0.26, 170) : H / 2;
    flyTo(s.x - (ax - W / 2) / z, s.y - (ay - H / 2) / z, z);
    var f = fieldById[s.field]; card.innerHTML = ""; card.style.setProperty("--f", f.color);
    var close = h("button", "card__close", "Close ×"); close.type = "button"; close.addEventListener("click", function () { closeCard(); }); card.appendChild(close);
    var m = s.media || {};
    if (m.video) {
      var fig = h("figure", "card__media"), v = document.createElement("video");
      v.controls = true; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = !reduced; v.poster = m.poster; v.src = m.video; v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
      fig.appendChild(v); if (m.caption) fig.appendChild(h("figcaption", "label", m.caption)); card.appendChild(fig);
      var tv = tiles[s.id].querySelector("video"); if (tv) tv.pause();
    } else if (m.image) { var fi = h("figure", "card__media" + (m.square ? " card__media--square" : "")), im = h("img"); im.src = m.image; im.alt = ""; fi.appendChild(im); card.appendChild(fi); }
    else if (m.book) { var bk = h("a", "book book--card"); bk.href = s.links[0][1]; bk.target = "_blank"; bk.rel = "noopener"; bk.innerHTML = '<span class="book__spine"></span><span class="book__cover"><span class="book__title">CURE<br>BEREFT</span><span class="book__author">Aryan Poonacha</span></span>'; card.appendChild(bk); }
    card.appendChild(h("p", "card__meta", (f.name + (s.when ? " · " + s.when : "") + (s.meta ? " · " + s.meta : "")).toUpperCase()));
    card.appendChild(h("h2", "card__title", s.title));
    if (s.line) card.appendChild(h("p", "card__lead", s.line));
    (s.facts || []).forEach(function (p) { card.appendChild(h("p", "card__p", p)); });
    if (s.tech) { var te = h("p", "card__tech"); te.appendChild(h("span", "label", "Built with")); te.appendChild(h("span", null, s.tech)); card.appendChild(te); }
    if (s.links && s.links.length) {
      var ln = h("p", "card__links");
      s.links.forEach(function (l, i) { if (i) ln.appendChild(h("span", "sep", "·")); var a = h("a", null, l[0] + (l[1].indexOf("http") === 0 ? " ↗" : "")); a.href = l[1]; if (l[1].indexOf("http") === 0) { a.target = "_blank"; a.rel = "noopener"; } ln.appendChild(a); });
      card.appendChild(ln);
    }
    if (s.near.length) {
      var rel = h("p", "card__near"); rel.appendChild(h("span", "card__nearlabel", "Linked"));
      s.near.forEach(function (o) { var b = h("a", "chip", o.title); b.href = "#" + o.id; b.style.setProperty("--f", fieldById[o.field].color); rel.appendChild(b); });
      card.appendChild(rel);
    }
    card.setAttribute("data-on", "true"); card.scrollTop = 0; document.body.setAttribute("data-active", "true");
    Object.keys(tiles).forEach(function (id) { tiles[id].classList.toggle("is-active", id === s.id); });
    if (location.hash !== "#" + s.id) history.replaceState(null, "", "#" + s.id);
    if (takeFocus) close.focus({ preventScroll: true });
  }
  function closeCard() {
    if (!active) return;
    if (card.contains(document.activeElement)) document.getElementById("index-toggle").focus({ preventScroll: true });
    var was = active; active = null;
    card.setAttribute("data-on", "false"); card.querySelectorAll("video").forEach(function (v) { v.pause(); });
    document.body.removeAttribute("data-active"); tiles[was.id].classList.remove("is-active");
    var tv = tiles[was.id].querySelector("video"); if (tv && playing.has(tv)) { var p = tv.play(); if (p && p.catch) p.catch(function () {}); }
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }
  var indexPick = false; /* an index item was chosen and its hashchange is on the way */
  function onHash() { var id = location.hash.slice(1), pick = indexPick; indexPick = false; if (id && byId[id]) { var takeFocus = pick || index.getAttribute("data-on") === "true" || card.contains(document.activeElement); toggleIndex(false, true); open(byId[id], takeFocus); } else if (!id) { closeCard(); } }
  window.addEventListener("hashchange", onHash);

  /* ---------- hud ---------- */
  document.getElementById("zoom-in").addEventListener("click", function () { zoomAt(W / 2, H / 2, 1.5); });
  document.getElementById("zoom-out").addEventListener("click", function () { zoomAt(W / 2, H / 2, 1 / 1.5); });
  document.getElementById("zoom-home").addEventListener("click", function () { closeCard(); home(); });
  document.getElementById("home-link").addEventListener("click", function (e) { e.preventDefault(); toggleIndex(false); closeCard(); home(); if (location.hash) history.replaceState(null, "", location.pathname + location.search); });
  var legend = document.getElementById("legend");
  G.fields.forEach(function (f) {
    var n = stars.filter(function (s) { return s.field === f.id && s.kind !== "interest" && s.id !== "me"; }).length;
    var li = h("li"), b = h("button", "legend__item"); b.type = "button"; b.style.setProperty("--f", f.color);
    b.appendChild(h("i", "swatch")); b.appendChild(h("span", null, f.name)); b.appendChild(h("span", "n", String(n)));
    function on() { focusField = f.id; stage.dataset.focus = f.id; stars.forEach(function (s) { tiles[s.id].classList.toggle("is-dim", s.field !== f.id); }); }
    function off() { focusField = null; delete stage.dataset.focus; stars.forEach(function (s) { tiles[s.id].classList.remove("is-dim"); }); }
    b.addEventListener("mouseenter", on); b.addEventListener("mouseleave", off); b.addEventListener("focus", on); b.addEventListener("blur", off);
    b.addEventListener("click", function () { closeCard(); var c = f.centre, fit = fitTo({ x0: c.x0 - 40, y0: c.y0 - 40, x1: c.x1 + 40, y1: c.y1 + 40 }, { x: 80, y: 200 }); flyTo(fit.x, fit.y, Math.min(fit.z, 1.2)); });
    li.appendChild(b); legend.appendChild(li);
  });
  var li2 = h("li"), sp2 = h("span", "legend__item legend__item--static"); sp2.appendChild(h("i", "swatch swatch--hollow")); sp2.appendChild(h("span", null, "Interests")); li2.appendChild(sp2); legend.appendChild(li2);

  /* ---------- index ---------- */
  var indexBody = document.getElementById("index-body");
  G.fields.forEach(function (f) {
    var sec = h("section", "index__group"); sec.style.setProperty("--f", f.color); sec.appendChild(h("h3", "index__field", f.name));
    var ul = h("ul");
    stars.filter(function (s) { return s.field === f.id; }).sort(function (a, b) { return (b.year || 0) - (a.year || 0) || b.weight - a.weight; }).forEach(function (s) {
      var li = h("li"), a = h("a", "index__item" + (s.kind === "interest" ? " index__item--interest" : "")); a.href = "#" + s.id;
      a.appendChild(h("span", "t", s.title)); a.appendChild(h("span", "y", s.kind === "interest" ? "interest" : (s.when || "")));
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { toggleIndex(false); return; } /* opens elsewhere, no card here */
        var keyboard = e.detail === 0;
        toggleIndex(false, true); if (location.hash === "#" + s.id) open(s, keyboard); else indexPick = keyboard;
      });
      li.appendChild(a); ul.appendChild(li);
    });
    sec.appendChild(ul); indexBody.appendChild(sec);
  });
  var indexOpener = null;
  function toggleIndex(force, keepFocus) {
    var toggle = document.getElementById("index-toggle"), was = index.getAttribute("data-on") === "true", on = typeof force === "boolean" ? force : !was;
    if (on === was) return;
    index.setAttribute("data-on", on ? "true" : "false"); toggle.setAttribute("aria-expanded", on ? "true" : "false");
    if (on) { indexOpener = document.activeElement; var first = index.querySelector("a"); if (first) first.focus(); }
    else if (!keepFocus) {
      indexOpener.focus({ preventScroll: true });
      if (document.activeElement !== indexOpener || indexOpener === document.body) (active ? card.querySelector(".card__close") : toggle).focus({ preventScroll: true });
    }
  }
  document.getElementById("index-toggle").addEventListener("click", function () { toggleIndex(); });
  document.getElementById("index-close").addEventListener("click", function () { toggleIndex(false); });

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", function (e) {
    var typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === "Escape") { if (index.getAttribute("data-on") === "true") toggleIndex(false); else if (active) { closeCard(); } return; }
    if (e.key === "Tab" && index.getAttribute("data-on") === "true") {
      var items = index.querySelectorAll("a[href], button"), at = Math.max(Array.prototype.indexOf.call(items, document.activeElement), e.shiftKey ? 0 : -1);
      e.preventDefault(); items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus(); return;
    }
    if (typing || e.metaKey || e.ctrlKey) return;
    if (e.key === "i" || e.key === "I") { e.preventDefault(); toggleIndex(); }
    else if (e.key === "+" || e.key === "=") zoomAt(W / 2, H / 2, 1.4);
    else if (e.key === "-") zoomAt(W / 2, H / 2, 1 / 1.4);
    else if (e.key === "0") { closeCard(); home(); }
    else if (e.key.indexOf("Arrow") === 0 && !e.target.closest(".card, .index")) { e.preventDefault(); var st = 80 / camT.z; if (e.key === "ArrowLeft") camT.x -= st; if (e.key === "ArrowRight") camT.x += st; if (e.key === "ArrowUp") camT.y -= st; if (e.key === "ArrowDown") camT.y += st; touched = true; }
  });

  /* ---------- go ---------- */
  resize(); layout(); build(); home(true);
  mini.width = Math.round(180 * dpr); mini.height = Math.round(120 * dpr);
  var wasNarrow = narrow();
  window.addEventListener("resize", function () { resize(); if (narrow() !== wasNarrow) { wasNarrow = narrow(); layout(); place(); } if (!touched) home(true); else if (active) open(active, card.contains(document.activeElement)); });
  if (qs.get("field") && fieldById[qs.get("field")]) { focusField = qs.get("field"); stars.forEach(function (s) { tiles[s.id].classList.toggle("is-dim", s.field !== focusField); }); }
  if (qs.get("hover") && byId[qs.get("hover")]) { hot = byId[qs.get("hover")]; showTip(hot); }
  if (qs.get("z")) { var fz = clampZ(parseFloat(qs.get("z")) || camT.z); camT.z = cam.z = fz; }
  if (qs.get("x") || qs.get("y")) { camT.x = cam.x = parseFloat(qs.get("x") || "0"); camT.y = cam.y = parseFloat(qs.get("y") || "0"); touched = true; }
  if (qs.get("index") === "1") toggleIndex(true);
  if (reduced) { cam = { x: camT.x, y: camT.y, z: camT.z }; }
  requestAnimationFrame(frame);
  window.__galaxy = function () { return { stars: stars, cam: cam, camT: camT, hot: hot && hot.id, active: active && active.id, pointers: pointers.size, pinch: !!pinch, touched: touched, W: W, H: H }; };
  onHash();
  var hint = document.getElementById("hint");
  if (hint) { var hideHint = function () { hint.setAttribute("data-on", "false"); }; setTimeout(hideHint, 10000); stage.addEventListener("pointerdown", hideHint, { once: true }); stage.addEventListener("wheel", hideHint, { once: true }); }
})();
