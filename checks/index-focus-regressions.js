async (page) => {
  const results = [];
  const record = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
  const press = async (key) => { await page.bringToFront(); await page.keyboard.press(key); };
  const click = async (selector) => { await page.bringToFront(); await page.locator(selector).click(); };
  const activate = async (selector) => {
    await page.locator(selector).focus();
    await press('Enter');
    await page.waitForTimeout(450);
  };
  const focus = () => page.evaluate(() => ({
    tag: document.activeElement.tagName,
    id: document.activeElement.id,
    card: document.querySelector('#card').contains(document.activeElement),
    hash: location.hash,
    index: document.querySelector('#index').dataset.on,
    cardOn: document.querySelector('#card').dataset.on
  }));
  for (const width of [1280, 390]) for (const motion of ['reduce', 'no-preference']) {
    const prefix = width + '-' + motion;
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: motion });
    const reset = async () => {
      await page.goto('http://127.0.0.1:4187/?focus-regression=1', { waitUntil: 'domcontentloaded' });
      await page.bringToFront();
      await page.waitForFunction(() => typeof window.__galaxy === 'function');
      if (!await page.evaluate(() => document.hasFocus())) throw new Error('Browser input is not focused');
    };
    const choose = async (id) => {
      await activate('#index-toggle');
      await activate('#index-body a[href="#' + id + '"]');
    };

    await reset();
    await choose('ee');
    await choose('curebereft');
    await press('i');
    await page.waitForTimeout(450);
    await page.goBack();
    await page.waitForTimeout(450);
    let state = await focus();
    record(prefix + '-back-with-card-opener', state.hash === '#ee' && state.index === 'false' && state.card, state);
    await page.goForward();
    await page.waitForTimeout(450);
    state = await focus();
    record(prefix + '-forward-keeps-card-focus', state.hash === '#curebereft' && state.card, state);

    await activate('#index-toggle');
    await page.goBack();
    await page.waitForTimeout(450);
    state = await focus();
    record(prefix + '-back-with-hud-opener', state.hash === '#ee' && state.index === 'false' && state.card, state);

    const linked = page.locator('#card .chip').first();
    const nextHash = await linked.getAttribute('href');
    await linked.focus();
    await press('Enter');
    await page.waitForTimeout(450);
    state = await focus();
    record(prefix + '-linked-card-keeps-focus', state.hash === nextHash && state.card, state);

    await activate('#card .card__close');
    state = await focus();
    record(prefix + '-close-returns-to-index-toggle', state.cardOn === 'false' && state.id === 'index-toggle', state);
    await choose('ee');
    await press('Escape');
    await page.waitForTimeout(450);
    state = await focus();
    record(prefix + '-escape-returns-to-index-toggle', state.cardOn === 'false' && state.id === 'index-toggle', state);

    await reset();
    await click('#index-toggle');
    await page.waitForTimeout(450);
    await click('#index-body a[href="#ee"]');
    await page.waitForTimeout(450);
    const before = await page.evaluate(() => window.__galaxy().camT.x);
    await press('ArrowRight');
    const after = await page.evaluate(() => window.__galaxy().camT.x);
    state = await focus();
    record(prefix + '-pointer-selection-keeps-arrow-pan', state.hash === '#ee' && !state.card && after > before, { ...state, before, after });
  }
  return { ok: results.every((r) => r.ok), cases: results };
}
