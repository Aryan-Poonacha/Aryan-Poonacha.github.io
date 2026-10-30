async (page) => {
 const result={browser:page.context().browser()?.version(),cases:[],ok:true};
 const record=(name,ok,detail)=>{result.cases.push({name,ok:!!ok,detail});if(!ok)result.ok=false;};
 const activate=async(selector)=>{await page.locator(selector).focus();await page.keyboard.press('Enter');};
 const inspect=()=>page.evaluate(()=>({focusId:document.activeElement.id,tag:document.activeElement.tagName,indexOn:document.querySelector('#index').dataset.on,focusInIndex:document.querySelector('#index').contains(document.activeElement),cardOn:document.querySelector('#card').dataset.on,focusInCard:document.querySelector('#card').contains(document.activeElement),hash:location.hash}));
 for(const width of [1280,390]) for(const motion of ['reduce','no-preference']) {
  const prefix=width+'-'+motion;await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:motion});
  await page.goto('http://127.0.0.1:4187/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.__galaxy==='function');await page.bringToFront();if(!await page.evaluate(()=>document.hasFocus()))throw new Error('Native browser input is not focused');
  await page.locator('#index-toggle').focus();await page.keyboard.press('Enter');await page.waitForTimeout(350);
  let s=await inspect();record(prefix+'-keyboard-open',s.indexOn==='true'&&s.focusInIndex,s);
  await page.keyboard.press('Escape');await page.waitForTimeout(350);s=await inspect();record(prefix+'-escape-restores-opener',s.indexOn==='false'&&s.focusId==='index-toggle',s);
  await page.locator('#home-link').focus();await page.keyboard.press('i');await page.waitForTimeout(350);s=await inspect();record(prefix+'-shortcut-open',s.indexOn==='true'&&s.focusInIndex,s);
  await page.keyboard.press('Escape');await page.waitForTimeout(350);s=await inspect();record(prefix+'-shortcut-restores-opener',s.indexOn==='false'&&s.focusId==='home-link',s);
  await activate('#index-toggle');await page.waitForTimeout(350);
  const focusable=page.locator('#index button:not([disabled]),#index a[href]');await focusable.last().focus();await page.keyboard.press('Tab');s=await inspect();record(prefix+'-tab-wrap-stays-dialog',s.indexOn==='true'&&s.focusInIndex,s);
  await focusable.first().focus();await page.keyboard.press('Shift+Tab');s=await inspect();record(prefix+'-reverse-tab-wrap-stays-dialog',s.indexOn==='true'&&s.focusInIndex,s);
  await activate('#index-close');await page.waitForTimeout(350);s=await inspect();record(prefix+'-close-restores-opener',s.indexOn==='false'&&s.focusId==='index-toggle',s);
  await activate('#index-toggle');await page.waitForTimeout(350);const choice=page.locator('#index-body a[href="#ee"]');await choice.focus();await page.keyboard.press('Enter');await page.waitForTimeout(350);s=await inspect();record(prefix+'-selection-focuses-visible-card',s.indexOn==='false'&&s.cardOn==='true'&&s.focusInCard&&s.hash==='#ee',s);
  record(prefix+'-selection-content',await page.evaluate(()=>document.querySelector('#card .card__title')?.textContent)==='Empire Earth in the browser');
  if(await page.locator('#card .card__close').count())await activate('#card .card__close');await page.waitForTimeout(350);s=await inspect();record(prefix+'-keyboard-card-close',s.cardOn==='false'&&s.hash==='',s);
 }
 return result;
}