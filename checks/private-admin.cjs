const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), path = require('node:path');
const { createHandler } = require('../tools/private-admin.cjs'), { fixture } = require('./private-fixture.cjs');
const root = path.resolve(__dirname, '..');
const policy = { origin: 'https://editor.example', passwordRef: 'op://fixture/item/password' };
const password = 'deliberate-test-password';
test('password protection and constrained publishing actions', async t => {
  let secret = password;
  const { state, factory } = fixture(root);
  const server = http.createServer(createHandler({ root, policy, passwordProvider: async () => secret, clientFactory: factory }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie;
  async function request(url, options = {}) {
    const headers = { Host: 'localhost', 'X-Forwarded-For': '100.73.248.31', 'X-Forwarded-Host': 'editor.example', 'X-Forwarded-Proto': 'https', ...(cookie ? { Cookie: cookie } : {}), ...options.headers };
    const data = options.body;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    // Native fetch rewrites Host; this fixture must reproduce Serve's exact proxy headers.
    return new Promise((resolve, reject) => {
      const req = http.request(base + url, { method: options.method || 'GET', headers }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      });
      req.on('error', reject); req.end(data);
    });
  }
  const action = (name, input = {}, headers = {}) => request('/__admin/actions/' + name, { method: 'POST', headers: { Origin: policy.origin, 'Content-Type': 'application/json', 'X-Portfolio-Request': '1', ...headers }, body: JSON.stringify({ expectedDraft: state.draft, expectedLive: state.live, ...input }) });
  const login = value => request('/__admin/login', { method: 'POST', headers: { Origin: policy.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: value }).toString() });
  try {
    for (const resource of ['/admin/', '/admin/admin.js', '/content/galaxy.json', '/galaxy.html']) await t.test('anonymous file denied ' + resource, async () => {
      const response = await request(resource); assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/login');
    });
    await t.test('anonymous API denied without GitHub actions', async () => { assert.equal((await action('connect')).status, 401); assert.deepEqual(state.writes, []); });
    await t.test('one password form, no GitHub token field', async () => { const text = await (await request('/login')).text(); assert(text.includes('autocomplete="current-password"')); assert(!text.includes('GitHub token')); });
    await t.test('wrong password rejected', async () => { const r = await login('wrong'); assert.equal(r.headers.get('location'), '/login?error=1'); assert(!r.headers.has('set-cookie')); });
    await t.test('cross-origin login rejected', async () => { const r = await request('/__admin/login', { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=wrong' }); assert.equal(r.status, 403); });
    await t.test('correct password sets secure remembered session', async () => { const r = await login(password); assert.equal(r.status, 303); const value = r.headers.get('set-cookie'); assert(value.includes('Secure; HttpOnly; SameSite=Strict')); assert(value.includes('Max-Age=2592000')); cookie = value.split(';')[0]; });
    await t.test('remembered session opens editor', async () => { assert.equal((await request('/admin/')).status, 200); assert.equal((await request('/login')).headers.get('location'), '/admin/'); });
    await t.test('session reveals configuration without credentials', async () => { const r = await request('/__admin/session'); const data = await r.text(); assert.equal(r.status, 200); assert(data.includes('managedAuth')); assert(!data.includes(password)); assert(!data.includes('SERVER_CREDENTIAL')); });
    await t.test('spoofed proxy host denied', async () => { assert.equal((await request('/admin/', { headers: { 'X-Forwarded-Host': 'attacker.example' } })).status, 403); });
    await t.test('forwarded address chain denied', async () => { assert.equal((await request('/admin/', { headers: { 'X-Forwarded-For': '100.73.248.31, 100.68.16.21' } })).status, 403); });
    await t.test('forged session denied', async () => { assert.equal((await request('/__admin/session', { headers: { Cookie: cookie + 'x' } })).status, 401); });
    for (const [name, headers] of [['missing Origin', { Origin: '' }], ['null Origin', { Origin: 'null' }], ['foreign Origin', { Origin: 'https://attacker.example' }], ['missing custom header', { 'X-Portfolio-Request': '' }], ['wrong content type', { 'Content-Type': 'text/plain' }]]) await t.test(name, async () => assert.equal((await action('save', { text: state.text }, headers)).status, 403));
    await t.test('no CORS/preflight', async () => { const r = await request('/__admin/actions/save', { method: 'OPTIONS' }); assert.equal(r.status, 403); assert(!r.headers.has('access-control-allow-origin')); });
    await t.test('connect returns snapshots without token', async () => { const r = await action('connect'); const text = await r.text(); assert.equal(r.status, 200); assert(text.includes('portfolio-drafts')); assert(!text.includes('SERVER_CREDENTIAL')); });
    await t.test('stale draft refused before mutation', async () => { const count = state.writes.length; assert.equal((await action('save', { text: state.text, expectedDraft: 'stale' })).status, 409); assert.equal(state.writes.length, count); });
    await t.test('malformed draft refused', async () => { assert.equal((await action('save', { text: '{}' })).status, 400); });
    await t.test('save only advances draft', async () => { const live = state.live; assert.equal((await action('save', { text: state.text })).status, 200); assert.equal(state.live, live); });
    await t.test('malformed media refused', async () => { assert.equal((await action('upload', { name: 'evil.svg', data: Buffer.from('<svg/>').toString('base64') })).status, 400); assert.equal((await action('upload', { name: 'x.png', data: '@@@@' })).status, 400); });
    await t.test('upload returns advanced draft snapshot', async () => { const old = state.draft; const r = await action('upload', { name: 'proof.png', data: Buffer.from('fixture image').toString('base64') }); assert.equal(r.status, 200); const data = await r.json(); assert.notEqual(data.draft.sha, old); assert.equal(data.draft.sha, state.draft); });
    await t.test('stale live publication refused', async () => { const count = state.writes.length; assert.equal((await action('publish', { view: 'legacy', text: state.text, expectedLive: 'stale' })).status, 409); assert.equal(state.writes.length, count); });
    await t.test('unsaved publication refused', async () => { const doc = JSON.parse(state.text); doc.core.summary = 'not saved'; assert.equal((await action('publish', { view: 'galaxy', text: JSON.stringify(doc) })).status, 400); });
    await t.test('deliberate publication works', async () => { assert.equal((await action('publish', { view: 'legacy', text: state.text })).status, 200); });
    await t.test('no low-level write proxy', async () => { assert.equal((await request('/__admin/github/repos/Aryan-Poonacha/Aryan-Poonacha.github.io/git/refs/heads/main', { method: 'PATCH', headers: { Origin: policy.origin, 'Content-Type': 'application/json', 'X-Portfolio-Request': '1' }, body: '{}' })).status, 405); });
    for (const resource of ['/__admin/github/repos/other/repo', '/__admin/github/repos/Aryan-Poonacha/Aryan-Poonacha.github.io/git/ref/heads/main', '/__admin/github/https://attacker.example']) await t.test('unsupported read denied ' + resource, async () => assert.equal((await request(resource)).status, 403));
    await t.test('third-party legacy scripts kept off privileged origin', async () => { assert.equal((await request('/legacy.html')).headers.get('location'), 'https://aryan-poonacha.github.io/legacy.html'); const r = await request('/admin/'); assert(r.headers.get('content-security-policy').includes("script-src 'self'")); });
    await t.test('logout clears session', async () => { const r = await request('/__admin/logout', { method: 'POST', headers: { Origin: policy.origin, 'Content-Type': 'application/json', 'X-Portfolio-Request': '1' }, body: '{}' }); assert.equal(r.status, 200); assert(r.headers.get('set-cookie').includes('Max-Age=0')); });
    await t.test('password rotation invalidates remembered sessions', async () => { secret = 'rotated-fixture-password'; await login(secret); assert.equal((await request('/__admin/session')).status, 401); });
    await t.test('login attempts are rate limited', async () => { for (let i = 0; i < 8; i++) await login('wrong'); assert.equal((await login('wrong')).status, 429); });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
