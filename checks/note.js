async (page) => {
  const cases = [], errors = [], base = 'http://127.0.0.1:4187/';
  const rec = (name, ok, detail) => cases.push({ name, ok: !!ok, detail });
  const doc = await (await page.request.get(base + 'content/galaxy.json')).json();
  const note = doc.domains.flatMap(d => d.stars).find(b => b.id === 'eenote');
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto(base + 'notes/empire-earth-in-the-browser.html');
  await page.locator('main h1').waitFor();
  rec('note-uses-editable-card', await page.locator('h1').textContent() === note.title && (await page.locator('main').textContent()).includes('Keeping the thread id'));
  rec('note-has-sections-and-original-links', await page.locator('main h2').count() === 4 && await page.locator('main a[href="https://github.com/jenissimo/bottleship/pull/38"]').count() === 1);
  const changed = structuredClone(doc), edited = changed.domains.flatMap(d => d.stars).find(b => b.id === 'eenote');
  edited.title = 'Edited from the admin';
  edited.body = ['**A section**', '**Bold** and *italic* [safe](https://example.com/) [unsafe](javascript:alert(1)) <img src=x onerror=alert(1)>', '[Another card](galaxy.html#ee)'];
  await page.route('**/content/galaxy.json', r => r.fulfill({ json: changed }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload(); await page.locator('main h1').waitFor();
  rec('note-reflects-changed-content', await page.locator('h1').textContent() === edited.title && await page.locator('main h2').textContent() === 'A section');
  rec('note-renders-text-safely', await page.locator('main img').count() === 0 && await page.locator('main a[href^="javascript:"]').count() === 0 && await page.locator('main strong').count() === 1 && await page.locator('main em').count() === 1);
  rec('note-resolves-links-from-site-root', await page.locator('main a', { hasText: 'Another card' }).getAttribute('href') === base + 'galaxy.html#ee');
  rec('phone-note-fits', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  edited.hidden = true;
  await page.reload(); await page.waitForFunction(() => document.querySelector('main').textContent.includes('unavailable'));
  rec('hidden-note-stays-hidden', await page.locator('main h1').count() === 0);
  rec('note-has-no-page-errors', errors.length === 0, errors);
  return { ok: cases.every(c => c.ok), cases };
}
