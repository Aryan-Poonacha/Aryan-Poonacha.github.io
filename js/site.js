/* aryan-poonacha.github.io — v3 behaviour. No dependencies. */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var narrow = function () { return window.innerWidth < 720; };

  /* ---- nav sheet + current section ---- */
  var toggle = document.querySelector(".nav__toggle");
  var sheet = document.querySelector(".nav__sheet");
  if (toggle && sheet) {
    toggle.addEventListener("click", function () {
      var open = sheet.getAttribute("data-open") === "true";
      sheet.setAttribute("data-open", open ? "false" : "true");
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      toggle.textContent = open ? "Fields ≡" : "Close ×";
    });
    sheet.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        sheet.setAttribute("data-open", "false");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "Fields ≡";
      }
    });
  }
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav__links a[href^='#']"));
  var sections = navLinks.map(function (a) { return document.querySelector(a.getAttribute("href")); }).filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    var current = null;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) current = en.target.id; });
      navLinks.forEach(function (a) {
        if (a.getAttribute("href") === "#" + current) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    }, { rootMargin: "-35% 0px -55% 0px" });
    sections.forEach(function (s) { obs.observe(s); });
  }

  /* ---- the dial ---- */
  var dial = document.querySelector(".dial");
  var dataEl = document.getElementById("dial-data");
  if (dial && dataEl) {
    var data = JSON.parse(dataEl.textContent);
    var byId = {};
    data.items.forEach(function (it) { byId[it.id] = it; });
    var fieldName = {};
    data.domains.forEach(function (d) { fieldName[d.id] = d.name; });

    var card = dial.parentNode.querySelector(".dial__card") || dial.querySelector(".dial__card");
    var cardImg = card.querySelector("img");
    var cardT = card.querySelector(".t");
    var cardM = card.querySelector(".m");
    var dots = Array.prototype.slice.call(dial.querySelectorAll(".dot"));
    var active = null;

    dots.forEach(function (dot, i) {
      dot.setAttribute("tabindex", "0");
      dot.setAttribute("role", "button");
      var it = byId[dot.getAttribute("data-id")];
      if (it) dot.setAttribute("aria-label", it.title + (it.year ? ", " + it.year : "") + ", " + fieldName[it.domain]);
      if (!reduced) dot.style.animationDelay = (i * 18) + "ms";
    });

    function show(dot) {
      var it = byId[dot.getAttribute("data-id")];
      if (!it) return;
      if (active && active !== dot) active.classList.remove("is-active");
      active = dot;
      dot.classList.add("is-active");
      card.className = "dial__card f-" + it.domain;
      if (it.poster) { cardImg.src = it.poster; cardImg.style.display = ""; }
      else { cardImg.removeAttribute("src"); cardImg.style.display = "none"; }
      cardT.textContent = it.title;
      cardM.textContent = fieldName[it.domain] + (it.year ? " · " + it.year : " · interest") + (it.kind === "interest" ? "" : " · click to jump ↓");
      card.setAttribute("data-on", "true");
      if (!narrow()) {
        var r = dial.getBoundingClientRect();
        var d = dot.getBoundingClientRect();
        var x = d.left - r.left + d.width / 2;
        var y = d.top - r.top + d.height / 2;
        var w = 236, h = card.offsetHeight || 200;
        var left = x + 18, top = y - h / 2;
        if (left + w > r.width) left = x - w - 18;
        if (top < 0) top = 0;
        if (top + h > r.height) top = r.height - h;
        card.style.left = left + "px";
        card.style.top = top + "px";
      } else {
        card.style.left = ""; card.style.top = "";
      }
    }
    function hide() {
      if (narrow()) return; // on phones the card stays until another tap
      card.setAttribute("data-on", "false");
      if (active) active.classList.remove("is-active");
      active = null;
    }
    function jump(dot) {
      var it = byId[dot.getAttribute("data-id")];
      if (!it || it.kind === "interest") return;
      var target = document.getElementById("item-" + it.id);
      if (target) {
        target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
        target.classList.add("is-hit");
        setTimeout(function () { target.classList.remove("is-hit"); }, 1600);
      }
    }
    dots.forEach(function (dot) {
      dot.addEventListener("mouseenter", function () { if (!narrow()) show(dot); });
      dot.addEventListener("mouseleave", hide);
      dot.addEventListener("focus", function () { show(dot); });
      dot.addEventListener("blur", hide);
      dot.addEventListener("click", function () {
        if (narrow()) { if (active === dot) jump(dot); else show(dot); }
        else jump(dot);
      });
      dot.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(dot); } });
    });
    // legend hover dims the other fields
    Array.prototype.forEach.call(document.querySelectorAll(".legend a[data-field]"), function (a) {
      var f = a.getAttribute("data-field");
      a.addEventListener("mouseenter", function () {
        dial.setAttribute("data-field", f);
        dots.forEach(function (d) { d.classList.toggle("in-field", (byId[d.getAttribute("data-id")] || {}).domain === f); });
      });
      a.addEventListener("mouseleave", function () { dial.removeAttribute("data-field"); });
    });
  }

  /* ---- recordings: featured media + rows ---- */
  Array.prototype.forEach.call(document.querySelectorAll(".media[data-video]"), function (m) {
    var btn = m.querySelector(".media__play");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var v = m.querySelector("video");
      if (!v) {
        v = document.createElement("video");
        v.setAttribute("controls", ""); v.setAttribute("playsinline", ""); v.setAttribute("muted", ""); v.setAttribute("preload", "metadata");
        v.setAttribute("poster", m.getAttribute("data-poster") || "");
        v.setAttribute("src", m.getAttribute("data-video"));
        m.appendChild(v);
      }
      m.setAttribute("data-playing", "true");
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".row[data-video]"), function (row) {
    var btn = row.querySelector("button.rec");
    var clip = row.querySelector(".clip");
    if (!btn || !clip) return;
    btn.addEventListener("click", function () {
      var open = row.getAttribute("data-open") === "true";
      if (open) {
        row.setAttribute("data-open", "false");
        var v0 = clip.querySelector("video"); if (v0) v0.pause();
        btn.textContent = "Recording ▶";
        return;
      }
      if (!clip.querySelector("video")) {
        var v = document.createElement("video");
        v.setAttribute("controls", ""); v.setAttribute("playsinline", ""); v.setAttribute("muted", ""); v.setAttribute("preload", "metadata");
        v.setAttribute("poster", row.getAttribute("data-poster") || "");
        v.setAttribute("src", row.getAttribute("data-video"));
        clip.insertBefore(v, clip.firstChild);
      }
      row.setAttribute("data-open", "true");
      btn.textContent = "Hide recording";
    });
  });
})();
