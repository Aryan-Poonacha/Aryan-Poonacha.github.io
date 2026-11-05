// Deliberate, credential-free fixture for password auth and the typed publishing transport.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const S = require('../js/schema.js');
function fixture(root) {
  const hash = value => crypto.createHash('sha1').update(value).digest('hex');
  const state = { text: S.format(JSON.parse(fs.readFileSync(path.join(root, 'content/galaxy.json')))), draft: hash('draft'), live: hash('live'), writes: [], release: { view: 'legacy', publishedAt: null } };
  const files = new Map([
    ['content/galaxy.json', { path: 'content/galaxy.json', sha: hash('content'), type: 'blob' }],
    ['content/release.json', { path: 'content/release.json', sha: hash('release'), type: 'blob' }]
  ]);
  const snap = branch => ({ branch: branch === 'draft' ? 'portfolio-drafts' : 'portfolio-live', sha: state[branch], tree: hash('tree-' + state[branch]), files: new Map(files) });
  return { state, factory: async () => ({
    token: 'SERVER_CREDENTIAL_MUST_NEVER_BE_SERIALIZED',
    async connect() { this.draft = snap('draft'); this.live = snap('live'); return { draft: state.text, release: state.release }; },
    async save(text) { state.text = text; state.draft = hash(text + state.draft); this.draft = snap('draft'); state.writes.push('draft'); return state.draft; },
    async upload(blob, name) { const value = 'assets/media/test-' + name; state.draft = hash(value + state.draft); files.set(value, { path: value, sha: hash(value), type: 'blob' }); this.draft = snap('draft'); state.writes.push('upload'); return value; },
    async publish(view, text) {
      if (!['legacy', 'galaxy'].includes(view)) { const e = new Error('Invalid view'); e.status = 400; throw e; }
      if (view === 'galaxy' && text !== state.text) { const e = new Error('Save this draft before publishing.'); e.status = 400; throw e; }
      state.live = hash(view + state.live); state.release = { view, publishedAt: 'fixture release' }; this.live = snap('live'); state.writes.push('publish'); return { ...state.release, commit: state.live };
    },
    async request(resource) {
      if (resource === '/git/blobs/' + hash('content')) return { content: Buffer.from(state.text).toString('base64'), encoding: 'base64' };
      if (resource === '/git/blobs/' + hash('release')) return { content: Buffer.from(JSON.stringify(state.release)).toString('base64'), encoding: 'base64' };
      return { fixture: true };
    }
  }) };
}
module.exports = { fixture };
