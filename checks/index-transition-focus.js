async (page) => {
  const cases = [];
  for (const width of [1280, 390]) for (const motion of ['reduce', 'no-preference']) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto('http://127.0.0.1:4187/?transition-focus=1', { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => typeof window.__galaxy === 'function');
    const press = async (key) => { await page.bringToFront(); await page.keyboard.press(key); };
    const inspect = () => page.evaluate(() => ({
      focusInIndex: document.querySelector('#index').contains(document.activeElement),
      focusInCard: document.querySelector('#card').contains(document.activeElement),
      index: document.querySelector('#index').dataset.on,
      card: document.querySelector('#card').dataset.on
    }));
    await page.locator('#index-toggle').focus();
    await press('Enter');
    await page.waitForTimeout(450);
    await press('Escape');
    await press('Tab');
    let state = await inspect();
    cases.push({ name: width + '-' + motion + '-index-rapid-tab', ok: state.index === 'false' && !state.focusInIndex, detail: state });

    await page.locator('#index-toggle').focus();
    await press('Enter');
    await page.locator('#index-body a[href="#ee"]').focus();
    await press('Enter');
    await page.waitForTimeout(450);
    await press('Escape');
    await press('Tab');
    state = await inspect();
    cases.push({ name: width + '-' + motion + '-card-rapid-tab', ok: state.card === 'false' && !state.focusInCard && !state.focusInIndex, detail: state });
  }
  return { ok: cases.every((x) => x.ok), cases };
}
