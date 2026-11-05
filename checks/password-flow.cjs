// Real browser cookies/forms and editor, backed by an isolated in-memory publishing fixture.
const assert = require('node:assert/strict'), https = require('node:https'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { createHandler } = require('../tools/private-admin.cjs'), { fixture } = require('./private-fixture.cjs');
const root = path.resolve(__dirname, '..');
const password = 'deliberate-test-password', evidence = process.env.PORTFOLIO_EVIDENCE_DIR;
async function run() {
  const { state, factory } = fixture(root), cases = [], errors = [], requests = [];
  const check = (name, value) => { assert(value, name); cases.push(name); console.log('PASS ' + name); };
  const certDir = fs.mkdtempSync(path.join(require('node:os').homedir(), '.local/share/device-agent/work/portfolio-tls-fixture-'));
  let pem;
  try {
    const cert = execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certDir, 'key'), '-days', '1', '-subj', '/CN=localhost'], { stdio: ['ignore', 'pipe', 'ignore'] });
    pem = Buffer.concat([fs.readFileSync(path.join(certDir, 'key')), cert]);
  } finally { fs.rmSync(certDir, { recursive: true }); }
  let handler;
  const server = https.createServer({ key: pem, cert: pem }, (req, res) => {
    // Model the installed Serve Unix-socket proxy while retaining real browser HTTPS.
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'host') req.rawHeaders[i + 1] = 'localhost';
    req.headers.host = 'localhost';
    for (const [key, value] of Object.entries({ 'x-forwarded-for': '100.73.248.31', 'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': 'https' })) {
      req.headers[key] = value; req.rawHeaders.push(key, value);
    }
    handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'https://127.0.0.1:' + server.address().port;
  handler = createHandler({ root, policy: { origin, passwordRef: 'op://fixture/item/password' }, passwordProvider: async () => password, clientFactory: factory });
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  let context, phone, restored;
  async function setup(context) {
    context.on('page', page => { page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept()); });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      requests.push({ url: url.href, method: request.method(), headers: await request.allHeaders() });
      if (url.origin === 'https://aryan-poonacha.github.io') {
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': origin }, contentType: 'application/json', body: JSON.stringify(state.release) });
      }
      if (url.origin !== origin) return route.fulfill({ status: 204 });
      await route.continue();
    });
  }
  const ready = p => p.waitForFunction(() => document.querySelector('#admin-app')?.hidden === false && window.PortfolioPublishing?.connected() && !document.querySelector('#disconnect')?.disabled);
  const login = async p => { await p.locator('#password').fill(password); await p.getByRole('button', { name: 'Open editor', exact: true }).click(); await ready(p); };
  const pick = async p => { await p.locator('#find').fill('tomex'); await p.locator('#tree .row[data-id="tomex"]').first().click(); await p.locator('#find').fill(''); };
  try {
    if (evidence) fs.mkdirSync(evidence, { recursive: true });
    context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, ...(evidence ? { recordVideo: { dir: evidence, size: { width: 1280, height: 800 } } } : {}) });
    await setup(context); const page = await context.newPage();
    await page.goto(origin + '/admin/');
    check('anonymous editor redirects to one password form', new URL(page.url()).pathname === '/login' && await page.locator('input[type=password]').count() === 1);
    check('no editor resources before sign-in', !requests.some(r => r.url.endsWith('/admin/admin.js')) && state.writes.length === 0);
    await page.locator('#password').fill('wrong'); await page.getByRole('button', { name: 'Open editor', exact: true }).click();
    try { await page.waitForURL('**/login?error=1', { timeout: 5000 }); } catch (e) { throw new Error('Wrong-password navigation: ' + page.url() + ' body=' + await page.locator('body').innerText()); }
    check('wrong password rejected without opening editor', page.url().includes('error=1') && (await page.locator('[role=status]').textContent()).includes('did not match'));
    if (evidence) await page.screenshot({ path: path.join(evidence, 'password-desktop.png') });
    await login(page);
    check('password opens connected editor without token setup', await page.locator('#shell').isVisible() && await page.locator('#connection-form').isHidden());
    const cookies = await context.cookies(), session = cookies.find(c => c.name === '__Host-portfolio-admin');
    check('30-day secure HttpOnly same-site session', session?.httpOnly && session.secure && session.sameSite === 'Strict' && session.expires > Date.now() / 1000 + 29 * 86400);
    check('no browser credential storage', await page.evaluate(() => !document.cookie.includes('portfolio-admin') && !localStorage.getItem('portfolio:github:token') && !sessionStorage.getItem('portfolio:github:token') && !JSON.stringify(window.PortfolioAccess.session).includes('deliberate-test-password')));
    await pick(page); await page.locator('#edit [data-field=summary] textarea').fill('Password flow saved draft.');
    const live = state.live;
    await page.locator('#save').click(); await page.waitForFunction(() => /Draft synced at/.test(document.querySelector('#status').textContent));
    check('save advances only fixture draft', state.text.includes('Password flow saved draft.') && state.live === live && state.writes.join(',') === 'draft');
    await page.reload(); await ready(page); await pick(page);
    check('reload remembers sign-in and saved work', await page.locator('#edit [data-field=summary] textarea').inputValue() === 'Password flow saved draft.');
    await page.frameLocator('#frame').locator('canvas').first().waitFor();
    check('real preview runs under protected origin CSP', true);
    if (evidence) await page.screenshot({ path: path.join(evidence, 'password-connected.png') });
    restored = await browser.newContext({ ignoreHTTPSErrors: true, storageState: await context.storageState() }); await setup(restored);
    const again = await restored.newPage(); await again.goto(origin + '/admin/'); await ready(again);
    check('remembered cookie survives a fresh browser context', await again.locator('#shell').isVisible()); await restored.close(); restored = null;
    const second = await context.newPage(); await second.goto(origin + '/admin/'); await ready(second);
    await page.locator('#publishing').click(); await page.locator('#disconnect').click();
    await page.waitForURL('**/login'); await second.waitForURL('**/login');
    check('sign-out locks all device tabs', (await context.cookies()).every(c => c.name !== '__Host-portfolio-admin'));
    await second.close();
    const recovery = { version: 1, tab: 'password-flow', work: [{ key: 'galaxy:admin:work:migrated', value: JSON.stringify({ at: Date.now(), base: 'older-version', doc: JSON.parse(state.text) }) }], hash: '#tomex' };
    recovery.work[0].value = JSON.stringify({ ...JSON.parse(recovery.work[0].value), doc: { ...JSON.parse(state.text), core: { ...JSON.parse(state.text).core, summary: 'Transferred browser-only work' } } });
    await page.goto(origin + '/admin/#recovery=' + encodeURIComponent(Buffer.from(JSON.stringify(recovery)).toString('base64')));
    await login(page);
    check('browser draft survives password form navigation', await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('galaxy:admin:work:') && localStorage.getItem(k).includes('Transferred browser-only work'))));
    phone = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 }); await setup(phone);
    const mobile = await phone.newPage(); await mobile.goto(origin + '/login');
    check('phone password form fits viewport', await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (evidence) await mobile.screenshot({ path: path.join(evidence, 'password-phone.png') });
    await login(mobile);
    check('phone opens connected editor', await mobile.locator('#shell').isVisible());
    check('no browser GitHub token or direct API requests', !requests.some(r => r.url.startsWith('https://api.github.com') || r.headers.authorization));
    check('no script errors', errors.length === 0);
    console.log(JSON.stringify({ passed: cases.length, cases, errors }));
  } finally {
    if (phone) await phone.close(); if (restored) await restored.close(); if (context) await context.close(); await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
