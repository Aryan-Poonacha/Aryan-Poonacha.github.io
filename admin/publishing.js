/* The owner-facing publishing controls. The editor owns local work; this module owns
   remote snapshots. Saving never targets the live branch. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id), GH = window.PortfolioGitHub;
  const TOKEN = "portfolio:github:token", REMEMBER = "portfolio:github:remember";
  let editor, config, client = null, busy = false, cloudText = "", release = null, served = null, liveError = "", authGeneration = 0;
  const LOGOUT = "portfolio:github:logout", authChannel = window.BroadcastChannel ? new BroadcastChannel("portfolio-admin-auth") : null;
  const connectingClients = new Set();
  const media = new Map(), mediaLoading = new Map(), servedAssets = new Map();
  const dialog = $("publishing-dialog");
  function message(text, bad) {
    $("publishing-msg").textContent = text || "";
    $("publishing-msg").classList.toggle("is-bad", !!bad);
  }
  function open() { if (!dialog.open) dialog.showModal(); update(); }
  function readToken() {
    try { return sessionStorage.getItem(TOKEN) || localStorage.getItem(TOKEN) || ""; } catch (e) { return ""; }
  }
  function storeToken(token, remember) {
    try {
      sessionStorage.removeItem(TOKEN); localStorage.removeItem(TOKEN);
      localStorage.removeItem(REMEMBER);
      // Remove the earlier editor's separate credential store too.
      sessionStorage.removeItem("galaxy:admin:token"); localStorage.removeItem("galaxy:admin:token");
      if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN, token);
      if (token && remember) localStorage.setItem(REMEMBER, "yes");
    } catch (e) { message("This browser cannot remember sign-in. Keep this tab open.", true); }
  }
  function stamp(r) { return r ? (r.view === "galaxy" ? "Galaxy" : "Legacy") + (r.publishedAt ? " · " + new Date(r.publishedAt).toLocaleString() : "") : "Not yet verified"; }
  function update() {
    if (!editor) return;
    const connected = !!client, dirty = editor.text() !== cloudText;
    $("connection-form").hidden = connected;
    $("connected-info").hidden = !connected;
    $("connected-repo").textContent = config ? config.repository : "";
    $("connect-shortcut").textContent = connected ? "GitHub connected" : "Connect GitHub";
    $("cloud-reload").disabled = !connected || busy;
    $("connect-go").disabled = busy || !config;
    $("disconnect").disabled = busy;
    $("live-state").textContent = liveError ? "Live: unverified" + (served ? " · last known " + stamp(served) : "") : "Live: " + stamp(served);
    $("release-state").textContent = liveError ? "Could not verify live state. " + liveError + (served ? " Last verified: " + stamp(served) : "") : "Live: " + stamp(served);
    $("cloud-state").textContent = busy ? "Working… Your live site stays unchanged until a release deploys."
      : connected ? (dirty ? "Browser changes need Save draft to sync." : "Draft synced across devices · " + client.draft.sha.slice(0, 7))
      : "Connect GitHub to sync drafts and publish from any device.";
    $("release-pending").textContent = release && served && (release.publishedAt !== served.publishedAt || release.view !== served.view)
      ? (liveError ? "Queued release: " : "Waiting for deployment: ") + stamp(release) + ". Check live state to verify it." : "";
    const galaxy = $("release-view").value === "galaxy";
    $("release-summary").textContent = galaxy ? (dirty ? "Save draft before publishing. Your preview includes changes not synced yet." : "Publishes the exact synced draft, with all its media.") : "Restores the original legacy homepage. Your galaxy work is kept.";
    $("publish-go").disabled = busy || !connected || (galaxy && dirty) || !$("release-confirm").checked || (galaxy && editor.hasRecovery());
    $("save").disabled = busy;
    if (connected) $("save").textContent = "Save draft";
    else if (!editor.local()) $("save").textContent = "Save draft…";
  }
  async function operation(fn) {
    if (busy) return;
    busy = true; update();
    try { await fn(); }
    catch (e) { message(e.message, true); editor.status(e.message, true); open(); }
    finally { busy = false; update(); }
  }
  function canonical(text) {
    const doc = JSON.parse(text);
    const errors = window.GalaxySchema.check(doc).filter(i => i.level === "error");
    if (errors.length) throw new Error("Cloud draft has invalid content: " + errors[0].msg);
    return window.GalaxySchema.format(doc);
  }
  async function loadMedia() {
    if (!client) return;
    const currentClient = client, doc = JSON.parse(editor.text()), paths = new Set();
    let mediaChanged = false;
    window.GalaxySchema.walk(doc, b => { if (b.media) [b.media.src, b.media.poster].filter(Boolean).forEach(p => paths.add(p)); });
    await Promise.all(Array.from(paths).map(async path => {
      const file = currentClient.draft.files.get(path), live = currentClient.live.files.get(path);
      if (!file || media.has(path) || servedAssets.get(path) === file.sha) return;
      const deployed = !liveError && release && served && release.view === served.view && release.publishedAt === served.publishedAt;
      if (file.sha === live?.sha && deployed) {
        media.set(path, new URL(path, config.siteUrl).href); mediaChanged = true; return;
      }
      if (mediaLoading.has(path)) return mediaLoading.get(path);
      const task = (async () => {
        // A newly queued release can contain this blob before Pages serves it.
        if (file.sha === live?.sha) {
          const publicFile = await fetch(new URL(path + "?check=" + Date.now(), config.siteUrl), { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(15000) }).catch(() => null);
          if (publicFile?.ok) { servedAssets.set(path, file.sha); media.set(path, new URL(path, config.siteUrl).href); mediaChanged = true; return; }
        }
        const blob = await currentClient.request("/git/blobs/" + file.sha);
        const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, "")), c => c.charCodeAt(0));
        const ext = path.split(".").pop().toLowerCase();
        const mime = { mp4: "video/mp4", webm: "video/webm", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", avif: "image/avif", pdf: "application/pdf" }[ext] || "application/octet-stream";
        media.set(path, URL.createObjectURL(new Blob([bytes], { type: mime })));
        mediaChanged = true;
      })();
      mediaLoading.set(path, task);
      try { await task; } finally { mediaLoading.delete(path); }
    }));
    if (client !== currentClient || !mediaChanged) return;
    editor.mediaReady();
    editor.preview();
  }
  let mediaTimer;
  function refreshMediaSoon() {
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(() => loadMedia().catch(e => message("Draft media could not load: " + e.message, true)), 150);
  }
  async function connect(token, remember) {
    const generation = authGeneration, candidate = new GH.Client(config, token);
    connectingClients.add(candidate);
    let out;
    try { out = await candidate.connect(); } finally { connectingClients.delete(candidate); }
    if (generation !== authGeneration) { candidate.disconnect(); return; }
    const text = canonical(out.draft);
    cloudText = text; client = candidate; release = out.release;
    storeToken(token, remember); $("connect-token").value = "";
    if (!editor.dirty()) editor.remote(text, true);
    else if (editor.base() !== text) message("This device and the cloud have different drafts. Download your browser copy, then Load cloud draft. Saving is blocked until they share a starting version.", true);
    else message("Connected. Save draft to sync your browser changes.");
    editor.connected(); update();
    await loadMedia();
  }
  async function save() {
    if (!client) { open(); return; }
    if (editor.blocked()) return;
    if (editor.hasRecovery()) { open(); message("Restore or discard the recovered browser changes first.", true); return; }
    if (editor.base() !== cloudText) { open(); message("This browser started from a different draft. Download your copy, then Load cloud draft. No cloud changes were overwritten.", true); return; }
    const text = editor.text(), savingClient = client;
    editor.status("Syncing draft…");
    await operation(async () => {
      if (text !== cloudText) await savingClient.save(text);
      if (client !== savingClient) return;
      cloudText = text; editor.saved(text, "cloud");
      message("Draft synced. The live site has not changed.");
      editor.status("Draft synced at " + new Date().toLocaleTimeString());
    });
  }
  async function checkLive() {
    try {
      const r = await fetch(new URL("content/release.json?check=" + Date.now(), config.siteUrl), { cache: "no-store" });
      if (!r.ok) throw new Error("Live state unavailable (HTTP " + r.status + ").");
      const out = await r.json();
      if (!["legacy", "galaxy"].includes(out.view)) throw new Error("The live state file is invalid.");
      served = out; liveError = "";
      $("open-live").href = config.siteUrl + "?release=" + encodeURIComponent(out.publishedAt || "legacy");
      update();
    } catch (e) { liveError = e.message; update(); }
  }
  function disconnectHere() {
    authGeneration++;
    if (client) client.disconnect();
    connectingClients.forEach(c => c.disconnect());
    client = null; cloudText = ""; release = null; storeToken("", false);
    $("connect-token").value = ""; $("connect-remember").checked = false;
    if (editor) { editor.disconnected(); message("Disconnected on this device. Your browser changes are still here."); update(); }
  }
  if (authChannel) authChannel.onmessage = e => { if (e.data === "disconnect") disconnectHere(); };
  window.addEventListener("storage", e => { if (e.key === LOGOUT) disconnectHere(); });
  window.PortfolioPublishing = {
    connected: () => !!client,
    busy: () => busy,
    save,
    open,
    resolve: path => media.get(path) || path,
    previewDoc(doc) {
      const copy = JSON.parse(JSON.stringify(doc));
      window.GalaxySchema.walk(copy, b => { if (b.media) ["src", "poster"].forEach(k => { if (media.has(b.media[k])) b.media[k] = media.get(b.media[k]); }); });
      return copy;
    },
    async upload(blob, name) {
      if (!client) throw new Error("Connect GitHub to upload media into your draft.");
      if (busy) throw new Error("Wait for the current save to finish, then upload again.");
      let path;
      await operation(async () => { path = await client.upload(blob, name); media.set(path, URL.createObjectURL(blob)); });
      if (!path) throw new Error("Media was not uploaded. Your existing content is unchanged.");
      return path;
    }
  };
  window.addEventListener("galaxy-editor-ready", async event => {
    editor = event.detail;
    $("publishing").onclick = open;
    $("connect-shortcut").onclick = open;
    $("publishing-close").onclick = () => dialog.close();
    $("connect-go").onclick = () => {
      const token = $("connect-token").value.trim();
      if (!token) return message("Enter your repository token to connect.", true);
      operation(() => connect(token, $("connect-remember").checked));
    };
    $("disconnect").onclick = () => {
      disconnectHere();
      if (authChannel) authChannel.postMessage("disconnect");
      try { localStorage.setItem(LOGOUT, String(Date.now()) + Math.random()); } catch (e) { /* BroadcastChannel also handles this */ }
    };
    $("cloud-reload").onclick = () => {
      if ((editor.dirty() || editor.hasRecovery()) && !confirm("Load the cloud draft? Browser changes will remain available with Undo. Download a copy first if you want a separate backup.")) return;
      operation(async () => {
        const out = await client.connect();
        cloudText = canonical(out.draft); release = out.release;
        editor.remote(cloudText, false); await loadMedia();
        message("Loaded the cloud draft. Live site unchanged.");
      });
    };
    $("release-view").onchange = () => { $("release-confirm").checked = false; update(); };
    $("release-confirm").onchange = update;
    $("check-live").onclick = checkLive;
    $("publish-go").onclick = () => {
      if ($("publish-go").disabled) return;
      const view = $("release-view").value;
      if (view === "galaxy" && editor.blocked()) return;
      operation(async () => {
        const result = await client.publish(view, cloudText);
        release = result; $("release-confirm").checked = false;
        message("Release " + result.commit.slice(0, 7) + " queued. Check live state after deployment.");
        await checkLive();
      });
    };
    window.addEventListener("galaxy-editor-change", () => { $("release-confirm").checked = false; update(); refreshMediaSoon(); });
    try {
      const response = await fetch(editor.site() + "content/publishing.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Publishing configuration is unavailable.");
      config = await response.json();
      if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository || "")) throw new Error("Invalid repository configuration.");
      $("token-link").href = "https://github.com/settings/personal-access-tokens/new?name=Portfolio+editor&contents=write&expires_in=366&target_name=" + encodeURIComponent(config.repository.split("/")[0]);
      await checkLive(); update();
      const token = readToken();
      if (token) await operation(() => connect(token, localStorage.getItem(REMEMBER) === "yes"));
    } catch (e) { message(e.message, true); update(); }
  }, { once: true });
})();
