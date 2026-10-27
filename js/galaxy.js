/* aryan-poonacha.github.io — one galaxy. Canvas 2D, no dependencies.
   World: the galactic core is (0,0); each field is a spiral arm; distance from the core is the year. */
(function () {
  "use strict";
  var G = window.GALAXY;
  var qs = new URLSearchParams(location.search);
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || qs.get("still") === "1";
  var canvas = document.getElementById("sky");
  var ctx = canvas.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0;
  var narrow = function () { return W < 720; };

  /* ---------- deterministic randomness ---------- */
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ---------- fields and the spiral ---------- */
  var fieldById = {}; G.fields.forEach(function (f) { fieldById[f.id] = f; });
  var TWIST = 0.0021;
  function armAngle(f, r) { return f.angle * Math.PI / 180 + r * TWIST; }
  function yearRadius(y) { return 150 + (y - 2016) * 68; }

  /* ---------- layout: target on the arm, then relax ---------- */
  var stars = G.stars, byId = {};
  stars.forEach(function (s) { byId[s.id] = s; });
  stars.forEach(function (s) {
    var rng = mulberry32(hash(s.id)), f = fieldById[s.field], r, a;
    if (s.id === "me") { r = 0; a = 0; }
    else if (s.field === "life") { r = 90 + rng() * 60; a = rng() * Math.PI * 2; }
    else if (s.kind === "interest") { r = 905 + (rng() - 0.5) * 90; a = armAngle(f, r) + (rng() - 0.5) * 0.5; }
    else { r = yearRadius(s.year) + (rng() - 0.5) * 90; a = armAngle(f, r) + (rng() - 0.5) * 0.42; }
    s.tx = Math.cos(a) * r; s.ty = Math.sin(a) * r; s.x = s.tx; s.y = s.ty;
    s.r0 = r; s.phase = rng() * Math.PI * 2;
    s.near = [];
  });
  var edges = G.edges.map(function (e) { var a = byId[e[0]], b = byId[e[1]]; a.near.push(b); b.near.push(a); return [a, b]; });
  for (var it = 0; it < 420; it++) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i]; if (s.id === "me") continue;
      s.x += (s.tx - s.x) * 0.02; s.y += (s.ty - s.y) * 0.02;
      for (var j = 0; j < stars.length; j++) {
        if (i === j) continue; var o = stars[j];
        var dx = s.x - o.x, dy = s.y - o.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var min = 64 + (s.weight + o.weight) * 4;
        if (d < min) { var push = (min - d) / d * 0.25; s.x += dx * push; s.y += dy * push; }
      }
    }
    edges.forEach(function (e) {
      var a = e[0], b = e[1], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > 230) { var k = (d - 230) / d * 0.004; if (a.id !== "me") { a.x += dx * k; a.y += dy * k; } if (b.id !== "me") { b.x -= dx * k; b.y -= dy * k; } }
    });
  }
  var fieldCentre = {};
  G.fields.forEach(function (f) {
    var xs = stars.filter(function (s) { return s.field === f.id && s.kind !== "interest"; });
    var cx = 0, cy = 0; xs.forEach(function (s) { cx += s.x; cy += s.y; });
    fieldCentre[f.id] = xs.length ? { x: cx / xs.length, y: cy / xs.length } : { x: 0, y: 0 };
  });

  /* ---------- dust: the body of the galaxy ---------- */
  var dust = [], drng = mulberry32(7);
  var arms = G.fields.filter(function (f) { return f.angle !== null; });
  function gauss() { var u = 1 - drng(), v = drng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function onArm(f, r) { var a = armAngle(f, r) + gauss() * 0.1, spread = gauss() * (26 + r * 0.075); return { x: Math.cos(a) * r + Math.cos(a + Math.PI / 2) * spread, y: Math.sin(a) * r + Math.sin(a + Math.PI / 2) * spread }; }
  for (var n = 0; n < 3400; n++) {
    var kind = drng(), x, y, tint = null, p, q;
    if (kind < 0.64) {
      var f = arms[Math.floor(drng() * arms.length)], r = 60 + Math.pow(drng(), 0.9) * 1000;
      q = onArm(f, r); x = q.x; y = q.y; tint = f.color; p = 0.6 + drng() * 0.4;
    } else if (kind < 0.82) {
      var rr = Math.abs(gauss()) * 150, aa = drng() * Math.PI * 2; x = Math.cos(aa) * rr; y = Math.sin(aa) * rr; tint = "#EDE9E2"; p = 0.6 + drng() * 0.4;
    } else { x = (drng() - 0.5) * 3600; y = (drng() - 0.5) * 3600; p = 0.22 + drng() * 0.45; }
    dust.push({ x: x, y: y, p: p, r: 0.35 + drng() * 1.05, a: 0.1 + drng() * 0.5, ph: drng() * 6.28, c: tint });
  }
  /* haze: big soft blobs that make the arms visible as a body */
  var haze = [];
  for (var m = 0; m < 700; m++) {
    var hf = arms[Math.floor(drng() * arms.length)], hr = 40 + Math.pow(drng(), 0.95) * 1000, hq = onArm(hf, hr);
    haze.push({ x: hq.x, y: hq.y, r: 16 + drng() * 40, a: 0.03 + drng() * 0.04, c: hf.id, p: 0.75 + drng() * 0.25 });
  }
  for (var m2 = 0; m2 < 160; m2++) { var cr0 = Math.abs(gauss()) * 120, ca0 = drng() * 6.283; haze.push({ x: Math.cos(ca0) * cr0, y: Math.sin(ca0) * cr0, r: 24 + drng() * 50, a: 0.04 + drng() * 0.05, c: "life", p: 0.8 + drng() * 0.2 }); }

  /* ---------- sprites ---------- */
  function sprite(color, size, inner) {
    var c = document.createElement("canvas"); c.width = c.height = size; var g = c.getContext("2d");
    var grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, color); grd.addColorStop(inner || 0.18, color); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = 1; g.fillStyle = grd; g.fillRect(0, 0, size, size); return c;
  }
  function withAlpha(hex, a) { var n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")"; }
  var glow = {}, dot = {};
  G.fields.forEach(function (f) { glow[f.id] = sprite(withAlpha(f.color, 0.55), 128, 0.04); dot[f.id] = sprite(f.color, 24, 0.5); });
  var dustSprite = {}; dustSprite.w = sprite("rgba(237,233,226,1)", 16, 0.3);
  G.fields.forEach(function (f) { dustSprite[f.id] = sprite(withAlpha(f.color, 1), 16, 0.3); });
  var portrait = new Image(); portrait.src = "assets/portrait.webp";

  /* ---------- camera ---------- */
  var cam = { x: 0, y: 0, z: 0.5 }, camT = { x: 0, y: 0, z: 0.5 };
  var theta = 0, born = performance.now(), lastInput = born;
  function fitZoom() { return narrow() ? 0.34 : Math.max(0.3, Math.min(1.1, Math.min(W / 2300, H / 2080))); }
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  cam.z = camT.z = fitZoom();
  if (narrow()) { cam.y = camT.y = -60; }
  function rot(x, y) { var c = Math.cos(theta), s = Math.sin(theta); return { x: x * c - y * s, y: x * s + y * c }; }
  function toScreen(x, y, p) { p = p || 1; var zz = Math.pow(cam.z, p); return { x: W / 2 + (x - cam.x) * p * zz, y: H / 2 + (y - cam.y) * p * zz }; }
  function clampZ(z) { return Math.max(0.22, Math.min(6, z)); }
  function zoomAt(px, py, factor, immediate) {
    var z = clampZ(camT.z * factor);
    var wx = camT.x + (px - W / 2) / camT.z, wy = camT.y + (py - H / 2) / camT.z;
    camT.x = wx - (px - W / 2) / z; camT.y = wy - (py - H / 2) / z; camT.z = z;
    if (immediate || reduced) { cam.x = camT.x; cam.y = camT.y; cam.z = camT.z; }
  }

  /* ---------- state ---------- */
  var hover = null, active = null, focusField = null, dragging = false, moved = false, keyCursor = -1;
  var card = document.getElementById("card"), index = document.getElementById("index");
  var byAngle = stars.slice().sort(function (a, b) { return Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x); });

  function starRadius(s) { return Math.min(18, (2.8 + s.weight * 1.4) * Math.sqrt(cam.z)); }
  function connected(a, b) { return a && b && (a === b || a.near.indexOf(b) >= 0); }

  /* ---------- draw ---------- */
  var labelBoxes = [];
  function overlaps(b) { for (var i = 0; i < labelBoxes.length; i++) { var o = labelBoxes[i]; if (b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y) return true; } return false; }
  function frame(now) {
    var t = (now - born) / 1000;
    var idle = !active && !dragging && now - lastInput > 2500;
    if (!reduced && idle) theta += 0.00005;
    var k = reduced ? 1 : 0.11;
    cam.x += (camT.x - cam.x) * k; cam.y += (camT.y - cam.y) * k; cam.z = Math.exp(Math.log(cam.z) + (Math.log(camT.z) - Math.log(cam.z)) * k);

    ctx.clearRect(0, 0, W, H);
    var entrance = reduced ? 1 : Math.min(1, t / 1.2);

    /* core glow */
    var c0 = toScreen(0, 0, 1), cr = 300 * Math.sqrt(cam.z);
    var cg = ctx.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, cr);
    cg.addColorStop(0, "rgba(237,233,226," + (0.13 * entrance) + ")"); cg.addColorStop(0.5, "rgba(191,212,255," + (0.04 * entrance) + ")"); cg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cg; ctx.fillRect(c0.x - cr, c0.y - cr, cr * 2, cr * 2);

    /* haze, then dust */
    ctx.globalCompositeOperation = "lighter";
    for (var hz = 0; hz < haze.length; hz++) {
      var hb = haze[hz], hw = rot(hb.x, hb.y), hs = toScreen(hw.x, hw.y, hb.p), hsz = hb.r * 2 * Math.pow(cam.z, 0.9);
      if (hs.x < -hsz || hs.y < -hsz || hs.x > W + hsz || hs.y > H + hsz) continue;
      ctx.globalAlpha = hb.a * entrance * (focusField && focusField !== hb.c ? 0.4 : 1);
      ctx.drawImage(glow[hb.c], hs.x - hsz / 2, hs.y - hsz / 2, hsz, hsz);
    }
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i], w = rot(d.x, d.y), sp = toScreen(w.x, w.y, d.p);
      if (sp.x < -8 || sp.y < -8 || sp.x > W + 8 || sp.y > H + 8) continue;
      var tw = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 1.3 + d.ph);
      var size = d.r * 2.4 * Math.pow(cam.z, 0.35) + 1.2;
      ctx.globalAlpha = d.a * tw * entrance * (focusField ? 0.6 : 1);
      ctx.drawImage(d.c ? (dustSprite[fieldKeyByColor[d.c]] || dustSprite.w) : dustSprite.w, sp.x - size / 2, sp.y - size / 2, size, size);
    }

    /* edges */
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1;
    stars.forEach(function (s) { var w = rot(s.x, s.y); var sp = toScreen(w.x, w.y, 1); s.sx = sp.x; s.sy = sp.y; });
    var lit = active || hover;
    for (var e = 0; e < edges.length; e++) {
      var a = edges[e][0], b = edges[e][1], al = 0.1, col = "#EDE9E2";
      if (lit && (a === lit || b === lit)) { al = 0.55; col = fieldById[lit.field].color; }
      else if (focusField) { al = (a.field === focusField && b.field === focusField) ? 0.2 : 0.03; }
      else if (active) al = 0.04;
      ctx.strokeStyle = withAlpha(col, al * entrance); ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }

    /* stars */
    labelBoxes = [];
    var order = stars.slice().sort(function (a, b) { return (b === lit) - (a === lit) || b.weight - a.weight; });
    for (var q = 0; q < order.length; q++) {
      var s = order[q], f = fieldById[s.field], rs = starRadius(s);
      var ea = reduced ? 1 : Math.max(0, Math.min(1, (t - s.r0 * 0.0011) / 0.7));
      var tw2 = reduced ? 1 : 0.86 + 0.14 * Math.sin(t * 1.7 + s.phase);
      var dim = 1;
      if (focusField && s.field !== focusField) dim = 0.22;
      if (active && !connected(active, s)) dim = Math.min(dim, 0.3);
      if (hover && !active && !connected(hover, s)) dim = Math.min(dim, 0.55);
      var isLit = s === lit, isNear = lit && s !== lit && lit.near.indexOf(s) >= 0;
      if (isLit) rs *= 1.45;
      var alpha = ea * dim;
      if (s.sx < -60 || s.sy < -60 || s.sx > W + 60 || s.sy > H + 60) continue;

      ctx.globalCompositeOperation = "lighter";
      var gsize = rs * (isLit ? 12 : 9) * (0.8 + 0.2 * tw2);
      ctx.globalAlpha = alpha * (isLit ? 0.95 : 0.6) * (s.kind === "interest" ? 0.35 : 1);
      ctx.drawImage(glow[s.field], s.sx - gsize / 2, s.sy - gsize / 2, gsize, gsize);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = alpha;
      if (s.id === "me") {
        var pr = Math.max(14, 11 * Math.sqrt(cam.z) * 2.2);
        if (portrait.complete && portrait.naturalWidth) {
          ctx.save(); ctx.beginPath(); ctx.arc(s.sx, s.sy, pr, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
          ctx.drawImage(portrait, s.sx - pr, s.sy - pr, pr * 2, pr * 2); ctx.restore();
        }
        ctx.strokeStyle = withAlpha("#EDE9E2", 0.55 * alpha); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(s.sx, s.sy, pr + 0.5, 0, Math.PI * 2); ctx.stroke();
        if (isLit) { ctx.strokeStyle = withAlpha("#EDE9E2", 0.5 * alpha); ctx.beginPath(); ctx.arc(s.sx, s.sy, pr + 6, 0, Math.PI * 2); ctx.stroke(); }
      } else if (s.kind === "interest") {
        ctx.strokeStyle = withAlpha(f.color, 0.95 * alpha * tw2); ctx.lineWidth = 1.25;
        ctx.beginPath(); ctx.arc(s.sx, s.sy, rs * 0.9, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = withAlpha(f.color, Math.min(1, alpha * (0.85 + 0.15 * tw2)));
        ctx.beginPath(); ctx.arc(s.sx, s.sy, rs * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = withAlpha("#FFFFFF", 0.75 * alpha);
        ctx.beginPath(); ctx.arc(s.sx, s.sy, rs * 0.26, 0, Math.PI * 2); ctx.fill();
        if (isLit) { ctx.strokeStyle = withAlpha(f.color, 0.6 * alpha); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(s.sx, s.sy, rs * 1.5, 0, Math.PI * 2); ctx.stroke(); }
      }

      /* label */
      var showLabel = isLit || isNear || (!active && (s.weight >= 4 || (cam.z >= 1.15 && s.weight >= 3) || (cam.z >= 1.7 && s.weight >= 2) || cam.z >= 2.4));
      if (focusField && s.field === focusField && cam.z >= 0.45) showLabel = true;
      if (s.id === "me" && !isLit) showLabel = false;
      if (showLabel && alpha > 0.3) {
        var text = s.title.toUpperCase(), year = s.year && s.kind !== "place" ? "  " + s.year : "";
        if (text.length > 34 && !isLit) text = text.slice(0, 32).replace(/\s+\S*$/, "") + "…";
        ctx.font = "500 11px 'Geist Mono', ui-monospace, monospace"; ctx.letterSpacing = "0.08em";
        var tw3 = ctx.measureText(text).width, yw = year ? ctx.measureText(year).width : 0;
        var lx = s.sx + rs + 9, ly = s.sy + 4, box = { x: lx - 3, y: ly - 11, w: tw3 + yw + 6, h: 15 };
        if (lx + tw3 + yw > W - 8) { var lx2 = s.sx - rs - 9 - tw3 - yw; lx = lx2 >= 8 ? lx2 : Math.max(8, W - 8 - tw3 - yw); box.x = lx - 3; }
        if (!overlaps(box) || isLit) {
          labelBoxes.push(box);
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = withAlpha(isLit ? f.color : "#EDE9E2", (isLit ? 1 : 0.78) * alpha);
          ctx.fillText(text, lx, ly);
          if (year) { ctx.fillStyle = withAlpha("#EDE9E2", 0.45 * alpha); ctx.fillText(year, lx + tw3, ly); }
        }
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  var fieldKeyByColor = {}; G.fields.forEach(function (f) { fieldKeyByColor[f.color] = f.id; });
  requestAnimationFrame(frame);

  /* ---------- hit testing ---------- */
  function hit(px, py) {
    var best = null, bd = 1e9;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i], r = Math.max(14, starRadius(s) * 2.4);
      if (s.id === "me") r = Math.max(r, 11 * Math.sqrt(cam.z) * 2.2 + 6);
      var dx = s.sx - px, dy = s.sy - py, d = dx * dx + dy * dy;
      if (d < r * r && d < bd) { best = s; bd = d; }
    }
    return best;
  }

  /* ---------- card ---------- */
  function h(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
  function open(s, fromHash) {
    if (!s) return;
    active = s; hover = null; lastInput = performance.now();
    var w = rot(s.x, s.y), z = narrow() ? 2.0 : 2.4;
    var ax = narrow() ? W / 2 : W * 0.34, ay = narrow() ? H * 0.22 : H * 0.5;
    camT.z = z; camT.x = w.x - (ax - W / 2) / z; camT.y = w.y - (ay - H / 2) / z;
    if (reduced) { cam.x = camT.x; cam.y = camT.y; cam.z = camT.z; }
    var f = fieldById[s.field];
    card.innerHTML = "";
    card.style.setProperty("--f", f.color);
    var close = h("button", "card__close", "Close ×"); close.type = "button"; close.addEventListener("click", function () { closeCard(); }); card.appendChild(close);
    if (s.book) {
      var bk = h("a", "book"); bk.href = s.links[0][1]; bk.setAttribute("aria-label", s.title + " on Google Books");
      bk.innerHTML = '<span class="book__spine"></span><span class="book__cover"><span class="book__title">CURE<br>BEREFT</span><span class="book__author">Aryan Poonacha</span></span>';
      card.appendChild(bk);
    } else if (s.poster) {
      var fig = h("figure", "card__media" + (s.square ? " card__media--square" : ""));
      var img = h("img"); img.src = s.poster; img.alt = ""; fig.appendChild(img);
      if (s.video) {
        var play = h("button", "card__play", "▶ Recording"); play.type = "button";
        play.addEventListener("click", function () {
          var v = document.createElement("video"); v.controls = true; v.muted = true; v.playsInline = true; v.autoplay = true; v.poster = s.poster; v.src = s.video;
          fig.replaceChild(v, img); play.remove();
        });
        fig.appendChild(play);
      }
      card.appendChild(fig);
    }
    card.appendChild(h("p", "card__meta", (f.name + " · " + s.meta).toUpperCase()));
    card.appendChild(h("h2", "card__title", s.title));
    if (s.line) card.appendChild(h("p", "card__line", s.line));
    if (s.links && s.links.length) {
      var ln = h("p", "card__links");
      s.links.forEach(function (l, i) { if (i) ln.appendChild(h("span", "sep", "·")); var a = h("a", null, l[0] + (l[1].indexOf("http") === 0 ? " ↗" : "")); a.href = l[1]; if (l[1].indexOf("http") === 0) { a.target = "_blank"; a.rel = "noopener"; } ln.appendChild(a); });
      card.appendChild(ln);
    }
    if (s.near.length) {
      var rel = h("p", "card__near"); rel.appendChild(h("span", "card__nearlabel", "Linked"));
      s.near.forEach(function (o) { var b = h("button", "chip", o.title); b.type = "button"; b.style.setProperty("--f", fieldById[o.field].color); b.addEventListener("click", function () { open(o); }); rel.appendChild(b); });
      card.appendChild(rel);
    }
    card.setAttribute("data-on", "true"); card.scrollTop = 0;
    document.body.setAttribute("data-active", "true");
    if (!fromHash) history.replaceState(null, "", "#" + s.id);
    close.focus({ preventScroll: true });
  }
  function closeCard() {
    if (!active) return;
    active = null; lastInput = performance.now();
    card.setAttribute("data-on", "false"); card.querySelectorAll("video").forEach(function (v) { v.pause(); });
    document.body.removeAttribute("data-active");
    camT.z = Math.min(camT.z, 1.1);
    history.replaceState(null, "", location.pathname + location.search);
    canvas.focus({ preventScroll: true });
  }
  function openHash() { var id = location.hash.slice(1); if (id && byId[id]) open(byId[id], true); }
  window.addEventListener("hashchange", openHash);

  /* ---------- pointer ---------- */
  var pointers = new Map(), last = null, pinch = null, downAt = null;
  canvas.addEventListener("pointerdown", function (e) {
    canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastInput = performance.now();
    if (pointers.size === 1) { dragging = true; moved = false; last = { x: e.clientX, y: e.clientY }; downAt = { x: e.clientX, y: e.clientY }; canvas.classList.add("is-drag"); }
    else if (pointers.size === 2) { var p = Array.from(pointers.values()); pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), z: camT.z }; moved = true; }
  });
  canvas.addEventListener("pointermove", function (e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) {
      var p = Array.from(pointers.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      var mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
      zoomAt(mx, my, (pinch.z * d / pinch.d) / camT.z, true); lastInput = performance.now(); return;
    }
    if (dragging && last) {
      var dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
      if (!moved && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) moved = true;
      if (moved) { camT.x -= dx / cam.z; camT.y -= dy / cam.z; cam.x = camT.x; cam.y = camT.y; lastInput = performance.now(); }
      return;
    }
    var s = hit(e.clientX, e.clientY);
    if (s !== hover) { hover = s; canvas.classList.toggle("is-hover", !!s); }
  });
  function endPointer(e) {
    var wasPrimary = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (wasPrimary) {
      dragging = false; canvas.classList.remove("is-drag");
      if (!moved) { var s = hit(e.clientX, e.clientY); if (s) open(s); else if (active) closeCard(); }
    }
  }
  canvas.addEventListener("pointerup", endPointer); canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", function () { if (!dragging) { hover = null; canvas.classList.remove("is-hover"); } });
  canvas.addEventListener("wheel", function (e) { e.preventDefault(); lastInput = performance.now(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0014), true); }, { passive: false });
  canvas.addEventListener("dblclick", function (e) { zoomAt(e.clientX, e.clientY, 1.8); });

  /* ---------- keyboard ---------- */
  canvas.addEventListener("keydown", function (e) {
    lastInput = performance.now();
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault(); var step = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : -1;
      keyCursor = (keyCursor + step + byAngle.length) % byAngle.length; hover = byAngle[keyCursor];
      var w = rot(hover.x, hover.y); camT.x = w.x; camT.y = w.y; if (camT.z < 1.2) camT.z = 1.2;
    } else if (e.key === "Enter" || e.key === " ") { if (hover) { e.preventDefault(); open(hover); } }
    else if (e.key === "+" || e.key === "=") zoomAt(W / 2, H / 2, 1.4);
    else if (e.key === "-") zoomAt(W / 2, H / 2, 1 / 1.4);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if (index.getAttribute("data-on") === "true") toggleIndex(false); else closeCard(); }
    if ((e.key === "i" || e.key === "I") && !e.metaKey && !e.ctrlKey && document.activeElement.tagName !== "INPUT") toggleIndex();
    if (e.key === "0" && document.activeElement === canvas) home();
  });

  /* ---------- hud ---------- */
  function home() { camT.x = 0; camT.y = narrow() ? -60 : 0; camT.z = fitZoom(); lastInput = performance.now(); }
  document.getElementById("zoom-in").addEventListener("click", function () { zoomAt(W / 2, H / 2, 1.5); });
  document.getElementById("zoom-out").addEventListener("click", function () { zoomAt(W / 2, H / 2, 1 / 1.5); });
  document.getElementById("zoom-home").addEventListener("click", function () { closeCard(); home(); });
  document.getElementById("home-link").addEventListener("click", function (e) { e.preventDefault(); toggleIndex(false); closeCard(); home(); });

  var legend = document.getElementById("legend");
  G.fields.forEach(function (f) {
    var n = stars.filter(function (s) { return s.field === f.id && s.kind !== "interest" && s.id !== "me"; }).length;
    var li = h("li"); var b = h("button", "legend__item"); b.type = "button"; b.style.setProperty("--f", f.color);
    b.appendChild(h("i", "swatch")); b.appendChild(h("span", null, f.name)); b.appendChild(h("span", "n", String(n)));
    b.addEventListener("mouseenter", function () { focusField = f.id; }); b.addEventListener("mouseleave", function () { focusField = null; });
    b.addEventListener("focus", function () { focusField = f.id; }); b.addEventListener("blur", function () { focusField = null; });
    b.addEventListener("click", function () { closeCard(); var c = fieldCentre[f.id]; var w = rot(c.x, c.y); camT.x = w.x; camT.y = w.y; camT.z = f.id === "life" ? 2.2 : 1.25; lastInput = performance.now(); });
    li.appendChild(b); legend.appendChild(li);
  });
  var li2 = h("li"); var sp2 = h("span", "legend__item legend__item--static"); sp2.appendChild(h("i", "swatch swatch--hollow")); sp2.appendChild(h("span", null, "Interests")); li2.appendChild(sp2); legend.appendChild(li2);

  /* ---------- index ---------- */
  var indexBody = document.getElementById("index-body");
  G.fields.forEach(function (f) {
    var sec = h("section", "index__group"); sec.style.setProperty("--f", f.color);
    sec.appendChild(h("h3", "index__field", f.name));
    var ul = h("ul");
    stars.filter(function (s) { return s.field === f.id; }).sort(function (a, b) { return (b.year || 0) - (a.year || 0) || b.weight - a.weight; }).forEach(function (s) {
      var li = h("li"); var b = h("button", "index__item" + (s.kind === "interest" ? " index__item--interest" : "")); b.type = "button";
      b.appendChild(h("span", "t", s.title)); b.appendChild(h("span", "y", s.year && s.kind !== "place" ? String(s.year) : (s.kind === "interest" ? "interest" : "")));
      b.addEventListener("click", function () { toggleIndex(false); open(s); }); li.appendChild(b); ul.appendChild(li);
    });
    sec.appendChild(ul); indexBody.appendChild(sec);
  });
  function toggleIndex(force) {
    var on = typeof force === "boolean" ? force : index.getAttribute("data-on") !== "true";
    index.setAttribute("data-on", on ? "true" : "false"); document.getElementById("index-toggle").setAttribute("aria-expanded", on ? "true" : "false");
    if (on) index.querySelector("button").focus(); else canvas.focus({ preventScroll: true });
  }
  document.getElementById("index-toggle").addEventListener("click", function () { toggleIndex(); });
  document.getElementById("index-close").addEventListener("click", function () { toggleIndex(false); });

  window.addEventListener("resize", function () { var wasFit = Math.abs(camT.z - fitZoom()) < 0.001; resize(); if (wasFit) home(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {});
  openHash();
  /* ?hover=id ?field=id ?index=1 ?z= ?x= ?y= : deep states, used for storyboards and shareable views */
  if (qs.get("field") && fieldById[qs.get("field")]) focusField = qs.get("field");
  if (qs.get("hover") && byId[qs.get("hover")]) { hover = byId[qs.get("hover")]; lastInput = 1e15; }
  if (qs.get("index") === "1") toggleIndex(true);
  if (qs.get("z")) { camT.z = cam.z = clampZ(parseFloat(qs.get("z")) || camT.z); }
  if (qs.get("x") || qs.get("y")) { camT.x = cam.x = parseFloat(qs.get("x") || "0"); camT.y = cam.y = parseFloat(qs.get("y") || "0"); }
  var hint = document.getElementById("hint");
  if (hint) { var hideHint = function () { hint.setAttribute("data-on", "false"); }; setTimeout(hideHint, 9000); canvas.addEventListener("pointerdown", hideHint, { once: true }); canvas.addEventListener("wheel", hideHint, { once: true }); }
})();
