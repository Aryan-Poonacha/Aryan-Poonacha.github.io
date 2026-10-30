async (page) => {
  const cases = [];
  for (const width of [1280, 390]) for (const motion of ['reduce', 'no-preference']) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto('http://127.0.0.1:4187/?card-reopen-focus=1', { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => typeof window.__galaxy === 'function');
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.bringToFront();
      await page.locator('#index-toggle').click();
      await page.waitForTimeout(450);
      await page.locator('#index-body a[href="#ee"]').click();
      await page.waitForTimeout(450);
      await page.bringToFront();
      await page.locator('#card .card__p').first().click();
      const before = await page.evaluate(() => window.__galaxy().camT.x);
      await page.keyboard.press('ArrowRight');
      const after = await page.evaluate(() => window.__galaxy().camT.x);
      cases.push({ name: width + '-' + motion + '-text-pan-cycle-' + cycle, ok: after > before, detail: { before, after } });
      await page.locator('#card .card__close').click();
      await page.waitForTimeout(450);
    }
  }
  return { ok: cases.every((x) => x.ok), cases };
}
