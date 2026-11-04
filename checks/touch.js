async (page) => {
  const cases = [], errors = [], context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const phone = await context.newPage(); phone.on('pageerror', e => errors.push(e.message));
  const rec = (name, ok, detail) => cases.push({ name, ok: !!ok, detail });
  try {
    const cdp = await context.newCDPSession(phone);
    const send = async (type, points) => { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 1, radiusY: 1, force: 1 })) }); await phone.waitForTimeout(40); };
    const state = () => phone.evaluate(() => ({ ...window.__galaxy().camT, active: window.__galaxy().active, pointers: window.__galaxy().pointers }));
    for (const lifted of [1, 2]) {
      await phone.goto('http://127.0.0.1:4187/galaxy.html?intro=0&still=1'); await phone.waitForFunction(() => !!window.__galaxy);
      await send('touchStart', [[1, 130, 400]]);
      await send('touchStart', [[1, 130, 400], [2, 260, 400]]);
      await send('touchMove', [[1, 110, 400], [2, 280, 400]]);
      await send('touchEnd', [[lifted, lifted === 1 ? 110 : 280, 400]]);
      const before = await state(), remaining = lifted === 1 ? [2, 281, 400] : [1, 111, 400];
      await send('touchMove', [remaining]);
      const after = await state(), expected = -1 / before.z, actual = after.x - before.x;
      rec('lift-finger-' + lifted + '-continues-with-one-pixel-pan', Math.abs(actual - expected) < 0.01, { actual, expected });
      await send('touchEnd', []);
      rec('lift-finger-' + lifted + '-release-does-not-open-card', (await state()).pointers === 0 && !(await state()).active);
    }
    rec('no-touch-page-errors', errors.length === 0, errors);
  } finally { await context.close(); }
  return { ok: cases.every(c => c.ok), cases };
}
