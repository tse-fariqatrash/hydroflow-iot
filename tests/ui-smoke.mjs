import { chromium } from 'playwright';
const PAGES = ['overview','mimic','water','ems','bms','trends','alarms','reports','devices','tags','about'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(`[console] ${m.text()}`); });
page.on('pageerror', e => errs.push(`[pageerror] ${e.message}\n${(e.stack||'').split('\n').slice(0,4).join('\n')}`));
page.on('requestfailed', r => errs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.waitForSelector('.login-card', { timeout: 15000 });
await page.click('button[type=submit]');
await page.waitForSelector('#app', { timeout: 20000 });
await page.waitForTimeout(4000);

for (const p of PAGES) {
  errs.push(`--- PAGE ${p} ---`);
  await page.evaluate(r => { location.hash = '#' + r; }, p);
  await page.waitForTimeout(3200);
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.screenshot({ path: `/tmp/shots/${p}.png`, fullPage: true });
  const empties = await page.$$eval('.empty', els => els.map(e => e.textContent.trim().slice(0,60)));
  const nan = await page.evaluate(() => (document.body.innerText.match(/NaN|undefined|Infinity/g)||[]).length);
  console.log(`${p.padEnd(10)} h=${String(h).padStart(5)} empties=${JSON.stringify(empties)} badTokens=${nan}`);
}
// light theme spot-check on two representative pages
await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; localStorage.setItem('hydroflow.theme','light'); });
for (const p of ['overview','water']) {
  await page.evaluate(r => { location.hash = '#' + r; }, p);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/shots/light-${p}.png`, fullPage: true });
}
// mobile viewport check
await page.setViewportSize({ width: 420, height: 900 });
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; location.hash = '#overview'; });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/shots/mobile-overview.png', fullPage: true });
await browser.close();
console.log('\n=== ERRORS ===');
const real = errs.filter(e => !e.startsWith('--- PAGE'));
if (!real.length) console.log('none'); else {
  let ctxp = '';
  for (const e of errs) { if (e.startsWith('--- PAGE')) ctxp = e; else console.log(ctxp, '\n ', e); }
}
