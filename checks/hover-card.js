async (page) => {
  // Hovering a star shows its card; a recording plays (still under reduced motion); the card stays while the
  // pointer moves onto it and its links; it leaves with the pointer. Stars without a recording get a live picture.
  const cases = [];
  const rec = (name, ok, detail) => cases.push({ name, ok: !!ok, detail });
  const peek = () => page.evaluate(() => {
    const el = document.querySelector('#peek'), v = el.querySelector('video');
    return { on: el.dataset.on, id: window.__galaxy().peek, title: el.querySelector('.peek__title') && el.querySelector('.peek__title').textContent,
      video: !!v, playing: !!v && !v.paused && v.currentTime > 0, poster: !!v && !!v.poster, canvas: !!el.querySelector('canvas.peek__orbits'), links: el.querySelectorAll('.peek__links a').length };
  });
  for (const motion of ['no-preference', 'reduce']) {
    const p = '1280-' + motion;
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto('http://127.0.0.1:4187/galaxy.html?cluster=games&hover-card=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__galaxy === 'function');
    await page.waitForTimeout(500);
    await page.locator('#b-ee .body__hit').hover();
    await page.waitForTimeout(1400);
    let s = await peek();
    rec(p + '-hover-shows-card', s.on === 'true' && s.id === 'ee' && s.title === 'Empire Earth in the browser' && s.links >= 2, s);
    rec(p + '-recording-' + (motion === 'reduce' ? 'stays-still' : 'plays'), s.video && s.poster && (motion === 'reduce' ? !s.playing : s.playing), s);

    const box = await page.locator('#peek').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20, { steps: 8 });
    await page.waitForTimeout(500);
    s = await peek();
    rec(p + '-card-stays-under-pointer', s.on === 'true' && s.id === 'ee', s);

    await page.mouse.move(40, 420, { steps: 6 });
    await page.waitForTimeout(700);
    s = await peek();
    rec(p + '-card-leaves-with-pointer', s.on === 'false', s);

    await page.locator('#b-firstgames .body__hit').hover();
    await page.waitForTimeout(600);
    s = await peek();
    rec(p + '-no-recording-gets-live-picture', s.on === 'true' && s.id === 'firstgames' && !s.video && s.canvas, s);
  }
  const doc = await (await page.request.get('http://127.0.0.1:4187/content/galaxy.json')).json();
  delete doc.domains.flatMap(d => d.stars).find(b => b.id === 'tomex').media.poster;
  await page.route('**/content/galaxy.json', r => r.fulfill({ json: doc }));
  await page.goto('http://127.0.0.1:4187/galaxy.html?intro=0#tomex');
  await page.locator('#card video').waitFor();
  rec('video-without-poster-does-not-fetch-undefined', await page.locator('#card video').getAttribute('poster') === null);
  return { ok: cases.every((c) => c.ok), cases };
}
