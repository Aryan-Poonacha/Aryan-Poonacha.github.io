async (page) => {
  const cases = [];
  for (const width of [1280, 390]) for (const panel of ['index', 'card']) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('http://127.0.0.1:4187/?panel-double-click=1', { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => typeof window.__galaxy === 'function');
    await page.locator('#index-toggle').click();
    await page.waitForTimeout(450);
    if (panel === 'card') {
      await page.locator('#index-body a[href="#ee"]').click();
      await page.waitForFunction(() => document.querySelector('#card').dataset.on === 'true');
      await page.waitForTimeout(450);
    }
    const close = page.locator(panel === 'index' ? '#index-close' : '#card .card__close');
    const box = await close.boundingBox();
    const before = await page.evaluate(() => window.__galaxy().camT.z);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2, { delay: 100 });
    await page.waitForTimeout(450);
    const after = await page.evaluate(() => ({
      z: window.__galaxy().camT.z, hash: location.hash,
      card: document.querySelector('#card').dataset.on,
      index: document.querySelector('#index').dataset.on
    }));
    cases.push({ name: width + '-' + panel + '-double-close', ok: after.z === before && after.hash === '' && after.card === 'false' && after.index === 'false', detail: { before, ...after } });
  }
  return { ok: cases.every((x) => x.ok), cases };
}
