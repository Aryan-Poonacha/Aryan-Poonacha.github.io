/* aryan-poonacha.github.io — the galaxy.
   Three zoom levels on one map: the galaxy (domains as clusters around the core), a cluster (its stars),
   and a star's solar system (its planets, each one part of the project). The sky is WebGL particles;
   stars, orbits and intersections are a 2D canvas; every star and planet is a real link in the DOM,
   positioned each frame, so hover, focus, deep links (#id) and the index all work. No dependencies.
   js/content.js loads the content (content/galaxy.json) and calls startGalaxy with it. */
window.startGalaxy = function (G) {
  "use strict";
  var qs = new URLSearchParams(location.search), L = G.site.labels;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || qs.get("still") === "1";
  var hoverable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var stage = document.getElementById("stage"), world = document.getElementById("world");
  var sky = document.getElementById("sky"), fx = document.getElementById("fx"), fctx = fx.getContext("2d");
  var peek = document.getElementById("peek"), card = document.getElementById("card"), index = document.getElementById("index");
  var mini = document.getElementById("minimap"), mctx = mini.getContext("2d"), intro = document.getElementById("intro");
  var dpr = Math.min(window.devicePixelRatio || 1, 2), skyDpr = 1, W = 0, H = 0;
  var narrow = function () { return W < 720; };

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(s) { var x = 2166136261; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function rgba(hex, a) { var c = rgb(hex); return "rgba(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + "," + a + ")"; }
  function h(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function ext(url) { return url.indexOf("http") === 0; }
  function linkEl(l, cls) { var a = h("a", cls || null, l[0] + (ext(l[1]) ? " ↗" : "")); a.href = l[1]; if (ext(l[1])) { a.target = "_blank"; a.rel = "noopener"; } return a; }
  function fill(t, v) { return t.replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }); }
  /* card text: [words](address) is a link, **words** bold, *words* italic; the rest is plain text */
  var RICH = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  function rich(tag, cls, text) {
    var el = h(tag, cls), last = 0, m; text = String(text || ""); RICH.lastIndex = 0;
    while ((m = RICH.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) el.appendChild(window.GalaxySchema.safeUrl(m[2]) ? linkEl([m[1], m[2]]) : document.createTextNode(m[1]));
      else el.appendChild(h(m[3] ? "strong" : "em", null, m[3] || m[4]));
      last = RICH.lastIndex;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
    return el;
  }
  function plain(t) { return String(t || "").replace(RICH, function (m, a, u, b, i) { return a || b || i; }); }

  /* ---------- the model: clusters, stars, planets ---------- */
  var CORE = "#FFE3B8", KINDS = G.kinds;
  var clusters = G.clusters, clusterById = {};
  clusters.forEach(function (c, i) { c.i = i; c.stars = []; clusterById[c.id] = c; });
  var bodies = [], byId = {}, stars = [];
  G.stars.forEach(function (s) {
    s.planet = false; s.parent = null; s.near = []; s.planets = []; stars.push(s); bodies.push(s); byId[s.id] = s;
    s.color = s.cluster ? clusterById[s.cluster].color : CORE;
    if (s.cluster) clusterById[s.cluster].stars.push(s);
    (s.system || []).forEach(function (p, i) {
      p.planet = true; p.parent = s; p.cluster = s.cluster; p.color = s.color; p.near = []; p.planets = []; p.i = i; p.weight = 1;
      if (p.year == null) p.year = s.year;
      if (!p.when) p.when = s.when;
      s.planets.push(p); bodies.push(p); byId[p.id] = p;
    });
  });
  var edges = G.edges.map(function (e) { var a = byId[e[0]], b = byId[e[1]]; a.near.push(b); b.near.push(a); return [a, b]; });
  var path = (G.path || []).map(function (id) { return byId[id]; });
  /* the reading order: the core, then each domain from its heart outwards, planets after their star */
  var seq = [];
  function pushStar(s) { seq.push(s); s.planets.forEach(function (p) { seq.push(p); }); }
  pushStar(byId[G.core]);
  clusters.forEach(function (c) {
    c.stars.sort(function (a, b) { return (b.id === c.core) - (a.id === c.core); }); /* the heart, then the editor's order */
    c.stars.forEach(pushStar);
  });
  seq.forEach(function (b, i) { b.seq = i; });
  function clusterOf(b) { return b.cluster ? clusterById[b.cluster] : null; }
  function nameOf(b) { var c = clusterOf(b); return c ? c.name : L.core; }

  /* ---------- layout ----------
     each cluster is laid out on its own around its heart, then set on a ring around the core,
     pushed outwards until no two clusters overlap. Wide screens get a wide galaxy, phones a tall one. */
  var bounds = null, TILT = 0.86, shape = { x: 1.2, y: 0.86 };
  function starR(s) { return s.kind === "interest" ? 9 : 7 + (s.weight || 1) * 3.6; }
  function layout() {
    shape = narrow() ? { x: 0.82, y: 1.28 } : { x: 1.2, y: 0.86 };
    stars.forEach(function (s) {
      s.wr = starR(s);
      var n = s.planets.length, gap = s.id === G.core ? 34 : 30, r0 = s.wr * 1.9 + 34;
      s.planets.forEach(function (p, i) {
        var rng = mulberry32(hash(p.id));
        p.wr = p.kind === "interest" ? 5 : 6.2;
        p.orbit = r0 + i * gap; p.omega = 0.05 / Math.sqrt(p.orbit / 90) * (i % 2 ? 0.9 : 1);
        p.phase = i * 2.39996 + rng() * 0.6;
      });
      s.sysR = n ? r0 + (n - 1) * gap + 18 : 0;
      s.room = Math.max(s.sysR, s.wr * 2) + 70;
    });
    var me = byId[G.core]; me.x = 0; me.y = 0; me.lx = 0; me.ly = 0;
    var R0 = me.sysR + 90;
    clusters.forEach(function (c, i) { c.a = (narrow() ? -150 + i * 60 : c.angle) * Math.PI / 180; });
    clusters.forEach(function (c) {
      var core = byId[c.core], others = c.stars.filter(function (s) { return s !== core; });
      core.lx = 0; core.ly = 0;
      var rng = mulberry32(hash(c.id)), base = rng() * 6.283;
      others.forEach(function (s, i) {
        var ang = base + i * 2.39996, rad = core.room + s.room * 0.6 + 70 * Math.sqrt(i);
        s.tlx = Math.cos(ang) * rad; s.tly = Math.sin(ang) * rad * 0.9;
        /* where the domains meet: lean towards the other domain */
        s.near.forEach(function (o) {
          var oc = clusterOf(o.planet ? o.parent : o); if (!oc || oc === c) return;
          var dx = Math.cos(oc.a) - Math.cos(c.a), dy = Math.sin(oc.a) - Math.sin(c.a), dl = Math.hypot(dx, dy) || 1;
          s.tlx += dx / dl * 80; s.tly += dy / dl * 80;
        });
        s.lx = s.tlx; s.ly = s.tly;
      });
      for (var it = 0; it < 300; it++) {
        others.forEach(function (s) { s.lx += (s.tlx - s.lx) * 0.02; s.ly += (s.tly - s.ly) * 0.02; });
        for (var a = 0; a < c.stars.length; a++) for (var b = a + 1; b < c.stars.length; b++) {
          var p = c.stars[a], q = c.stars[b], dx = q.lx - p.lx, dy = q.ly - p.ly, d = Math.hypot(dx, dy) || 1, need = p.room + q.room;
          if (d >= need) continue;
          var push = (need - d) / d, fp = p === core ? 0 : 1, fq = q === core ? 0 : 1, tot = fp + fq;
          p.lx -= dx * push * fp / tot; p.ly -= dy * push * fp / tot; q.lx += dx * push * fq / tot; q.ly += dy * push * fq / tot;
        }
      }
      c.R = 0; c.stars.forEach(function (s) { c.R = Math.max(c.R, Math.hypot(s.lx, s.ly) + Math.max(s.sysR, s.wr * 2) + 60); });
      c.D = R0 + c.R + 120;
    });
    function centres() { clusters.forEach(function (c) { c.x = Math.cos(c.a) * c.D * shape.x; c.y = Math.sin(c.a) * c.D * shape.y; }); }
    for (var round = 0; round < 400; round++) {
      centres(); var moved = false;
      clusters.forEach(function (c, i) {
        if (Math.hypot(c.x, c.y) < R0 + c.R + 90) { c.D += 14; moved = true; }
        for (var j = i + 1; j < clusters.length; j++) { var o = clusters[j]; if (Math.hypot(c.x - o.x, c.y - o.y) < c.R + o.R + 110) { c.D += 10; o.D += 10; moved = true; } }
      });
      if (!moved) break;
    }
    centres();
    clusters.forEach(function (c) {
      c.ax = c.D * shape.x; c.ay = c.D * shape.y;
      c.stars.forEach(function (s) { s.x = c.x + s.lx; s.y = c.y + s.ly; });
      var b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
      c.stars.forEach(function (s) { var r = Math.max(s.sysR, s.wr) + 30; b.x0 = Math.min(b.x0, s.x - r); b.y0 = Math.min(b.y0, s.y - r); b.x1 = Math.max(b.x1, s.x + r + 120); b.y1 = Math.max(b.y1, s.y + r); });
      c.b = b; c.cx = (b.x0 + b.x1) / 2; c.cy = (b.y0 + b.y1) / 2; c.R = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2;
    });
    bounds = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
    stars.forEach(function (s) { var r = Math.max(s.sysR, s.wr) + 40; bounds.x0 = Math.min(bounds.x0, s.x - r); bounds.y0 = Math.min(bounds.y0, s.y - r - 60); bounds.x1 = Math.max(bounds.x1, s.x + r); bounds.y1 = Math.max(bounds.y1, s.y + r); });
    planetsAt(clock);
    if (skyGL) skyGL.build();
  }
  function planetsAt(t) {
    stars.forEach(function (s) {
      s.planets.forEach(function (p) { var a = p.phase + (reduced ? 0 : t * p.omega); p.x = s.x + Math.cos(a) * p.orbit; p.y = s.y + Math.sin(a) * p.orbit * TILT; });
    });
  }

  /* ---------- the sky: WebGL particles ---------- */
  var skyGL = (function () {
    var gl = null;
    try { gl = sky.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: "high-performance" }); } catch (e) { gl = null; }
    if (!gl) return null;
    var VS = [
      "attribute vec2 aPos; attribute float aSize; attribute vec4 aColor; attribute vec4 aX;",
      "uniform vec2 uView; uniform vec3 uCam; uniform float uDpr, uTime, uIntro, uFocus, uFocusAmt, uGain, uHazeMax;",
      "varying vec4 vColor; varying float vSharp;",
      "void main() {",
      "  float kind = aX.w; vec2 sp; float size; float a = aColor.a;",
      "  if (kind > 1.5) {", /* background: a tiled starfield with parallax */
      "    vec2 tile = uView + 240.0; float d = aX.x;",
      "    vec2 q = aPos * tile - uCam.xy * uCam.z * d * 0.08;",
      "    q = mod(q, tile) - 120.0;",
      "    sp = uView * 0.5 + (q - uView * 0.5) * pow(uCam.z / 0.2, 0.06 * d);",
      "    size = aSize * uDpr; a *= min(1.0, uIntro * 1.6) * (0.7 + 0.3 * sin(uTime * (0.4 + aX.y) + aX.y * 50.0));",
      "  } else {",
      "    vec2 p = aPos; float r = length(p) / 2400.0;",
      "    float e = uIntro; float rot = (1.0 - e) * (1.0 - e) * 2.6 * (1.25 - min(r, 1.25));",
      "    float cs = cos(rot), sn = sin(rot); p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y) * mix(0.12, 1.0, 1.0 - (1.0 - e) * (1.0 - e) * (1.0 - e));",
      "    sp = uView * 0.5 + (p - uCam.xy) * uCam.z;",
      "    size = aSize * uCam.z * uDpr;",
      "    float minS = (kind > 0.5 ? 6.0 : 1.4) * uDpr;",
      "    if (size < minS) { a *= (size * size) / (minS * minS); size = minS; }",
      "    if (kind > 0.5) { if (size > uHazeMax) { a *= uHazeMax / size; size = uHazeMax; } } else size = min(size, 48.0 * uDpr);",
      "    a *= e;",
      "    if (kind < 0.5) a *= 0.78 + 0.22 * sin(uTime * (0.5 + aX.y * 1.5) + aX.y * 40.0);",
      "    if (uFocus > -0.5 && abs(aX.z - uFocus) > 0.1) a *= mix(1.0, 0.28, uFocusAmt);",
      "    a *= uGain;",
      "  }",
      "  gl_Position = vec4((sp / uView * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0);",
      "  gl_PointSize = size; vColor = vec4(aColor.rgb, a); vSharp = kind > 0.5 && kind < 1.5 ? 2.4 : 5.5;",
      "}"].join("\n");
    var FS = [
      "precision mediump float; varying vec4 vColor; varying float vSharp;",
      "void main() { vec2 c = gl_PointCoord - 0.5; float d2 = dot(c, c) * 4.0; if (d2 > 1.0) discard;",
      "  float a = exp(-d2 * vSharp) * (1.0 - d2); gl_FragColor = vec4(vColor.rgb * vColor.a * a, 1.0); }"].join("\n");
    var lost = false, prog, loc = {}, buf, count = 0, STRIDE = 11;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    function setup() {
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      ["aPos", "aSize", "aColor", "aX"].forEach(function (n) { loc[n] = gl.getAttribLocation(prog, n); });
      ["uView", "uCam", "uDpr", "uTime", "uIntro", "uFocus", "uFocusAmt", "uGain", "uHazeMax"].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
      buf = gl.createBuffer();
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    }
    try { setup(); } catch (e) { return null; }
    sky.addEventListener("webglcontextlost", function (e) { e.preventDefault(); lost = true; document.body.classList.add("no-gl"); }, false);
    sky.addEventListener("webglcontextrestored", function () { try { setup(); build(); lost = false; document.body.classList.remove("no-gl"); } catch (e) {} }, false);
    function build() {
      var lite = narrow() || (navigator.hardwareConcurrency || 8) <= 4, k = lite ? 0.55 : 1;
      var rng = mulberry32(1337), out = [];
      function gauss() { var u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2832 * v); }
      function push(x, y, size, c, a, depth, cl, kind) { out.push(x, y, size, c[0], c[1], c[2], a, depth, rng(), cl, kind); }
      function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
      var white = [0.82, 0.87, 1.0], warm = [1.0, 0.86, 0.66], core = rgb(CORE);
      /* the bulge */
      for (var i = 0; i < 7000 * k; i++) {
        var rr = Math.abs(gauss()) * 300, aa = rng() * 6.2832;
        push(Math.cos(aa) * rr * 1.15, Math.sin(aa) * rr * 0.9, 2 + rng() * 5, mix(warm, [1, 0.97, 0.9], rng()), 0.12 + rng() * 0.38, 1, -2, 0);
      }
      for (var hc = 0; hc < 40; hc++) { var hr = Math.abs(gauss()) * 220, ha = rng() * 6.2832; push(Math.cos(ha) * hr, Math.sin(ha) * hr * 0.85, 260 + rng() * 420, core, 0.05 + rng() * 0.05, 1, -2, 1); }
      clusters.forEach(function (c) {
        var col = rgb(c.color);
        /* a spiral arm from the core through the cluster */
        for (var j = 0; j < 4800 * k; j++) {
          var rn = 0.1 + Math.pow(rng(), 0.85) * 1.3, th = c.a + 0.95 * Math.log(rn), spread = gauss() * (40 + rn * 150);
          var x = Math.cos(th) * rn * c.ax + Math.cos(th + 1.5708) * spread, y = Math.sin(th) * rn * c.ay + Math.sin(th + 1.5708) * spread;
          push(x, y, 2 + rng() * 4.5, mix(white, col, smooth(0.2, 1.0, rn) * 0.8), 0.1 + rng() * 0.34, 1, c.i, 0);
        }
        for (var m = 0; m < 110 * k; m++) {
          var rn2 = 0.15 + Math.pow(rng(), 0.9) * 1.2, th2 = c.a + 0.95 * Math.log(rn2), sp2 = gauss() * (60 + rn2 * 160);
          push(Math.cos(th2) * rn2 * c.ax + Math.cos(th2 + 1.5708) * sp2, Math.sin(th2) * rn2 * c.ay + Math.sin(th2 + 1.5708) * sp2, 200 + rng() * 380, mix(white, col, 0.5 + rn2 * 0.4), 0.03 + rng() * 0.04, 1, c.i, 1);
        }
        /* the cluster itself: a dense knot of dust and gas around its stars */
        var R = c.R || 600;
        for (var n = 0; n < 3600 * k; n++) {
          var g1 = gauss() * R * 0.5, g2 = gauss() * R * 0.5;
          push(c.cx + g1, c.cy + g2, 1.8 + rng() * 4.5, mix(white, col, 0.45 + rng() * 0.5), 0.14 + rng() * 0.42, 1, c.i, 0);
        }
        for (var b2 = 0; b2 < 90 * k; b2++) { var g3 = gauss() * R * 0.62, g4 = gauss() * R * 0.62; push(c.cx + g3, c.cy + g4, 220 + rng() * 480, mix(col, white, rng() * 0.3), 0.045 + rng() * 0.06, 1, c.i, 1); }
        for (var b3 = 0; b3 < 140; b3++) { var g5 = gauss() * R * 0.6, g6 = gauss() * R * 0.6; push(c.cx + g5, c.cy + g6, 6 + rng() * 9, mix(white, col, rng() * 0.6), 0.5 + rng() * 0.4, 1, c.i, 0); }
      });
      /* far stars behind everything */
      for (var f = 0; f < 4200 * k; f++) {
        var tint = rng(), fc = tint < 0.7 ? white : tint < 0.88 ? warm : [0.7, 0.8, 1];
        push(rng(), rng(), 0.7 + Math.pow(rng(), 3) * 2.2, fc, 0.25 + rng() * 0.6, 0.15 + rng() * 0.85, -3, 2);
      }
      var data = new Float32Array(out); count = data.length / STRIDE;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      var F = 4;
      gl.enableVertexAttribArray(loc.aPos); gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, STRIDE * F, 0);
      gl.enableVertexAttribArray(loc.aSize); gl.vertexAttribPointer(loc.aSize, 1, gl.FLOAT, false, STRIDE * F, 2 * F);
      gl.enableVertexAttribArray(loc.aColor); gl.vertexAttribPointer(loc.aColor, 4, gl.FLOAT, false, STRIDE * F, 3 * F);
      gl.enableVertexAttribArray(loc.aX); gl.vertexAttribPointer(loc.aX, 4, gl.FLOAT, false, STRIDE * F, 7 * F);
    }
    return {
      build: build,
      draw: function (t, introE, focus, focusAmt) {
        if (lost || gl.isContextLost()) return;
        gl.viewport(0, 0, sky.width, sky.height);
        gl.clearColor(0.016, 0.02, 0.035, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(loc.uView, W, H); gl.uniform3f(loc.uCam, cam.x, cam.y, cam.z);
        gl.uniform1f(loc.uDpr, skyDpr); gl.uniform1f(loc.uHazeMax, 230 * skyDpr); gl.uniform1f(loc.uTime, reduced ? 0 : t); gl.uniform1f(loc.uIntro, introE);
        gl.uniform1f(loc.uFocus, focus); gl.uniform1f(loc.uFocusAmt, focusAmt);
        gl.uniform1f(loc.uGain, 0.62 + 0.38 * smooth(0.12, 0.9, cam.z));
        gl.drawArrays(gl.POINTS, 0, count);
      }
    };
  })();
  if (!skyGL) document.body.classList.add("no-gl");

  /* ---------- camera ---------- */
  var cam = { x: 0, y: 0, z: 0.2 }, camT = { x: 0, y: 0, z: 0.2 }, flight = null, touched = false;
  var ZMIN = 0.06, ZMAX = 7;
  function clampZ(z) { return clamp(z, ZMIN, ZMAX); }
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    skyDpr = narrow() ? 1 : Math.min(dpr, 1.5);
    [[sky, skyDpr], [fx, dpr]].forEach(function (x) { var c = x[0]; c.width = Math.round(W * x[1]); c.height = Math.round(H * x[1]); c.style.width = W + "px"; c.style.height = H + "px"; });
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /* the part of the screen not covered by the open card */
  function freeArea() {
    var open = !!active;
    if (narrow()) { var sheet = open ? Math.min(H * 0.6, card.offsetHeight || H * 0.6) : 0; return { x0: 0, y0: 70, x1: W, y1: H - (open ? sheet : 70) }; }
    return { x0: 0, y0: 80, x1: open ? W - 500 : W, y1: H - 80 };
  }
  function viewOf(px, py, z, area) {
    var a = area || freeArea(), ax = (a.x0 + a.x1) / 2, ay = (a.y0 + a.y1) / 2;
    return { x: px - (ax - W / 2) / z, y: py - (ay - H / 2) / z, z: clampZ(z) };
  }
  function fitBox(b, pad) {
    var a = freeArea(), bw = b.x1 - b.x0, bh = b.y1 - b.y0, z = Math.min((a.x1 - a.x0 - 2 * pad) / bw, (a.y1 - a.y0 - 2 * pad) / bh);
    return viewOf((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, z, a);
  }
  function homeView() {
    var a = freeArea(); a.y0 += narrow() ? 40 : 34; a.y1 -= narrow() ? 70 : 64;
    var bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0, pad = narrow() ? 6 : 30, z = Math.min((a.x1 - a.x0 - 2 * pad) / bw, (a.y1 - a.y0 - 2 * pad) / bh);
    return viewOf((bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2, z, a);
  }
  function clusterView(c) {
    var a = freeArea(); a.y0 += narrow() ? 64 : 92;
    var bw = c.b.x1 - c.b.x0, bh = c.b.y1 - c.b.y0, pad = narrow() ? 10 : 40, z = Math.min((a.x1 - a.x0 - 2 * pad) / bw, (a.y1 - a.y0 - 2 * pad) / bh);
    return viewOf((c.b.x0 + c.b.x1) / 2, (c.b.y0 + c.b.y1) / 2, z, a);
  }
  function systemView(s) {
    var a = freeArea(), r = s.sysR || s.wr * 6;
    var z = Math.min((a.x1 - a.x0) / 2 - (narrow() ? 26 : 70), (a.y1 - a.y0) / 2 - 40) / (r * (narrow() ? 1.0 : 1.08));
    return viewOf(s.x, s.y, z, a);
  }
  function starView(s) { return viewOf(s.x, s.y, Math.max(Math.min(camT.z, 2.2), narrow() ? 0.9 : 1.15)); }
  function viewFor(b) { if (b.planet) return systemView(b.parent); if (b.planets.length) return systemView(b); return starView(b); }
  /* van Wijk and Nuij's smooth zoom-and-pan, as in d3.interpolateZoom */
  function zoomPath(p0, p1) {
    var rho = Math.SQRT2, ux0 = p0[0], uy0 = p0[1], w0 = p0[2], ux1 = p1[0], uy1 = p1[1], w1 = p1[2], dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy, f, S;
    if (d2 < 1e-6) { S = Math.log(w1 / w0) / rho; f = function (t) { return [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)]; }; }
    else {
      var d1 = Math.sqrt(d2), b0 = (w1 * w1 - w0 * w0 + 4 * d2) / (2 * w0 * 2 * d1), b1 = (w1 * w1 - w0 * w0 - 4 * d2) / (2 * w1 * 2 * d1);
      var r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1); S = (r1 - r0) / rho;
      f = function (t) { var s = t * S, c0 = Math.cosh(r0), u = w0 / (2 * d1) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0)); return [ux0 + u * dx, uy0 + u * dy, w0 * c0 / Math.cosh(rho * s + r0)]; };
    }
    f.duration = Math.abs(S) * 1000 * rho / Math.SQRT2; return f;
  }
  function flyTo(v, opt) {
    camT = { x: v.x, y: v.y, z: clampZ(v.z) }; touched = true;
    if (reduced) { cam = { x: camT.x, y: camT.y, z: camT.z }; flight = null; return; }
    var span = Math.min(W, H), f = zoomPath([cam.x, cam.y, span / cam.z], [camT.x, camT.y, span / camT.z]);
    flight = { f: f, t0: performance.now(), dur: clamp(f.duration * ((opt && opt.slow) || 0.85), 450, (opt && opt.max) || 2400), span: span, to: { x: camT.x, y: camT.y, z: camT.z } };
  }
  function settle() { flight = null; }
  function zoomAt(px, py, factor) {
    settle();
    var z = clampZ(camT.z * factor), wx = camT.x + (px - W / 2) / camT.z, wy = camT.y + (py - H / 2) / camT.z;
    camT = { x: wx - (px - W / 2) / z, y: wy - (py - H / 2) / z, z: z }; cam = { x: camT.x, y: camT.y, z: camT.z }; touched = true; skipIntro();
  }
  function toScreen(x, y) { return { x: W / 2 + (x - cam.x) * cam.z, y: H / 2 + (y - cam.y) * cam.z }; }
  function toWorld(px, py) { return { x: cam.x + (px - W / 2) / cam.z, y: cam.y + (py - H / 2) / cam.z }; }

  /* ---------- the DOM: one link per body, one label per cluster ---------- */
  var els = {}, clusterEls = {};
  function build() {
    world.textContent = "";
    clusters.forEach(function (c) {
      var b = h("button", "cl"); b.type = "button"; b.style.setProperty("--c", c.color); b.dataset.cluster = c.id;
      b.appendChild(h("span", "cl__n", c.name));
      var count = seq.filter(function (x) { return x.cluster === c.id; }).length;
      b.appendChild(h("span", "cl__m", count + " bodies"));
      b.appendChild(h("span", "cl__b", c.blurb));
      b.setAttribute("aria-label", c.name + ": " + c.blurb + " Zoom in.");
      b.addEventListener("click", function () { if (dragged) return; closeCard(); flyTo(clusterView(c)); });
      b.addEventListener("mouseenter", function () { setFocus(c.id); }); b.addEventListener("mouseleave", function () { setFocus(null); });
      world.appendChild(b); clusterEls[c.id] = b;
    });
    seq.forEach(function (s) {
      var a = h("a", "body body--" + s.kind + (s.planet ? " body--planet" : " body--star") + (s.id === G.core ? " body--core" : "") + (s.cluster && clusterById[s.cluster].core === s.id ? " body--heart" : ""));
      a.href = "#" + s.id; a.id = "b-" + s.id; a.style.setProperty("--c", s.color); a.dataset.id = s.id;
      a.setAttribute("aria-label", s.title + (s.when ? ", " + s.when : "") + ", " + (s.planet ? "part of " + s.parent.title : nameOf(s)) + (s.planets.length ? ", " + s.planets.length + " planets" : ""));
      a.appendChild(h("span", "body__hit"));
      var lab = h("span", "body__label"); lab.appendChild(h("span", "body__t", s.name || s.title)); if (s.short) lab.appendChild(h("span", "body__s", s.short)); a.appendChild(lab);
      a.addEventListener("mouseenter", function () { if (!dragged && !pointerDown) hover(s, true); });
      a.addEventListener("mouseleave", function () { unhover(s); });
      a.addEventListener("focus", function () { if (a.matches(":focus-visible")) { hover(s, false); keepInView(s); } });
      a.addEventListener("blur", function () { unhover(s); });
      a.addEventListener("click", function (e) { if (dragged) { e.preventDefault(); return; } hidePeek(true); if (location.hash === "#" + s.id) { e.preventDefault(); open(s, e.detail === 0); } });
      world.appendChild(a); els[s.id] = { a: a, lab: lab, on: true, vis: true, la: -1, x: 0, y: 0, w: 0 };
    });
  }
  function keepInView(s) {
    var p = toScreen(s.x, s.y), a = freeArea(), m = 60;
    if (p.x < a.x0 + m || p.x > a.x1 - m || p.y < a.y0 + m || p.y > a.y1 - m || (s.planet && s.parent.sysR * cam.z < 140)) flyTo(viewFor(s));
  }

  /* ---------- per-frame placement and semantic zoom ---------- */
  var hot = null, active = null, focusCl = null, focusAmt = 0;
  var hudEls = Array.prototype.slice.call(document.querySelectorAll(".brand, .elsewhere, .crumbs, .legend, .tools, #minimap"));
  function visibility() {
    var fa = freeArea(), z = cam.z, span = Math.min(fa.x1 - fa.x0, fa.y1 - fa.y0);
    clusters.forEach(function (c) {
      var Rs = c.R * z; c.Rs = Rs;
      c.starA = smooth(span * 0.17, span * 0.3, Rs);
      c.labelA = 1 - smooth(span * 0.24, span * 0.36, Rs);
    });
    stars.forEach(function (s) {
      var Ss = s.sysR * z; s.Ss = Ss;
      s.sysA = s.planets.length ? smooth(26, 70, Ss) : 0;          /* orbits and planet dots */
      s.planetLinks = Ss > span * 0.17;                           /* planets become links */
      s.planetA = smooth(span * 0.19, span * 0.27, Ss);           /* planet labels */
      if (active && (active === s || active.parent === s)) { s.sysA = Math.max(s.sysA, 0.8); s.planetLinks = true; } /* the open system keeps its planets */
    });
  }
  function labelAlpha(s) {
    if (s === hot || s === active) return 1;
    if (s.planet) return s === active ? 1 : s.parent.planetA;
    if (s.id === G.core) return 1;
    var c = clusterById[s.cluster];
    if (c.core === s.id) return Math.max(0.92, c.starA);
    if (s.weight >= 5) return Math.max(0.8, c.starA);
    return c.starA;
  }
  function overlaps(r, list) { for (var i = 0; i < list.length; i++) { var q = list[i]; if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return true; } return false; }
  function place() {
    /* read last frame's layout first (cheap), then write */
    var blocked = [];
    clusters.forEach(function (c) { var b = clusterEls[c.id]; if (c.labelA > 0.05 && !b.classList.contains("is-off")) { var r = b.getBoundingClientRect(); blocked.push([r.left, r.top, r.right, r.bottom]); } });
    var hd = heading.getBoundingClientRect(); if (heading.getAttribute("data-on") === "true") blocked.push([hd.left, hd.top, hd.right, hd.bottom]);
    hudEls.forEach(function (el) { var r = el.getBoundingClientRect(); if (r.width && getComputedStyle(el).opacity !== "0") blocked.push([r.left - 6, r.top - 6, r.right + 6, r.bottom + 6]); });
    var pos = {};
    seq.forEach(function (s) {
      var p = toScreen(s.x, s.y), r = s.planet ? Math.max(2, s.wr * cam.z) : bodyPx(s); pos[s.id] = { p: p, r: r };
      if (!s.planet || s.parent.planetLinks) blocked.push([p.x - r - 3, p.y - r - 3, p.x + r + 3, p.y + r + 3, s.id, s.planet ? s.parent.id : ""]);
    });
    var order = seq.slice().sort(function (a, b) { return prio(b) - prio(a); });
    order.forEach(function (s) {
      var e = els[s.id], p = pos[s.id].p, r = pos[s.id].r;
      var on = s.planet ? s.parent.planetLinks || s === active : true;
      var off = p.x < -300 || p.x > W + 300 || p.y < -60 || p.y > H + 60;
      if (on !== e.vis) { e.vis = on; e.a.classList.toggle("is-off", !on); }
      if (!on) return;
      var hit = Math.max(hoverable ? 22 : 34, r * 2 + 8);
      e.a.style.transform = "translate3d(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px,0)";
      e.a.style.setProperty("--hit", hit.toFixed(0) + "px");
      e.a.style.setProperty("--r", r.toFixed(1) + "px");
      var la = off ? 0 : labelAlpha(s), side = e.side || "r";
      if (la > 0.02) {
        /* try the right, the left, below and above; hide the label if none is free */
        var lw = e.w || (e.w = e.lab.offsetWidth || 120), lh = s.short && s.kind !== "interest" ? 34 : 20, gap = Math.max(hit / 2, r) + 6, y0 = p.y - lh / 2, vg = Math.max(hit / 2, r) + 3;
        var cands = [["r", [p.x + gap, y0, p.x + gap + lw, y0 + lh]], ["l", [p.x - gap - lw, y0, p.x - gap, y0 + lh]], ["d", [p.x - lw / 2, p.y + vg, p.x + lw / 2, p.y + vg + lh]], ["u", [p.x - lw / 2, p.y - vg - lh, p.x + lw / 2, p.y - vg]]];
        /* a cluster's heart may cover a small neighbour's dot, never a label */
        var big = isHeart(s), others = blocked.filter(function (q) { return q[4] !== s.id && q[5] !== s.id && !(big && q[4] && !isHeart(byId[q[4]]) && (byId[q[4]].weight || 1) < 5); }), must = s === hot || s === active, pick = null;
        for (var ci = 0; ci < cands.length && !pick; ci++) { var q = cands[ci][1]; if (q[0] > 6 && q[2] < W - 6 && q[1] > 4 && q[3] < H - 4 && !overlaps(q, others)) pick = cands[ci]; }
        if (!pick && must) pick = cands[0][1][2] < W - 6 ? cands[0] : cands[1];
        if (pick) { side = pick[0]; blocked.push(pick[1]); } else la = 0;
      }
      if (side !== e.side) { e.side = side; e.a.dataset.side = side; }
      if (focusCl && s.cluster !== focusCl && s.id !== G.core) la *= 0.3;
      la = Math.round(la * 20) / 20;
      if (la !== e.la) { e.la = la; e.lab.style.opacity = la; e.a.classList.toggle("is-quiet", la < 0.05); }
    });
    clusters.forEach(function (c) {
      /* outward of the cluster: above it in the upper half, below it in the lower half */
      var b = clusterEls[c.id], below = c.cy > (narrow() ? 400 : 200), edge = toScreen(c.cx, below ? c.b.y1 : c.b.y0), lift = narrow() ? 14 : 22;
      b.style.transform = "translate3d(" + edge.x.toFixed(1) + "px," + (edge.y + (below ? lift : -lift)).toFixed(1) + "px,0) translate(-50%," + (below ? "0" : "-100%") + ")";
      b.classList.toggle("is-below", below);
      var a = c.labelA * (focusCl && focusCl !== c.id ? 0.35 : 1);
      b.style.opacity = a.toFixed(2);
      b.classList.toggle("is-off", a < 0.03);
    });
  }
  function isHeart(s) { return !s.planet && (s.id === G.core || (s.cluster && clusterById[s.cluster].core === s.id)); }
  function prio(s) { return (s === active ? 1000 : 0) + (s === hot ? 900 : 0) + (s.id === G.core ? 500 : 0) + (s.cluster && clusterById[s.cluster].core === s.id ? 400 : 0) + (s.planet ? 0 : 100) + (s.weight || 1) * 10 - (s.planet ? s.i : 0); }
  function bodyPx(s) { var base = s.kind === "interest" ? 2.4 : 1.6 + (s.weight || 1) * 0.75; return clamp(s.wr * cam.z, base, 64); }

  /* ---------- the 2D layer: intersections, orbits, stars, planets ---------- */
  var glowCache = {};
  function glow(color) {
    if (glowCache[color]) return glowCache[color];
    var c = document.createElement("canvas"), s = 128; c.width = c.height = s; var g = c.getContext("2d"), grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2), col = rgb(color);
    var str = function (a) { return "rgba(" + Math.round(col[0] * 255) + "," + Math.round(col[1] * 255) + "," + Math.round(col[2] * 255) + "," + a + ")"; };
    grd.addColorStop(0, "rgba(255,255,255,0.95)"); grd.addColorStop(0.08, str(0.85)); grd.addColorStop(0.25, str(0.28)); grd.addColorStop(0.6, str(0.06)); grd.addColorStop(1, str(0));
    g.fillStyle = grd; g.fillRect(0, 0, s, s); glowCache[color] = c; return c;
  }
  function posOf(b) { if (b.planet && b.parent.sysA < 0.3) return b.parent; return b; }
  function drawFx(t, introE) {
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.clearRect(0, 0, W, H);
    if (introE < 0.35) return;
    var fade = smooth(0.35, 0.95, introE), lit = active || hot;
    var litSet = {}; if (lit) { litSet[lit.id] = 1; lit.near.forEach(function (o) { litSet[o.id] = 1; }); if (lit.parent) litSet[lit.parent.id] = 1; }
    /* intersections: curves bowed towards the core */
    fctx.lineCap = "round";
    edges.forEach(function (e) {
      var a = posOf(e[0]), b = posOf(e[1]), on = lit && (e[0] === lit || e[1] === lit);
      var pa = toScreen(a.x, a.y), pb = toScreen(b.x, b.y);
      if (Math.max(pa.x, pb.x) < -50 || Math.min(pa.x, pb.x) > W + 50 || Math.max(pa.y, pb.y) < -50 || Math.min(pa.y, pb.y) > H + 50) return;
      var cross = e[0].cluster !== e[1].cluster, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, pull = cross ? 0.22 : 0.08, cp = toScreen(mx * (1 - pull), my * (1 - pull));
      var al = on ? 0.75 : lit ? 0.04 : (cross ? 0.1 : 0.07);
      if (focusCl && !on) al *= (e[0].cluster === focusCl || e[1].cluster === focusCl) ? 1.6 : 0.3;
      var col = on ? lit.color : (cross ? "#C9D3FF" : e[0].color);
      fctx.strokeStyle = rgba(col, al * fade); fctx.lineWidth = on ? 1.4 : 1;
      if (on && !reduced) { fctx.setLineDash([2, 7]); fctx.lineDashOffset = -t * 22; } else fctx.setLineDash([]);
      fctx.beginPath(); fctx.moveTo(pa.x, pa.y); fctx.quadraticCurveTo(cp.x, cp.y, pb.x, pb.y); fctx.stroke();
    });
    fctx.setLineDash([]);
    /* the career: M.Eng. → Lightfield → Tomex */
    for (var i = 0; i + 1 < path.length; i++) {
      var p0 = toScreen(path[i].x, path[i].y), p1 = toScreen(path[i + 1].x, path[i + 1].y), col2 = path[i].color;
      var grd = fctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y); grd.addColorStop(0, rgba(col2, 0.05 * fade)); grd.addColorStop(0.5, rgba(col2, 0.42 * fade)); grd.addColorStop(1, rgba(col2, 0.05 * fade));
      fctx.strokeStyle = grd; fctx.lineWidth = 1.5; fctx.beginPath(); fctx.moveTo(p0.x, p0.y); fctx.lineTo(p1.x, p1.y); fctx.stroke();
      if (!reduced) for (var k = 0; k < 2; k++) {
        var u = ((t * 0.12 + k * 0.5 + i * 0.25) % 1), px = p0.x + (p1.x - p0.x) * u, py = p0.y + (p1.y - p0.y) * u;
        fctx.fillStyle = rgba(col2, 0.85 * fade * Math.sin(u * Math.PI)); fctx.beginPath(); fctx.arc(px, py, 1.8, 0, 6.283); fctx.fill();
      }
    }
    /* systems: orbits, then planets */
    stars.forEach(function (s) {
      if (!s.sysA) return;
      var c = toScreen(s.x, s.y), R = s.sysR * cam.z;
      if (c.x + R < 0 || c.x - R > W || c.y + R < 0 || c.y - R > H) return;
      var dim = focusCl && s.cluster !== focusCl && s.id !== G.core ? 0.3 : 1;
      s.planets.forEach(function (p) {
        var o = p.orbit * cam.z, isLit = p === active || p === hot;
        fctx.strokeStyle = isLit ? rgba(s.color, 0.55 * s.sysA * fade) : "rgba(220,228,255," + (0.09 * s.sysA * fade * dim).toFixed(3) + ")";
        fctx.lineWidth = isLit ? 1.2 : 1; fctx.beginPath(); fctx.ellipse(c.x, c.y, o, o * TILT, 0, 0, 6.283); fctx.stroke();
      });
      s.planets.forEach(function (p) {
        var q = toScreen(p.x, p.y), pr = Math.max(1.3, p.wr * cam.z * 0.9), isLit = p === active || p === hot;
        fctx.globalAlpha = s.sysA * fade * dim;
        if (isLit || pr > 3) { var gs = pr * (isLit ? 9 : 6); fctx.globalCompositeOperation = "lighter"; fctx.drawImage(glow(s.color), q.x - gs / 2, q.y - gs / 2, gs, gs); fctx.globalCompositeOperation = "source-over"; }
        var dx = c.x - q.x, dy = c.y - q.y, dl = Math.hypot(dx, dy) || 1, g2 = fctx.createRadialGradient(q.x + dx / dl * pr * 0.45, q.y + dy / dl * pr * 0.45, pr * 0.1, q.x, q.y, pr);
        g2.addColorStop(0, "#FFFFFF"); g2.addColorStop(0.35, s.color); g2.addColorStop(1, rgba(s.color, 0.25));
        fctx.fillStyle = p.kind === "interest" ? "rgba(0,0,0,0)" : g2; fctx.beginPath(); fctx.arc(q.x, q.y, pr, 0, 6.283); fctx.fill();
        if (p.kind === "interest") { fctx.strokeStyle = s.color; fctx.lineWidth = 1; fctx.stroke(); }
        if (isLit) { fctx.strokeStyle = rgba(s.color, 0.9); fctx.lineWidth = 1; fctx.beginPath(); fctx.arc(q.x, q.y, pr + 5, 0, 6.283); fctx.stroke(); }
        fctx.globalAlpha = 1;
      });
    });
    /* stars */
    stars.forEach(function (s) {
      var q = toScreen(s.x, s.y), r = bodyPx(s), gs = r * (s.planets.length ? 9 : 7.5);
      if (q.x < -gs || q.x > W + gs || q.y < -gs || q.y > H + gs) return;
      var dim = focusCl && s.cluster !== focusCl && s.id !== G.core ? 0.3 : 1, isLit = s === active || s === hot || (lit && litSet[s.id]);
      var tw = reduced ? 1 : 0.92 + 0.08 * Math.sin(t * 1.7 + s.seq);
      fctx.globalAlpha = fade * dim * tw;
      if (s.kind === "interest") {
        fctx.strokeStyle = rgba(s.color, 0.9); fctx.lineWidth = 1.2; fctx.beginPath(); fctx.arc(q.x, q.y, r + 1.5, 0, 6.283); fctx.stroke();
        fctx.globalCompositeOperation = "lighter"; fctx.drawImage(glow(s.color), q.x - gs / 3, q.y - gs / 3, gs / 1.5, gs / 1.5); fctx.globalCompositeOperation = "source-over";
      } else {
        fctx.globalCompositeOperation = "lighter";
        fctx.drawImage(glow(s.color), q.x - gs / 2, q.y - gs / 2, gs, gs);
        if (s.weight >= 4 && r < 26) { /* diffraction spikes on the bright ones */
          var L = r * 7 * (isLit ? 1.4 : 1); fctx.strokeStyle = rgba(s.color, 0.35); fctx.lineWidth = 1;
          fctx.beginPath(); fctx.moveTo(q.x - L, q.y); fctx.lineTo(q.x + L, q.y); fctx.moveTo(q.x, q.y - L); fctx.lineTo(q.x, q.y + L); fctx.stroke();
        }
        fctx.globalCompositeOperation = "source-over";
        var g3 = fctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
        g3.addColorStop(0, "#FFFFFF"); g3.addColorStop(0.55, "#FFF8EC"); g3.addColorStop(1, rgba(s.color, 0.9));
        fctx.fillStyle = g3; fctx.beginPath(); fctx.arc(q.x, q.y, r, 0, 6.283); fctx.fill();
      }
      if (s === active || s === hot) { fctx.strokeStyle = rgba(s.color, 0.85); fctx.lineWidth = 1; fctx.beginPath(); fctx.arc(q.x, q.y, r + 7, 0, 6.283); fctx.stroke(); }
      fctx.globalAlpha = 1;
    });
  }

  /* ---------- the hover card ---------- */
  var peekFor = null, peekTimer = 0, hideTimer = 0, peekVideo = null, orbitPeek = null;
  function hover(s, pointer) {
    clearTimeout(hideTimer); hot = s;
    if (!hoverable && pointer) return;
    if (s === active && card.getAttribute("data-on") === "true") return;
    /* with a card open, crossing another body on the way to the card must not replace it: switching needs a dwell */
    clearTimeout(peekTimer); peekTimer = setTimeout(function () { showPeek(s); }, peek.getAttribute("data-on") === "true" ? 200 : 90);
  }
  function unhover(s) { if (hot === s) hot = null; clearTimeout(peekTimer); clearTimeout(hideTimer); hideTimer = setTimeout(function () { if (!peek.matches(":hover")) hidePeek(); }, 220); }
  peek.addEventListener("mouseenter", function () { clearTimeout(hideTimer); clearTimeout(peekTimer); });
  peek.addEventListener("mouseleave", function () { hideTimer = setTimeout(hidePeek, 160); });
  function mediaFor(s, big) {
    var m = s.media || {};
    if (m.video) {
      var v = document.createElement("video"); v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
      v.poster = m.poster; v.preload = "auto"; if (big) v.controls = true; v.autoplay = !reduced; v.src = m.video; return v;
    }
    if (m.image) { var im = h("img"); im.src = m.image; im.alt = ""; im.decoding = "async"; return im; }
    if (m.book) {
      var bk = h("span", "book"), cover = h("span", "book__cover"); bk.appendChild(h("span", "book__spine"));
      cover.appendChild(h("span", "book__title", (m.bookTitle || "").toUpperCase().split(/\s+/).join("\n"))); cover.appendChild(h("span", "book__by", m.bookAuthor || "")); bk.appendChild(cover);
      var wrap = h("span", "media-book"); wrap.appendChild(bk); return wrap;
    }
    if (m.quote) { var qb = h("blockquote", "media-quote"); qb.appendChild(h("span", "q", "“" + m.quote + "”")); if (m.cite) qb.appendChild(h("span", "label", m.cite)); return qb; }
    return null;
  }
  function showPeek(s) {
    if (pointerDown) return;
    peekFor = s; peek.textContent = ""; peek.style.setProperty("--c", s.color);
    var media = mediaFor(s, false), fig = h("div", "peek__media");
    orbitPeek = null;
    if (media) { fig.appendChild(media); if (media.tagName === "VIDEO") { peekVideo = media; if (!reduced) { var pl = media.play(); if (pl && pl.catch) pl.catch(function () {}); } } if (s.media && s.media.square) fig.classList.add("is-square"); }
    else { var oc = h("canvas", "peek__orbits"); fig.appendChild(oc); orbitPeek = { c: oc, s: s, mode: s.planets.length ? "system" : s.planet ? "planet" : "locator" }; }
    peek.appendChild(fig);
    /* the sections, in the order the content's card layout gives */
    var body = h("div", "peek__body"), parts = {
      kicker: function () { body.appendChild(h("p", "peek__kicker", (s.planet ? s.parent.title : nameOf(s)) + (s.when && s.kind !== "interest" ? " · " + s.when : ""))); },
      title: function () { body.appendChild(h("h3", "peek__title", s.title)); },
      subtitle: function () { if (s.meta && s.meta !== s.when) body.appendChild(h("p", "peek__meta", s.meta)); },
      summary: function () { if (s.line) body.appendChild(rich("p", "peek__line", s.line)); },
      firstParagraph: function () { if (s.facts && s.facts[0]) body.appendChild(rich("p", "peek__fact", s.facts[0])); },
      builtWith: function () { if (s.tech) body.appendChild(h("p", "peek__tech", s.tech)); },
      links: function () { if (s.links && s.links.length) { var ln = h("p", "peek__links"); s.links.slice(0, 3).forEach(function (l) { ln.appendChild(linkEl(l)); }); body.appendChild(ln); } },
      hint: function () { body.appendChild(h("p", "peek__hint", s.planets.length ? fill(L.hoverSystem, { n: s.planets.length }) : s.planet ? fill(L.hoverPlanet, { star: s.parent.title }) : L.hoverStar)); }
    };
    G.site.card.hover.forEach(function (k) { if (parts[k]) parts[k](); });
    body.querySelectorAll("a").forEach(function (a) { a.tabIndex = -1; });
    peek.appendChild(body);
    choosePeekSide(); positionPeek(); peek.setAttribute("data-on", "true");
  }
  /* the hover card goes on the side of its star that covers the fewest other stars, so a neighbour
     stays reachable; the side is chosen when it opens and kept while the camera moves */
  var peekSide = "r";
  function peekRect(side, p, pw, ph) {
    var e = els[peekFor.id], lab = e && e.la > 0.05 ? Math.min(e.w || 0, 220) : 0, gap = Math.max(18, bodyPx(peekFor) + 16), x, y;
    if (side === "r") { x = p.x + gap + (e && e.side === "r" ? lab : 0); y = p.y - ph * 0.35; }
    else if (side === "l") { x = p.x - gap - pw - (e && e.side === "l" ? lab : 0); y = p.y - ph * 0.35; }
    else if (side === "d") { x = p.x - pw / 2; y = p.y + gap + 22; }
    else { x = p.x - pw / 2; y = p.y - gap - ph; }
    return [clamp(x, 14, W - pw - 14), clamp(y, 70, H - ph - 14)];
  }
  function choosePeekSide() {
    var p = toScreen(peekFor.x, peekFor.y), pw = peek.offsetWidth || 340, ph = peek.offsetHeight || 380, best = "r", bestScore = 1e9;
    ["r", "l", "d", "u"].forEach(function (side, order) {
      var r = peekRect(side, p, pw, ph), x0 = r[0] - 14, y0 = r[1] - 14, x1 = r[0] + pw + 14, y1 = r[1] + ph + 14, score = order * 0.1;
      if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) score += 100;          /* never over its own star */
      seq.forEach(function (b) {
        if (b === peekFor || (b.planet && !b.parent.planetLinks)) return;
        var q = toScreen(b.x, b.y); if (q.x > x0 && q.x < x1 && q.y > y0 && q.y < y1) score += b.planet ? 1 : 3;
      });
      if (score < bestScore) { bestScore = score; best = side; }
    });
    peekSide = best;
  }
  function positionPeek() {
    if (!peekFor) return;
    var r = peekRect(peekSide, toScreen(peekFor.x, peekFor.y), peek.offsetWidth || 340, peek.offsetHeight || 380);
    peek.style.transform = "translate3d(" + Math.round(r[0]) + "px," + Math.round(r[1]) + "px,0)";
  }
  function hidePeek(now) {
    clearTimeout(peekTimer); peek.setAttribute("data-on", "false"); orbitPeek = null;
    if (peekVideo) { peekVideo.pause(); peekVideo = null; }
    if (now) peekFor = null; else setTimeout(function () { if (peek.getAttribute("data-on") === "false") peekFor = null; }, 250);
  }
  /* the hover card's live picture, when a body has no recording: its system, where a planet sits in its
     system, or where a star sits in its domain */
  function drawOrbitPeek(t) {
    if (!orbitPeek) return;
    var c = orbitPeek.c, s = orbitPeek.s, mode = orbitPeek.mode, w = c.clientWidth, hh = c.clientHeight; if (!w) return;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
    var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    g.font = "500 9.5px 'Geist Mono', ui-monospace, monospace"; g.textBaseline = "middle";
    function sun(x, y, col, r) { g.globalCompositeOperation = "lighter"; g.drawImage(glow(col), x - r * 8, y - r * 8, r * 16, r * 16); g.globalCompositeOperation = "source-over"; g.fillStyle = "#FFF6E6"; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); }
    function clip(str, n) { return str.length > n ? str.slice(0, n - 1) + "…" : str; }
    if (mode === "locator") {
      var cl = clusterOf(s), list = cl ? cl.stars : [s], b = cl ? cl.b : { x0: s.x - 200, y0: s.y - 200, x1: s.x + 200, y1: s.y + 200 };
      var k = Math.min((w - 40) / (b.x1 - b.x0), (hh - 40) / (b.y1 - b.y0)), ox = w / 2 - (b.x0 + b.x1) / 2 * k, oy = hh / 2 - (b.y0 + b.y1) / 2 * k;
      g.strokeStyle = rgba(s.color, 0.5); g.lineWidth = 1;
      s.near.forEach(function (o) { var q = o.planet ? o.parent : o; if (q.cluster !== s.cluster) return; g.beginPath(); g.moveTo(ox + s.x * k, oy + s.y * k); g.lineTo(ox + q.x * k, oy + q.y * k); g.stroke(); });
      list.forEach(function (q) { var x = ox + q.x * k, y = oy + q.y * k; if (q === s) return; g.fillStyle = rgba(q.color, 0.55); g.beginPath(); g.arc(x, y, q.weight >= 4 ? 3 : 2, 0, 6.283); g.fill(); });
      var sx = ox + s.x * k, sy = oy + s.y * k, pulse = reduced ? 0 : (t * 0.6) % 1;
      sun(sx, sy, s.color, 4.5);
      g.strokeStyle = rgba(s.color, 0.8 * (1 - pulse)); g.beginPath(); g.arc(sx, sy, 8 + pulse * 18, 0, 6.283); g.stroke();
      g.fillStyle = rgba(s.color, 0.95); g.fillText((cl ? cl.name : L.core).toUpperCase(), 14, 16);
      return;
    }
    var host = mode === "planet" ? s.parent : s, list2 = mode === "system", cx = list2 ? w * 0.3 : w * 0.5, cy = hh * 0.52;
    var R = host.sysR, kk = Math.min((hh * 0.44) / (R * TILT), ((list2 ? w * 0.27 : w * 0.44)) / R);
    sun(cx, cy, host.color, 6);
    host.planets.forEach(function (p, i) {
      var o = p.orbit * kk, a = p.phase + (reduced ? 0 : t * p.omega * 2.2), x = cx + Math.cos(a) * o, y = cy + Math.sin(a) * o * TILT, me = p === s;
      g.strokeStyle = me ? rgba(host.color, 0.6) : "rgba(220,228,255,0.12)"; g.lineWidth = 1; g.beginPath(); g.ellipse(cx, cy, o, o * TILT, 0, 0, 6.283); g.stroke();
      g.fillStyle = me || mode !== "planet" ? host.color : rgba(host.color, 0.45); g.beginPath(); g.arc(x, y, me ? 4.5 : 2.8, 0, 6.283); g.fill();
      if (me) {
        g.strokeStyle = rgba(host.color, 0.9); g.beginPath(); g.arc(x, y, 9, 0, 6.283); g.stroke();
        var lab = clip(p.title, 30), tw = g.measureText(lab).width, tx = x + 14; if (tx + tw > w - 6) tx = x - 14 - tw;
        g.fillStyle = "#fff"; g.fillText(lab, tx, y);
      }
      if (list2) {
        var ly = 18 + i * Math.min(20, (hh - 30) / host.planets.length);
        g.fillStyle = host.color; g.beginPath(); g.arc(w * 0.62, ly, 2.5, 0, 6.283); g.fill();
        g.fillStyle = "rgba(237,233,226,0.88)"; g.fillText(clip(p.name || p.title, Math.floor((w * 0.38 - 16) / 6)), w * 0.62 + 9, ly);
      }
    });
    if (mode === "planet") { g.fillStyle = rgba(host.color, 0.95); g.fillText((host.name || host.title).toUpperCase(), 14, 16); }
  }

  /* ---------- the card ---------- */
  function panelFocus(panel, on) { if (on) panel.removeAttribute("tabindex"); else panel.tabIndex = -1; panel.querySelectorAll("a[href], button, input, video[controls]").forEach(function (el) { if (on) el.removeAttribute("tabindex"); else el.tabIndex = -1; }); }
  function open(s, takeFocus) {
    if (!s) return; active = s; hidePeek(true); skipIntro();
    var c = clusterOf(s); card.textContent = ""; card.style.setProperty("--c", s.color);
    var close = h("button", "card__close", L.close); close.type = "button"; close.addEventListener("click", function () { closeCard(); }); card.appendChild(close);
    var crumbs = h("p", "card__crumbs");
    var home = h("button", "crumb", L.galaxy); home.type = "button"; home.addEventListener("click", function () { closeCard(); flyTo(homeView()); }); crumbs.appendChild(home);
    if (c) { crumbs.appendChild(h("span", "sep", "/")); var cb = h("button", "crumb", c.name); cb.type = "button"; cb.addEventListener("click", function () { closeCard(); flyTo(clusterView(c)); }); crumbs.appendChild(cb); }
    if (s.planet) { crumbs.appendChild(h("span", "sep", "/")); var pa = h("a", "crumb", s.parent.title); pa.href = "#" + s.parent.id; chipBlur(pa); crumbs.appendChild(pa); }
    card.appendChild(crumbs);
    /* the sections, in the order the content's card layout gives */
    var sections = {
      media: function () {
        var media = mediaFor(s, true); if (!media) return;
        var fig = h("figure", "card__media" + (s.media.square ? " card__media--square" : "") + (s.media.book ? " card__media--book" : "") + (s.media.quote ? " card__media--quote" : ""));
        fig.appendChild(media); if (s.media.caption) fig.appendChild(h("figcaption", "label", s.media.caption)); card.appendChild(fig);
      },
      meta: function () { card.appendChild(h("p", "card__meta", [KINDS[s.kind], s.kind === "interest" ? "" : s.when, s.meta && s.meta !== s.when ? s.meta : ""].filter(Boolean).join(" · "))); },
      title: function () { card.appendChild(h("h2", "card__title", s.title)); },
      summary: function () { if (s.line) card.appendChild(rich("p", "card__lead", s.line)); },
      body: function () { (s.facts || []).forEach(function (p) { card.appendChild(rich("p", "card__p", p)); }); },
      builtWith: function () { if (s.tech) { var te = h("p", "card__tech"); te.appendChild(h("span", "label", L.builtWith)); te.appendChild(h("span", null, s.tech)); card.appendChild(te); } },
      links: function () { if (s.links && s.links.length) { var ln = h("p", "card__links"); s.links.forEach(function (l, i) { if (i) ln.appendChild(h("span", "sep", "·")); ln.appendChild(linkEl(l)); }); card.appendChild(ln); } },
      system: function () {
        var family = s.planet ? s.parent.planets : s.planets;
        if (!family.length) return;
        var sys = h("section", "card__system"), title = s.planet ? fill(L.systemOf, { star: s.parent.title }) : L.system;
        sys.appendChild(h("h3", "card__label", title + " · " + family.length));
        var ol = h("ol");
        family.forEach(function (p) {
          var li = h("li"), a = h("a", "chip chip--planet" + (p === s ? " is-here" : "")); a.href = "#" + p.id; a.style.setProperty("--c", p.color);
          a.appendChild(h("span", "t", p.title)); if (p.short) a.appendChild(h("span", "s", p.short));
          if (p === s) a.setAttribute("aria-current", "true");
          chipBlur(a); li.appendChild(a); ol.appendChild(li);
        });
        sys.appendChild(ol); card.appendChild(sys);
      },
      connections: function () {
        if (!s.near.length) return;
        var rel = h("section", "card__near"); rel.appendChild(h("h3", "card__label", L.near));
        var wrap = h("p", "card__chips");
        s.near.forEach(function (o) { var b = h("a", "chip", o.title); b.href = "#" + o.id; b.style.setProperty("--c", o.color); b.title = nameOf(o); chipBlur(b); wrap.appendChild(b); });
        rel.appendChild(wrap); card.appendChild(rel);
      },
      steps: function () {
        var step = h("nav", "card__step"), prev = seq[(s.seq - 1 + seq.length) % seq.length], next = seq[(s.seq + 1) % seq.length];
        step.setAttribute("aria-label", "Previous and next");
        var pv = h("a", "step step--prev"); pv.href = "#" + prev.id; pv.appendChild(h("span", "label", L.previous)); pv.appendChild(h("span", "t", prev.title));
        var nx = h("a", "step step--next"); nx.href = "#" + next.id; nx.appendChild(h("span", "label", L.next)); nx.appendChild(h("span", "t", next.title));
        chipBlur(pv); chipBlur(nx); step.appendChild(pv); step.appendChild(nx); card.appendChild(step);
      }
    };
    G.site.card.detail.forEach(function (k) { if (sections[k]) sections[k](); });
    card.querySelectorAll(".card__lead a, .card__p a").forEach(chipBlur);
    panelFocus(card, true); card.setAttribute("data-on", "true"); card.scrollTop = 0; document.body.setAttribute("data-active", "true");
    if (location.hash !== "#" + s.id) history.replaceState(null, "", "#" + s.id);
    flyTo(viewFor(s), { slow: 0.95 });
    updateCrumbs(true);
    if (takeFocus) close.focus({ preventScroll: true });
  }
  /* a pointer click on a link inside the card should not leave focus in the card, so arrows still pan */
  function chipBlur(b) { b.addEventListener("click", function (e) { if (e.detail && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) b.blur(); }); }
  function closeCard() {
    if (!active) return;
    if (card.contains(document.activeElement)) document.getElementById("index-toggle").focus({ preventScroll: true });
    var was = active; active = null;
    /* the card no longer covers part of the map: what it framed settles into the middle, at the same zoom */
    var host = was.planet ? was.parent : was, sp = toScreen(host.x, host.y);
    if (sp.x > 0 && sp.x < W && sp.y > 0 && sp.y < H) flyTo({ x: host.x, y: host.y, z: camT.z });
    panelFocus(card, false); card.setAttribute("data-on", "false"); card.querySelectorAll("video").forEach(function (v) { v.pause(); });
    document.body.removeAttribute("data-active");
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    updateCrumbs(true);
  }
  var indexPick = false; /* an index item was chosen and its hashchange is on the way */
  function onHash() {
    var id = decodeURIComponent(location.hash.slice(1)), pick = indexPick; indexPick = false;
    if (id && byId[id]) { var takeFocus = pick || index.getAttribute("data-on") === "true" || card.contains(document.activeElement); toggleIndex(false, true); open(byId[id], takeFocus); }
    else if (id && clusterById[id]) { toggleIndex(false, true); if (active) closeCard(); skipIntro(); flyTo(clusterView(clusterById[id])); }
    else if (!id) { closeCard(); }
  }
  window.addEventListener("hashchange", onHash);

  /* ---------- hud: crumbs, legend, zoom, minimap ---------- */
  var crumbsEl = document.getElementById("crumbs"), heading = document.getElementById("heading"), lastCrumb = "";
  function where() {
    if (active) return { c: clusterOf(active), s: active.planet ? active.parent : active, p: active.planet ? active : null };
    var span = Math.min(W, H), centre = toWorld((freeArea().x0 + freeArea().x1) / 2, H / 2), best = null, bd = 1e9;
    stars.forEach(function (s) { if (!s.planets.length) return; var d = Math.hypot(s.x - centre.x, s.y - centre.y); if (d < s.sysR * 1.1 && s.Ss > span * 0.2 && d < bd) { bd = d; best = s; } });
    var c = null, cd = 1e9;
    clusters.forEach(function (k) { var d = Math.hypot(k.cx - centre.x, k.cy - centre.y); if (d < k.R * 1.1 && k.Rs > span * 0.3 && d < cd) { cd = d; c = k; } });
    if (best) return { c: clusterOf(best), s: best, p: null };
    return { c: c, s: null, p: null };
  }
  function updateCrumbs(force) {
    var w = where(), key = (w.c ? w.c.id : "") + "/" + (w.s ? w.s.id : "") + "/" + (w.p ? w.p.id : "");
    if (key === lastCrumb && !force) return; lastCrumb = key;
    var hc = w.c && !w.s && !active ? w.c : null;
    if (hc) { heading.style.setProperty("--c", hc.color); heading.querySelector(".heading__n").textContent = hc.name; heading.querySelector(".heading__b").textContent = hc.blurb; }
    heading.setAttribute("data-on", hc ? "true" : "false");
    crumbsEl.textContent = "";
    function crumb(label, fn, color, current) {
      if (crumbsEl.childNodes.length) crumbsEl.appendChild(h("span", "sep", "›"));
      var b = h("button", "crumb" + (current ? " is-current" : ""), label); b.type = "button"; if (color) b.style.setProperty("--c", color);
      if (current) b.setAttribute("aria-current", "location");
      b.addEventListener("click", fn); crumbsEl.appendChild(b);
    }
    crumb(L.galaxy, function () { closeCard(); flyTo(homeView()); }, null, !w.c && !w.s);
    if (w.s && w.s.id === G.core) crumb(L.core, function () { closeCard(); flyTo(systemView(w.s)); }, CORE, !w.p);
    if (w.c) crumb(w.c.name, function () { closeCard(); flyTo(clusterView(w.c)); }, w.c.color, !w.s);
    if (w.s && w.s.id !== G.core) crumb(w.s.name || w.s.title, function () { location.hash = w.s.id; }, w.s.color, !w.p);
    if (w.p) crumb(w.p.name || w.p.title, function () { open(w.p, false); }, w.p.color, true);
  }
  function setFocus(id) { focusCl = id; stage.dataset.focus = id || ""; }
  var legend = document.getElementById("legend");
  clusters.forEach(function (c) {
    var n = seq.filter(function (s) { return s.cluster === c.id; }).length;
    var li = h("li"), b = h("button", "legend__item"); b.type = "button"; b.style.setProperty("--c", c.color);
    b.appendChild(h("i", "swatch")); b.appendChild(h("span", null, c.name)); b.appendChild(h("span", "n", String(n)));
    b.addEventListener("mouseenter", function () { setFocus(c.id); }); b.addEventListener("mouseleave", function () { setFocus(null); });
    b.addEventListener("focus", function () { setFocus(c.id); }); b.addEventListener("blur", function () { setFocus(null); });
    b.addEventListener("click", function () { closeCard(); skipIntro(); flyTo(clusterView(c)); });
    li.appendChild(b); legend.appendChild(li);
  });
  document.getElementById("zoom-in").addEventListener("click", function () { zoomAt(W / 2, H / 2, 1.6); });
  document.getElementById("zoom-out").addEventListener("click", function () { zoomAt(W / 2, H / 2, 1 / 1.6); });
  document.getElementById("zoom-home").addEventListener("click", function () { closeCard(); skipIntro(); flyTo(homeView()); });
  document.getElementById("home-link").addEventListener("click", function (e) { e.preventDefault(); toggleIndex(false); closeCard(); skipIntro(); flyTo(homeView()); if (location.hash) history.replaceState(null, "", location.pathname + location.search); });
  function zoomOut() {
    var w = where();
    if (w.s) { var c = clusterOf(w.s); flyTo(c ? clusterView(c) : homeView()); }
    else if (w.c) flyTo(homeView());
    else zoomAt(W / 2, H / 2, 1 / 1.6);
  }
  var miniMap = null;
  function drawMini() {
    if (narrow()) return;
    var mw = mini.width / dpr, mh = mini.height / dpr, bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0, s = Math.min((mw - 14) / bw, (mh - 14) / bh);
    var ox = (mw - bw * s) / 2 - bounds.x0 * s, oy = (mh - bh * s) / 2 - bounds.y0 * s;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.clearRect(0, 0, mw, mh);
    clusters.forEach(function (c) { var g = mctx.createRadialGradient(ox + c.cx * s, oy + c.cy * s, 0, ox + c.cx * s, oy + c.cy * s, c.R * s); g.addColorStop(0, rgba(c.color, 0.35)); g.addColorStop(1, rgba(c.color, 0)); mctx.fillStyle = g; mctx.fillRect(0, 0, mw, mh); });
    stars.forEach(function (st) { mctx.fillStyle = rgba(st.color, st === active || (active && active.parent === st) ? 1 : 0.8); var r = st.weight >= 4 ? 1.8 : 1.1; mctx.beginPath(); mctx.arc(ox + st.x * s, oy + st.y * s, r, 0, 6.283); mctx.fill(); });
    var vx = ox + (cam.x - W / 2 / cam.z) * s, vy = oy + (cam.y - H / 2 / cam.z) * s, vw = W / cam.z * s, vh = H / cam.z * s;
    mctx.strokeStyle = "rgba(237,233,226,0.75)"; mctx.lineWidth = 1; mctx.strokeRect(clamp(vx, 0.5, mw - 2), clamp(vy, 0.5, mh - 2), Math.max(2, Math.min(mw - 1, vw)), Math.max(2, Math.min(mh - 1, vh)));
    miniMap = { s: s, ox: ox, oy: oy };
  }
  mini.addEventListener("click", function (e) { if (!miniMap) return; var r = mini.getBoundingClientRect(); skipIntro(); flyTo({ x: (e.clientX - r.left - miniMap.ox) / miniMap.s, y: (e.clientY - r.top - miniMap.oy) / miniMap.s, z: Math.max(camT.z, 0.35) }); });

  /* ---------- the index: every body as a table ---------- */
  var indexBody = document.getElementById("index-body"), search = document.getElementById("index-search"), filters = document.getElementById("index-filters");
  var sortKey = "map", sortDir = 1, onlyCl = null, rows = {};
  var table = h("table", "tbl"), thead = h("thead"), tbody = h("tbody"), hr = h("tr");
  [["title", L.colName], ["cluster", L.colDomain], ["part", L.colPart], ["year", L.colWhen], ["kind", L.colKind]].forEach(function (col) {
    var th = h("th"); th.scope = "col"; th.className = "c-" + col[0];
    var b = h("button", "sort", col[1]); b.type = "button"; b.dataset.key = col[0];
    b.addEventListener("click", function () { if (sortKey === col[0]) sortDir = -sortDir; else { sortKey = col[0]; sortDir = col[0] === "year" ? -1 : 1; } renderRows(); });
    th.appendChild(b); hr.appendChild(th);
  });
  thead.appendChild(hr); table.appendChild(thead); table.appendChild(tbody); indexBody.appendChild(table);
  seq.forEach(function (s) {
    var tr = h("tr", "row" + (s.planet ? " row--planet" : "") + (s.kind === "interest" ? " row--interest" : "")); tr.style.setProperty("--c", s.color); tr.dataset.id = s.id;
    var td1 = h("td", "c-title"), a = h("a", "index__item"); a.href = "#" + s.id;
    a.appendChild(h("span", "t", s.title)); if (s.short && s.short !== "Interest") a.appendChild(h("span", "s", s.short));
    a.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { toggleIndex(false); return; } /* opens elsewhere, no card here */
      var keyboard = e.detail === 0;
      if (!keyboard) a.blur();
      toggleIndex(false, true); if (location.hash === "#" + s.id) open(s, keyboard); else indexPick = keyboard;
    });
    td1.appendChild(a); tr.appendChild(td1);
    var td2 = h("td", "c-cluster"); td2.appendChild(h("i", "swatch")); td2.appendChild(h("span", null, nameOf(s))); tr.appendChild(td2);
    tr.appendChild(h("td", "c-part", s.planet ? s.parent.title : (s.planets.length ? s.planets.length + " planets" : "")));
    tr.appendChild(h("td", "c-year", s.kind === "interest" ? "—" : (s.when || "")));
    tr.appendChild(h("td", "c-kind", KINDS[s.kind] || ""));
    tr.addEventListener("click", function (e) {
      if (e.target.closest("a")) return;
      toggleIndex(false, true); if (location.hash === "#" + s.id) open(s, false); else location.hash = s.id;
    });
    rows[s.id] = tr;
    s.text = [s.title, s.short, s.meta, s.when, plain(s.line), plain((s.facts || []).join(" ")), s.tech, nameOf(s), s.planet ? s.parent.title : "", KINDS[s.kind]].join(" ").toLowerCase();
  });
  var fAll = h("button", "filter is-on", L.all); fAll.type = "button"; fAll.setAttribute("aria-pressed", "true");
  fAll.addEventListener("click", function () { onlyCl = null; renderRows(); }); filters.appendChild(fAll);
  clusters.forEach(function (c) {
    var b = h("button", "filter"); b.type = "button"; b.style.setProperty("--c", c.color); b.dataset.cluster = c.id; b.setAttribute("aria-pressed", "false");
    b.appendChild(h("i", "swatch")); b.appendChild(h("span", null, c.name));
    b.addEventListener("click", function () { onlyCl = onlyCl === c.id ? null : c.id; renderRows(); }); filters.appendChild(b);
  });
  search.addEventListener("input", renderRows);
  function sortVal(s) {
    if (sortKey === "title") return s.title.toLowerCase();
    if (sortKey === "cluster") return (s.cluster ? clusterById[s.cluster].i : -1) * 1000 + s.seq;
    if (sortKey === "part") return (s.planet ? s.parent.title : s.title).toLowerCase() + (s.planet ? " " + s.i : "");
    if (sortKey === "year") return s.year == null ? -1 : s.year;
    if (sortKey === "kind") return (KINDS[s.kind] || "") + " " + s.title.toLowerCase();
    return s.seq;
  }
  function renderRows() {
    var q = search.value.trim().toLowerCase(), list = seq.slice(), shown = 0;
    if (sortKey !== "map") list.sort(function (a, b) { var x = sortVal(a), y = sortVal(b); return (x < y ? -1 : x > y ? 1 : a.seq - b.seq) * (x === y ? 1 : sortDir); });
    list.forEach(function (s) {
      var tr = rows[s.id], ok = (!onlyCl || s.cluster === onlyCl) && (!q || s.text.indexOf(q) >= 0);
      tr.hidden = !ok; tr.classList.toggle("is-flat", sortKey !== "map"); if (ok) shown++;
      tbody.appendChild(tr);
    });
    table.querySelectorAll(".sort").forEach(function (b) { var on = b.dataset.key === sortKey; b.classList.toggle("is-on", on); b.setAttribute("aria-sort", on ? (sortDir > 0 ? "ascending" : "descending") : "none"); b.parentNode.setAttribute("aria-sort", on ? (sortDir > 0 ? "ascending" : "descending") : "none"); });
    filters.querySelectorAll(".filter").forEach(function (b) { var on = (b.dataset.cluster || null) === onlyCl; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    document.getElementById("index-count").textContent = shown === seq.length ? seq.length + " bodies in " + clusters.length + " domains and the core" : shown + " of " + seq.length;
  }
  var mapOrder = document.getElementById("index-map-order");
  mapOrder.addEventListener("click", function () { sortKey = "map"; sortDir = 1; renderRows(); });
  renderRows();
  var indexOpener = null;
  function toggleIndex(force, keepFocus) {
    var toggle = document.getElementById("index-toggle"), was = index.getAttribute("data-on") === "true", on = typeof force === "boolean" ? force : !was;
    if (on === was) return;
    panelFocus(index, on); index.setAttribute("data-on", on ? "true" : "false"); toggle.setAttribute("aria-expanded", on ? "true" : "false");
    if (on) { hidePeek(true); skipIntro(); indexOpener = document.activeElement; var first = narrow() ? index.querySelector("#index-close") : search; if (first) first.focus(); }
    else if (!keepFocus) {
      if (!indexOpener || index.contains(indexOpener) || (card.contains(indexOpener) && !active)) indexOpener = toggle;
      indexOpener.focus({ preventScroll: true });
      if (document.activeElement !== indexOpener || indexOpener === document.body) (active ? card.querySelector(".card__close") : toggle).focus({ preventScroll: true });
    }
  }
  document.getElementById("index-toggle").addEventListener("click", function () { toggleIndex(); });
  document.getElementById("index-close").addEventListener("click", function () { toggleIndex(false); });

  /* ---------- input: drag, wheel, pinch, keys ---------- */
  var pointers = new Map(), last = null, down = null, dragged = false, pinch = null, pointerDown = false;
  stage.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".hud, .card, .index, #minimap, .peek")) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); pointerDown = true;
    if (pointers.size === 1) { down = { x: e.clientX, y: e.clientY, t: performance.now() }; last = down; dragged = false; }
    else if (pointers.size === 2) { var p = Array.from(pointers.values()); pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), z: camT.z }; dragged = true; }
  });
  stage.addEventListener("pointermove", function (e) {
    if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) { var p = Array.from(pointers.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); zoomAt((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, (pinch.z * d / pinch.d) / camT.z); return; }
    if (!down) return;
    if (!dragged && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { dragged = true; stage.classList.add("is-drag"); hidePeek(true); hot = null; skipIntro(); try { stage.setPointerCapture(e.pointerId); } catch (err) {} }
    if (dragged) { settle(); camT.x -= (e.clientX - last.x) / cam.z; camT.y -= (e.clientY - last.y) / cam.z; cam.x = camT.x; cam.y = camT.y; cam.z = camT.z; touched = true; }
    last = { x: e.clientX, y: e.clientY };
  });
  function up(e) {
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { var wasDrag = dragged; down = null; pointerDown = false; stage.classList.remove("is-drag"); setTimeout(function () { dragged = false; }, 0); if (!wasDrag && !e.target.closest(".body, .cl, .hud, .card, .index, #minimap, .peek") && active) closeCard(); }
  }
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up); window.addEventListener("pointerup", function (e) { if (pointers.has(e.pointerId)) up(e); });
  stage.addEventListener("wheel", function (e) {
    if (e.target.closest(".card, .index, .peek")) return; e.preventDefault(); hidePeek(true);
    var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; zoomAt(e.clientX, e.clientY, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)));
  }, { passive: false });
  stage.addEventListener("dblclick", function (e) { if (e.target.closest(".body, .cl, .hud, .card, .index, .peek")) return; zoomAt(e.clientX, e.clientY, 2); });
  document.addEventListener("keydown", function (e) {
    var typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (e.key === "Escape") { if (index.getAttribute("data-on") === "true") toggleIndex(false); else if (active) { closeCard(); } else if (!typing) zoomOut(); return; }
    if (e.key === "Tab" && index.getAttribute("data-on") === "true") {
      var items = Array.prototype.filter.call(index.querySelectorAll("a[href], button, input"), function (el) { return el.offsetParent !== null || el === document.activeElement; });
      var at = Math.max(items.indexOf(document.activeElement), e.shiftKey ? 0 : -1);
      e.preventDefault(); items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus(); return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    skipIntro();
    if (e.key === "i" || e.key === "I") { e.preventDefault(); toggleIndex(); }
    else if (e.key === "+" || e.key === "=") zoomAt(W / 2, H / 2, 1.5);
    else if (e.key === "-" || e.key === "_") zoomAt(W / 2, H / 2, 1 / 1.5);
    else if (e.key === "0") { closeCard(); flyTo(homeView()); }
    else if ((e.key === "]" || e.key === "[") && !e.target.closest(".index")) { var cur = active || (hot) || seq[0], nb = seq[(cur.seq + (e.key === "]" ? 1 : -1) + seq.length) % seq.length]; if (active || hot) location.hash = nb.id; else location.hash = cur.id; }
    else if (e.key.indexOf("Arrow") === 0 && !e.target.closest(".card, .index")) { e.preventDefault(); settle(); var st = 80 / camT.z; if (e.key === "ArrowLeft") camT.x -= st; if (e.key === "ArrowRight") camT.x += st; if (e.key === "ArrowUp") camT.y -= st; if (e.key === "ArrowDown") camT.y += st; touched = true; }
  });

  /* ---------- the entrance ---------- */
  var born = performance.now(), introOn = !reduced && !location.hash && qs.get("intro") !== "0", introT0 = born, introDone = !introOn;
  function introE(now) { return introDone ? 1 : clamp((now - introT0) / 2800, 0, 1); }
  function skipIntro() {
    if (introDone) return; introDone = true; intro.setAttribute("data-on", "false"); document.body.classList.add("is-in");
  }

  /* ---------- the loop ---------- */
  var clock = 0, lastNow = born, lastCrumbAt = 0;
  function frame(now) {
    var dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now; clock += dt;
    if (flight) {
      var u = clamp((now - flight.t0) / flight.dur, 0, 1), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2, v = flight.f(e);
      cam = { x: v[0], y: v[1], z: flight.span / v[2] };
      if (u >= 1) { cam = { x: flight.to.x, y: flight.to.y, z: flight.to.z }; flight = null; }
    } else {
      var k = reduced ? 1 : 1 - Math.exp(-dt * 14);
      cam.x += (camT.x - cam.x) * k; cam.y += (camT.y - cam.y) * k; cam.z = Math.exp(Math.log(cam.z) + (Math.log(camT.z) - Math.log(cam.z)) * k);
    }
    focusAmt += ((focusCl ? 1 : 0) - focusAmt) * (reduced ? 1 : 1 - Math.exp(-dt * 8));
    var ie = introE(now);
    if (!introDone && ie >= 1 && now - introT0 > 3900) skipIntro();
    planetsAt(clock);
    visibility();
    if (skyGL) skyGL.draw(clock, ie, focusCl ? clusterById[focusCl].i : (focusAmt > 0.01 ? lastFocusI : -1), focusAmt);
    if (focusCl) lastFocusI = clusterById[focusCl].i;
    drawFx(clock, ie);
    place();
    if (peekFor && peek.getAttribute("data-on") === "true") positionPeek();
    drawOrbitPeek(clock);
    if (now - lastCrumbAt > 250) { lastCrumbAt = now; updateCrumbs(false); }
    drawMini();
    requestAnimationFrame(frame);
  }
  var lastFocusI = -1;

  /* ---------- go ---------- */
  resize(); layout(); build();
  mini.width = Math.round(184 * dpr); mini.height = Math.round(132 * dpr);
  var start = homeView(); camT = { x: start.x, y: start.y, z: start.z };
  if (introOn) {
    cam = { x: start.x * 0.6, y: start.y * 0.6, z: start.z * 1.3 }; intro.setAttribute("data-on", "true");
    flight = { f: zoomPath([cam.x, cam.y, Math.min(W, H) / cam.z], [start.x, start.y, Math.min(W, H) / start.z]), t0: born, dur: 3200, span: Math.min(W, H), to: { x: start.x, y: start.y, z: start.z } };
  } else { cam = { x: start.x, y: start.y, z: start.z }; document.body.classList.add("is-in"); }
  var wasNarrow = narrow();
  window.addEventListener("resize", function () {
    resize();
    if (narrow() !== wasNarrow) { wasNarrow = narrow(); layout(); els && Object.keys(els).forEach(function (id) { els[id].w = 0; }); }
    if (!touched) { var v = homeView(); camT = v; cam = { x: v.x, y: v.y, z: v.z }; flight = null; }
    else if (active) { var av = viewFor(active); camT = av; cam = { x: av.x, y: av.y, z: av.z }; flight = null; }
  });
  if (qs.get("z")) { var fz = clampZ(parseFloat(qs.get("z")) || camT.z); camT.z = cam.z = fz; flight = null; touched = true; skipIntro(); }
  if (qs.get("x") || qs.get("y")) { camT.x = cam.x = parseFloat(qs.get("x") || "0"); camT.y = cam.y = parseFloat(qs.get("y") || "0"); flight = null; touched = true; skipIntro(); }
  if (qs.get("cluster") && clusterById[qs.get("cluster")]) { skipIntro(); var cv = clusterView(clusterById[qs.get("cluster")]); camT = cv; cam = { x: cv.x, y: cv.y, z: cv.z }; flight = null; touched = true; }
  if (qs.get("at") && byId[qs.get("at")]) { skipIntro(); var atv = viewFor(byId[qs.get("at")]); camT = atv; cam = { x: atv.x, y: atv.y, z: atv.z }; flight = null; touched = true; }
  if (qs.get("index") === "1") toggleIndex(true);
  document.fonts && document.fonts.ready.then(function () { Object.keys(els).forEach(function (id) { els[id].w = 0; }); });
  requestAnimationFrame(frame);
  window.__galaxy = function () { return { bodies: bodies, stars: stars, clusters: clusters, cam: cam, camT: camT, hot: hot && hot.id, active: active && active.id, peek: peekFor && peek.getAttribute("data-on") === "true" ? peekFor.id : null, flying: !!flight, where: where(), pointers: pointers.size, pinch: !!pinch, touched: touched, W: W, H: H, gl: !!skyGL, toScreen: toScreen }; };
  onHash();
  if (qs.get("hover") && byId[qs.get("hover")]) { skipIntro(); setTimeout(function () { hot = byId[qs.get("hover")]; showPeek(hot); }, 60); }
  var hint = document.getElementById("hint");
  if (hint) {
    hint.textContent = (hoverable ? G.site.hint.pointer : G.site.hint.touch) || "";
    var hideHint = function () { hint.setAttribute("data-on", "false"); }; setTimeout(hideHint, 14000); stage.addEventListener("pointerdown", hideHint, { once: true }); stage.addEventListener("wheel", hideHint, { once: true });
  }
};
