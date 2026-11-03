async (page) => {
  // Galaxy → cluster → star system → planet, and back out with Escape, at desktop and phone widths.
  const cases = [];
  const rec = (name, ok, detail) => cases.push({ name, ok: !!ok, detail });
  const state = () => page.evaluate(() => {
    const g = window.__galaxy(), w = g.where;
    const shown = (sel) => Array.from(document.querySelectorAll(sel)).filter((a) => getComputedStyle(a).visibility !== 'hidden').length;
    return {
      level: w.p ? 'planet' : w.s ? 'system' : w.c ? 'cluster' : 'galaxy', c: w.c && w.c.id, s: w.s && w.s.id, active: g.active,
      card: document.querySelector('#card').dataset.on, title: document.querySelector('#card .card__title') && document.querySelector('#card .card__title').textContent,
      heading: document.querySelector('#heading').dataset.on, headingSeen: getComputedStyle(document.querySelector('#heading')).opacity !== '0', crumbs: document.querySelector('#crumbs').textContent,
      bodies: g.bodies.length, links: document.querySelectorAll('#world a.body').length, clusters: document.querySelectorAll('#world .cl').length,
      cbPlanets: shown('#world a.body--planet[data-id^="cb-"], #world a.body--planet[data-id="i-novel"]'), hash: location.hash
    };
  });
  for (const width of [1280, 390]) {
    const p = String(width);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:4187/?galaxy-levels=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__galaxy === 'function');
    await page.waitForTimeout(400);
    let s = await state();
    rec(p + '-enters-on-the-galaxy', s.level === 'galaxy' && !s.headingSeen && s.bodies === 82 && s.links === s.bodies && s.clusters === 6 && s.cbPlanets === 0, s);

    await page.locator('#world .cl[data-cluster="writing"]').click();
    await page.waitForTimeout(400);
    s = await state();
    rec(p + '-cluster-name-zooms-to-cluster', s.level === 'cluster' && s.c === 'writing' && s.heading === 'true' && s.headingSeen && /Writing/.test(s.crumbs), s);

    await page.locator('#b-curebereft .body__hit').click();
    await page.waitForTimeout(500);
    s = await state();
    rec(p + '-star-opens-its-system', s.active === 'curebereft' && !s.headingSeen && s.s === 'curebereft' && s.card === 'true' && s.title === 'Cure Bereft' && s.hash === '#curebereft', s);
    rec(p + '-system-planets-are-links', s.cbPlanets === 5 && await page.locator('#card .chip--planet').count() === 5, s);

    await page.locator('#card a.chip--planet[href="#cb-press"]').click();
    await page.waitForTimeout(500);
    s = await state();
    rec(p + '-planet-opens-in-its-system', s.active === 'cb-press' && s.s === 'curebereft' && s.title === '“A thrilling debut”' && s.hash === '#cb-press', s);

    await page.locator('#card a.crumb[href="#curebereft"]').click();
    await page.waitForTimeout(400);
    const crumbPan = await page.evaluate(() => ({ active: window.__galaxy().active, focusInCard: document.querySelector('#card').contains(document.activeElement), x: window.__galaxy().camT.x }));
    await page.keyboard.press('ArrowRight');
    const crumbAfter = await page.evaluate(() => window.__galaxy().camT.x);
    rec(p + '-parent-link-keeps-arrow-pan', crumbPan.active === 'curebereft' && !crumbPan.focusInCard && crumbAfter > crumbPan.x, { ...crumbPan, after: crumbAfter });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    s = await state();
    rec(p + '-escape-closes-the-card', s.card === 'false' && s.hash === '' && s.level === 'system', s);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    s = await state();
    rec(p + '-escape-zooms-out-to-cluster', s.level === 'cluster' && s.c === 'writing', s);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    s = await state();
    rec(p + '-escape-zooms-out-to-galaxy', s.level === 'galaxy' && !s.headingSeen, s);

    await page.goto('http://127.0.0.1:4187/?galaxy-levels=2#lf-agent', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__galaxy === 'function');
    await page.waitForTimeout(400);
    s = await state();
    rec(p + '-planet-deep-link', s.active === 'lf-agent' && s.s === 'lightfield' && s.card === 'true', s);
  }
  /* a short phone: the card leaves little map, and the system's planets must still be there */
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto('http://127.0.0.1:4187/?galaxy-levels=3#curebereft', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__galaxy === 'function');
  await page.waitForTimeout(500);
  const short = await state();
  rec('390x667-system-planets-are-links', short.active === 'curebereft' && short.cbPlanets === 5, short);
  return { ok: cases.every((c) => c.ok), cases };
}
