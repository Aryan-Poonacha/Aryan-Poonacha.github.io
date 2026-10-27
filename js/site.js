/* Archive: show-all and inline recordings. No dependencies. */
(function () {
  "use strict";
  var archive = document.querySelector(".archive");
  if (!archive) return;

  var more = archive.querySelector(".more button");
  if (more) {
    more.addEventListener("click", function () {
      archive.setAttribute("data-all", "true");
      var first = archive.querySelector(".item[data-extra] a, .item[data-extra] button");
      if (first) first.focus();
    });
  }

  Array.prototype.forEach.call(archive.querySelectorAll(".item[data-video]"), function (item) {
    var btn = item.querySelector("button.rec");
    var clip = item.querySelector(".clip");
    if (!btn || !clip) return;
    btn.addEventListener("click", function () {
      var open = item.getAttribute("data-open") === "true";
      if (open) {
        item.setAttribute("data-open", "false");
        var v = clip.querySelector("video");
        if (v) v.pause();
        btn.textContent = "Recording";
        return;
      }
      if (!clip.querySelector("video")) {
        var video = document.createElement("video");
        video.setAttribute("controls", "");
        video.setAttribute("playsinline", "");
        video.setAttribute("muted", "");
        video.setAttribute("preload", "metadata");
        video.setAttribute("poster", item.getAttribute("data-poster") || "");
        video.setAttribute("src", item.getAttribute("data-video"));
        clip.insertBefore(video, clip.firstChild);
      }
      item.setAttribute("data-open", "true");
      btn.textContent = "Hide recording";
    });
  });
})();
