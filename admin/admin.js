/* The content editor. It loads content/galaxy.json, edits it here, shows the real site with the draft beside it,
   and saves to this checkout (when python3 tools/edit.py serves it), to a GitHub branch, or as a file.
   Unsaved work stays in this browser until it is saved or discarded. No dependencies. */
(function () {
  "use strict";
  var S = window.GalaxySchema;
  var SITE = new URL("../", location.href).href;
  var PREVIEW = new URL("galaxy.html", SITE).href;
  var P = window.PortfolioPublishing;
  function newTabId() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2); }
  var draftId = newTabId();
  try {
    draftId = sessionStorage.getItem("galaxy:admin:preview-id") || draftId;
    sessionStorage.setItem("galaxy:admin:preview-id", draftId);
  } catch (e) { /* the iframe still receives drafts by message */ }
  window.addEventListener("pagehide", function () { store(KEY.draft + ":" + draftId, undefined); });
  var KEY = { work: "galaxy:admin:work:" + draftId, draft: "galaxy:draft", ui: "galaxy:admin:ui" };
  var CORE_COLOR = "#FFE3B8";
  var tabIdentityReady = Promise.resolve(), activeTabIds = new Set();
  if (window.BroadcastChannel) {
    var identityChannel = new BroadcastChannel("galaxy-admin-tabs"), instance = newTabId(), born = Date.now();
    function renewIdentity() {
      draftId = newTabId(); KEY.work = "galaxy:admin:work:" + draftId;
      try { sessionStorage.setItem("galaxy:admin:preview-id", draftId); } catch (e) { /* optional persistence */ }
      identityChannel.postMessage({ type: "hello", id: draftId, instance: instance, born: born });
    }
    identityChannel.onmessage = function (e) {
      var m = e.data;
      if (!m || m.instance === instance) return;
      if (m.type === "gone") { activeTabIds.delete(m.id); return; }
      activeTabIds.add(m.id);
      if (m.type === "hello") identityChannel.postMessage({ type: "present", id: draftId, instance: instance, born: born });
      if (m.id !== draftId) return;
      var otherOlder = m.born < born || (m.born === born && m.instance < instance);
      if (otherOlder) renewIdentity();
      else if (m.type === "hello") identityChannel.postMessage({ type: "claimed", id: draftId, instance: instance, born: born });
    };
    tabIdentityReady = new Promise(function (resolve) { setTimeout(function () { resolve(); }, 150); });
    identityChannel.postMessage({ type: "hello", id: draftId, instance: instance, born: born });
    window.addEventListener("pagehide", function () {
      identityChannel.postMessage({ type: "gone", id: draftId, instance: instance, born: born });
      identityChannel.close();
    });
  }

  /* ---------- small helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, props) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "value") e.value = v;
      else if (k === "checked") e.checked = true;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(e, x); });
    else e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  function store(k, v) { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); return true; } catch (e) { return false; } }
  function stored(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function hashText(t) { var x = 2166136261; for (var i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); }
  function clock(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function day(ts) { return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
  function inField(t) { return t && /INPUT|TEXTAREA|SELECT/.test(t.tagName); }
  var keys = new WeakMap(), nextKey = 1;
  function keyOf(o) { if (!keys.has(o)) keys.set(o, nextKey++); return keys.get(o); }
  function swap(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return false; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true; }

  /* ---------- state ---------- */
  var doc = null, baseText = "", savedText = "", savedVia = "", server = null, pendingRecovery = null;
  var sel = { type: "overview" }, undoStack = [], redoStack = [], lastKey = null, lastAt = 0;
  var ui = Object.assign({ open: {}, closed: {}, preview: true, mode: "card", device: "desktop", auto: true, filter: "all" }, stored(KEY.ui) || {});
  function saveUi() { store(KEY.ui, ui); }

  function ensureShape(c) {
    c.site = c.site || {}; c.site.labels = c.site.labels || {}; c.site.intro = c.site.intro || {}; c.site.hint = c.site.hint || {};
    c.site.links = c.site.links || []; c.site.moreLinks = c.site.moreLinks || [];
    c.site.card = c.site.card || {}; c.site.card.hover = c.site.card.hover || S.HOVER.slice(); c.site.card.detail = c.site.card.detail || S.DETAIL.slice();
    c.kinds = c.kinds || {}; c.path = c.path || []; c.domains = c.domains || []; c.connections = c.connections || [];
    c.domains.forEach(function (d) { d.stars = d.stars || []; });
    return c;
  }
  function find(id) { var r = null; S.walk(doc, function (b, at) { if (!r && b.id === id) r = { body: b, at: at }; }); return r; }
  function all() { var out = []; S.walk(doc, function (b, at) { out.push({ body: b, at: at }); }); return out; }
  function domain(id) { return doc.domains.filter(function (d) { return d.id === id; })[0] || null; }
  function takenBy(id) { var f = find(id); return f ? f.body : domain(id); }
  function unique(base, self) { base = S.slug(base); var id = base, n = 2; while (takenBy(id) && takenBy(id) !== self) id = base + "-" + n++; return id; }
  function label(b) { return b.mapLabel || b.title || b.id || "Untitled"; }
  function where(f) { return f.at.core ? "Centre" : f.at.planet ? (f.at.parent.mapLabel || f.at.parent.title) + (f.at.domain ? " · " + f.at.domain.name : "") : f.at.domain.name; }
  function colorOf(f) { return f && f.at.domain ? f.at.domain.color : CORE_COLOR; }
  function hiddenAt(f) { return f.body.hidden || (f.at.parent && f.at.parent.hidden) || (f.at.domain && f.at.domain.hidden); }

  /* ---------- changes, undo, autosave ---------- */
  function before(key) {
    var now = Date.now();
    if (key && key === lastKey && now - lastAt < 1200) { lastAt = now; return; }
    undoStack.push(JSON.stringify(doc)); if (undoStack.length > 200) undoStack.shift();
    redoStack = []; lastKey = key || null; lastAt = now;
  }
  function changed(rerender) {
    autosave(); refreshStatus(); renderTree();
    if (rerender) renderEdit(); else refreshIssues();
    if (ui.auto) previewSoon();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(doc)); doc = JSON.parse(undoStack.pop()); lastKey = null; fixSel(); changed(true); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(doc)); doc = JSON.parse(redoStack.pop()); lastKey = null; fixSel(); changed(true); }
  function fixSel() { if ((sel.type === "body" && !find(sel.id)) || (sel.type === "domain" && !domain(sel.id))) sel = { type: "overview" }; }
  /* the browser keeps whatever differs from the file this page loaded (or last saved to disk) */
  function keepWork() {
    if (!doc) return;
    var text = S.format(doc);
    if (pendingRecovery && pendingRecovery.key === KEY.work) {
      if (text === baseText) return; // Keep the unresolved version across repeated reloads.
      var recoveryKey = KEY.work + ":recovered:" + pendingRecovery.work.at;
      if (!store(recoveryKey, pendingRecovery.work)) { setStatus("Recovery storage is full. Restore or download the earlier changes before editing more.", true); return; }
      pendingRecovery.key = recoveryKey;
    }
    if (text === baseText) store(KEY.work, undefined);
    else if (!store(KEY.work, { at: Date.now(), base: hashText(baseText), doc: doc, savedVia: text === savedText ? savedVia : "" })) {
      setStatus("Browser recovery storage unavailable. Save draft to keep these changes.", true);
    }
  }
  var autosave = debounce(keepWork, 250);

  /* ---------- status ---------- */
  var statusNote = "", statusBad = false;
  function setStatus(note, bad) { statusNote = note || ""; statusBad = !!bad; refreshStatus(); }
  function refreshStatus() {
    if (!doc) return;
    var dirty = S.format(doc) !== savedText, issues = S.check(doc), errs = issues.filter(function (i) { return i.level === "error"; }).length;
    var st = $("status");
    st.textContent = (statusNote ? statusNote + " · " : "") + (dirty ? "Unsaved changes" : "All changes saved") + (errs ? " · " + errs + (errs === 1 ? " error" : " errors") : "");
    st.dataset.state = statusBad || errs ? "bad" : dirty ? "dirty" : "clean";
    $("undo").disabled = !undoStack.length; $("redo").disabled = !redoStack.length;
    $("save").textContent = P && P.connected() ? "Save draft" : server ? "Save" : "Save draft…";
    window.dispatchEvent(new Event("galaxy-editor-change"));
    document.title = (dirty ? "• " : "") + "Content editor · " + (doc.site.name || "");
  }
  function issuesFor(id) { return S.check(doc).filter(function (i) { return i.id === id; }); }

  /* ---------- the tree ---------- */
  var tree = $("tree"), findBox = $("find");
  function matches(b, q) {
    if (!q) return true;
    return [b.id, b.title, b.mapLabel, b.mapNote, b.summary, (b.body || []).join(" "), b.subtitle, b.notes].join(" ").toLowerCase().indexOf(q) >= 0;
  }
  function badge(issues, b) {
    var e = issues.some(function (i) { return i.level === "error"; }), w = issues.length && !e;
    return [
      e ? el("span", { class: "badge badge--err", title: issues.map(function (i) { return i.msg; }).join("\n") }, "!") : null,
      w ? el("span", { class: "badge badge--warn", title: issues.map(function (i) { return i.msg; }).join("\n") }, "•") : null,
      b && b.reviewed ? el("span", { class: "badge badge--ok", title: "Reviewed" }, "✓") : null,
      b && b.hidden ? el("span", { class: "badge badge--muted" }, "hidden") : null
    ];
  }
  function navRow(type, text, count) {
    return el("div", { class: "row row--nav" + (sel.type === type ? " is-on" : ""), role: "treeitem", tabindex: "0", "data-nav": type,
      onclick: function () { select(type); }, onkeydown: rowKey },
      el("span", { class: "row__t" }, text), count != null ? el("span", { class: "row__n" }, String(count)) : null);
  }
  function rowKey(e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }
  function bodyRow(b, kind, color, open, toggle, issues) {
    var on = sel.type === "body" && sel.id === b.id;
    return el("div", { class: "row row--" + kind + (on ? " is-on" : "") + (b.hidden ? " is-hidden" : ""), role: "treeitem", tabindex: "0",
      draggable: kind === "core" ? null : "true", "data-kind": kind, "data-id": b.id, "aria-selected": on ? "true" : "false", style: "--c:" + color,
      onclick: function () { select("body", b.id); }, onkeydown: rowKey },
      toggle ? el("button", { type: "button", class: "row__tw", "aria-label": open ? "Collapse" : "Expand", tabindex: "-1", onclick: function (e) { e.stopPropagation(); toggle(); } }, open ? "▾" : "▸") : el("span", { class: "row__tw" }),
      el("i", { class: "row__dot" + (kind === "planet" ? " row__dot--planet" : "") + (b.kind === "interest" ? " row__dot--ring" : "") }),
      el("span", { class: "row__t" }, label(b)),
      (b.planets || []).length ? el("span", { class: "row__n", title: "Planets" }, String(b.planets.length)) : null,
      badge(issues[b.id] || [], b));
  }
  function renderTree() {
    if (!doc) return;
    var q = findBox.value.trim().toLowerCase(), scroll = tree.scrollTop, issues = {};
    S.check(doc).forEach(function (i) { (issues[i.id] = issues[i.id] || []).push(i); });
    var total = all(), reviewed = total.filter(function (f) { return f.body.reviewed; }).length;
    tree.textContent = "";
    if (!q) {
      tree.appendChild(navRow("overview", "Overview", reviewed + "/" + total.length));
      tree.appendChild(navRow("site", "Site text & card layout"));
      tree.appendChild(navRow("kinds", "Kinds", Object.keys(doc.kinds).length));
      tree.appendChild(navRow("path", "Highlighted path", doc.path.length));
      tree.appendChild(navRow("connections", "Connections", doc.connections.length));
      tree.appendChild(el("p", { class: "tree__h" }, "The map"));
    }
    function branch(b, kind, color, d) {
      var planets = b.planets || [], hit = matches(b, q), kids = planets.filter(function (p) { return matches(p, q); });
      if (q && !hit && !kids.length) return null;
      var key = "b:" + b.id, open = q ? true : !!ui.open[key];
      var box = el("div", { class: "branch" }, bodyRow(b, kind, color, open, planets.length ? function () { ui.open[key] = !open; saveUi(); renderTree(); } : null, issues));
      if (open && planets.length) {
        var kidsBox = el("div", { class: "branch__kids", role: "group" });
        (q ? kids : planets).forEach(function (p) { kidsBox.appendChild(el("div", { class: "branch" }, bodyRow(p, "planet", color, false, null, issues))); });
        box.appendChild(kidsBox);
      }
      return box;
    }
    tree.appendChild(branch(doc.core, "core", CORE_COLOR) || document.createDocumentFragment());
    doc.domains.forEach(function (d) {
      var stars = d.stars.map(function (s) { return branch(s, "star", d.color, d); }).filter(Boolean);
      if (q && !stars.length && !matches({ id: d.id, title: d.name, summary: d.blurb }, q)) return;
      var key = "d:" + d.id, open = q ? true : !ui.closed[key], on = sel.type === "domain" && sel.id === d.id;
      var head = el("div", { class: "row row--domain" + (on ? " is-on" : "") + (d.hidden ? " is-hidden" : ""), role: "treeitem", tabindex: "0", draggable: "true",
        "data-kind": "domain", "data-id": d.id, style: "--c:" + d.color, onclick: function () { select("domain", d.id); }, onkeydown: rowKey },
        el("button", { type: "button", class: "row__tw", tabindex: "-1", "aria-label": open ? "Collapse" : "Expand", onclick: function (e) { e.stopPropagation(); ui.closed[key] = open; saveUi(); renderTree(); } }, open ? "▾" : "▸"),
        el("i", { class: "row__dot row__dot--domain" }), el("span", { class: "row__t" }, d.name || d.id), el("span", { class: "row__n" }, String(d.stars.length)),
        badge(issues["domain:" + d.id] || [], d));
      var box = el("div", { class: "branch branch--domain" }, head);
      if (open) box.appendChild(el("div", { class: "branch__kids", role: "group" }, stars,
        q ? null : el("button", { type: "button", class: "tree__add", onclick: function () { addStar(d); } }, "+ Star")));
      tree.appendChild(box);
    });
    if (!q) tree.appendChild(el("button", { type: "button", class: "tree__add tree__add--domain", onclick: addDomain }, "+ Domain"));
    tree.scrollTop = scroll;
  }
  findBox.addEventListener("input", renderTree);

  /* drag a row onto another: before or after it, or inside a star (as a planet) or a domain (as a star) */
  var drag = null;
  function hasPlanets(id) { var f = find(id); return f && (f.body.planets || []).length > 0; }
  function zone(r, e) {
    var kind = r.dataset.kind, id = r.dataset.id;
    if (!drag || !kind || id === drag.id) return null;
    var box = r.getBoundingClientRect(), y = (e.clientY - box.top) / box.height, edge = y < 0.5 ? "before" : "after";
    if (drag.kind === "domain") return kind === "domain" ? edge : null;
    var canPlanet = drag.kind === "planet" || !hasPlanets(drag.id);
    if (kind === "domain") return "inside";
    if (kind === "core") return canPlanet ? "inside" : null;
    if (kind === "star") return y > 0.3 && y < 0.7 && canPlanet ? "inside" : edge;
    if (kind === "planet") { var t = find(id); if (t && t.at.parent && t.at.parent.id === drag.id) return null; return canPlanet ? edge : null; }
    return null;
  }
  function clearMarks() { tree.querySelectorAll(".drop-before, .drop-after, .drop-inside, .is-drag").forEach(function (r) { r.classList.remove("drop-before", "drop-after", "drop-inside", "is-drag"); }); }
  tree.addEventListener("dragstart", function (e) {
    var r = e.target.closest && e.target.closest(".row[draggable]"); if (!r) return;
    drag = { kind: r.dataset.kind, id: r.dataset.id }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", r.dataset.id);
    setTimeout(function () { r.classList.add("is-drag"); }, 0);
  });
  tree.addEventListener("dragover", function (e) {
    var r = e.target.closest && e.target.closest(".row"); tree.querySelectorAll(".drop-before, .drop-after, .drop-inside").forEach(function (x) { x.classList.remove("drop-before", "drop-after", "drop-inside"); });
    var z = r && zone(r, e); if (!z) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move"; r.classList.add("drop-" + z);
  });
  tree.addEventListener("drop", function (e) {
    var r = e.target.closest && e.target.closest(".row"), z = r && zone(r, e), d = drag; clearMarks(); drag = null;
    if (!z || !d) return;
    e.preventDefault(); dropOn(d, r.dataset.kind, r.dataset.id, z);
  });
  tree.addEventListener("dragend", function () { clearMarks(); drag = null; });
  function dropOn(d, kind, id, z) {
    if (d.kind === "domain") return moveDomain(d.id, id, z);
    if (kind === "domain") { var dm = domain(id); return moveBody(d.id, dm.stars, dm.stars.length, false); }
    if (kind === "core") { doc.core.planets = doc.core.planets || []; return moveBody(d.id, doc.core.planets, doc.core.planets.length, true); }
    var t = find(id);
    if (z === "inside") { t.body.planets = t.body.planets || []; ui.open["b:" + t.body.id] = true; return moveBody(d.id, t.body.planets, t.body.planets.length, true); }
    moveBody(d.id, t.at.list, t.at.list.indexOf(t.body) + (z === "after" ? 1 : 0), !!t.at.planet);
  }

  /* ---------- moving, adding, removing ---------- */
  function moveBody(id, dest, index, asPlanet) {
    var f = find(id); if (!f || f.at.core) return false;
    var b = f.body;
    if (asPlanet && (b.planets || []).length) { setStatus("A planet cannot have planets: move or remove " + label(b) + "’s planets first.", true); return false; }
    if (asPlanet && dest === b.planets) return false;
    before();
    var src = f.at.list, i = src.indexOf(b);
    src.splice(i, 1);
    if (src === dest && i < index) index--;
    if (asPlanet) { delete b.size; delete b.planets; } else if (b.size == null) b.size = 2;
    dest.splice(index, 0, b);
    var old = f.at.domain;
    if (old && old.heart === id && dest !== old.stars) old.heart = old.stars[0] ? old.stars[0].id : undefined;
    setStatus("Moved " + label(b));
    changed(true);
    return true;
  }
  function moveDomain(id, targetId, z) {
    var list = doc.domains, a = domain(id), t = domain(targetId); if (!a || !t || a === t) return;
    before(); list.splice(list.indexOf(a), 1); list.splice(list.indexOf(t) + (z === "after" ? 1 : 0), 0, a); changed(true);
  }
  function step(list, item, d) { var i = list.indexOf(item); before(); if (swap(list, i, d)) changed(true); else undoStack.pop(); }
  function newBody(title, kind, planet) {
    var b = { id: unique(title), kind: kind, title: title, _auto: true };
    if (!planet) b.size = 2;
    return b;
  }
  function addStar(d) {
    before(); var b = newBody("New star", "work", false); d.stars.push(b); ui.closed["d:" + d.id] = false;
    changed(false); select("body", b.id, "title");
  }
  function addPlanet(star) {
    before(); var p = newBody("New planet", "part", true); star.planets = star.planets || []; star.planets.push(p); ui.open["b:" + star.id] = true;
    changed(false); select("body", p.id, "title");
  }
  function addDomain() {
    before();
    var used = doc.domains.map(function (d) { return d.color.toLowerCase(); }), palette = ["#F2A541", "#78A2FF", "#7BD88F", "#B596FF", "#5FD0E0", "#EE6C5A", "#F27BBD", "#C9D46B"];
    var color = palette.filter(function (c) { return used.indexOf(c.toLowerCase()) < 0; })[0] || palette[doc.domains.length % palette.length];
    var d = { id: unique("new-domain"), name: "New domain", color: color, angle: 0, blurb: "", stars: [], _auto: true };
    doc.domains.push(d); changed(false); select("domain", d.id, "name");
  }
  function duplicate(f) {
    before();
    var copy = JSON.parse(JSON.stringify(f.body));
    copy.id = unique(copy.id + "-copy"); copy.title = (copy.title || "") + " (copy)"; delete copy.reviewed;
    (copy.planets || []).forEach(function (p) { p.id = unique(p.id + "-copy"); });
    f.at.list.splice(f.at.list.indexOf(f.body) + 1, 0, copy);
    changed(false); select("body", copy.id);
  }
  function forget(id) {
    doc.connections = doc.connections.filter(function (p) { return p[0] !== id && p[1] !== id; });
    doc.path = doc.path.filter(function (x) { return x !== id; });
  }
  function remove(f) {
    var b = f.body, n = (b.planets || []).length;
    if (!confirm("Delete “" + (b.title || b.id) + "”" + (n ? " and its " + n + (n === 1 ? " planet" : " planets") : "") + "? Undo brings it back.")) return;
    before();
    f.at.list.splice(f.at.list.indexOf(b), 1);
    forget(b.id); (b.planets || []).forEach(function (p) { forget(p.id); });
    if (f.at.domain && f.at.domain.heart === b.id) f.at.domain.heart = f.at.domain.stars[0] ? f.at.domain.stars[0].id : undefined;
    setStatus("Deleted " + label(b));
    sel = f.at.planet ? { type: "body", id: f.at.parent.id } : f.at.domain ? { type: "domain", id: f.at.domain.id } : { type: "overview" };
    changed(true); preview();
  }
  function removeDomain(d) {
    var n = d.stars.length;
    if (!confirm("Delete the domain “" + d.name + "”" + (n ? " and its " + n + (n === 1 ? " star" : " stars") + ", with their planets" : "") + "? Undo brings it back.")) return;
    before();
    doc.domains.splice(doc.domains.indexOf(d), 1);
    d.stars.forEach(function (s) { forget(s.id); (s.planets || []).forEach(function (p) { forget(p.id); }); });
    sel = { type: "overview" }; setStatus("Deleted " + d.name); changed(true); preview();
  }
  /* a new ID everywhere it is named: connections, the path, a domain's heart */
  function rename(oldId, newId) {
    doc.connections.forEach(function (p) { if (p[0] === oldId) p[0] = newId; if (p[1] === oldId) p[1] = newId; });
    doc.path = doc.path.map(function (x) { return x === oldId ? newId : x; });
    doc.domains.forEach(function (d) { if (d.heart === oldId) d.heart = newId; });
    if (ui.open["b:" + oldId]) { ui.open["b:" + newId] = true; delete ui.open["b:" + oldId]; }
    if (sel.id === oldId) { sel.id = newId; history.replaceState(null, "", "#" + sel.type + ":" + newId); }
  }

  /* ---------- form controls ---------- */
  var uid = 0;
  function field(key, title, help, control, extra) {
    var id = "f" + (++uid);
    if (control && control.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(control.tagName)) control.id = id;
    return el("div", { class: "field", "data-field": key },
      el("div", { class: "field__top" }, el("label", { class: "field__l", for: id }, title), extra || null),
      control, help ? el("p", { class: "field__help" }, help) : null, el("p", { class: "field__msg", "aria-live": "polite" }));
  }
  function text(obj, key, o) {
    o = o || {};
    var input = el(o.rows ? "textarea" : "input", { rows: o.rows, placeholder: o.placeholder, spellcheck: o.code ? "false" : null, list: o.list, inputmode: o.number ? "numeric" : null, class: o.cls });
    input.value = obj[key] == null ? "" : String(obj[key]);
    input.addEventListener("input", function () {
      before("t:" + key + ":" + keyOf(obj));
      var v = input.value;
      obj[key] = o.number ? (v.trim() === "" ? undefined : isFinite(Number(v)) ? Number(v) : v) : v;
      if (o.onInput) o.onInput(v);
      changed(false);
    });
    if (o.rows) grow(input);
    return input;
  }
  function grow(t) { var fit = function () { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 640) + "px"; }; t.addEventListener("input", fit); requestAnimationFrame(fit); }
  function counter(input, max) {
    var c = el("span", { class: "field__count" }), up = function () { var n = input.value.length; c.textContent = n + " / " + max; c.classList.toggle("is-over", n > max); };
    input.addEventListener("input", up); up(); return c;
  }
  function choose(options, value, onChange) {
    var s = el("select");
    options.forEach(function (o) { s.appendChild(el("option", { value: o[0] }, o[1])); });
    s.value = value == null ? "" : value;
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }
  function check(obj, key, title, rerender) {
    var c = el("input", { type: "checkbox", checked: !!obj[key] });
    c.addEventListener("change", function () { before(); obj[key] = c.checked || undefined; changed(!!rerender); });
    return el("label", { class: "check" }, c, " " + title);
  }
  function btn(textOrNode, onclick, o) {
    o = o || {};
    return el("button", { type: "button", class: o.cls || null, title: o.title, "aria-label": o.aria, disabled: o.disabled, onclick: onclick }, textOrNode);
  }
  function part(title, help, children, o) {
    o = o || {};
    return el("section", { class: "part" + (o.cls ? " " + o.cls : ""), id: o.id },
      el("h3", { class: "part__h" }, title), help ? el("p", { class: "part__help" }, help) : null, children);
  }
  function linksEditor(obj, key, what) {
    var box = el("div", { class: "list" });
    function draw(focusLast) {
      box.textContent = "";
      var list = obj[key] || [];
      list.forEach(function (l, i) {
        box.appendChild(el("div", { class: "list__row" },
          text(l, "label", { placeholder: "Label", cls: "list__label" }),
          text(l, "url", { placeholder: "https://…, mailto:…, or assets/file.pdf", code: true, cls: "list__url" }),
          btn("↑", function () { before(); swap(list, i, -1); changed(false); draw(); }, { cls: "icon", aria: "Move up", disabled: i === 0 }),
          btn("↓", function () { before(); swap(list, i, 1); changed(false); draw(); }, { cls: "icon", aria: "Move down", disabled: i === list.length - 1 }),
          btn("×", function () { before(); list.splice(i, 1); changed(false); draw(); }, { cls: "icon", aria: "Remove link" })));
      });
      box.appendChild(btn("+ " + (what || "Link"), function () { before(); (obj[key] = obj[key] || []).push({ label: "", url: "" }); changed(false); draw(true); }, { cls: "ghost small" }));
      if (focusLast) { var ins = box.querySelectorAll(".list__label"); if (ins.length) ins[ins.length - 1].focus(); }
    }
    draw(); return box;
  }
  function cardOptions(exceptId) {
    return all().filter(function (f) { return f.body.id !== exceptId; }).map(function (f) { return (f.body.title || f.body.id) + " · " + f.body.id; });
  }
  function pickId(v) { v = (v || "").trim(); var m = v.match(/ · ([a-z0-9-]+)$/); var id = m ? m[1] : v; return find(id) ? id : null; }
  function cardPicker(placeholder, onPick, exceptId) {
    var dl = "dl" + (++uid), input = el("input", { list: dl, placeholder: placeholder, class: "picker", spellcheck: "false" }), list = el("datalist", { id: dl });
    cardOptions(exceptId).forEach(function (o) { list.appendChild(el("option", { value: o })); });
    input.addEventListener("change", function () { var id = pickId(input.value); if (id) { input.value = ""; onPick(id); } });
    return el("span", { class: "picker__wrap" }, input, list);
  }
  function chipFor(id, onRemove) {
    var f = find(id);
    return el("span", { class: "chip", style: "--c:" + colorOf(f) },
      btn(f ? label(f.body) : id + " (missing)", function () { if (f) select("body", id); }, { cls: "chip__t", title: f ? where(f) : "No card has this ID" }),
      onRemove ? btn("×", onRemove, { cls: "chip__x", aria: "Remove" }) : null);
  }

  /* ---------- media ---------- */
  function mediaName(name) { var m = String(name).toLowerCase().match(/^(.*?)(\.[a-z0-9]+)?$/); return S.slug(m[1]) + (m[2] || ""); }
  function upload(blob, name) {
    if (P && P.connected()) return P.upload(blob, name || blob.name || "file");
    var path = "assets/media/" + mediaName(name || blob.name || "file");
    if (server) {
      return putFile(path, blob, false).catch(function (e) {
        if (e.exists && confirm(path + " already exists. Replace it?")) return putFile(path, blob, true);
        throw e;
      }).then(function () { return path; });
    }
    return P.upload(blob, name || blob.name || "file");
  }
  function mediaUrl(src) { return new URL(P ? P.resolve(src) : src, SITE).href; }

  function posterFrom(src) {
    return new Promise(function (ok, no) {
      var v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.crossOrigin = "anonymous"; v.src = mediaUrl(src);
      v.addEventListener("loadeddata", function () { v.currentTime = Math.min(1.2, (v.duration || 3) / 3); }, { once: true });
      v.addEventListener("seeked", function () {
        var c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0);
        c.toBlob(function (b) { if (b) ok(b); else no(new Error("Could not read a frame")); }, "image/webp", 0.82);
      }, { once: true });
      v.addEventListener("error", function () { no(new Error("Could not load " + src)); }, { once: true });
    });
  }
  function mediaPaths() {
    var out = {};
    all().forEach(function (f) { var m = f.body.media; if (m && m.src) out[m.src] = 1; if (m && m.poster) out[m.poster] = 1; });
    return Object.keys(out).sort();
  }
  function mediaEditor(b) {
    var box = el("div", { class: "media-ed" });
    function attachment(m, key) { return { id: b.id, type: m.type, key: key, value: m[key] || "", source: key === "poster" ? m.src : null }; }
    function attach(path, target, message) {
      var current = find(target.id), m = current && current.body.media;
      if (!m || m.type !== target.type || (m[target.key] || "") !== target.value || (target.source != null && m.src !== target.source)) {
        setStatus("Uploaded " + path + " but not attached: the card or media changed. Paste this path into the file field to use it.", true);
        return;
      }
      before(); m[target.key] = path; setStatus(message + path); changed(true);
    }
    function fileRow(m, key, title, help, accept) {
      var input = text(m, key, { code: true, placeholder: "assets/media/name" + (accept.indexOf("video") >= 0 ? ".mp4" : ".webp"), list: "media-files", onInput: function () { drawPreview(); } });
      var pick = el("input", { type: "file", accept: accept, hidden: true });
      pick.addEventListener("change", function () {
        var file = pick.files[0]; if (!file) return;
        var target = attachment(m, key);
        setStatus("Uploading " + file.name + "…");
        upload(file).then(function (path) { attach(path, target, "Uploaded "); })
          .catch(function (e) { setStatus("Upload failed: " + e.message, true); });
        pick.value = "";
      });
      return field("media." + key, title, help, el("div", { class: "hrow" }, input, btn("Upload…", function () { pick.click(); }, { cls: "small" }), pick));
    }
    var prev = el("div", { class: "media-ed__preview" });
    function drawPreview() {
      prev.textContent = "";
      var m = b.media; if (!m) { prev.appendChild(el("p", { class: "help" }, "No media: the hover card shows a live picture of the map around this card.")); return; }
      if (m.type === "video" && m.src) prev.appendChild(el("video", { src: mediaUrl(m.src), "data-media-src": m.src, "data-media-poster": m.poster || "", poster: m.poster ? mediaUrl(m.poster) : null, muted: true, loop: true, autoplay: true, playsinline: true, controls: true }));
      else if (m.type === "image" && m.src) prev.appendChild(el("img", { src: mediaUrl(m.src), "data-media-src": m.src, alt: "" }));
      else if (m.type === "quote") prev.appendChild(el("blockquote", null, "“" + (m.quote || "") + "”", el("cite", null, m.cite || "")));
      else if (m.type === "book") prev.appendChild(el("div", { class: "bookmock" }, el("b", null, (m.title || "").toUpperCase()), el("span", null, m.author || "")));
    }
    function draw() {
      box.textContent = "";
      var m = b.media, type = m ? m.type : "";
      box.appendChild(field("media", "Type", "Plays or shows on the hover card and at the top of the card.",
        choose([["", "None: a live picture of the map"], ["video", "Video (muted loop)"], ["image", "Image"], ["book", "Book cover"], ["quote", "Quote"]], type, function (v) {
          before();
          var old = b.media || {};
          b.media = v ? { type: v } : undefined;
          if (v === "video" || v === "image") { if (old.src) b.media.src = old.src; if (old.caption) b.media.caption = old.caption; }
          if (v === "book") { b.media.title = old.title || b.title; b.media.author = old.author || (doc.site.name || ""); }
          changed(false); draw();
        })));
      if (type === "video") {
        box.appendChild(fileRow(m, "src", "Video file", "An MP4 (H.264), muted, ideally under 4 MB and 10–30 seconds.", "video/mp4,video/webm"));
        var posterRow = fileRow(m, "poster", "Poster image", "Shown before the video plays and with reduced motion.", "image/*");
        posterRow.appendChild(btn("Make a poster from the video", function () {
          if (!m.src) return setStatus("Choose the video first", true);
          var target = attachment(m, "poster"), source = m.src;
          setStatus("Making a poster…");
          posterFrom(source).then(function (blob) { return upload(blob, source.split("/").pop().replace(/\.[a-z0-9]+$/i, "") + ".webp"); })
            .then(function (path) { attach(path, target, "Poster saved as "); })
            .catch(function (e) { setStatus("Poster failed: " + e.message, true); });
        }, { cls: "small ghost" }));
        box.appendChild(posterRow);
        box.appendChild(field("media.caption", "Caption", "Optional, under the media on the card.", text(m, "caption")));
      } else if (type === "image") {
        box.appendChild(fileRow(m, "src", "Image file", "WebP or JPEG, about 1280 px wide.", "image/*"));
        box.appendChild(check(m, "square", "Square crop (for a portrait)"));
        box.appendChild(field("media.caption", "Caption", "Optional, under the media on the card.", text(m, "caption")));
      } else if (type === "book") {
        box.appendChild(field("media.title", "Cover title", "Each word goes on its own line of the cover.", text(m, "title", { onInput: function () { drawPreview(); } })));
        box.appendChild(field("media.author", "Cover author", null, text(m, "author", { onInput: function () { drawPreview(); } })));
      } else if (type === "quote") {
        box.appendChild(field("media.quote", "Quote", "Without quotation marks; they are added.", text(m, "quote", { rows: 3, onInput: function () { drawPreview(); } })));
        box.appendChild(field("media.cite", "Source", null, text(m, "cite", { onInput: function () { drawPreview(); } })));
      }
      box.appendChild(prev); drawPreview();
    }
    draw(); return box;
  }

  /* ---------- the editor panes ---------- */
  var edit = $("edit");
  function renderEdit(focusKey) {
    if (!doc) return;
    edit.textContent = ""; uid = 0;
    var dl = el("datalist", { id: "media-files" }); mediaPaths().forEach(function (p) { dl.appendChild(el("option", { value: p })); }); edit.appendChild(dl);
    var f = sel.type === "body" ? find(sel.id) : null, d = sel.type === "domain" ? domain(sel.id) : null;
    if (sel.type === "body" && f) renderBody(f);
    else if (d) renderDomain(d);
    else if (sel.type === "site") renderSite();
    else if (sel.type === "kinds") renderKinds();
    else if (sel.type === "path") renderPath();
    else if (sel.type === "connections") renderConnections();
    else renderOverview();
    refreshIssues();
    if (focusKey) { var t = edit.querySelector('[data-field="' + focusKey + '"] input, [data-field="' + focusKey + '"] textarea'); if (t) { t.focus(); if (t.select) t.select(); } }
  }
  function refreshIssues() {
    var id = sel.type === "body" ? sel.id : sel.type === "domain" ? "domain:" + sel.id : null;
    if (!id) return;
    var mine = issuesFor(id);
    edit.querySelectorAll(".field").forEach(function (fl) {
      var msgs = mine.filter(function (i) { return i.field === fl.dataset.field; }), m = fl.querySelector(".field__msg");
      fl.classList.toggle("has-error", msgs.some(function (i) { return i.level === "error"; }));
      fl.classList.toggle("has-warn", msgs.length > 0);
      if (m) m.textContent = msgs.map(function (i) { return i.msg; }).join(" ");
    });
  }
  function head(kicker, title, color, actions) {
    return el("header", { class: "ed__head", style: "--c:" + color },
      el("p", { class: "ed__kicker" }, kicker), el("h2", { class: "ed__title", id: "ed-title" }, title), actions ? el("div", { class: "ed__actions" }, actions) : null);
  }
  function revealOnPhone(element) {
    if (window.matchMedia("(max-width: 760px)").matches) {
      window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - document.querySelector(".top").getBoundingClientRect().height, behavior: "auto" });
    }
  }
  function showIn(mode) { return btn(mode === "hover" ? "Show hover card" : mode === "card" ? "Show card" : "Show on map", function () { ui.mode = mode; ui.preview = true; saveUi(); syncPreviewUi(); preview(); revealOnPhone($("preview")); }, { cls: "small ghost" }); }

  var BODY_HELP = {
    title: "The card’s heading.",
    mapLabel: "A shorter name for the map when the title is long. Empty: the title.",
    mapNote: "The small line under the label on the map, in the table and on planet chips.",
    kind: "Shown at the top of the card. Interests draw as rings.",
    size: "How bright the star is: 1 is faint, 5 is a major star. 4 and 5 get light spikes.",
    when: "As shown, e.g. “March 2026 – now”. Planets without dates show their star’s.",
    year: "A number, for sorting the table by date. Planets without one use their star’s.",
    subtitle: "One line under the title: a role, a place, a publisher.",
    summary: "Opens the hover card and the card. One or two sentences.",
    body: "The card’s text. A blank line starts a new paragraph; the first paragraph also shows on hover. [words](https://…) makes a link, **bold**, *italic*.",
    builtWith: "Tools and stack, one line.",
    notes: "Editor notes, removed from published galaxy content. This public repository’s draft branch is readable by others."
  };
  function renderBody(f) {
    var b = f.body, at = f.at, color = colorOf(f), kindOpts = Object.keys(doc.kinds).map(function (k) { return [k, doc.kinds[k] || k]; });
    if (b.kind && !doc.kinds[b.kind]) kindOpts.push([b.kind, b.kind]);
    var titleInput = text(b, "title", { onInput: function (v) {
      $("ed-title").textContent = v || "Untitled";
      var ml = edit.querySelector('[data-field="mapLabel"] input'); if (ml) ml.placeholder = v;
      if (b._auto) { var nid = unique(v || "card", b); if (nid !== b.id) { rename(b.id, nid); b.id = nid; var idIn = edit.querySelector('[data-field="id"] input'); if (idIn) idIn.value = nid; } }
    } });
    var summary = text(b, "summary", { rows: 3 });
    edit.appendChild(head(at.core ? "Centre of the map" : at.planet ? "Planet of " + (at.parent.title || at.parent.id) + (at.domain ? " · " + at.domain.name : "") : "Star · " + at.domain.name, b.title || "Untitled", color,
      [check(b, "reviewed", "Reviewed"), at.core ? null : check(b, "hidden", "Hidden from the site", true), showIn("hover"), showIn("card")]));
    edit.appendChild(part("On the map", null, [
      field("title", "Title", BODY_HELP.title, titleInput),
      el("div", { class: "grid2" },
        field("mapLabel", "Map label", BODY_HELP.mapLabel, text(b, "mapLabel", { placeholder: b.title })),
        field("mapNote", "Map note", BODY_HELP.mapNote, text(b, "mapNote"))),
      el("div", { class: at.planet ? "grid2" : "grid3" },
        field("kind", "Kind", BODY_HELP.kind, choose(kindOpts, b.kind, function (v) { before(); b.kind = v; changed(false); })),
        at.planet ? null : field("size", "Brightness", BODY_HELP.size, choose([["1", "1 · faint"], ["2", "2"], ["3", "3"], ["4", "4 · spikes"], ["5", "5 · major"]], String(b.size || 2), function (v) { before(); b.size = Number(v); changed(false); })),
        field("year", "Year", BODY_HELP.year, text(b, "year", { number: true, placeholder: at.parent && at.parent.year ? String(at.parent.year) : "e.g. 2024" }))),
      field("when", "Dates", BODY_HELP.when, text(b, "when", { placeholder: at.parent && at.parent.when ? at.parent.when : "" }))
    ]));
    edit.appendChild(part("Words", null, [
      field("subtitle", "Subtitle", BODY_HELP.subtitle, text(b, "subtitle")),
      field("summary", "Summary", BODY_HELP.summary, summary, counter(summary, 240)),
      field("body", "Body", BODY_HELP.body, paragraphs(b)),
      field("builtWith", "Built with", BODY_HELP.builtWith, text(b, "builtWith"))
    ]));
    edit.appendChild(part("Media", null, mediaEditor(b)));
    edit.appendChild(part("Links", "Shown on the card; the first three also on hover.", linksEditor(b, "links")));
    edit.appendChild(part("Connections", "Lines to other cards, drawn across the map and listed under “Where it meets”.", connections(b)));
    if (!at.planet) edit.appendChild(part("Planets", (b.planets || []).length ? "Its solar system: each planet is one part of this, with its own card." : "Add planets to give this star a solar system you can zoom into.", planetsList(b)));
    edit.appendChild(part("Place and ID", null, placement(f)));
    edit.appendChild(part("Notes", null, field("notes", "Editor notes", BODY_HELP.notes, text(b, "notes", { rows: 3 }))));
    if (!at.core) edit.appendChild(el("div", { class: "ed__danger" }, btn("Duplicate", function () { duplicate(f); }, { cls: "small" }), btn("Delete…", function () { remove(f); }, { cls: "small danger" })));
  }
  function paragraphs(b) {
    var t = el("textarea", { rows: 6, class: "prose" });
    t.value = (b.body || []).join("\n\n");
    t.addEventListener("input", function () {
      before("p:" + keyOf(b));
      b.body = t.value.split(/\n[ \t]*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      changed(false);
    });
    grow(t); return t;
  }
  /* reads the card's ID on every use: a new card's ID follows its title while it is typed */
  function connections(b) {
    var box = el("div", { class: "chips" });
    function draw() {
      var id = b.id;
      box.textContent = "";
      doc.connections.forEach(function (p) {
        if (p[0] !== id && p[1] !== id) return;
        var other = p[0] === id ? p[1] : p[0];
        box.appendChild(chipFor(other, function () { before(); doc.connections.splice(doc.connections.indexOf(p), 1); changed(false); draw(); }));
      });
      box.appendChild(cardPicker("Connect to a card…", function (other) {
        var id = b.id;
        if (other === id) return;
        if (doc.connections.some(function (p) { return (p[0] === id && p[1] === other) || (p[1] === id && p[0] === other); })) return setStatus("Already connected");
        before(); doc.connections.push([id, other]); changed(false); draw();
      }, id));
    }
    draw(); return box;
  }
  function planetsList(star) {
    var box = el("div", { class: "kids" }), list = star.planets || [];
    list.forEach(function (p, i) {
      box.appendChild(el("div", { class: "kids__row" + (p.hidden ? " is-hidden" : "") },
        btn(el("span", null, el("b", null, p.title || p.id), p.mapNote ? el("span", { class: "muted" }, " · " + p.mapNote) : null), function () { select("body", p.id); }, { cls: "kids__open" }),
        badge(issuesFor(p.id), p),
        btn("↑", function () { step(list, p, -1); }, { cls: "icon", aria: "Move up", disabled: i === 0 }),
        btn("↓", function () { step(list, p, 1); }, { cls: "icon", aria: "Move down", disabled: i === list.length - 1 })));
    });
    box.appendChild(btn("+ Planet", function () { addPlanet(star); }, { cls: "ghost small" }));
    return box;
  }
  function placement(f) {
    var b = f.body, at = f.at, out = [];
    var idInput = el("input", { spellcheck: "false", value: b.id });
    idInput.addEventListener("change", function () {
      var v = idInput.value.trim();
      if (v === b.id) return;
      if (!S.ID.test(v)) { setStatus("IDs are lowercase letters, digits and dashes", true); idInput.value = b.id; return; }
      if (takenBy(v)) { setStatus("“" + v + "” is already used", true); idInput.value = b.id; return; }
      before(); var old = b.id; rename(old, v); b.id = v; delete b._auto; changed(true);
    });
    out.push(field("id", "ID", "Used in links to this card (aryan-poonacha.github.io/#" + b.id + "). Changing it updates connections and the path; old links stop working.", idInput));
    if (at.core) return out;
    var stars = [["", "Choose…"], ["core", (doc.core.title || "Centre") + " (centre)"]];
    doc.domains.forEach(function (d) { d.stars.forEach(function (s) { if (s !== b) stars.push([s.id, (s.title || s.id) + " · " + d.name]); }); });
    var domains = [["", "Choose…"]].concat(doc.domains.map(function (d) { return [d.id, d.name]; }));
    function toStar(v) { if (!v) return; var t = v === "core" ? doc.core : find(v).body; t.planets = t.planets || []; ui.open["b:" + t.id] = true; moveBody(b.id, t.planets, t.planets.length, true); }
    function toDomain(v) { if (!v) return; var d = domain(v); moveBody(b.id, d.stars, d.stars.length, false); }
    if (at.star) {
      out.push(el("div", { class: "grid2" },
        field("domain", "Domain", "Moves the star, with its planets, to another domain.", choose(domains.slice(1), at.domain.id, toDomain)),
        field("asPlanet", "Make it a planet of", (b.planets || []).length ? "Only a star without planets can become a planet." : "It joins that star’s solar system.", (function () { var s = choose(stars, "", toStar); s.disabled = (b.planets || []).length > 0; return s; })())));
      out.push(el("div", { class: "hrow" },
        el("label", { class: "check" }, (function () {
          var c = el("input", { type: "checkbox", checked: at.domain.heart === b.id });
          c.addEventListener("change", function () { before(); at.domain.heart = c.checked ? b.id : (at.domain.stars.filter(function (s) { return s !== b; })[0] || {}).id; changed(true); });
          return c;
        })(), " The heart of " + at.domain.name + " (its centre star)"),
        btn("Move up", function () { step(at.list, b, -1); }, { cls: "small", disabled: at.index === 0 }),
        btn("Move down", function () { step(at.list, b, 1); }, { cls: "small", disabled: at.index === at.list.length - 1 })));
    } else {
      out.push(el("div", { class: "grid2" },
        field("parent", "Part of", "Moves the planet to another star’s system.", choose(stars.filter(function (s) { return s[0] !== at.parent.id && !(at.parent === doc.core && s[0] === "core"); }), "", toStar)),
        field("asStar", "Make it a star in", "It leaves the system and becomes a star of that domain.", choose(domains, "", toDomain))));
      out.push(el("div", { class: "hrow" },
        btn("Move up", function () { step(at.list, b, -1); }, { cls: "small", disabled: at.index === 0 }),
        btn("Move down", function () { step(at.list, b, 1); }, { cls: "small", disabled: at.index === at.list.length - 1 })));
    }
    out.push(el("p", { class: "help" }, "You can also drag cards in the list on the left: onto a domain, before or after a card, or onto the middle of a star to make it a planet."));
    return out;
  }

  function renderDomain(d) {
    var idInput = el("input", { spellcheck: "false", value: d.id });
    idInput.addEventListener("change", function () {
      var v = idInput.value.trim(); if (v === d.id) return;
      if (!S.ID.test(v) || takenBy(v)) { setStatus(S.ID.test(v) ? "“" + v + "” is already used" : "IDs are lowercase letters, digits and dashes", true); idInput.value = d.id; return; }
      before(); if (ui.closed["d:" + d.id]) ui.closed["d:" + v] = true; d.id = v; delete d._auto; sel.id = v; changed(true);
    });
    var hex = el("input", { class: "hex", spellcheck: "false", value: d.color }), picker = el("input", { type: "color", value: S.COLOR.test(d.color) ? d.color.toLowerCase() : "#888888" });
    picker.addEventListener("input", function () { before("color:" + d.id); d.color = picker.value.toUpperCase(); hex.value = d.color; changed(false); });
    hex.addEventListener("input", function () { before("color:" + d.id); d.color = hex.value.trim(); if (S.COLOR.test(d.color)) picker.value = d.color.toLowerCase(); changed(false); });
    var angle = el("input", { type: "range", min: "-180", max: "180", step: "1", value: String(d.angle || 0) }), angleN = el("span", { class: "field__count" }, (d.angle || 0) + "°");
    angle.addEventListener("input", function () { before("angle:" + d.id); d.angle = Number(angle.value); angleN.textContent = d.angle + "°"; dial.style.setProperty("--a", d.angle + "deg"); changed(false); });
    var dial = el("span", { class: "dial", style: "--a:" + (d.angle || 0) + "deg;--c:" + d.color }, el("i"));
    var name = text(d, "name", { onInput: function (v) {
      $("ed-title").textContent = v || "Untitled";
      if (d._auto) { var nid = unique(v || "domain", d); if (nid !== d.id) { if (ui.closed["d:" + d.id]) ui.closed["d:" + nid] = true; d.id = nid; sel.id = nid; idInput.value = nid; history.replaceState(null, "", "#domain:" + nid); } }
    } });
    var blurb = text(d, "blurb", { rows: 3 });
    edit.appendChild(head("Domain · " + d.stars.length + (d.stars.length === 1 ? " star" : " stars"), d.name || "Untitled", d.color,
      [check(d, "hidden", "Hidden from the site", true), showIn("map")]));
    edit.appendChild(part("Domain", null, [
      field("name", "Name", "The cluster’s name on the map, in the legend and in the table filters.", name),
      field("blurb", "Blurb", "Shown under the name when the domain is hovered or zoomed into.", blurb, counter(blurb, 160)),
      el("div", { class: "grid2" },
        field("color", "Colour", "Every star, planet and line in the domain takes it.", el("div", { class: "hrow" }, picker, hex)),
        field("angle", "Position", "Where the domain sits around the centre on wide screens: 0° is right, −90° top, 90° bottom. On phones domains stack in this list’s order.", el("div", { class: "hrow" }, dial, angle), angleN)),
      field("heart", "Heart", "The domain’s centre star; the others gather around it.", choose([["", "The first star"]].concat(d.stars.map(function (s) { return [s.id, s.title || s.id]; })), d.heart, function (v) { before(); d.heart = v || undefined; changed(true); })),
      field("id", "ID", "Used in links to the domain (#" + d.id + ").", idInput)
    ]));
    var box = el("div", { class: "kids" });
    d.stars.forEach(function (s, i) {
      box.appendChild(el("div", { class: "kids__row" + (s.hidden ? " is-hidden" : "") },
        btn(el("span", null, el("b", null, (d.heart === s.id ? "★ " : "") + (s.title || s.id)), s.mapNote ? el("span", { class: "muted" }, " · " + s.mapNote) : null, (s.planets || []).length ? el("span", { class: "muted" }, " · " + s.planets.length + " planets") : null), function () { select("body", s.id); }, { cls: "kids__open" }),
        badge(issuesFor(s.id), s),
        btn("↑", function () { step(d.stars, s, -1); }, { cls: "icon", aria: "Move up", disabled: i === 0 }),
        btn("↓", function () { step(d.stars, s, 1); }, { cls: "icon", aria: "Move down", disabled: i === d.stars.length - 1 })));
    });
    box.appendChild(btn("+ Star", function () { addStar(d); }, { cls: "ghost small" }));
    edit.appendChild(part("Stars", "In reading order: the table, Previous / Next, and the order they are placed around the heart.", box));
    edit.appendChild(part("Notes", null, field("notes", "Editor notes", BODY_HELP.notes, text(d, "notes", { rows: 3 }))));
    var i = doc.domains.indexOf(d);
    edit.appendChild(el("div", { class: "ed__danger" },
      btn("Move up", function () { step(doc.domains, d, -1); }, { cls: "small", disabled: i === 0 }),
      btn("Move down", function () { step(doc.domains, d, 1); }, { cls: "small", disabled: i === doc.domains.length - 1 }),
      btn("Delete domain…", function () { removeDomain(d); }, { cls: "small danger" })));
  }

  var LABEL_HELP = {
    galaxy: "First breadcrumb, back to the whole map", core: "The centre, in breadcrumbs and the table", close: "The card’s close button",
    system: "Over a star’s planets on its card", systemOf: "Over the planets on a planet’s card; {star} is the star", near: "Over a card’s connections",
    builtWith: "Before the Built with line", previous: "Previous card link", next: "Next card link",
    hoverSystem: "Hover hint on a star with planets; {n} is how many", hoverPlanet: "Hover hint on a planet; {star} is its star", hoverStar: "Hover hint on any other card",
    colName: "Table column", colDomain: "Table column", colPart: "Table column", colWhen: "Table column", colKind: "Table column",
    all: "First table filter", mapOrder: "Table button that restores map order", find: "Label of the table search", findPlaceholder: "Placeholder of the table search"
  };
  var SECTIONS = {
    hover: { kicker: "Domain (or its star) and dates", title: "Title", subtitle: "Subtitle", summary: "Summary", firstParagraph: "First paragraph of the body", builtWith: "Built with", links: "First three links", hint: "Click hint" },
    detail: { media: "Media", meta: "Kind, dates and subtitle", title: "Title", summary: "Summary", body: "Body paragraphs", builtWith: "Built with", links: "Links", system: "The system’s planets", connections: "Where it meets (connections)", steps: "Previous and next" }
  };
  function layoutEditor(which) {
    var box = el("div", { class: "layout" }), names = SECTIONS[which], every = which === "hover" ? S.HOVER : S.DETAIL;
    function draw() {
      box.textContent = "";
      var on = doc.site.card[which];
      on.concat(every.filter(function (k) { return on.indexOf(k) < 0; })).forEach(function (k) {
        var i = on.indexOf(k), c = el("input", { type: "checkbox", checked: i >= 0 });
        c.addEventListener("change", function () { before(); if (c.checked) on.push(k); else on.splice(on.indexOf(k), 1); changed(false); draw(); });
        box.appendChild(el("div", { class: "layout__row" + (i < 0 ? " is-off" : "") },
          el("label", { class: "check" }, c, " " + (names[k] || k)),
          i >= 0 ? btn("↑", function () { before(); swap(on, i, -1); changed(false); draw(); }, { cls: "icon", aria: "Earlier", disabled: i === 0 }) : null,
          i >= 0 ? btn("↓", function () { before(); swap(on, i, 1); changed(false); draw(); }, { cls: "icon", aria: "Later", disabled: i === on.length - 1 }) : null));
      });
    }
    draw(); return box;
  }
  function renderSite() {
    var s = doc.site;
    edit.appendChild(head("The whole site", "Site text & card layout", CORE_COLOR));
    edit.appendChild(part("Name and opening", "The opening plays once when the page loads. An empty field shows nothing there.", [
      el("div", { class: "grid2" }, field("name", "Name", "Top left, and the opening’s title.", text(s, "name")), field("tagline", "Tagline", "Under the name, top left.", text(s, "tagline"))),
      field("intro.kicker", "Opening kicker", "Small capitals above the name.", text(s.intro, "kicker")),
      field("intro.line", "Opening line", "Under the name in the opening.", text(s.intro, "line", { rows: 2 })),
      el("div", { class: "grid2" }, field("hint.pointer", "Hint with a mouse", "Bottom right for a while.", text(s.hint, "pointer")), field("hint.touch", "Hint on touch screens", null, text(s.hint, "touch")))
    ]));
    edit.appendChild(part("Page and sharing", "Applied to the published page and search/link previews.", [
      field("pageTitle", "Page title", "Browser tab and link title. Empty uses your name.", text(s, "pageTitle")),
      field("description", "Page description", "Search and link preview. Empty uses your tagline.", text(s, "description", { rows: 3 })),
      field("socialImage", "Sharing image", "An image URL or assets/media/ path.", text(s, "socialImage")),
      field("socialHandle", "Social handle", "Optional, e.g. @aryan_poonacha.", text(s, "socialHandle"))
    ]));
    edit.appendChild(part("Links", null, [
      field("links", "Elsewhere", "Top right of the map, and at the foot of the table.", linksEditor(s, "links")),
      field("moreLinks", "More, in the table only", "Extra links at the foot of the table.", linksEditor(s, "moreLinks"))
    ]));
    edit.appendChild(part("Card layout", "Which sections the cards show, in order. It applies to every card; a section with nothing to show is skipped.", el("div", { class: "grid2" },
      field("card.hover", "Hover card", "Next to the media, while the pointer is over a card.", layoutEditor("hover")),
      field("card.detail", "Card", "The panel that opens on click.", layoutEditor("detail")))));
    var labels = el("div", { class: "labels" });
    Object.keys(S.LABELS).forEach(function (k) {
      labels.appendChild(field("labels." + k, LABEL_HELP[k] || k, null, text(s.labels, k, { placeholder: S.LABELS[k] })));
    });
    edit.appendChild(part("Interface words", "Every word the site itself says. Empty uses the default shown.", [field("indexTitle", "Table heading", null, text(s, "indexTitle", { placeholder: "Every star, as a table" })), labels]));
    edit.appendChild(el("p", { class: "help" }, "Page title, search description and sharing image are editable above and included when you publish."));
  }
  function renderKinds() {
    edit.appendChild(head("Kinds", "Kinds of card", CORE_COLOR));
    var used = {}; all().forEach(function (f) { used[f.body.kind] = (used[f.body.kind] || 0) + 1; });
    var box = el("div", { class: "list" });
    Object.keys(doc.kinds).forEach(function (k) {
      box.appendChild(el("div", { class: "list__row" }, el("code", { class: "list__key" }, k), text(doc.kinds, k, { cls: "list__label" }), el("span", { class: "muted" }, (used[k] || 0) + " cards"),
        btn("×", function () { before(); delete doc.kinds[k]; changed(true); }, { cls: "icon", aria: "Remove kind", disabled: used[k] > 0, title: used[k] ? "In use" : "Remove" })));
    });
    var key = el("input", { placeholder: "key, e.g. talk", spellcheck: "false" }), lab = el("input", { placeholder: "Label, e.g. Talk" });
    box.appendChild(el("div", { class: "list__row" }, key, lab, btn("+ Kind", function () {
      var k = S.slug(key.value); if (!key.value.trim() || doc.kinds[k]) return setStatus(doc.kinds[k] ? "That kind exists" : "Give the kind a key", true);
      before(); doc.kinds[k] = lab.value.trim() || key.value.trim(); changed(true);
    }, { cls: "small" })));
    edit.appendChild(part("Kinds", "Each card has one; its label shows at the top of the card and in the table. “interest” draws as a ring on the map; “part” suits a planet.", box));
  }
  function renderPath() {
    edit.appendChild(head("Highlighted path", "The lit path", CORE_COLOR));
    var box = el("div", { class: "kids" });
    doc.path.forEach(function (id, i) {
      box.appendChild(el("div", { class: "kids__row" }, el("span", { class: "kids__n" }, String(i + 1)), chipFor(id),
        btn("↑", function () { before(); swap(doc.path, i, -1); changed(true); }, { cls: "icon", aria: "Earlier", disabled: i === 0 }),
        btn("↓", function () { before(); swap(doc.path, i, 1); changed(true); }, { cls: "icon", aria: "Later", disabled: i === doc.path.length - 1 }),
        btn("×", function () { before(); doc.path.splice(i, 1); changed(true); }, { cls: "icon", aria: "Remove" })));
    });
    box.appendChild(cardPicker("Add a card to the path…", function (id) { before(); doc.path.push(id); changed(true); }));
    edit.appendChild(part("Path", "A glowing line with moving light through these cards, in order: the career, by default.", box));
  }
  function renderConnections() {
    edit.appendChild(head("Connections", doc.connections.length + " lines between cards", CORE_COLOR));
    var filter = el("input", { type: "search", placeholder: "Filter…" }), box = el("div", { class: "pairs" });
    function draw() {
      box.textContent = ""; var q = filter.value.trim().toLowerCase();
      doc.connections.forEach(function (p) {
        var a = find(p[0]), b = find(p[1]), t = [p[0], p[1], a && a.body.title, b && b.body.title].join(" ").toLowerCase();
        if (q && t.indexOf(q) < 0) return;
        box.appendChild(el("div", { class: "pairs__row" }, chipFor(p[0]), el("span", { class: "muted" }, "↔"), chipFor(p[1]),
          btn("×", function () { before(); doc.connections.splice(doc.connections.indexOf(p), 1); changed(false); draw(); }, { cls: "icon", aria: "Remove connection" })));
      });
    }
    filter.addEventListener("input", draw);
    var first = null;
    var adder = el("div", { class: "hrow" }, cardPicker("From…", function (id) { first = id; fromLabel.textContent = "From " + label(find(id).body) + " to:"; }),
      cardPicker("To…", function (id) {
        if (!first) return setStatus("Choose where the line starts first", true);
        if (first === id || doc.connections.some(function (p) { return (p[0] === first && p[1] === id) || (p[1] === first && p[0] === id); })) return setStatus("Already connected");
        before(); doc.connections.push([first, id]); first = null; fromLabel.textContent = ""; changed(false); draw();
      }));
    var fromLabel = el("span", { class: "muted" });
    edit.appendChild(part("Add", "Connections show where the domains meet. Each card’s own connections are also on its page here.", [adder, fromLabel]));
    edit.appendChild(part("All", null, [filter, box]));
    draw();
  }
  function renderOverview() {
    var list = all(), reviewed = list.filter(function (f) { return f.body.reviewed; }).length, issues = S.check(doc), byId = {};
    issues.forEach(function (i) { (byId[i.id] = byId[i.id] || []).push(i); });
    var errs = issues.filter(function (i) { return i.level === "error"; }), warns = issues.filter(function (i) { return i.level === "warn"; });
    edit.appendChild(head("Everything", "Overview", CORE_COLOR));
    edit.appendChild(el("div", { class: "progress" },
      el("div", { class: "progress__bar" }, el("i", { style: "width:" + (list.length ? reviewed / list.length * 100 : 0).toFixed(1) + "%" })),
      el("p", null, el("b", null, reviewed + " of " + list.length), " cards reviewed · " + errs.length + (errs.length === 1 ? " error" : " errors") + " · " + warns.length + (warns.length === 1 ? " warning" : " warnings"))));
    edit.appendChild(el("p", { class: "help" }, "Work through the cards: rewrite each one, then tick Reviewed. Errors stop a save; warnings are content that may need work. Nothing is published until you save and publish."));
    if (errs.length) {
      var eb = el("ul", { class: "problems" });
      errs.forEach(function (i) { eb.appendChild(el("li", null, btn(i.msg, function () { goIssue(i); }, { cls: "link" }))); });
      edit.appendChild(part("Errors to fix", null, eb, { cls: "part--bad" }));
    }
    var filters = [["all", "All"], ["work", "Needs work"], ["todo", "Not reviewed"], ["done", "Reviewed"], ["hidden", "Hidden"]];
    edit.appendChild(el("div", { class: "seg seg--filters" }, filters.map(function (f) {
      return btn(f[1], function () { ui.filter = f[0]; saveUi(); renderEdit(); }, { cls: ui.filter === f[0] ? "is-on" : "" });
    })));
    var tb = el("tbody");
    list.forEach(function (f) {
      var b = f.body, mine = byId[b.id] || [];
      if (ui.filter === "work" && !mine.length) return;
      if (ui.filter === "todo" && b.reviewed) return;
      if (ui.filter === "done" && !b.reviewed) return;
      if (ui.filter === "hidden" && !hiddenAt(f)) return;
      var c = el("input", { type: "checkbox", checked: !!b.reviewed, "aria-label": "Reviewed" });
      c.addEventListener("change", function () { before(); b.reviewed = c.checked || undefined; changed(false); });
      tb.appendChild(el("tr", { class: (f.at.planet ? "is-planet" : "") + (hiddenAt(f) ? " is-hidden" : ""), style: "--c:" + colorOf(f) },
        el("td", null, btn(el("span", null, el("i", { class: "row__dot" }), b.title || b.id, el("small", null, where(f))), function () { select("body", b.id); }, { cls: "link" })),
        el("td", { class: "num" + (!(b.summary || "").trim() && b.kind !== "interest" ? " is-bad" : "") }, String((b.summary || "").length)),
        el("td", { class: "num" }, String((b.body || []).length)),
        el("td", { class: "muted" }, b.media ? b.media.type : "—"),
        el("td", { class: "num" }, String((b.links || []).length)),
        el("td", null, mine.length ? el("span", { class: "issues", title: mine.map(function (i) { return i.msg; }).join("\n") }, badge(mine), " " + mine[0].msg) : null),
        el("td", { class: "c" }, c)));
    });
    edit.appendChild(el("div", { class: "table-wrap" }, el("table", { class: "overview" },
      el("thead", null, el("tr", null, [["Card"], ["Summary", "Characters in the summary"], ["¶", "Paragraphs in the body"], ["Media"], ["Links"], ["Needs"], ["✓", "Reviewed"]].map(function (h) { return el("th", { title: h[1] || null }, h[0]); }))), tb)));
  }
  function goIssue(i) {
    if (i.id === "connections") return select("connections");
    if (i.id === "path") return select("path");
    if (i.id && i.id.indexOf("domain:") === 0) return select("domain", i.id.slice(7), i.field);
    if (i.id && find(i.id)) return select("body", i.id, i.field);
  }

  /* ---------- selection ---------- */
  function select(type, id, focusKey) {
    sel = { type: type, id: id };
    history.replaceState(null, "", "#" + type + (id ? ":" + id : ""));
    show(focusKey);
  }
  /* open the selection's parents in the list, draw, and bring its row into view */
  function show(focusKey) {
    if (sel.type === "body") { var f = find(sel.id); if (f && f.at.parent) ui.open["b:" + f.at.parent.id] = true; if (f && f.at.domain) ui.closed["d:" + f.at.domain.id] = false; }
    if (sel.type === "domain") ui.closed["d:" + sel.id] = false;
    renderTree(); renderEdit(focusKey); edit.scrollTop = 0; preview();
    var on = tree.querySelector(".row.is-on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }

  /* ---------- the preview: the real site, reading the draft ---------- */
  var frame = $("frame"), stage = $("preview-stage"), shown = { draft: null, query: null }, version = 0;
  window.addEventListener("message", function (e) {
    if (!doc || e.origin !== location.origin || e.source !== frame.contentWindow || !e.data || e.data.type !== "galaxy-draft-ready") return;
    e.source.postMessage({ type: "galaxy-draft", doc: P ? P.previewDoc(doc) : doc }, location.origin);
  });
  function target() {
    var q = "", hash = "";
    if (sel.type === "body") {
      var f = find(sel.id);
      if (f && !hiddenAt(f)) { if (ui.mode === "hover") q = "&at=" + sel.id + "&hover=" + sel.id; else if (ui.mode === "map") q = "&at=" + sel.id; else hash = "#" + sel.id; }
    } else if (sel.type === "domain" && domain(sel.id) && !domain(sel.id).hidden) q = "&cluster=" + sel.id;
    return { query: "?draft=1&editor=" + encodeURIComponent(draftId) + "&intro=0" + q, hash: hash };
  }
  function preview() {
    if (!ui.preview || !doc) return;
    var draft = S.format(doc), t = target();
    $("preview-open").href = PREVIEW + t.query + t.hash;
    if (draft === shown.draft && t.query === shown.query && frame.contentWindow && frame.src) {
      /* same content and view: only the hash moves, and the site flies there */
      try { if (frame.contentWindow.location.hash !== t.hash) frame.contentWindow.location.hash = t.hash || ""; return; } catch (e) { /* reload below */ }
    }
    store(KEY.draft + ":" + draftId, JSON.stringify(P ? P.previewDoc(doc) : doc));
    shown = { draft: draft, query: t.query };
    frame.src = PREVIEW + t.query + "&v=" + (++version) + t.hash;
  }
  var previewSoon = debounce(preview, 900);
  /* a phone is 390 × 844; a desktop is 1280 wide and as tall as the panel's shape allows */
  function fit() {
    var w = stage.clientWidth || 1, h = stage.clientHeight || 1, d = ui.device === "phone" ? [390, 844] : [1280, Math.round(Math.max(720, Math.min(1440, 1280 * h / w)))], k = Math.min(w / d[0], h / d[1]);
    frame.style.width = d[0] + "px"; frame.style.height = d[1] + "px";
    frame.style.transform = "translate(" + Math.max(0, (w - d[0] * k) / 2) + "px," + Math.max(0, (h - d[1] * k) / 2) + "px) scale(" + k + ")";
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
  window.addEventListener("resize", fit);
  function syncPreviewUi() {
    $("shell").classList.toggle("no-preview", !ui.preview);
    $("toggle-preview").setAttribute("aria-pressed", String(ui.preview));
    document.querySelectorAll("#preview-mode button").forEach(function (b) { b.classList.toggle("is-on", b.dataset.mode === ui.mode); });
    document.querySelectorAll("#preview-device button").forEach(function (b) { b.classList.toggle("is-on", b.dataset.device === ui.device); });
    $("preview-auto").checked = ui.auto;
    fit();
  }
  $("toggle-preview").addEventListener("click", function () { ui.preview = !ui.preview; saveUi(); syncPreviewUi(); if (ui.preview) { preview(); revealOnPhone($("preview")); } });
  $("preview-back").addEventListener("click", function () { revealOnPhone(edit); });
  $("preview-mode").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; ui.mode = b.dataset.mode; saveUi(); syncPreviewUi(); preview(); });
  $("preview-device").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; ui.device = b.dataset.device; saveUi(); syncPreviewUi(); shown.query = null; preview(); });
  $("preview-auto").addEventListener("change", function () { ui.auto = this.checked; saveUi(); if (ui.auto) preview(); });
  $("preview-reload").addEventListener("click", function () { shown.query = null; preview(); });

  /* ---------- saving ---------- */
  function putFile(path, blob, replace) {
    return fetch(SITE + "__admin/file?path=" + encodeURIComponent(path) + (replace ? "&replace=1" : ""), { method: "PUT", body: blob }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 409 && j.exists) { var e = new Error(j.error); e.exists = true; throw e; }
        if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
        return j;
      });
    });
  }
  function blockers() {
    var errs = S.check(doc).filter(function (i) { return i.level === "error"; });
    if (errs.length) { setStatus("Fix " + errs.length + (errs.length === 1 ? " error" : " errors") + " before saving", true); select("overview"); }
    return errs.length > 0;
  }
  function settle() { all().forEach(function (f) { delete f.body._auto; }); doc.domains.forEach(function (d) { delete d._auto; }); }
  function saveNow() {
    if (P && P.busy()) return;
    if (!doc || blockers()) return;
    if (P && P.connected()) return P.save();
    if (!server) return P.open();
    var t = S.format(doc);
    setStatus("Saving…");
    putFile("content/galaxy.json", new Blob([t], { type: "application/json" })).then(function () {
      baseText = savedText = t; savedVia = "disk"; settle(); keepWork(); refreshStatus();
      setStatus("Saved to content/galaxy.json at " + clock(Date.now()));
      dialogMsg("Saved to content/galaxy.json.");
    }).catch(function (e) { setStatus("Not saved: " + e.message, true); dialogMsg("Not saved: " + e.message, true); });
  }
  function download() {
    if (!doc) return;
    var a = el("a", { href: URL.createObjectURL(new Blob([S.format(doc)], { type: "application/json" })), download: "galaxy.json" });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    dialogMsg("Downloaded galaxy.json.");
  }
  function importFile(file) {
    file.text().then(function (t) {
      var c = JSON.parse(t);
      if (!c || typeof c !== "object" || !c.core || !c.domains) throw new Error("this is not a galaxy content file (no core or domains)");
      c = ensureShape(c); S.format(c); S.check(c);
      if (doc) before();
      doc = c; sel = { type: "overview" }; changed(true); preview();
      setStatus("Opened " + file.name + " (not saved yet)"); closeDialog();
    }).catch(function (e) { dialogMsg("Could not open it: " + e.message, true); });
  }
  var dialog = $("save-dialog");
  function dialogMsg(m, bad) { var p = $("save-msg"); p.textContent = m || ""; p.classList.toggle("is-bad", !!bad); }
  function openDialog() {
    $("save-disk").hidden = !server || (P && P.connected());
    if (server) $("save-disk-help").textContent = "Writes " + (server.root ? server.root + "/" : "") + "content/galaxy.json in this checkout; the previous version goes to content/.backups/. Commit and push it with git when you are ready.";
    dialogMsg("");
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
  }
  function closeDialog() { if (dialog.open) dialog.close(); }
  /* Enter in a field must not close the dialog; only its × does */
  dialog.querySelector("form").addEventListener("submit", function (e) { if (!e.submitter || e.submitter.value !== "cancel") e.preventDefault(); });
  $("save-disk-go").addEventListener("click", saveNow);
  $("download").addEventListener("click", download);
  $("import").addEventListener("change", function () { if (this.files[0]) importFile(this.files[0]); this.value = ""; });
  $("save").addEventListener("click", saveNow);
  $("more").addEventListener("click", openDialog);
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  document.addEventListener("keydown", function (e) {
    var mod = e.metaKey || e.ctrlKey, k = (e.key || "").toLowerCase();
    if (mod && k === "s") { e.preventDefault(); saveNow(); }
    else if (mod && k === "z" && !inField(e.target)) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && k === "y" && !inField(e.target)) { e.preventDefault(); redo(); }
  });
  window.addEventListener("beforeunload", function (e) { keepWork(); if (doc && S.format(doc) !== savedText) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------- start ---------- */
  function banner(msg, actions) {
    var b = $("banner"); b.textContent = "";
    b.appendChild(el("span", null, msg));
    actions.forEach(function (a) { b.appendChild(btn(a.label, function () { b.hidden = true; a.fn(); }, { cls: a.primary ? "primary small" : "small" })); });
    b.hidden = false;
  }
  function restoreSel() {
    var m = location.hash.match(/^#(\w+)(?::([a-z0-9-]+))?$/);
    if (m) sel = { type: m[1], id: m[2] };
    fixSel();
    if (["overview", "site", "kinds", "path", "connections", "domain", "body"].indexOf(sel.type) < 0) sel = { type: "overview" };
  }
  window.addEventListener("hashchange", function () { if (!doc) return; restoreSel(); show(); });
  function start(t) {
    doc = ensureShape(JSON.parse(t));
    baseText = savedText = S.format(doc);
    var workKey = KEY.work, work = stored(workKey);
    if (!work) { workKey = "galaxy:admin:work"; work = stored(workKey); }
    pendingRecovery = null;
    if (!work) {
      // A closed tab's unsaved work can still be recovered in this browser.
      try {
        Object.keys(localStorage).filter(function (k) { return k.indexOf("galaxy:admin:work:") === 0; }).forEach(function (k) {
          var owner = k.slice("galaxy:admin:work:".length).split(":")[0];
          if (owner !== draftId && activeTabIds.has(owner)) return;
          var candidate = stored(k);
          if (candidate && candidate.doc && (!work || candidate.at > work.at)) { work = candidate; workKey = k; }
        });
      } catch (e) { /* storage unavailable; cloud editing still works */ }
    }
    if (work && work.doc) {
      var wt = S.format(ensureShape(work.doc));
      if (wt === baseText) store(workKey, undefined);
      else {
        var moved = work.base !== hashText(baseText);
        pendingRecovery = { work: work, key: workKey };
        banner(work.savedVia
          ? "This browser has the version you saved (" + work.savedVia + ", " + day(work.at) + "), which this copy of the site does not show yet."
          : "This browser kept changes you had not saved (" + day(work.at) + ")." + (moved ? " content/galaxy.json has changed since; restoring replaces those changes when you save." : ""),
          [{ label: work.savedVia ? "Use it" : "Restore them", primary: true, fn: function () { before(); var recovery = pendingRecovery; pendingRecovery = null; doc = ensureShape(work.doc); if (recovery && recovery.key !== KEY.work) { store(KEY.work, work); store(recovery.key, undefined); } if (work.savedVia) { savedText = wt; savedVia = work.savedVia; } changed(true); preview(); } },
           { label: "Discard", fn: function () { if (pendingRecovery) store(pendingRecovery.key, undefined); pendingRecovery = null; keepWork(); } }]);
      }
    }
    restoreSel(); syncPreviewUi(); refreshStatus(); show();
  }
  Promise.all([
    fetch(SITE + "content/galaxy.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("content/galaxy.json: HTTP " + r.status); return r.text(); }),
    fetch(SITE + "__admin/ping", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    tabIdentityReady
  ]).then(function (res) {
    server = res[1] && res[1].ok ? res[1] : null;
    try {
      start(res[0]);
      window.dispatchEvent(new CustomEvent("galaxy-editor-ready", { detail: {
        text: function () { return S.format(doc); },
        base: function () { return baseText; },
        dirty: function () { return S.format(doc) !== savedText; },
        local: function () { return !!server; },
        site: function () { return SITE; },
        hasRecovery: function () { return !$("banner").hidden; },
        blocked: blockers,
        status: setStatus,
        preview: function () { shown.draft = null; preview(); },
        mediaReady: function () {
          edit.querySelectorAll("[data-media-src]").forEach(function (node) {
            var src = mediaUrl(node.dataset.mediaSrc);
            if (node.src !== src) node.src = src;
            if (node.dataset.mediaPoster) node.poster = mediaUrl(node.dataset.mediaPoster);
          });
        },
        connected: refreshStatus,
        disconnected: refreshStatus,
        remote: function (text, initial) {
          if (initial) { start(text); return; }
          if (pendingRecovery && pendingRecovery.key === KEY.work) {
            if (!store(KEY.work + ":recovered:" + pendingRecovery.work.at, pendingRecovery.work)) throw new Error("Download or restore the pending browser recovery before loading another draft.");
          }
          if (pendingRecovery && S.format(doc) === baseText) { undoStack.push(JSON.stringify(pendingRecovery.work.doc)); redoStack = []; lastKey = null; }
          else before();
          doc = ensureShape(JSON.parse(text)); baseText = savedText = S.format(doc);
          savedVia = "cloud"; pendingRecovery = null; $("banner").hidden = true; fixSel(); keepWork(); changed(true); preview();
        },
        saved: function (text, via) {
          baseText = savedText = text; savedVia = via; settle(); keepWork(); refreshStatus();
        }
      } }));
    }
    catch (e) {
      $("status").textContent = "Could not read content/galaxy.json";
      edit.appendChild(el("div", { class: "part part--bad" }, el("h3", { class: "part__h" }, "content/galaxy.json is not valid JSON"), el("p", null, e.message),
        el("p", { class: "help" }, "Fix it in a text editor, or open a good copy (a download, or one from content/.backups/) with Save as… → Open a file.")));
      doc = null;
    }
  }).catch(function (e) { $("status").textContent = e.message; $("status").dataset.state = "bad"; });
})();
