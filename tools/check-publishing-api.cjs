// Opt-in integration proof using existing gh sign-in and two disposable, uniquely named branches.
// Never touches main, portfolio-live, portfolio-drafts, Pages settings, or the public website.
// PORTFOLIO_API_PROOF=1 node tools/check-publishing-api.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Client } = require('../admin/github.js'), S = require('../js/schema.js');
if (process.env.PORTFOLIO_API_PROOF !== '1') throw new Error('Set PORTFOLIO_API_PROOF=1 to run the isolated GitHub proof.');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'content/publishing.json')));
const suffix = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
config.draftBranch = 'admin-proof-' + suffix + '-draft'; config.liveBranch = 'admin-proof-' + suffix + '-live';
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const client = new Client(config, token), made = [];
const results = [];
const prove = (name, detail) => { results.push({ name, ok: true, detail }); console.log('PASS ' + name); };
(async () => {
  try {
    const source = await client.snapshot('galaxy');
    const doc = JSON.parse(fs.readFileSync(path.join(root, 'content/galaxy.json'), 'utf8'));
    const legacy = fs.readFileSync(path.join(root, 'legacy.html'), 'utf8');
    const seed = await client.request('/git/trees', 'POST', { base_tree: source.tree, tree: [
      { path: 'legacy.html', mode: '100644', type: 'blob', content: legacy },
      { path: 'galaxy.html', mode: '100644', type: 'blob', content: fs.readFileSync(path.join(root, 'galaxy.html'), 'utf8') },
      { path: 'index.html', mode: '100644', type: 'blob', content: legacy },
      { path: 'content/galaxy.json', mode: '100644', type: 'blob', content: JSON.stringify(doc, null, 2) },
      { path: 'content/release.json', mode: '100644', type: 'blob', content: JSON.stringify({ view: 'legacy', publishedAt: null, draftCommit: null }) }
    ] });
    const commit = await client.request('/git/commits', 'POST', { message: 'Isolated portfolio admin API proof', tree: seed.sha, parents: [source.sha] });
    // Leave the draft branch absent to exercise automatic initialization.
    await client.request('/git/refs', 'POST', { ref: 'refs/heads/' + config.liveBranch, sha: commit.sha }); made.push(config.liveBranch);
    await client.connect(); made.push(config.draftBranch);
    const stale = new Client(config, token); await stale.connect();
    assert.equal(client.live.sha, commit.sha); assert.equal(client.draft.sha, commit.sha);
    prove('connection creates a separate draft without publishing');
    await client.publish('galaxy', S.format(doc));
    prove('first-run noncanonical JSON publishes');
    doc.core.summary = 'API proof: Unicode — 星'; doc.core.notes = 'EDITOR_ONLY_PROOF'; doc.core.reviewed = true;
    doc.site.pageTitle = '<Proof> & Unicode 星'; doc.site.description = '"Description" <safe>';
    const upload = await client.upload(new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' }), 'proof image.png');
    doc.core.media = { type: 'image', src: upload };
    const text = S.format(doc), liveBeforeSave = client.live.sha;
    await client.save(text);
    assert.equal((await client.snapshot(config.liveBranch)).sha, liveBeforeSave);
    prove('draft save leaves live ref unchanged');
    await assert.rejects(stale.save(S.format({ ...doc, site: { ...doc.site, name: 'stale device' } })), e => e.status === 422);
    assert.equal(await client.text(await client.snapshot(config.draftBranch), 'content/galaxy.json'), text);
    prove('actual GitHub rejects concurrent stale save');
    await assert.rejects(client.publish('galaxy', S.format({ ...doc, site: { ...doc.site, name: 'unsaved' } })), /Save this draft/);
    prove('unsaved content cannot publish');
    const released = await client.publish('galaxy', text), savedDraft = client.draft.sha;
    const live = await client.snapshot(config.liveBranch);
    const publicText = await client.text(live, 'content/galaxy.json'), html = await client.text(live, 'index.html');
    assert(publicText.includes('API proof: Unicode')); assert(!publicText.includes('EDITOR_ONLY_PROOF')); assert(!publicText.includes('"reviewed"'));
    assert(html.includes('&lt;Proof&gt; &amp; Unicode 星')); assert(html.includes('&quot;Description&quot; &lt;safe&gt;'));
    assert.equal(live.files.get(upload).sha, client.draft.files.get(upload).sha);
    assert.equal(JSON.parse(await client.text(live, 'content/release.json')).draftCommit, savedDraft);
    prove('one release includes exact content, metadata and media, excluding editor notes', released.commit);
    await assert.rejects(stale.publish('legacy', ''), e => e.status === 422);
    prove('stale live switch is rejected');
    await client.publish('legacy', text);
    assert.equal(await client.text(client.live, 'index.html'), legacy);
    assert.equal(await client.text(client.live, 'content/galaxy.json'), publicText);
    assert.equal((await client.snapshot(config.draftBranch)).sha, savedDraft);
    prove('legacy rollback preserves draft and published galaxy');
  } finally {
    for (const branch of made.reverse()) {
      await client.request('/git/refs/heads/' + encodeURIComponent(branch), 'DELETE');
      console.log('CLEANED ' + branch);
    }
  }
  console.log(JSON.stringify({ ok: true, cases: results.length, results }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
