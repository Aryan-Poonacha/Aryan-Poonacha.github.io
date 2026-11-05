async (page) => {
  const cases = [], errors = [], base = 'http://127.0.0.1:4187/';
  const rec = (name, ok) => cases.push({ name, ok: !!ok });
  const content = await (await page.request.get(base + 'content/galaxy.json')).text();
  let mode = 'owner', writes = 0, repositoryReads = 0;
  const requests = [];
  async function routes(p) {
    await p.route('**/content/publishing.json', r => r.fulfill({ json: { repository: 'Aryan-Poonacha/Aryan-Poonacha.github.io', draftBranch: 'portfolio-drafts', liveBranch: 'portfolio-live', siteUrl: 'https://aryan-poonacha.github.io/' } }));
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', d => d.accept());
    p.on('request', r => requests.push({ url: r.url(), method: r.method(), authorization: r.headers().authorization }));
    await p.route('**/__admin/ping', r => r.fulfill({ status: 404, json: {} }));
    await p.route('https://api.github.com/**', r => {
      const path = new URL(r.request().url()).pathname;
      if (r.request().method() !== 'GET') writes++;
      if (path === '/user') {
        if (mode === 'network') return r.abort();
        if (mode === 'expired') return r.fulfill({ status: 401, json: { message: 'Bad credentials' } });
        if (mode === 'limited') return r.fulfill({ status: 403, json: { message: 'Rate limit exceeded' } });
        return r.fulfill({ json: { id: mode === 'other' ? 1 : 25931656, login: 'Aryan-Poonacha' } });
      }
      const api = path.replace(/^\/repos\/[^/]+\/[^/]+/, '');
      if (!api) { repositoryReads++; return r.fulfill({ json: { permissions: { push: mode !== 'readonly' } } }); }
      if (api.startsWith('/git/ref/heads/')) return r.fulfill({ json: { object: { sha: 'commit' } } });
      if (api === '/git/commits/commit') return r.fulfill({ json: { tree: { sha: 'tree' } } });
      if (api.startsWith('/git/trees/tree')) return r.fulfill({ json: { tree: [
        { path: 'content/galaxy.json', type: 'blob', sha: 'content' },
        { path: 'content/release.json', type: 'blob', sha: 'release' }
      ] } });
      if (api.startsWith('/git/blobs/')) return r.fulfill({ json: {
        encoding: 'base64', content: Buffer.from(api.endsWith('/content') ? content : JSON.stringify({ view: 'legacy', publishedAt: null })).toString('base64')
      } });
      return r.fulfill({ status: 404, json: {} });
    });
  }
  const signIn = async (p, remember = false) => {
    await p.locator('#access-go:enabled').waitFor();
    await p.locator('#access-token').fill('fixture-owner-secret');
    await p.locator('#access-remember').setChecked(remember);
    await p.locator('#access-go').click();
  };
  const connected = p => p.waitForFunction(() => window.PortfolioPublishing?.connected() && !document.querySelector('#disconnect').disabled);
  await routes(page);
  await page.setViewportSize({ width: 1000, height: 750 });
  await page.goto(base + 'admin/');
  await page.locator('#access-go:enabled').waitFor();
  rec('anonymous-sees-sign-in-only', await page.locator('#access').isVisible() && await page.locator('#shell').count() === 0);
  rec('anonymous-loads-no-editor-or-preview', !requests.some(r => /\/(admin|publishing)\.js(?:\?|$)|galaxy\.html|content\/galaxy\.json/.test(r.url)) && await page.locator('iframe').count() === 0);
  await page.evaluate(() => { localStorage.setItem('portfolio:unlocked', 'true'); sessionStorage.setItem('portfolio:authenticated', 'yes'); });
  await page.reload(); await page.locator('#access-go:enabled').waitFor();
  rec('forged-browser-flags-do-not-open-editor', await page.locator('#shell').count() === 0);
  for (const [value, pattern] of [['other', 'restricted'], ['expired', 'expired'], ['readonly', 'cannot edit'], ['limited', 'refused'], ['network', 'Failed to fetch']]) {
    mode = value; const before = repositoryReads;
    await signIn(page);
    await page.waitForFunction(() => !document.querySelector('#access-go').disabled && document.querySelector('#access-status').classList.contains('is-bad'));
    rec(value + '-identity-fails-closed', (await page.locator('#access-status').textContent()).includes(pattern) && await page.locator('#shell').count() === 0);
    if (value === 'other') rec('spoofed-owner-name-denied-before-repository-access', before === repositoryReads);
    rec(value + '-token-is-not-persisted', await page.evaluate(() => !localStorage.getItem('portfolio:github:token') && !sessionStorage.getItem('portfolio:github:token')));
  }
  mode = 'owner'; await signIn(page); await connected(page);
  rec('verified-owner-opens-connected-editor', await page.locator('#shell').isVisible() && await page.locator('#access').isHidden());
  rec('sign-in-is-tab-only-by-default', await page.evaluate(() => !!sessionStorage.getItem('portfolio:github:token') && !localStorage.getItem('portfolio:github:token')));
  rec('token-cleared-from-inputs-and-urls', !(await page.locator('#access-token').inputValue()) && requests.every(r => !r.url.includes('fixture-owner-secret')));
  rec('token-sent-only-to-github-api', requests.filter(r => r.authorization).every(r => r.url.startsWith('https://api.github.com/')));
  await page.locator('#find').fill('tomex');
  await page.locator('#tree .row[data-id="tomex"]').click();
  await page.locator('#edit [data-field="summary"] textarea').fill('Unsaved work survives immediate sign-out.');
  await page.locator('#publishing').click(); await page.locator('#disconnect').click();
  rec('disconnect-locks-editor-and-preview', await page.locator('#access').isVisible() && await page.locator('#admin-app').isHidden() && await page.locator('#frame').getAttribute('src') === 'about:blank');
  rec('disconnect-preserves-unsaved-recovery', await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('galaxy:admin:work:') && localStorage.getItem(k).includes('Unsaved work survives immediate sign-out.'))));
  await page.keyboard.press('Control+s');
  rec('keyboard-shortcuts-cannot-reopen-locked-editor', await page.locator('dialog[open]').count() === 0);
  await signIn(page, true); await connected(page);
  const sibling = await page.context().newPage(); await routes(sibling); await sibling.goto(base + 'admin/'); await connected(sibling);
  rec('remembered-owner-reverified-in-new-tab', await sibling.locator('#shell').isVisible());
  await page.locator('#publishing').click(); await page.locator('#disconnect').click();
  await sibling.locator('#access').waitFor({ state: 'visible' });
  rec('disconnect-locks-all-open-tabs', !await sibling.evaluate(() => window.PortfolioPublishing.connected()) && await sibling.locator('#admin-app').isHidden());
  await sibling.close();
  await signIn(page, true); await connected(page);
  mode = 'expired'; await page.reload();
  await page.waitForFunction(() => /expired/.test(document.querySelector('#access-status').textContent));
  rec('remembered-expired-token-never-loads-editor', await page.locator('#shell').count() === 0 && await page.evaluate(() => !localStorage.getItem('portfolio:github:token')));
  mode = 'owner'; await signIn(page); await connected(page);
  mode = 'expired'; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('#access').waitFor({ state: 'visible' });
  rec('revoked-session-locks-on-return-to-tab', await page.locator('#admin-app').isHidden() && !await page.evaluate(() => window.PortfolioPublishing.connected()));
  mode = 'owner'; await signIn(page); await connected(page);
  mode = 'expired'; await page.locator('#cloud-reload').click();
  await page.locator('#access').waitFor({ state: 'visible' });
  rec('github-401-locks-instead-of-reopening-publishing', await page.locator('#admin-app').isHidden() && await page.locator('dialog[open]').count() === 0);
  await page.setViewportSize({ width: 390, height: 844 });
  rec('phone-sign-in-fits-without-horizontal-scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.PORTFOLIO_EVIDENCE_DIR) await page.screenshot({ path: require('node:path').join(process.env.PORTFOLIO_EVIDENCE_DIR, 'owner-sign-in-phone.png') });
  await page.setViewportSize({ width: 1000, height: 750 });
  if (process.env.PORTFOLIO_EVIDENCE_DIR) await page.screenshot({ path: require('node:path').join(process.env.PORTFOLIO_EVIDENCE_DIR, 'owner-sign-in.png') });
  const noJS = await page.context().browser().newContext({ javaScriptEnabled: false });
  try {
    const p = await noJS.newPage(); await p.goto(base + 'admin/');
    rec('javascript-disabled-stays-locked', await p.locator('#shell').count() === 0 && await p.locator('#access').isVisible());
  } finally { await noJS.close(); }
  mode = 'owner';
  const noStorage = await page.context().browser().newContext();
  try {
    const p = await noStorage.newPage(); await routes(p);
    await p.addInitScript(() => ['localStorage', 'sessionStorage'].forEach(key => Object.defineProperty(window, key, { get() { throw new Error('Storage disabled'); } })));
    await p.goto(base + 'admin/'); await signIn(p); await connected(p);
    rec('owner-can-connect-with-browser-storage-disabled', await p.locator('#shell').isVisible());
  } finally { await noStorage.close(); }
  const remoteContext = await page.context().browser().newContext();
  try {
    const p = await remoteContext.newPage();
    await p.route('http://public.example/**', async r => {
      const url = new URL(r.request().url());
      if (url.pathname === '/__admin/ping') return r.fulfill({ json: { ok: true, root: 'spoofed-server' } });
      if (url.pathname === '/content/publishing.json') return r.fulfill({ json: { repository: 'Aryan-Poonacha/Aryan-Poonacha.github.io', draftBranch: 'portfolio-drafts', liveBranch: 'portfolio-live', siteUrl: 'https://aryan-poonacha.github.io/' } });
      return r.fulfill({ response: await p.request.get(base + url.pathname.slice(1) + url.search) });
    });
    await p.goto('http://public.example/admin/'); await p.locator('#access-go:enabled').waitFor();
    rec('remote-host-cannot-use-local-server-bypass', await p.locator('#shell').count() === 0 && await p.locator('#access').isVisible());
  } finally { await remoteContext.close(); }
  rec('authentication-checks-never-mutate-repository', writes === 0);
  const password = 'deliberate-fixture-password-2026';
  const envelope = await require('../admin/password.js').seal(password, 'fixture-owner-secret', 'Aryan-Poonacha/Aryan-Poonacha.github.io');
  const encryptedContext = await page.context().browser().newContext(process.env.PORTFOLIO_STATIC_EVIDENCE_DIR ? { viewport: { width: 1000, height: 750 }, recordVideo: { dir: process.env.PORTFOLIO_STATIC_EVIDENCE_DIR, size: { width: 1000, height: 750 } } } : {});
  try {
    const p = await encryptedContext.newPage(); await routes(p);
    await p.route('**/content/publishing.json', r => r.fulfill({ json: { repository: 'Aryan-Poonacha/Aryan-Poonacha.github.io', draftBranch: 'portfolio-drafts', liveBranch: 'portfolio-live', siteUrl: 'https://aryan-poonacha.github.io/', accessEnvelope: envelope } }));
    await p.goto(base + 'admin/'); await p.locator('#access-go:enabled').waitFor();
    rec('static-admin-asks-only-for-saved-password', (await p.locator('#access-form .field__l').textContent()) === 'Password' && await p.locator('#access-form details').isHidden() && await p.locator('#access-form .check').isHidden());
    if (process.env.PORTFOLIO_STATIC_EVIDENCE_DIR) await p.screenshot({ path: require('node:path').join(process.env.PORTFOLIO_STATIC_EVIDENCE_DIR, 'static-password.png') });
    const reads = repositoryReads;
    await p.locator('#access-token').fill('wrong-password'); await p.locator('#access-go').click(); await p.locator('#access-go:enabled').waitFor();
    rec('wrong-password-never-reaches-github', (await p.locator('#access-status').textContent()).includes('did not match') && repositoryReads === reads && await p.locator('#shell').count() === 0);
    await p.locator('#access-token').fill(password); await p.locator('#access-go').click(); await connected(p);
    rec('password-unlocks-connected-static-editor', await p.locator('#shell').isVisible() && await p.locator('#access').isHidden());
    rec('password-and-github-key-stay-out-of-browser-storage', await p.evaluate(() => !localStorage.getItem('portfolio:github:token') && !sessionStorage.getItem('portfolio:github:token') && !JSON.stringify({ ...localStorage, ...sessionStorage }).includes('deliberate-fixture-password-2026')));
    rec('password-is-cleared-after-unlock', await p.locator('#access-token').inputValue() === '');
    if (process.env.PORTFOLIO_STATIC_EVIDENCE_DIR) await p.screenshot({ path: require('node:path').join(process.env.PORTFOLIO_STATIC_EVIDENCE_DIR, 'static-connected.png') });
    await p.locator('#publishing').click(); await p.locator('#disconnect').click();
    rec('static-password-sign-out-locks-editor', await p.locator('#access').isVisible() && await p.locator('#admin-app').isHidden() && await p.evaluate(() => window.PortfolioAccess.session === null));
  } finally { await encryptedContext.close(); }
  rec('no-access-page-errors', errors.length === 0);
  return { ok: cases.every(c => c.ok), cases };
}
