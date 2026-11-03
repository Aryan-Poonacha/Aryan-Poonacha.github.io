async (page) => {
  // The table lists every body; search, domain filters and sorting work; choosing a planet's row flies into its
  // system and opens its card with focus.
  const cases = [];
  const rec = (name, ok, detail) => cases.push({ name, ok: !!ok, detail });
  const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('#index-body tbody tr')).filter((r) => !r.hidden).map((r) => r.dataset.id));
  for (const width of [1280, 390]) {
    const p = String(width);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:4187/?table-view=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__galaxy === 'function');
    await page.bringToFront();
    await page.locator('#home-link').focus();
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    let all = await rows();
    rec(p + '-every-body-is-a-row', all.length === 82 && all[0] === 'me' && all.indexOf('lf-agent') > all.indexOf('lightfield'), { n: all.length, first: all[0] });

    await page.locator('#index-search').fill('chronicle');
    await page.waitForTimeout(150);
    let found = await rows();
    rec(p + '-search-finds', found.length > 0 && found.length < 82 && found.indexOf('col-visa') >= 0 && found.indexOf('tomex') < 0, found);
    await page.locator('#index-search').fill('');

    await page.locator('#index-filters .filter[data-cluster="games"]').click();
    let games = await rows();
    const clusters = await page.evaluate((ids) => ids.map((id) => window.__galaxy().bodies.find((b) => b.id === id).cluster), games);
    rec(p + '-domain-filter', games.length === 11 && clusters.every((c) => c === 'games'), { n: games.length });
    await page.locator('#index-filters .filter[data-cluster="games"]').click();

    await page.locator('#index-body .sort[data-key="year"]').click();
    const sorted = await rows();
    const years = await page.evaluate((ids) => ids.slice(0, 5).map((id) => window.__galaxy().bodies.find((b) => b.id === id).year), sorted);
    rec(p + '-sort-by-when', years.every((y) => y === 2026), years);
    await page.locator('#index-map-order').click();

    await page.locator('#index-body tr[data-id="healthcarolina"] .c-year').click();
    await page.waitForTimeout(400);
    const rowPick = await page.evaluate(() => ({ active: window.__galaxy().active, focusInCard: document.querySelector('#card').contains(document.activeElement), x: window.__galaxy().camT.x }));
    await page.keyboard.press('ArrowRight');
    const rowAfter = await page.evaluate(() => window.__galaxy().camT.x);
    rec(p + '-row-click-keeps-arrow-pan', rowPick.active === 'healthcarolina' && !rowPick.focusInCard && rowAfter > rowPick.x, { ...rowPick, after: rowAfter });
    await page.keyboard.press('i');
    await page.waitForTimeout(300);

    await page.locator('#index-body a[href="#ee-mp"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => { const g = window.__galaxy(); return { active: g.active, s: g.where.s && g.where.s.id, index: document.querySelector('#index').dataset.on, focusInCard: document.querySelector('#card').contains(document.activeElement), title: document.querySelector('#card .card__title').textContent }; });
    rec(p + '-row-jumps-into-system', s.active === 'ee-mp' && s.s === 'ee' && s.index === 'false' && s.focusInCard && s.title === 'Multiplayer', s);
  }
  return { ok: cases.every((c) => c.ok), cases };
}
