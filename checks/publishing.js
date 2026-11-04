async (page) => {
  // Exercise the real editor and publishing UI against an isolated GitHub protocol fixture.
  // Refs, immutable commits, trees and blobs are independent; non-fast-forward saves are rejected.
  const cases = [], errors = [], base = 'http://127.0.0.1:4187/';
  const rec = (name, ok, detail) => { cases.push({ name, ok: !!ok, detail: detail || null }); };
  const original = await (await page.request.get(base + 'content/galaxy.json')).text();
  const legacy = await (await page.request.get(base + 'legacy.html')).text();
  const galaxy = await (await page.request.get(base + 'galaxy.html')).text();
  const blobs = new Map(), trees = new Map(), commits = new Map(), refs = new Map();
  let n = 0, servedHead, rejectLive = false, failAuth = false, delaySave = false, delayResolve;
  const id = () => String(++n).padStart(40, '0');
  const blob = text => { const sha = id(); blobs.set(sha, text); return sha; };
  const seed = new Map([
    ['content/galaxy.json', blob(original)], ['content/release.json', blob(JSON.stringify({ view: 'legacy', publishedAt: null, draftCommit: null }))],
    ['legacy.html', blob(legacy)], ['galaxy.html', blob(galaxy)], ['index.html', blob(legacy)]
  ]);
  const t0 = id(), c0 = id(); trees.set(t0, seed); commits.set(c0, { tree: { sha: t0 }, parents: [] });
  refs.set('portfolio-live', c0); servedHead = c0;
  const file = (branch, path) => blobs.get(trees.get(commits.get(refs.get(branch)).tree.sha).get(path));
  const atFile = (commit, path) => blobs.get(trees.get(commits.get(commit).tree.sha).get(path));
  async function routes(p) {
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', d => d.accept());
    await p.route('**/__admin/ping', r => r.fulfill({ status: 404, body: '{}' }));
    await p.route('**/content/release.json*', r => r.fulfill({ contentType: 'application/json', body: atFile(servedHead, 'content/release.json') }));
    await p.route('https://api.github.com/**', async route => {
      const req = route.request(), url = new URL(req.url()), path = decodeURIComponent(url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, ''));
      const body = req.postDataJSON(); let out = {}, status = 200;
      if (failAuth) { status = 401; out = { message: 'Bad credentials' }; }
      else if (!path) out = { permissions: { push: true } };
      else if (path.startsWith('/git/ref/heads/')) {
        const sha = refs.get(path.slice('/git/ref/heads/'.length));
        if (sha) out = { object: { sha } }; else { status = 404; out = { message: 'Not found' }; }
      } else if (path === '/git/refs') {
        const branch = body.ref.replace('refs/heads/', '');
        if (refs.has(branch)) status = 422; else { refs.set(branch, body.sha); out = { object: { sha: body.sha } }; }
      } else if (path.startsWith('/git/commits/')) out = commits.get(path.split('/').pop());
      else if (path.startsWith('/git/trees/')) out = { tree: Array.from(trees.get(path.split('/').pop())).map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644' })), truncated: false };
      else if (path.startsWith('/git/blobs/')) out = { content: Buffer.from(blobs.get(path.split('/').pop()), 'utf8').toString('base64'), encoding: 'base64' };
      else if (path === '/git/blobs') { const sha = blob(Buffer.from(body.content, 'base64')); out = { sha }; }
      else if (path === '/git/trees') {
        const tree = new Map(trees.get(body.base_tree));
        body.tree.forEach(e => tree.set(e.path, e.sha || blob(e.content)));
        const sha = id(); trees.set(sha, tree); out = { sha };
      } else if (path === '/git/commits') {
        const sha = id(); commits.set(sha, { tree: { sha: body.tree }, parents: body.parents }); out = { sha };
      } else if (path.startsWith('/git/refs/heads/')) {
        const branch = path.slice('/git/refs/heads/'.length);
        if (delaySave && branch === 'portfolio-drafts') { delaySave = false; await new Promise(r => { delayResolve = r; }); }
        if ((rejectLive && branch === 'portfolio-live') || commits.get(body.sha).parents[0] !== refs.get(branch) || body.force) {
          status = 422; out = { message: 'Update is not a fast forward' };
        } else { refs.set(branch, body.sha); out = { object: { sha: body.sha } }; }
      } else { status = 404; out = { message: path }; }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(out) });
    });
  }
  const wait = async (p, expression) => { try { return await p.waitForFunction(expression, null, { timeout: 12000 }); } catch (e) { throw new Error('After ' + cases.map(c => c.name).join(', ') + ': ' + expression.toString() + ': ' + await p.locator('#publishing-msg').textContent() + '; status=' + await p.locator('#status').textContent()); } };
  const pick = async (p, id) => { await p.locator('#find').fill(id); await p.locator('#tree .row[data-id="' + id + '"]').first().click(); await p.locator('#find').fill(''); };
  const summary = p => p.locator('#edit [data-field="summary"] textarea');
  const close = async p => { if (await p.locator('#publishing-dialog').evaluate(e => e.open)) await p.locator('#publishing-close').click(); };
  const connect = async (p, remember = false) => {
    await p.locator('#connect-shortcut').click();
    await p.locator('#connect-token').fill('fixture-token');
    if (remember) await p.locator('#connect-remember').check();
    await p.locator('#connect-go').click();
    await wait(p, () => document.querySelector('#connected-info').hidden === false && !document.querySelector('#disconnect').disabled);
    await close(p);
  };
  await routes(page); await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + 'admin/'); await wait(page, () => document.querySelector('#tree .row[data-id="tomex"]'));
  rec('legacy-is-default-homepage', (await (await page.request.get(base)).text()) === legacy);
  await connect(page, true);
  rec('connect-seeds-separate-cloud-draft', refs.get('portfolio-drafts') === c0 && refs.get('portfolio-live') === c0);
  await pick(page, 'tomex'); await summary(page).fill('Carefully edited draft.');
  await page.locator('#save').click();
  await wait(page, () => /Draft synced at/.test(document.querySelector('#status').textContent));
  rec('draft-save-does-not-publish', /Carefully edited draft/.test(file('portfolio-drafts', 'content/galaxy.json')) && refs.get('portfolio-live') === c0);
  const context2 = await page.context().browser().newContext(); const p2 = await context2.newPage(); await routes(p2);
  try {
    await p2.goto(base + 'admin/'); await wait(p2, () => document.querySelector('#tree .row[data-id="tomex"]')); await connect(p2);
    await pick(p2, 'tomex'); rec('other-device-loads-saved-draft', await summary(p2).inputValue() === 'Carefully edited draft.');
    await pick(page, 'tomex'); await summary(page).fill('Newer device-one edit.'); await page.locator('#save').click();
    await wait(page, () => /Draft synced at/.test(document.querySelector('#status').textContent) && /All changes saved/.test(document.querySelector('#status').textContent));
    await summary(p2).fill('Stale device-two edit.'); await p2.locator('#save').click();
    await wait(p2, () => /Another save changed/.test(document.querySelector('#publishing-msg').textContent));
    rec('stale-device-save-refused-without-data-loss', /Newer device-one edit/.test(file('portfolio-drafts', 'content/galaxy.json')) && await summary(p2).inputValue() === 'Stale device-two edit.');
    await close(p2); await p2.locator('#cloud-reload').click();
    await wait(p2, () => /Draft synced across devices/.test(document.querySelector('#cloud-state').textContent));
    rec('conflict-reload-keeps-browser-version-in-undo', await summary(p2).inputValue() === 'Newer device-one edit.' && !(await p2.locator('#undo').isDisabled()));
    await p2.locator('#undo').click();
    rec('undo-recovers-discarded-local-copy', await summary(p2).inputValue() === 'Stale device-two edit.');
  } finally { await context2.close(); }
  // Unsaved edits in two tabs must retain independent recovery records.
  await pick(page, 'tomex'); await summary(page).fill('Tab A unsaved.'); await page.waitForTimeout(350);
  const p3 = await page.context().newPage(); await routes(p3); await p3.goto(base + 'admin/');
  await wait(p3, () => /GitHub connected/.test(document.querySelector('#connect-shortcut').textContent) && !document.querySelector('#disconnect').disabled);
  await pick(p3, 'lightfield'); await summary(p3).fill('Tab B unsaved.'); await p3.waitForTimeout(350);
  await page.reload(); await wait(page, () => /GitHub connected/.test(document.querySelector('#connect-shortcut').textContent) && !document.querySelector('#banner').hidden);
  await page.locator('#banner button', { hasText: 'Restore them' }).click(); await pick(page, 'tomex');
  const tabA = await summary(page).inputValue();
  await p3.reload(); await wait(p3, () => /GitHub connected/.test(document.querySelector('#connect-shortcut').textContent) && !document.querySelector('#banner').hidden);
  await p3.locator('#banner button', { hasText: 'Restore them' }).click(); await pick(p3, 'lightfield');
  rec('two-tabs-recover-their-own-unsaved-edits', tabA === 'Tab A unsaved.' && await summary(p3).inputValue() === 'Tab B unsaved.');
  await p3.close();
  // Create, upload, duplicate and delete through the same hosted UI used in production.
  await page.locator('#tree .row--domain[data-id="ventures"] ~ .branch__kids .tree__add').click();
  await page.locator('#edit [data-field="title"] input').fill('Future project');
  await page.locator('#edit [data-field="media"] select').selectOption('image');
  await page.locator('#edit [data-field="media.src"] input[type="file"]').setInputFiles({ name: 'future.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
  await wait(page, () => /Uploaded assets/.test(document.querySelector('#status').textContent));
  await wait(page, () => { const img = document.querySelector('.media-ed__preview img'); return img && img.complete && img.naturalWidth > 0; });
  const uploadedPath = await page.locator('#edit [data-field="media.src"] input:not([type="file"])').inputValue();
  await page.locator('#edit [data-field="notes"] textarea').fill('EDITOR_ONLY_BROWSER_PROOF');
  await page.locator('#save').click(); await wait(page, () => /All changes saved/.test(document.querySelector('#status').textContent) && !document.querySelector('#save').disabled);
  rec('new-card-and-immutable-media-sync-only-to-draft', file('portfolio-drafts', 'content/galaxy.json').includes('future-project') && !trees.get(commits.get(refs.get('portfolio-live')).tree.sha).has(uploadedPath));
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  const copyId = await page.locator('#edit [data-field="id"] input').inputValue();
  await page.getByRole('button', { name: 'Delete…', exact: true }).click();
  await page.locator('#save').click(); await wait(page, () => /All changes saved/.test(document.querySelector('#status').textContent) && !document.querySelector('#save').disabled);
  rec('deleted-card-is-removed-from-cloud', !JSON.parse(file('portfolio-drafts', 'content/galaxy.json')).domains.some(d => d.stars.some(b => b.id === copyId)));
  await page.locator('#tree .row--nav[data-nav="site"]').click();
  await page.locator('#edit [data-field="pageTitle"] input').fill('Updated & reviewed portfolio');
  await page.locator('#edit [data-field="description"] textarea').fill('All website text is editable.');
  await pick(page, 'tomex');
  // Editing during an in-flight save must remain unsaved afterwards and recover on reload.
  await summary(page).fill('Snapshot during save.'); delaySave = true; await page.locator('#save').click();
  for (let i = 0; i < 40 && !delayResolve; i++) await page.waitForTimeout(50);
  await summary(page).fill('Typed while saving.'); delayResolve();
  await wait(page, () => /Draft synced at/.test(document.querySelector('#status').textContent) && /Unsaved changes/.test(document.querySelector('#status').textContent) && !document.querySelector('#save').disabled);
  rec('typing-during-cloud-save-remains-unsaved', /Snapshot during save/.test(file('portfolio-drafts', 'content/galaxy.json')) && await summary(page).inputValue() === 'Typed while saving.', { summary: await summary(page).inputValue(), status: await page.locator('#status').textContent() });
  await page.reload(); await wait(page, () => /GitHub connected/.test(document.querySelector('#connect-shortcut').textContent) && !document.querySelector('#banner').hidden);
  await page.locator('#banner button', { hasText: 'Restore them' }).click(); await pick(page, 'tomex');
  rec('cloud-sign-in-and-unsaved-work-survive-reload', await summary(page).inputValue() === 'Typed while saving.', { summary: await summary(page).inputValue(), status: await page.locator('#status').textContent() });
  await page.locator('#save').click(); await wait(page, () => /All changes saved/.test(document.querySelector('#status').textContent));
  await page.locator('#publishing').click(); await page.locator('#release-confirm').check();
  rejectLive = true; await page.locator('#publish-go').click();
  await wait(page, () => /Another save changed/.test(document.querySelector('#publishing-msg').textContent));
  rec('failed-release-preserves-live-and-draft', refs.get('portfolio-live') === c0 && /Typed while saving/.test(file('portfolio-drafts', 'content/galaxy.json')));
  rejectLive = false; await page.locator('#release-confirm').check(); await page.locator('#publish-go').click();
  await wait(page, () => /Release .* queued/.test(document.querySelector('#publishing-msg').textContent) && !document.querySelector('#disconnect').disabled);
  rec('galaxy-release-is-one-snapshot', file('portfolio-live', 'index.html').includes('id="sky"') && /Typed while saving/.test(file('portfolio-live', 'content/galaxy.json')) && JSON.parse(file('portfolio-live', 'content/release.json')).view === 'galaxy');
  rec('release-publishes-media-and-metadata-without-editor-notes', trees.get(commits.get(refs.get('portfolio-live')).tree.sha).has(uploadedPath) && file('portfolio-live', 'index.html').includes('Updated &amp; reviewed portfolio') && !file('portfolio-live', 'content/galaxy.json').includes('EDITOR_ONLY_BROWSER_PROOF'));
  rec('live-label-waits-for-served-release', /Live: Legacy/.test(await page.locator('#release-state').textContent()) && /Waiting for deployment: Galaxy/.test(await page.locator('#release-pending').textContent()));
  servedHead = refs.get('portfolio-live'); await page.locator('#check-live').click();
  await wait(page, () => /Live: Galaxy/.test(document.querySelector('#live-state').textContent));
  rec('live-label-verifies-served-release', /Live: Galaxy/.test(await page.locator('#release-state').textContent()) && !(await page.locator('#release-pending').textContent()));
  const draftBeforeRollback = refs.get('portfolio-drafts'), publishedBeforeRollback = file('portfolio-live', 'content/galaxy.json');
  await page.locator('#release-view').selectOption('legacy');
  rec('switching-view-needs-new-deliberate-publish', await page.locator('#publish-go').isDisabled() && file('portfolio-live', 'index.html').includes('id="sky"'));
  await page.locator('#release-confirm').check(); await page.locator('#publish-go').click();
  await wait(page, () => /Waiting for deployment: Legacy/.test(document.querySelector('#release-pending').textContent));
  rec('legacy-switch-keeps-galaxy-draft-and-publication', file('portfolio-live', 'index.html') === legacy && refs.get('portfolio-drafts') === draftBeforeRollback && file('portfolio-live', 'content/galaxy.json') === publishedBeforeRollback);
  await page.locator('#disconnect').click();
  rec('disconnect-clears-credentials', await page.evaluate(() => !localStorage.getItem('portfolio:github:token') && !sessionStorage.getItem('portfolio:github:token')));
  failAuth = true; await page.locator('#connect-token').fill('expired-fixture'); await page.locator('#connect-go').click();
  await wait(page, () => /sign-in expired/.test(document.querySelector('#publishing-msg').textContent));
  rec('expired-token-never-connects-or-publishes', !(await page.locator('#connected-info').isVisible()) && await page.locator('#publish-go').isDisabled());
  await close(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#publishing').click();
  rec('phone-controls-fit-and-scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#publishing-dialog').scrollHeight > 0));
  rec('no-publishing-page-errors', errors.length === 0, errors);
  await close(page); await page.evaluate(() => localStorage.clear());
  return { ok: cases.every(c => c.ok), cases };
}
