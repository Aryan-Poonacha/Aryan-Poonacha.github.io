/* The content model, shared by the editor and by Node tools: the key order of every object, cleaning,
   the JSON layout of content/galaxy.json, and the checks run before a save.
   Loaded by the site (js/content.js) and the editor (admin/) as window.GalaxySchema; in Node, require("./schema.js"). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GalaxySchema = factory();
})(this, function () {
  "use strict";
  var TOP = ["site", "kinds", "path", "core", "domains", "connections"];
  var SITE = ["name", "tagline", "pageTitle", "description", "socialImage", "socialHandle", "intro", "hint", "links", "moreLinks", "indexTitle", "labels", "card"];
  var DOMAIN = ["id", "name", "color", "angle", "heart", "blurb", "hidden", "notes", "stars"];
  var BODY = ["id", "kind", "title", "mapLabel", "mapNote", "when", "year", "subtitle", "size", "summary", "body", "builtWith",
    "media", "links", "reviewed", "hidden", "notes", "planets"];
  var MEDIA = {
    video: ["type", "src", "poster", "caption"],
    image: ["type", "src", "square", "caption"],
    book: ["type", "title", "author", "caption"],
    quote: ["type", "quote", "cite"]
  };
  /* the sections a card can show, in their default order */
  var HOVER = ["kicker", "title", "subtitle", "summary", "firstParagraph", "builtWith", "links", "hint"];
  var DETAIL = ["media", "meta", "title", "summary", "body", "builtWith", "links", "system", "connections", "steps"];
  var LABELS = {
    galaxy: "Galaxy", core: "Core", close: "Close ×",
    system: "In this system", systemOf: "The {star} system", near: "Where it meets", builtWith: "Built with",
    previous: "← Previous", next: "Next →",
    hoverSystem: "Click to enter its system · {n} worlds", hoverPlanet: "Click to open · part of {star}", hoverStar: "Click to open",
    colName: "Name", colDomain: "Domain", colPart: "Part of", colWhen: "When", colKind: "Kind", all: "All", mapOrder: "Map order",
    find: "Find", findPlaceholder: "A project, a year, a tool…"
  };
  var ID = /^[a-z0-9][a-z0-9-]*$/, COLOR = /^#[0-9a-fA-F]{6}$/;

  function isEmpty(v) { return v == null || v === "" || v === false || (Array.isArray(v) && !v.length); }
  function trim(v) { return typeof v === "string" ? v.trim() : v; }
  /* the known keys first, in order, then anything else; empty values and _ui keys are dropped, except the
     arrays named in keep, which hold the structure (domains, a domain's stars) even when empty */
  function pick(o, keys, keep) {
    var out = {};
    keys.forEach(function (k) { var v = trim(o[k]); if (!isEmpty(v) || (keep && keep.indexOf(k) >= 0 && Array.isArray(v))) out[k] = v; });
    Object.keys(o).forEach(function (k) { var v = trim(o[k]); if (keys.indexOf(k) < 0 && k.charAt(0) !== "_" && !isEmpty(v)) out[k] = v; });
    return out;
  }
  function links(list) {
    return (list || []).map(function (l) { return pick(l || {}, ["label", "url"]); }).filter(function (l) { return l.url || l.label; });
  }
  function num(v) { if (v === "" || v == null) return undefined; var n = Number(v); return isFinite(n) ? n : undefined; }
  function media(m) {
    if (!m || !m.type || !MEDIA[m.type]) return undefined;
    var out = pick(m, MEDIA[m.type]);
    Object.keys(out).forEach(function (k) { if (MEDIA[m.type].indexOf(k) < 0) delete out[k]; });
    return out;
  }
  function body(b, planet) {
    var o = {};
    Object.keys(b || {}).forEach(function (k) { o[k] = b[k]; });
    o.year = num(o.year);
    o.size = planet ? undefined : num(o.size);
    o.body = (o.body || []).map(trim).filter(Boolean);
    o.links = links(o.links);
    o.media = media(o.media);
    o.planets = planet ? undefined : (o.planets || []).map(function (p) { return body(p, true); });
    return pick(o, BODY);
  }
  function site(s) {
    s = s || {};
    var o = pick(s, SITE);
    if (s.intro) o.intro = pick(s.intro, ["kicker", "line"]);
    if (s.hint) o.hint = pick(s.hint, ["pointer", "touch"]);
    o.links = links(s.links); o.moreLinks = links(s.moreLinks);
    if (s.labels) { o.labels = pick(s.labels, Object.keys(LABELS)); }
    /* an empty card section list is a choice (show nothing), so it is kept */
    if (s.card) o.card = { hover: (s.card.hover || []).slice(), detail: (s.card.detail || []).slice() };
    return pick(o, SITE);
  }
  function normalize(c) {
    c = c || {};
    return pick({
      site: site(c.site),
      kinds: c.kinds ? pick(c.kinds, Object.keys(c.kinds)) : undefined,
      path: (c.path || []).filter(Boolean),
      core: c.core ? body(c.core, false) : undefined,
      domains: (c.domains || []).map(function (d) {
        var o = {}; Object.keys(d).forEach(function (k) { o[k] = d[k]; });
        o.angle = num(o.angle);
        o.stars = (d.stars || []).map(function (s) { return body(s, false); });
        return pick(o, DOMAIN, ["stars"]);
      }),
      connections: (c.connections || []).filter(function (p) { return p && p[0] && p[1] && p[0] !== p[1]; }).map(function (p) { return [p[0], p[1]]; })
    }, TOP, ["domains"]);
  }

  /* JSON with short arrays and small objects on one line, so a diff shows what changed */
  var WIDTH = 116;
  function layout(v, ind) {
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      if (v.every(function (x) { return x === null || typeof x !== "object" || (Array.isArray(x) && x.every(function (y) { return typeof y !== "object"; })); })) {
        var line = "[" + v.map(function (x) { return layout(x, ""); }).join(", ") + "]";
        if (line.length + ind.length <= WIDTH && !v.some(Array.isArray)) return line;
      }
      return "[\n" + v.map(function (x) { return ind + "  " + layout(x, ind + "  "); }).join(",\n") + "\n" + ind + "]";
    }
    if (v && typeof v === "object") {
      var keys = Object.keys(v);
      if (!keys.length) return "{}";
      if (keys.every(function (k) { return v[k] === null || typeof v[k] !== "object"; })) {
        var one = "{ " + keys.map(function (k) { return JSON.stringify(k) + ": " + JSON.stringify(v[k]); }).join(", ") + " }";
        if (one.length + ind.length <= WIDTH) return one;
      }
      return "{\n" + keys.map(function (k) { return ind + "  " + JSON.stringify(k) + ": " + layout(v[k], ind + "  "); }).join(",\n") + "\n" + ind + "}";
    }
    return JSON.stringify(v);
  }
  function format(c) { return layout(normalize(c), "") + "\n"; }

  /* every body with where it sits: the core, its planets, each domain's stars and their planets */
  function walk(c, fn) {
    if (c.core) {
      fn(c.core, { core: true, list: null, domain: null, parent: null });
      (c.core.planets || []).forEach(function (p, i) { fn(p, { planet: true, list: c.core.planets, index: i, domain: null, parent: c.core }); });
    }
    (c.domains || []).forEach(function (d) {
      (d.stars || []).forEach(function (s, i) {
        fn(s, { star: true, list: d.stars, index: i, domain: d, parent: null });
        (s.planets || []).forEach(function (p, j) { fn(p, { planet: true, list: s.planets, index: j, domain: d, parent: s }); });
      });
    });
  }
  /* a link may be web, mail or phone, or relative to the site; parsed as a browser would, so hidden tabs or control
     characters cannot turn it into javascript: */
  function safeUrl(u) {
    try { return /^(https?|mailto|tel):$/.test(new URL(String(u || "").trim(), "https://site.invalid/").protocol); } catch (e) { return false; }
  }
  var INLINE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

  /* errors break the map or a link; warnings are content that needs work */
  function check(c) {
    var out = [], seen = {}, ids = {};
    function add(level, where, field, msg) { out.push({ level: level, id: where, field: field, msg: msg }); }
    if (!c.core) add("error", null, "core", "There is no centre star.");
    (c.domains || []).forEach(function (d) {
      if (!d.id || !ID.test(d.id)) add("error", "domain:" + (d.id || "?"), "id", "Domain ID must be lowercase letters, digits and dashes.");
      if (d.id && seen[d.id]) add("error", "domain:" + d.id, "id", "Another item already uses the ID “" + d.id + "”.");
      seen[d.id] = true;
      if (!trim(d.name)) add("error", "domain:" + d.id, "name", "The domain needs a name.");
      if (!COLOR.test(d.color || "")) add("error", "domain:" + d.id, "color", "Colour must look like #F2A541.");
      if (!(d.stars || []).some(function (s) { return !s.hidden; })) add("warn", "domain:" + d.id, "stars", "No visible stars, so this domain is not on the map.");
      else if (d.heart && !(d.stars || []).some(function (s) { return s.id === d.heart && !s.hidden; })) add("warn", "domain:" + d.id, "heart", "The heart star is not a visible star of this domain; the first star is used.");
      if (!trim(d.blurb)) add("warn", "domain:" + d.id, "blurb", "No blurb: it shows when the domain is hovered and zoomed into.");
    });
    walk(c, function (b, at) {
      var id = b.id;
      if (!id || !ID.test(id)) add("error", id || null, "id", "ID must be lowercase letters, digits and dashes.");
      else if (seen[id]) add("error", id, "id", "Another item already uses the ID “" + id + "”.");
      seen[id] = true; ids[id] = b;
      if (!trim(b.title)) add("error", id, "title", "Every card needs a title.");
      if (b.year != null && b.year !== "" && !isFinite(Number(b.year))) add("warn", id, "year", "The year must be a number, like 2024; it is dropped otherwise.");
      if (c.kinds && b.kind && !c.kinds[b.kind]) add("warn", id, "kind", "The kind “" + b.kind + "” has no label in Kinds.");
      [b.summary].concat(b.body || []).forEach(function (t) {
        String(t || "").replace(INLINE, function (m, words, url) { if (!safeUrl(url)) add("error", id, url && t === b.summary ? "summary" : "body", "The link “" + words + "” uses a blocked address type."); return m; });
      });
      (b.links || []).forEach(function (l, i) {
        if (!trim(l.url)) add("warn", id, "links", "Link " + (i + 1) + " has no address.");
        else if (!safeUrl(l.url)) add("error", id, "links", "Link " + (i + 1) + " uses a blocked address type.");
        if (!trim(l.label)) add("warn", id, "links", "Link " + (i + 1) + " has no label.");
      });
      var m = b.media;
      if (m && (m.type === "video" || m.type === "image") && !trim(m.src)) add("error", id, "media", "The " + m.type + " has no file.");
      if (m && m.type === "quote" && !trim(m.quote)) add("warn", id, "media", "The quote is empty.");
      if (b.kind !== "interest" && !trim(b.summary)) add("warn", id, "summary", "No summary: the hover card and the card open with it.");
      if ((trim(b.summary) || "").length > 240) add("warn", id, "summary", "The summary is long for a hover card (over 240 characters).");
      var label = trim(b.mapLabel) || trim(b.title) || "";
      if (label.length > 30) add("warn", id, "mapLabel", "Long on the map; a shorter map label reads better.");
      if (at.star && (b.size || 2) >= 4 && !(b.body || []).length && !(b.planets || []).length) add("warn", id, "body", "A bright star with no detail beyond its summary.");
    });
    (c.connections || []).forEach(function (p) {
      if (!ids[p[0]] || !ids[p[1]]) add("error", "connections", "connections", "A connection points at a missing card: " + p[0] + " ↔ " + p[1] + ".");
    });
    (c.path || []).forEach(function (id) { if (!ids[id]) add("error", "path", "path", "The highlighted path names a missing card: " + id + "."); });
    return out;
  }
  function slug(s) {
    return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "card";
  }
  return {
    normalize: normalize, format: format, check: check, walk: walk, slug: slug, safeUrl: safeUrl,
    HOVER: HOVER, DETAIL: DETAIL, LABELS: LABELS, ID: ID, COLOR: COLOR, MEDIA: MEDIA
  };
});
