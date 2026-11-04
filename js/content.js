/* Loads the content and starts the map. Everything the site says lives in content/galaxy.json, written by the
   editor at /admin/ (or by hand; see content/README.md). With ?draft=1 the editor's unsaved draft is shown. */
(function () {
  "use strict";
  var S = window.GalaxySchema, qs = new URLSearchParams(location.search);
  var PALETTE = ["#F2A541", "#78A2FF", "#7BD88F", "#B596FF", "#5FD0E0", "#EE6C5A"];

  function draft() { try { var d = localStorage.getItem("galaxy:draft" + (qs.get("editor") ? ":" + qs.get("editor") : "")); return d ? JSON.parse(d) : null; } catch (e) { return null; } }
  function load() {
    if (qs.get("draft") === "1") {
      if (qs.get("editor") && window.parent !== window) return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { window.removeEventListener("message", receive); reject(new Error("The draft preview timed out. Reload it from the admin.")); }, 5000);
        function receive(e) {
          if (e.origin !== location.origin || e.source !== window.parent || !e.data || e.data.type !== "galaxy-draft") return;
          clearTimeout(timer); window.removeEventListener("message", receive); resolve(e.data.doc);
        }
        window.addEventListener("message", receive);
        window.parent.postMessage({ type: "galaxy-draft-ready" }, location.origin);
      });
      if (draft()) return Promise.resolve(draft());
      if (qs.get("editor")) return Promise.reject(new Error("This draft preview is no longer available. Open it again from the admin."));
    }
    return fetch("content/galaxy.json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("content/galaxy.json: HTTP " + r.status);
      return r.text();
    }).then(function (t) {
      try { return JSON.parse(t); } catch (e) { throw new Error("content/galaxy.json is not valid JSON: " + e.message); }
    });
  }

  /* the file's shape (domains holding stars holding planets) into the map's flat model */
  function shape(c) {
    c = S.normalize(c);
    var site = c.site || {}, labels = {}, seen = {}, isBody = {};
    Object.keys(S.LABELS).forEach(function (k) { labels[k] = (site.labels && site.labels[k]) || S.LABELS[k]; });
    function links(list) {
      return (list || []).filter(function (l) { return l.url && S.safeUrl(l.url); }).map(function (l) { return [l.label || l.url, l.url]; });
    }
    function media(m) {
      if (!m) return null;
      if (m.type === "video" && m.src) return { video: m.src, poster: m.poster, caption: m.caption };
      if (m.type === "image" && m.src) return { image: m.src, square: !!m.square, caption: m.caption };
      if (m.type === "book") return { book: true, bookTitle: m.title || "", bookAuthor: m.author || "", caption: m.caption };
      if (m.type === "quote" && m.quote) return { quote: m.quote, cite: m.cite };
      return null;
    }
    function body(b, cluster, planet) {
      if (!b || b.hidden || !b.id || seen[b.id]) return null;
      seen[b.id] = isBody[b.id] = true;
      var o = { id: b.id, kind: b.kind || "work", title: b.title || b.id, year: b.year == null ? null : b.year, when: b.when || "",
        meta: b.subtitle || "", line: b.summary || "", facts: b.body || [], tech: b.builtWith || "", links: links(b.links), media: media(b.media) };
      if (b.mapLabel) o.name = b.mapLabel;
      if (b.mapNote) o.short = b.mapNote;
      if (!planet) {
        o.cluster = cluster; o.weight = Math.max(1, Math.min(5, Math.round(b.size || 2)));
        o.system = (b.planets || []).map(function (p) { return body(p, cluster, true); }).filter(Boolean);
      }
      return o;
    }
    var core = body(c.core, null, false);
    if (!core) throw new Error("content/galaxy.json has no centre star (core).");
    var stars = [core], clusters = [], domains = (c.domains || []).filter(function (d) { return !d.hidden; });
    domains.forEach(function (d, i) {
      if (!d.id || seen[d.id]) return;
      var list = (d.stars || []).map(function (s) { return body(s, d.id, false); }).filter(Boolean);
      if (!list.length) return;
      seen[d.id] = true;
      clusters.push({ id: d.id, name: d.name || d.id, color: S.COLOR.test(d.color || "") ? d.color : PALETTE[i % PALETTE.length],
        angle: d.angle != null ? d.angle : -90 + i * 360 / domains.length, blurb: d.blurb || "",
        core: list.some(function (s) { return s.id === d.heart; }) ? d.heart : list[0].id });
      stars = stars.concat(list);
    });
    var pairs = {}, edges = (c.connections || []).filter(function (p) {
      var key = [p[0], p[1]].sort().join(" ");
      if (!isBody[p[0]] || !isBody[p[1]] || pairs[key]) return false;
      return (pairs[key] = true);
    });
    var card = site.card || {};
    return {
      kinds: c.kinds || {}, core: core.id, clusters: clusters, stars: stars, edges: edges,
      path: (c.path || []).filter(function (id) { return isBody[id]; }),
      site: {
        name: site.name || "", tagline: site.tagline || "", pageTitle: site.pageTitle, description: site.description, socialImage: site.socialImage, socialHandle: site.socialHandle, intro: site.intro || {}, hint: site.hint || {}, indexTitle: site.indexTitle || "",
        links: links(site.links), moreLinks: links(site.moreLinks), labels: labels,
        card: { hover: card.hover || S.HOVER, detail: card.detail || S.DETAIL }
      }
    };
  }

  /* the words around the map */
  function text(sel, t) { var el = document.querySelector(sel); if (el) el.textContent = t || ""; }
  function linkList(el, list, arrows) {
    if (!el) return;
    el.textContent = "";
    list.forEach(function (l) {
      var a = document.createElement("a"), ext = /^https?:/.test(l[1]);
      a.href = l[1]; a.textContent = l[0] + (arrows && ext ? " ↗" : "");
      el.appendChild(a);
    });
  }
  function applySite(s) {
    document.title = s.pageTitle || s.name;
    function meta(selector, value) { var e = document.querySelector(selector); if (e) e.setAttribute("content", value || ""); }
    meta('meta[name="description"]', s.description || s.tagline);
    meta('meta[property="og:title"]', s.pageTitle || s.name);
    meta('meta[property="og:description"]', s.description || s.tagline);
    text(".brand h1 a", s.name); text(".brand .label", s.tagline);
    text(".intro__name", s.name); text(".intro__kicker", s.intro.kicker); text(".intro__line", s.intro.line);
    text("#index-title", s.indexTitle || "Every star, as a table");
    text(".index__search .label", s.labels.find); text("#index-map-order", s.labels.mapOrder);
    var find = document.getElementById("index-search"); if (find) find.placeholder = s.labels.findPlaceholder;
    linkList(document.querySelector(".hud.elsewhere"), s.links, false);
    linkList(document.querySelector(".index__links"), s.links.concat(s.moreLinks), true);
  }
  function fail(e) {
    var p = document.createElement("p"); p.className = "load-error";
    p.textContent = "The map could not load. " + (e && e.message ? e.message : e);
    document.body.appendChild(p);
    if (window.console) console.error(e);
  }

  load().then(function (c) {
    var G = shape(c);
    applySite(G.site);
    window.startGalaxy(G);
  }).catch(fail);
})();
