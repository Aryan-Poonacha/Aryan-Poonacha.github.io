/* Notes use the same editable card content as the map. No second copy of the prose. */
(function () {
  "use strict";
  var main = document.querySelector("main[data-card]"), S = window.GalaxySchema;
  var root = new URL("../", location.href);
  function element(tag, text, cls) {
    var e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function rich(tag, value) {
    var e = element(tag), re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    var text = String(value || ""), at = 0, m;
    while ((m = re.exec(text))) {
      e.appendChild(document.createTextNode(text.slice(at, m.index)));
      if (m[1] && S.safeUrl(m[2])) {
        var a = element("a", m[1]); a.href = new URL(m[2], root).href; e.appendChild(a);
      } else e.appendChild(m[1] ? document.createTextNode(m[1]) : element(m[3] ? "strong" : "em", m[3] || m[4]));
      at = re.lastIndex;
    }
    e.appendChild(document.createTextNode(text.slice(at)));
    return e;
  }
  fetch(new URL("content/galaxy.json", root), { cache: "no-cache" }).then(function (response) {
    if (!response.ok) throw new Error("Content unavailable (HTTP " + response.status + ").");
    return response.json();
  }).then(function (doc) {
    var card;
    S.walk(doc, function (b, at) {
      if (b.id === main.dataset.card && !b.hidden && !(at.domain && at.domain.hidden) && !(at.parent && at.parent.hidden)) card = b;
    });
    if (!card) throw new Error("This note is unavailable.");
    main.textContent = "";
    var back = element("a", "← " + (doc.site.name || "Home"), "links back");
    back.href = new URL("galaxy.html#" + card.id, root).href;
    main.appendChild(back);
    main.appendChild(element("h1", card.title));
    main.appendChild(element("p", [card.when, card.subtitle].filter(Boolean).join(" · "), "meta"));
    if (card.summary) main.appendChild(rich("p", card.summary));
    (card.body || []).forEach(function (text) {
      var heading = /^\*\*([^*]+)\*\*$/.exec(text);
      main.appendChild(heading ? element("h2", heading[1]) : rich("p", text));
    });
    document.title = card.title + " · " + (doc.site.name || "");
  }).catch(function (error) {
    main.textContent = "";
    main.appendChild(element("p", "The note could not load. " + error.message));
  });
})();
