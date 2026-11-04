/* The owner-facing publishing controls. The editor owns local work; this module owns
   remote snapshots. Saving never targets the live branch. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id), GH = window.PortfolioGitHub;
  const TOKEN = "portfolio:github:token", REMEMBER = "portfolio:github:remember";
  let editor, config, client = null, busy = false, cloudText = "", release = null, served = null;
  const media = new Map();
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
    $("live-state").textContent = "Live: " + stamp(served);
    $("release-state").textContent = "Live: " + stamp(served);
    $("cloud-state").textContent = busy ? "Working… Your live site stays unchanged until a release deploys."
      : connected ? (dirty ? "Browser changes need Save draft to sync." : "Draft synced across devices · " + client.draft.sha.slice(0, 7))
      : "Connect GitHub to sync drafts and publish from any device.";
    $("release-pending").textContent = release && served && (release.publishedAt !== served.publishedAt || release.view !== served.view)
      ? "Waiting for deployment: " + stamp(release) + ". Check live state to verify it." : "";
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
    const doc = JSON.parse(cloudText), paths = new Set();
    window.GalaxySchema.walk(doc, b => { if (b.media) [b.media.src, b.media.poster].filter(Boolean).forEach(p => paths.add(p)); });
    await Promise.all(Array.from(paths).map(async path => {
      const file = client.draft.files.get(path), live = client.live.files.get(path);
      if (!file || file.sha === live?.sha || media.has(path)) return;
      const blob = await client.request("/git/blobs/" + file.sha);
      const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, "")), c => c.charCodeAt(0));
      const ext = path.split(".").pop().toLowerCase();
      const mime = { mp4: "video/mp4", webm: "video/webm", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", avif: "image/avif", pdf: "application/pdf" }[ext] || "application/octet-stream";
      media.set(path, URL.createObjectURL(new Blob([bytes], { type: mime })));
    }));
    editor.preview();
  }
  async function connect(token, remember) {
    const candidate = new GH.Client(config, token);
    const out = await candidate.connect();
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
    const text = editor.text();
    editor.status("Syncing draft…");
    await operation(async () => {
      if (text !== cloudText) await client.save(text);
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
      served = out;
      $("open-live").href = config.siteUrl + "?release=" + encodeURIComponent(out.publishedAt || "legacy");
      update();
    } catch (e) { $("live-state").textContent = "Live: could not verify"; $("release-state").textContent = "Could not verify live state. " + e.message; }
  }
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
      client = null; cloudText = ""; release = null; storeToken("", false);
      $("connect-token").value = ""; $("connect-remember").checked = false;
      editor.disconnected(); message("Disconnected. Your browser changes are still here."); update();
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
    window.addEventListener("galaxy-editor-change", () => { $("release-confirm").checked = false; update(); });
    try {
      const response = await fetch(editor.site() + "content/publishing.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Publishing configuration is unavailable.");
      config = await response.json();
      if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository || "")) throw new Error("Invalid repository configuration.");
      $("token-link").href = "https://github.com/settings/personal-access-tokens/new?name=Portfolio+editor&contents=write&target_name=" + encodeURIComponent(config.repository.split("/")[0]) + "&repository_ids=" + encodeURIComponent(config.repositoryId || "");
      await checkLive(); update();
      const token = readToken();
      if (token) await operation(() => connect(token, localStorage.getItem(REMEMBER) === "yes"));
    } catch (e) { message(e.message, true); update(); }
  }, { once: true });
})();
