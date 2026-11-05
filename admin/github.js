/* GitHub is the durable store. Each operation is one commit with an expected parent.
   A rejected ref update never overwrites another device's changes. No build service or secret backend. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../js/schema.js"));
  else root.PortfolioGitHub = factory(root.GalaxySchema);
})(this, function (schema) {
  "use strict";
  const CONTENT = "content/galaxy.json", RELEASE = "content/release.json";
  function encode(text) {
    const bytes = new TextEncoder().encode(text);
    let raw = "";
    for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(raw);
  }
  function decode(text) {
    return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, "")), c => c.charCodeAt(0)));
  }
  function publicContent(doc) {
    const c = JSON.parse(JSON.stringify(doc));
    function clean(value) {
      if (!value || typeof value !== "object") return;
      Object.keys(value).forEach(k => {
        if (k === "notes" || k === "reviewed" || k[0] === "_") delete value[k];
        else clean(value[k]);
      });
    }
    clean(c);
    return c;
  }
  function galaxyHtml(template, doc) {
    const site = doc.site || {};
    const escape = value => String(value || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const title = escape(site.pageTitle || site.name), description = escape(site.description || site.tagline);
    const image = site.socialImage && schema.safeUrl(site.socialImage) ? escape(new URL(site.socialImage, "https://aryan-poonacha.github.io/").href) : "";
    const head = [
      "<!--content-head:start-->", '<meta name="robots" content="index,follow" />', "<title>" + title + "</title>",
      '<meta name="description" content="' + description + '" />',
      '<meta property="og:title" content="' + title + '" />',
      '<meta property="og:description" content="' + description + '" />',
      '<meta name="twitter:card" content="' + (image ? "summary_large_image" : "summary") + '" />',
      image ? '<meta property="og:image" content="' + image + '" />' : "",
      site.socialHandle ? '<meta name="twitter:creator" content="' + escape(site.socialHandle) + '" />' : "",
      "<!--content-head:end-->"
    ].join("\n");
    if (!template.includes("<!--content-head:start-->")) throw new Error("Galaxy template needs a content metadata block.");
    return template.replace(/<!--content-head:start-->[\s\S]*?<!--content-head:end-->/, head);
  }
  class Client {
    constructor(config, token, fetcher) {
      this.config = config; this.token = token; this.fetcher = fetcher || fetch.bind(globalThis);
      this.api = "https://api.github.com/repos/" + config.repository.split("/").map(encodeURIComponent).join("/");
      this.draft = null; this.live = null;
      this.abort = new AbortController(); this.disconnected = false;
    }
    disconnect() { this.disconnected = true; this.token = ""; this.abort.abort(); }
    async request(path, method, body) {
      if (this.disconnected) throw new Error("This device is disconnected. Connect GitHub again to continue.");
      const res = await this.fetcher(this.api + path, {
        method: method || "GET", cache: "no-store", signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30000)]),
        headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + this.token,
          "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(res.status === 401 ? "GitHub sign-in expired. Connect again."
          : res.status === 403 ? "GitHub refused access. Check this repository's Contents permission or rate limit."
          : res.status === 409 || res.status === 422 ? "Another save changed this branch. Reload the cloud draft before saving again. Your browser changes are still here."
          : "GitHub: " + (data.message || "HTTP " + res.status));
        error.status = res.status; throw error;
      }
      return data;
    }
    async snapshot(branch) {
      const ref = await this.request("/git/ref/heads/" + encodeURIComponent(branch));
      const commit = await this.request("/git/commits/" + ref.object.sha);
      const tree = await this.request("/git/trees/" + commit.tree.sha + "?recursive=1");
      if (tree.truncated) throw new Error("Repository tree is too large to load safely.");
      const files = new Map(tree.tree.filter(f => f.type === "blob").map(f => [f.path, f]));
      return { branch, sha: ref.object.sha, tree: commit.tree.sha, files };
    }
    async text(snapshot, path) {
      const file = snapshot.files.get(path);
      if (!file) throw new Error("Missing " + path + " on " + snapshot.branch + ".");
      const blob = await this.request("/git/blobs/" + file.sha);
      if (blob.encoding !== "base64") throw new Error("Unsupported GitHub file encoding.");
      return decode(blob.content);
    }
    async connect() {
      const repo = await this.request("");
      if (!repo.permissions || !repo.permissions.push) throw new Error("This token cannot edit this repository. Select this repository and grant Contents: read and write.");
      if (this.config.liveBranch === this.config.draftBranch || [this.config.liveBranch, this.config.draftBranch].includes("main")) {
        throw new Error("Draft and live branches must be separate and cannot be main.");
      }
      this.live = await this.snapshot(this.config.liveBranch);
      try { this.draft = await this.snapshot(this.config.draftBranch); }
      catch (e) {
        if (e.status !== 404) throw e;
        // First connection seeds a draft from the deployed site, without changing it.
        await this.request("/git/refs", "POST", { ref: "refs/heads/" + this.config.draftBranch, sha: this.live.sha });
        this.draft = await this.snapshot(this.config.draftBranch);
      }
      return { draft: await this.text(this.draft, CONTENT), release: JSON.parse(await this.text(this.live, RELEASE)) };
    }
    async commit(snapshot, entries, message) {
      const tree = await this.request("/git/trees", "POST", { base_tree: snapshot.tree, tree: entries });
      const commit = await this.request("/git/commits", "POST", { message, tree: tree.sha, parents: [snapshot.sha] });
      // Non-fast-forward updates fail if a second device has moved the ref since we loaded it.
      await this.request("/git/refs/heads/" + encodeURIComponent(snapshot.branch), "PATCH", { sha: commit.sha, force: false });
      return { ...snapshot, sha: commit.sha, tree: tree.sha };
    }
    async save(text) {
      const next = await this.commit(this.draft, [{ path: CONTENT, mode: "100644", type: "blob", content: text }], "Save portfolio draft");
      this.draft = await this.snapshotAt(next);
      return next.sha;
    }
    async snapshotAt(next) {
      // Read by tree SHA rather than branch name, which another device could already have moved.
      const tree = await this.request("/git/trees/" + next.tree + "?recursive=1");
      if (tree.truncated) throw new Error("Repository tree is too large to load safely.");
      return { ...next, files: new Map(tree.tree.filter(f => f.type === "blob").map(f => [f.path, f])) };
    }
    async upload(blob, name) {
      if (blob.size > 24 * 1024 * 1024) throw new Error("Choose a file under 24 MB (short MP4 or compressed image).");
      if (!/\.(mp4|webm|webp|jpg|jpeg|png|gif|avif|pdf)$/i.test(name)) throw new Error("Use MP4, WebM, WebP, JPG, PNG, GIF, AVIF or PDF.");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
      const safe = name.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(-100);
      const path = "assets/media/" + hash.slice(0, 16) + "-" + safe;
      if (!this.draft.files.has(path)) {
        const bytes = new Uint8Array(await blob.arrayBuffer()); let raw = "";
        for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
        const saved = await this.request("/git/blobs", "POST", { content: btoa(raw), encoding: "base64" });
        const next = await this.commit(this.draft, [{ path, mode: "100644", type: "blob", sha: saved.sha }], "Upload draft media");
        this.draft = { ...next, files: new Map(this.draft.files).set(path, { path, sha: saved.sha, type: "blob", mode: "100644" }) };
      }
      return path;
    }
    async publish(view, text) {
      if (!["legacy", "galaxy"].includes(view)) throw new Error("Choose legacy or galaxy.");
      // Galaxy releases always use the exact saved draft snapshot, not unsaved form values.
      if (view === "galaxy") {
        const head = await this.request("/git/ref/heads/" + encodeURIComponent(this.config.draftBranch));
        if (head.object.sha !== this.draft.sha) throw new Error("The cloud draft changed on another device. Load cloud draft and review it before publishing. Your browser changes are still here.");
        if (schema.format(JSON.parse(await this.text(this.draft, CONTENT))) !== schema.format(JSON.parse(text))) throw new Error("Save this draft before publishing.");
      }
      const release = { view, publishedAt: new Date().toISOString(), draftCommit: view === "galaxy" ? this.draft.sha : null };
      const template = this.live.files.get(view + ".html");
      if (!template) throw new Error("The live branch has no " + view + " template. Deploy the admin first.");
      const entries = [
        { path: "index.html", type: "blob", mode: "100644", sha: template.sha },
        { path: RELEASE, type: "blob", mode: "100644", content: JSON.stringify(release, null, 2) + "\n" }
      ];
      if (view === "galaxy") {
        entries[0] = { path: "index.html", type: "blob", mode: "100644", content: galaxyHtml(await this.text(this.live, "galaxy.html"), JSON.parse(text)) };
        entries.push({ path: CONTENT, type: "blob", mode: "100644", content: JSON.stringify(publicContent(JSON.parse(text)), null, 2) + "\n" });
        // Copy immutable media blobs from the saved draft in the same commit as its content.
        this.draft.files.forEach((file, path) => {
          if (path.startsWith("assets/media/") && this.live.files.get(path)?.sha !== file.sha) entries.push({ path, mode: "100644", type: "blob", sha: file.sha });
        });
      }
      const next = await this.commit(this.live, entries, "Publish " + view + " portfolio");
      this.live = await this.snapshotAt(next);
      return { ...release, commit: next.sha };
    }
  }
  return { Client, encode, decode, publicContent, galaxyHtml, CONTENT, RELEASE };
});
