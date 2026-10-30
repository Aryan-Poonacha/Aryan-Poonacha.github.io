async (page) => {
  const cases = [];
  for (const width of [1280, 390]) for (const motion of ['reduce', 'no-preference']) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto('http://127.0.0.1:4187/?pointer-card-focus=1', { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => typeof window.__galaxy === 'function');
    await page.locator('#index-toggle').click();
    await page.waitForTimeout(450);
    await page.locator('#index-body a[href="#ee"]').click();
    await page.waitForTimeout(450);
    await page.bringToFront();
    const chip = page.locator('#card .chip').first();
    const target = await chip.getAttribute('href');
    await chip.click();
    await page.waitForTimeout(450);
    const before = await page.evaluate(() => window.__galaxy().camT.x);
    await page.bringToFront();
    await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(() => window.__galaxy().camT.x);
    const hash = await page.evaluate(() => location.hash);
    cases.push({ name: width + '-' + motion + '-pointer-linked-card-pan', ok: hash === target && after > before, detail: { target, hash, before, after } });
  }
  return { ok: cases.every((x) => x.ok), cases };
}
