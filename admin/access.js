/* Fully static: the password unlocks encrypted GitHub access locally.
   GitHub verifies the owner and authorizes every repository write. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const TOKEN = "portfolio:github:token", REMEMBER = "portfolio:github:remember", LOGOUT = "portfolio:github:logout";
  const app = $("admin-app"), gate = $("access");
  const channel = window.BroadcastChannel ? new BroadcastChannel("portfolio-admin-auth") : null;
  const scripts = new Map();
  let config, guard = null, generation = 0, started = false, local = false, checking = false, timer, passwordMode = false;

  function status(text, bad) {
    $("access-status").textContent = text;
    $("access-status").classList.toggle("is-bad", !!bad);
  }
  function stored() {
    try { return sessionStorage.getItem(TOKEN) || localStorage.getItem(TOKEN) || ""; } catch (e) { return ""; }
  }
  function rememberToken(token, remember) {
    try {
      [sessionStorage, localStorage].forEach(s => { s.removeItem(TOKEN); s.removeItem("galaxy:admin:token"); });
      localStorage.removeItem(REMEMBER);
      if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN, token);
      if (token && remember) localStorage.setItem(REMEMBER, "yes");
    } catch (e) { /* The verified in-memory session still works when storage is unavailable. */ }
  }
  function lock(text, broadcast) {
    generation++;
    clearInterval(timer);
    if (guard) guard.disconnect();
    guard = null;
    rememberToken("", false);
    app.hidden = !local; app.inert = !local; gate.hidden = local;
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    window.dispatchEvent(new Event("portfolio-admin-locked"));
    if (!local && $("frame")) $("frame").src = "about:blank";
    $("access-token").value = "";
    $("access-remember").checked = false;
    status(text || "Sign in to open your editor.", !!text);
    $("access-go").disabled = !config;
    if (broadcast) {
      if (channel) channel.postMessage("disconnect");
      try { localStorage.setItem(LOGOUT, crypto.randomUUID()); } catch (e) { /* BroadcastChannel also handles logout. */ }
    }
  }
  function script(src) {
    if (scripts.has(src)) return scripts.get(src);
    const loading = new Promise((resolve, reject) => {
      const node = document.createElement("script");
      node.src = src; node.onload = resolve;
      node.onerror = () => { scripts.delete(src); node.remove(); reject(new Error("Could not load the editor. Sign in to try again.")); };
      document.body.appendChild(node);
    });
    scripts.set(src, loading);
    return loading;
  }
  async function boot() {
    if (!app.childElementCount) app.appendChild($("editor-template").content.cloneNode(true));
    await script("publishing.js?v=owner-access-1");
    await script("admin.js?v=owner-access-1");
    started = true;
  }
  async function open(token, remember) {
    const attempt = ++generation;
    $("access-go").disabled = true;
    status("Verifying your GitHub account…");
    const candidate = new window.PortfolioGitHub.Client(config, token);
    if (guard) guard.disconnect();
    guard = candidate;
    try {
      await candidate.authorize();
      if (attempt !== generation) return;
      rememberToken(passwordMode ? "" : token, passwordMode ? false : remember);
      $("access-token").value = "";
      // Share the verified session in memory, including when browser storage is blocked.
      window.PortfolioAccess.session = { token, remember: passwordMode ? false : remember, config };
      if (!started) {
        await boot();
      } else window.dispatchEvent(new Event("portfolio-admin-unlocked"));
      if (attempt !== generation) return;
      gate.hidden = true; app.hidden = false; app.inert = false;
      timer = setInterval(revalidate, 60000);
    } catch (e) {
      if (attempt === generation) lock(e.message);
    }
  }
  async function revalidate() {
    if (local || !guard || app.hidden || checking || document.hidden) return;
    checking = true;
    const current = guard;
    try { await current.authorize(); }
    catch (e) { if (guard === current) lock("Sign in again. " + e.message, true); }
    finally { checking = false; }
  }
  window.PortfolioAccess = { lock, session: null, allowed: () => local || !app.hidden && !!window.PortfolioAccess.session };
  window.addEventListener("portfolio-admin-locked", () => { window.PortfolioAccess.session = null; });
  window.addEventListener("portfolio-auth-required", e => lock(e.detail, started && !app.hidden));
  if (channel) channel.onmessage = e => { if (e.data === "disconnect") lock(); };
  window.addEventListener("storage", e => { if (e.key === LOGOUT) lock(); });
  window.addEventListener("focus", revalidate);
  window.addEventListener("pageshow", revalidate);
  document.addEventListener("visibilitychange", revalidate);
  $("access-form").addEventListener("submit", async e => {
    e.preventDefault();
    const value = $("access-token").value;
    if (!value || !config || $("access-go").disabled) return;
    $("access-go").disabled = true;
    try {
      const token = passwordMode ? await window.PortfolioPassword.unlock(value, config.accessEnvelope, config.repository) : value.trim();
      await open(token, $("access-remember").checked);
    } catch (error) { lock(error.message); }
  });
  (async () => {
    try {
      // Only the loopback-only editor server may open without a GitHub sign-in.
      if (["127.0.0.1", "localhost"].includes(location.hostname)) {
        const response = await fetch("../__admin/ping", { cache: "no-store" }).catch(() => null);
        const ping = response?.ok ? await response.json().catch(() => null) : null;
        if (ping?.ok && typeof ping.root === "string" && ping.root) {
          local = true;
          await boot();
          gate.hidden = true; app.hidden = false; app.inert = false;
          return;
        }
      }
      const response = await fetch("../content/publishing.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Sign-in configuration is unavailable. Reload to try again.");
      config = await response.json();
      if (config.repository !== "Aryan-Poonacha/Aryan-Poonacha.github.io") throw new Error("Invalid sign-in configuration.");
      passwordMode = !!config.accessEnvelope && !new URL(location.href).searchParams.has("recover");
      $("access-form").querySelector(".field__l").textContent = passwordMode ? "Password" : "GitHub token";
      $("access-form").querySelector(".help").textContent = passwordMode ? "Use Portfolio Website Admin in 1Password." : "Sign in with your GitHub token to open the editor. Access is restricted to Aryan-Poonacha.";
      $("access-form").querySelector(".check").hidden = passwordMode;
      $("access-form").querySelector("details").hidden = passwordMode;
      if (passwordMode) { rememberToken("", false); lock(); return; }
      const token = stored();
      if (token) {
        let remember = false;
        try { remember = localStorage.getItem(REMEMBER) === "yes"; } catch (e) { /* optional */ }
        await open(token, remember);
      } else lock();
    } catch (e) { status(e.message, true); }
  })();
})();
