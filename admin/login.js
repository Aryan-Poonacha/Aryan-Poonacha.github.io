// Keep browser-only drafts through the password form's navigation, on this origin only.
(function () {
  if (!location.hash.startsWith("#recovery=") || location.hash.length > 1400010) return;
  try {
    sessionStorage.setItem("portfolio:admin:recovery", location.hash);
    history.replaceState(null, "", location.pathname + location.search);
  } catch (e) { /* The original browser copy remains on the public admin origin. */ }
})();
