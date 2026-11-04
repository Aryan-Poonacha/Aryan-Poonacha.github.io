async (page) => {
  // The content editor at /admin/, served by tools/edit.py: every card is listed; edits show in the preview of the real
  // site but not to visitors; undo; IDs stay unique; errors block a save; a save writes content/galaxy.json; moving,
  // adding, hiding and the card layout reach the map; unsaved work survives a reload, also through a save in flight;
  // an empty domain saves; cleared text stays cleared; script links render as text; the site reports broken content.
  // content/galaxy.json is put back byte for byte at the end.
  const cases = [];
  const rec = (name, ok, detail) => cases.push({ name, ok: !!ok, detail });
  const base = 'http://127.0.0.1:4187/';
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const until = async (fn, ms = 8000) => { const t = Date.now(); let v = null; while (Date.now() - t < ms) { try { v = await fn(); if (v) return v; } catch (e) { /* not yet */ } await page.waitForTimeout(120); } return v; };
  const fileText = () => page.evaluate(() => fetch('/content/galaxy.json', { cache: 'no-store' }).then((r) => r.text()));
  const putText = (t) => page.evaluate((t) => fetch('/__admin/file?path=content/galaxy.json', { method: 'PUT', body: t }).then((r) => r.status), t);
  const status = () => page.locator('#status').textContent();
  const frame = () => page.frames().find((f) => f !== page.mainFrame() && f.url().indexOf('draft=1') >= 0);
  const inPreview = (fn, arg) => until(async () => { const f = frame(); if (!f) return null; return f.evaluate(fn, arg); });
  const pick = async (id) => { await page.locator('#find').fill(''); await page.locator('#find').fill(id); await page.locator('#tree .row[data-id="' + id + '"]').first().click(); await page.locator('#find').fill(''); };
  const field = (key) => page.locator('#edit [data-field="' + key + '"]').first();
  const retype = async (locator, text) => { await locator.click(); await page.keyboard.press('Control+a'); await page.keyboard.type(text); };
  const undoAll = async () => { for (let i = 0; i < 12 && !(await page.locator('#undo').isDisabled()); i++) await page.locator('#undo').click(); };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + 'admin/');
  await until(() => page.evaluate(() => document.querySelectorAll('#edit table.overview tbody tr').length > 0));
  await page.bringToFront();
  const original = await fileText();
  try {
    const loaded = await page.evaluate(() => ({ rows: document.querySelectorAll('#edit table.overview tbody tr').length, domains: document.querySelectorAll('#tree .row--domain').length, save: document.querySelector('#save').textContent }));
    rec('lists-every-card', loaded.rows === 82 && loaded.domains === 6 && loaded.save === 'Save' && /All changes saved/.test(await status()), loaded);

    await pick('tomex');
    await retype(field('summary').locator('textarea'), 'Edited in the check.');
    const lead = await inPreview(() => { const l = document.querySelector('#card .card__lead'); return l && l.textContent === 'Edited in the check.' ? l.textContent : null; });
    rec('edit-shows-in-preview', lead && /Unsaved changes/.test(await status()), { lead, status: await status() });

    const pub = await page.context().newPage();
    await pub.goto(base + 'galaxy.html?intro=0#tomex'); await pub.waitForFunction(() => typeof window.__galaxy === 'function'); await pub.waitForTimeout(300);
    const pubLead = await pub.locator('#card .card__lead').textContent(); await pub.close(); await page.bringToFront();
    rec('visitors-do-not-see-drafts', /^AI cost control/.test(pubLead || ''), pubLead);

    await page.locator('#undo').click();
    const undone = await field('summary').locator('textarea').inputValue();
    rec('undo-restores', /^AI cost control/.test(undone) && /All changes saved/.test(await status()), undone.slice(0, 30));

    await retype(field('id').locator('input'), 'lightfield'); await page.keyboard.press('Tab');
    rec('ids-stay-unique', (await field('id').locator('input').inputValue()) === 'tomex' && /already used/.test(await status()), await status());

    await page.locator('#edit section.part', { hasText: 'the first three also on hover' }).locator('button', { hasText: '+ Link' }).click();
    await page.keyboard.type('Bad'); await page.keyboard.press('Tab'); await page.keyboard.type('javascript:alert(1)');
    await page.keyboard.press('Control+s'); await page.waitForTimeout(400);
    const blocked = await status();
    rec('errors-block-save', /Fix 1 error/.test(blocked) && (await fileText()) === original && (await page.locator('#edit .problems li').count()) === 1, blocked);
    await undoAll();

    await pick('curebereft');
    await retype(field('summary').locator('textarea'), 'Saved by the check.');
    await page.keyboard.press('Control+s');
    const saved = await until(async () => { const t = await fileText(); return t.indexOf('Saved by the check.') >= 0 ? t : null; });
    const parsed = saved ? JSON.parse(saved) : null;
    rec('save-writes-the-file', parsed && parsed.domains.find((d) => d.id === 'writing').stars[0].summary === 'Saved by the check.' && saved.endsWith('}\n') && /Saved to content\/galaxy.json/.test(await status()), await status());
    await putText(original);
    await page.goto(base + 'admin/#body:eenote'); await until(() => page.locator('#edit [data-field="domain"] select').count());

    await field('domain').locator('select').selectOption('games');
    const movedTree = await page.locator('#tree .branch--domain:has(.row--domain[data-id="games"]) .row[data-id="eenote"]').count();
    const movedMap = await inPreview(() => { const g = window.__galaxy && window.__galaxy(); const b = g && g.bodies.find((x) => x.id === 'eenote'); return b && b.cluster === 'games' ? b.cluster : null; });
    rec('move-reaches-the-map', movedTree === 1 && movedMap === 'games', { movedTree, movedMap });
    await undoAll();

    await pick('quantum');
    await page.locator('#edit section.part', { hasText: 'Add planets' }).locator('button', { hasText: '+ Planet' }).click();
    await page.keyboard.type('Deck as a circuit');
    const newId = await field('id').locator('input').inputValue();
    const inMap = await inPreview(() => { const g = window.__galaxy && window.__galaxy(); const b = g && g.bodies.find((x) => x.id === 'deck-as-a-circuit'); return b && b.parent ? b.parent.id : null; });
    rec('new-planet-takes-its-title', newId === 'deck-as-a-circuit' && (await page.locator('#tree .row--planet[data-id="deck-as-a-circuit"]').count()) === 1 && inMap === 'quantum', { newId, inMap });
    await undoAll();

    await page.locator('#tree .row--nav[data-nav="site"]').click();
    await page.locator('#edit .layout').nth(1).locator('label', { hasText: 'Previous and next' }).click();
    await pick('lightfield');
    const steps = await inPreview(() => { const c = document.querySelector('#card'); return c && c.dataset.on === 'true' && c.querySelector('.card__title') ? String(c.querySelectorAll('.card__step').length) : null; });
    rec('card-layout-applies', steps === '0', steps);
    await undoAll();

    await pick('i-math');
    await page.locator('#edit .ed__head label', { hasText: 'Hidden from the site' }).click();
    const gone = await inPreview(() => { const g = window.__galaxy && window.__galaxy(); return g && !g.bodies.some((x) => x.id === 'i-math') && g.bodies.length === 81 ? 'gone' : null; });
    rec('hidden-card-leaves-the-map', gone === 'gone' && (await page.locator('#tree .row.is-hidden[data-id="i-math"]').count()) === 1, gone);
    await undoAll();

    await page.locator('#preview-device button[data-device="phone"]').click();
    const phone = await inPreview(() => (window.innerWidth === 390 ? 390 : null));
    await page.locator('#preview-device button[data-device="desktop"]').click();
    rec('phone-preview', phone === 390, phone);

    await pick('voitheia');
    await retype(field('summary').locator('textarea'), 'Kept across a reload.');
    await page.waitForTimeout(500);
    await page.reload(); await until(() => page.locator('#banner:not([hidden])').count());
    const bannerText = await page.locator('#banner').textContent();
    await page.locator('#banner button', { hasText: 'Restore them' }).click();
    await pick('voitheia');
    const kept = await field('summary').locator('textarea').inputValue();
    rec('unsaved-work-survives-reload', /kept changes you had not saved/.test(bannerText) && kept === 'Kept across a reload.' && /Unsaved changes/.test(await status()), { bannerText, kept });
    await undoAll();
    rec('back-to-clean', /All changes saved/.test(await status()) && (await fileText()) === original, await status());

    // a domain with no stars yet can be saved and the editor still opens afterwards
    await page.locator('#tree .tree__add--domain').click(); await page.keyboard.type('Music');
    await page.keyboard.press('Control+s');
    await until(async () => (await fileText()).indexOf('"name": "Music"') >= 0);
    await page.reload(); await until(() => page.locator('#tree .row--domain').count());
    const music = await page.locator('#tree .row--domain[data-id="music"]').count();
    rec('empty-domain-survives-save', music === 1 && errors.length === 0, { music, errors: errors.slice(0, 2) });
    await putText(original); await page.evaluate(() => localStorage.clear()); await page.reload(); await until(() => page.locator('#tree .row--domain').count());

    // edits made while a save is in flight are still kept for recovery when it finishes
    await page.evaluate(() => { const f = window.fetch; window.fetch = (u, o) => (o && o.method === 'PUT' ? new Promise((r) => setTimeout(r, 1500)).then(() => f(u, o)) : f(u, o)); });
    await pick('voitheia');
    await retype(field('summary').locator('textarea'), 'First version.');
    await page.keyboard.press('Control+s'); await page.waitForTimeout(200);
    await page.keyboard.type(' Then more.');
    await page.waitForTimeout(2600);
    const work = await page.evaluate(() => { const w = JSON.parse(localStorage.getItem('galaxy:admin:work') || 'null'); return w && w.doc.domains.find((d) => d.id === 'ventures').stars.find((x) => x.id === 'voitheia').summary; });
    rec('edits-during-save-are-kept', work === 'First version. Then more.' && /Unsaved changes/.test(await status()), { work, status: await status() });
    await putText(original); await page.evaluate(() => localStorage.clear()); await page.goto(base + 'admin/'); await until(() => page.locator('#tree .row--domain').count());

    // clearing the tagline clears it on the site
    await page.locator('#tree .row--nav[data-nav="site"]').click();
    await field('tagline').locator('input').click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
    const tagline = await inPreview(() => { const t = document.querySelector('.brand .label'); return window.__galaxy && t && t.textContent === '' ? 'empty' : null; });
    rec('cleared-text-stays-cleared', tagline === 'empty', tagline);
    await undoAll();

    // a new card connects under the ID its title gave it
    await page.locator('#tree .row--domain[data-id="ventures"] ~ .branch__kids .tree__add').click();
    await page.keyboard.type('My project');
    await page.locator('#edit section.part', { hasText: 'Where it meets' }).locator('input.picker').fill('Tomex · tomex');
    await page.keyboard.press('Tab');
    const linked = await page.evaluate(() => Array.from(document.querySelectorAll('#edit .chips .chip__t')).map((c) => c.textContent));
    rec('new-card-connects-by-its-id', linked.indexOf('Tomex') >= 0 && !/error/.test(await status()), { linked, status: await status() });
    await undoAll();

    // links that would run script render as text, in card text and in a card's links
    const draft = JSON.parse(original);
    const tx = draft.domains.find((d) => d.id === 'ai').stars.find((x) => x.id === 'tomex');
    tx.summary = 'See [this](\u0001javascript:alert(1)) now.'; tx.links = [{ label: 'Bad', url: 'java\tscript:alert(1)' }, { label: 'Good', url: 'https://tomex.ai' }];
    const xss = await page.context().newPage();
    await xss.goto(base + 'admin/blank'); await xss.evaluate((d) => localStorage.setItem('galaxy:draft', JSON.stringify(d)), draft);
    await xss.goto(base + 'galaxy.html?draft=1&intro=0#tomex'); await xss.waitForFunction(() => typeof window.__galaxy === 'function'); await xss.waitForTimeout(300);
    const hrefs = await xss.evaluate(() => ({ lead: document.querySelector('#card .card__lead').innerHTML, links: Array.from(document.querySelectorAll('#card .card__links a')).map((a) => a.getAttribute('href')) }));
    await xss.evaluate(() => localStorage.removeItem('galaxy:draft')); await xss.close(); await page.bringToFront();
    rec('script-links-render-as-text', hrefs.lead.indexOf('<a') < 0 && hrefs.lead.indexOf('this') >= 0 && hrefs.links.length === 1 && hrefs.links[0] === 'https://tomex.ai', hrefs);

    const bad = await page.context().newPage();
    await bad.route('**/content/galaxy.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"core": ' }));
    await bad.goto(base + 'galaxy.html?intro=0'); await bad.waitForSelector('.load-error', { timeout: 5000 }).catch(() => null);
    const msg = await bad.locator('.load-error').textContent().catch(() => '');
    await bad.close(); await page.bringToFront();
    rec('site-reports-broken-content', /not valid JSON/.test(msg || ''), msg);

    rec('no-page-errors', errors.length === 0, errors.slice(0, 3));
  } finally {
    if ((await fileText()) !== original) await putText(original);
    await page.evaluate(() => localStorage.clear());
  }
  return { ok: cases.every((c) => c.ok), cases };
}
