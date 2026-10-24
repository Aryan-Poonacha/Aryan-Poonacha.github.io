/* Aryan Poonacha — site behaviour. No dependencies. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ---- mobile nav sheet ---- */
  var toggle = document.querySelector(".nav__toggle");
  var sheet = document.querySelector(".nav__sheet");
  if (toggle && sheet) {
    toggle.addEventListener("click", function () {
      var open = sheet.getAttribute("data-open") === "true";
      sheet.setAttribute("data-open", open ? "false" : "true");
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      toggle.textContent = open ? "Index ≡" : "Close ×";
    });
    sheet.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        sheet.setAttribute("data-open", "false");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "Index ≡";
      }
    });
  }

  /* ---- current section in nav ---- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav__links a[href^='#']"));
  var sections = navLinks
    .map(function (a) { return document.querySelector(a.getAttribute("href")); })
    .filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    var current = null;
    var secObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) current = en.target.id;
      });
      navLinks.forEach(function (a) {
        var on = a.getAttribute("href") === "#" + current;
        if (on) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    }, { rootMargin: "-40% 0px -55% 0px", threshold: 0 });
    sections.forEach(function (s) { secObs.observe(s); });
  }

  /* ---- route line + reveals ---- */
  var route = document.querySelector(".route");
  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if ("IntersectionObserver" in window && !reduced) {
    var inObs = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        if (en.target === route) route.classList.add("is-drawn");
        else en.target.classList.add("is-in");
        obs.unobserve(en.target);
      });
    }, { threshold: 0.2 });
    if (route) inObs.observe(route);
    reveals.forEach(function (el) { inObs.observe(el); });
  } else {
    if (route) route.classList.add("is-drawn");
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  /* ---- projects: show all ---- */
  var plist = document.querySelector(".plist");
  var more = document.querySelector(".plist__more button");
  if (plist && more) {
    more.addEventListener("click", function () {
      plist.setAttribute("data-all", "true");
      var first = plist.querySelector(".project[data-extra]");
      if (first) first.querySelector("a, button").focus();
    });
  }

  /* ---- projects: hover preview (desktop) ---- */
  var preview = document.querySelector(".preview");
  var pvVideo = preview ? preview.querySelector("video") : null;
  var pvImg = preview ? preview.querySelector("img") : null;
  var pvCap = preview ? preview.querySelector(".preview__cap") : null;
  var rows = Array.prototype.slice.call(document.querySelectorAll(".project"));

  function placePreview(x, y) {
    var w = preview.offsetWidth || 320;
    var h = preview.offsetHeight || 220;
    var left = x + 24;
    var top = y - h / 2;
    if (left + w > window.innerWidth - 16) left = x - w - 24;
    if (top < 72) top = 72;
    if (top + h > window.innerHeight - 16) top = window.innerHeight - h - 16;
    preview.style.transform = "translate3d(" + left + "px," + top + "px,0)";
  }

  if (preview && finePointer && window.innerWidth >= 960) {
    rows.forEach(function (row) {
      var video = row.getAttribute("data-video");
      var poster = row.getAttribute("data-poster");
      var cap = row.getAttribute("data-caption") || "";
      if (!video && !poster) return;

      row.addEventListener("mouseenter", function (e) {
        if (video) {
          preview.setAttribute("data-mode", "video");
          if (pvVideo.getAttribute("src") !== video) {
            pvVideo.setAttribute("src", video);
            if (poster) pvVideo.setAttribute("poster", poster);
            pvVideo.load();
          }
          var p = pvVideo.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          preview.setAttribute("data-mode", "image");
          pvImg.setAttribute("src", poster);
        }
        pvCap.textContent = cap;
        placePreview(e.clientX, e.clientY);
        preview.setAttribute("data-on", "true");
      });
      row.addEventListener("mousemove", function (e) {
        placePreview(e.clientX, e.clientY);
      });
      row.addEventListener("mouseleave", function () {
        preview.setAttribute("data-on", "false");
        if (video) pvVideo.pause();
      });
    });
  }

  /* ---- projects: inline recording on touch devices ---- */
  rows.forEach(function (row) {
    var btn = row.querySelector(".project__play");
    var box = row.querySelector(".project__inline");
    if (!btn || !box) return;
    btn.addEventListener("click", function () {
      var open = row.getAttribute("data-expanded") === "true";
      if (open) {
        row.setAttribute("data-expanded", "false");
        var v = box.querySelector("video");
        if (v) v.pause();
        btn.textContent = "▶ Recording";
        return;
      }
      if (!box.firstElementChild) {
        var video = document.createElement("video");
        video.setAttribute("controls", "");
        video.setAttribute("playsinline", "");
        video.setAttribute("muted", "");
        video.setAttribute("preload", "metadata");
        video.setAttribute("poster", row.getAttribute("data-poster") || "");
        video.setAttribute("src", row.getAttribute("data-video"));
        box.appendChild(video);
      }
      row.setAttribute("data-expanded", "true");
      btn.textContent = "▼ Hide recording";
    });
  });
})();
