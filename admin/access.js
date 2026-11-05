/* Pages redirects to the password-protected editor. Its server keeps GitHub credentials.
   The original owner-token mode remains available for local development and recovery. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const TOKEN = "portfolio:github:token", REMEMBER = "portfolio:github:remember", LOGOUT = "portfolio:github:logout";
  const app = $("admin-app"), gate = $("access");
  const channel = window.BroadcastChannel ? new BroadcastChannel("portfolio-admin-auth") : null;
  const scripts = new Map();
  let config, guard = null, generation = 0, started = false, local = false, checking = false, timer;

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
    if (config?.managedAuth) {
      fetch("/__admin/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Portfolio-Request": "1" }, body: "{}" })
        .catch(() => null).finally(() => location.assign("/login"));
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
    status(config.managedAuth ? "Opening your editor…" : "Verifying your GitHub account…");
    const candidate = new window.PortfolioGitHub.Client(config, token);
    if (guard) guard.disconnect();
    guard = candidate;
    try {
      await candidate.authorize();
      if (attempt !== generation) return;
      rememberToken(token, remember);
      $("access-token").value = "";
      // Share the verified session in memory, including when browser storage is blocked.
      window.PortfolioAccess.session = { token, remember, config };
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
  function receiveRecovery() {
    try {
      const pending = sessionStorage.getItem("portfolio:admin:recovery");
      if (!location.hash.startsWith("#recovery=") && pending) history.replaceState(null, "", location.pathname + location.search + pending);
    } catch (e) { /* The original browser copy remains available. */ }
    if (!location.hash.startsWith("#recovery=")) return;
    try {
      const raw = decodeURIComponent(location.hash.slice(10));
      if (raw.length > 1400000) throw new Error("Recovery is too large.");
      const data = JSON.parse(window.PortfolioGitHub.decode(raw));
      if (data.version !== 1 || !Array.isArray(data.work)) throw new Error("Invalid recovery.");
      for (const item of data.work) {
        if (!/^galaxy:admin:work:[\w.:-]{1,200}$/.test(item.key) || typeof item.value !== "string") continue;
        const work = JSON.parse(item.value);
        if (!work.doc || !Number.isFinite(work.at) || window.GalaxySchema.check(work.doc).some(i => i.level === "error")) continue;
        // Keep existing private-origin work too. The normal recovery UI resolves edits.
        const key = localStorage.getItem(item.key) && localStorage.getItem(item.key) !== item.value ? item.key + ":migrated:" + work.at : item.key;
        localStorage.setItem(key, item.value);
      }
      if (typeof data.tab === "string" && /^[\w.-]{1,100}$/.test(data.tab)) sessionStorage.setItem("galaxy:admin:preview-id", data.tab);
      sessionStorage.removeItem("portfolio:admin:recovery");
      history.replaceState(null, "", location.pathname + location.search + (typeof data.hash === "string" && /^#[\w:.-]*$/.test(data.hash) ? data.hash : ""));
    } catch (e) { status("Your previous browser copy is still kept on the public site's admin page.", true); }
  }
  function privateEditor(url) {
    if (url !== "https://agentmaxx-tuf.tail130242.ts.net/admin/") throw new Error("Invalid private editor address.");
    const target = new URL(url);
    try {
      const work = Object.keys(localStorage).filter(k => k.startsWith("galaxy:admin:work:")).map(key => ({ key, value: localStorage.getItem(key) }));
      const data = JSON.stringify({ version: 1, work, tab: sessionStorage.getItem("galaxy:admin:preview-id"), hash: location.hash });
      if (work.length && data.length < 1000000) target.hash = "recovery=" + encodeURIComponent(window.PortfolioGitHub.encode(data));
      else target.hash = location.hash;
    } catch (e) { target.hash = location.hash; }
    rememberToken("", false);
    location.replace(target.href);
  }
  window.addEventListener("portfolio-admin-locked", () => { window.PortfolioAccess.session = null; });
  window.addEventListener("portfolio-auth-required", e => lock(e.detail, started && !app.hidden));
  if (channel) channel.onmessage = e => { if (e.data === "disconnect") lock(); };
  window.addEventListener("storage", e => { if (e.key === LOGOUT) lock(); });
  window.addEventListener("focus", revalidate);
  window.addEventListener("pageshow", revalidate);
  document.addEventListener("visibilitychange", revalidate);
  $("access-form").addEventListener("submit", e => {
    e.preventDefault();
    if (config?.managedAuth && !$("access-go").disabled) return open("", false);
    const token = $("access-token").value.trim();
    if (token && config && !$("access-go").disabled) open(token, $("access-remember").checked);
  });
  (async () => {
    try {
      const sessionResponse = await fetch("../__admin/session", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (sessionResponse?.ok) {
        const session = await sessionResponse.json();
        if (session.managedAuth && session.owner?.id === 25931656 && session.config?.managedAuth && session.config.repository === "Aryan-Poonacha/Aryan-Poonacha.github.io") {
          config = session.config;
          $("access-token").required = false;
          $("access-form").querySelectorAll(".field, .check, details").forEach(node => { node.hidden = true; });
          $("access-form").querySelector(".help").textContent = "Opening your editor…";
          rememberToken("", false); receiveRecovery();
          await open("", false);
          return;
        }
        throw new Error("This device could not be verified.");
      }
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
      if (config.privateEditor && !new URL(location.href).searchParams.has("recover")) { privateEditor(config.privateEditor); return; }
      const token = stored();
      if (token) {
        let remember = false;
        try { remember = localStorage.getItem(REMEMBER) === "yes"; } catch (e) { /* optional */ }
        await open(token, remember);
      } else lock();
    } catch (e) { status(e.message, true); }
  })();
})();
