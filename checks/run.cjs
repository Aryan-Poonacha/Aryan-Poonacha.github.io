// npm ci && npx playwright install chromium && npm test [-- publishing.js]
const fs = require('node:fs'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-results');
const base = 'http://127.0.0.1:4187';
async function serverRoot() {
  try { const r = await fetch(base + '/__admin/ping', { signal: AbortSignal.timeout(1000) }); return r.ok ? (await r.json()).root : 'other'; }
  catch (e) { if (e.cause?.code === 'ECONNREFUSED') return null; throw e; }
}
(async () => {
  let server, browser;
  const result = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), files: {}, total: 0, failed: 0 };
  fs.mkdirSync(output, { recursive: true });
  try {
    let serving = await serverRoot();
    if (serving === null) {
      server = spawn('python3', ['tools/edit.py', '--port', '4187', '--no-open', '--no-backups'], { cwd: root, stdio: 'ignore' });
      server.on('error', e => console.error(e.message));
      for (let i = 0; i < 30 && serving === null; i++) {
        await new Promise(resolve => setTimeout(resolve, 100)); serving = await serverRoot();
      }
    }
    if (serving !== root) throw new Error('Port 4187 must serve this checkout via tools/edit.py. Found: ' + serving);
    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
    result.browser = browser.version();
    const available = fs.readdirSync(__dirname).filter(n => n.endsWith('.js')).sort();
    const requested = process.argv.slice(2), names = requested.length ? requested : available;
    for (const name of names) {
      if (!available.includes(name)) throw new Error('Unknown check: ' + name);
      const context = await browser.newContext(), page = await context.newPage();
      try {
        const check = eval('(' + fs.readFileSync(path.join(__dirname, name), 'utf8') + ')');
        const data = await check(page), failed = data.cases.filter(c => !c.ok);
        result.files[name] = { cases: data.cases.length, failed }; result.total += data.cases.length; result.failed += failed.length;
      } catch (e) { result.files[name] = { error: e.stack }; result.failed++; }
      finally { await context.close(); }
      fs.writeFileSync(path.join(output, 'browser.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(name + ': ' + JSON.stringify(result.files[name]));
    }
  } finally { if (browser) await browser.close(); if (server) server.kill(); }
  console.log((result.total - result.failed) + '/' + result.total + ' passed');
  process.exitCode = result.failed ? 1 : 0;
})().catch(e => { console.error(e.message); process.exitCode = 1; });
