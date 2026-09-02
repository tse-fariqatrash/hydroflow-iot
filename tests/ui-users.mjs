import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:4324';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errs = [];

async function session(user, pw) {
  const page = await b.newPage({ viewport: { width: 1500, height: 1050 } });
  page.on('console', m => { if (m.type() === 'error') errs.push(`[${user}] ${m.text()}`); });
  page.on('pageerror', e => errs.push(`[${user}] PAGEERROR ${e.message}`));
  await page.goto(BASE);
  await page.waitForSelector('.login-card');
  await page.fill('#u', user); await page.fill('#p', pw);
  await page.click('button[type=submit]');
  await page.waitForSelector('#app', { timeout: 20000 });
  await page.waitForTimeout(3500);
  return page;
}

// ── admin ──
const admin = await session('admin', 'hydroflow2026');
const navAdmin = await admin.$$eval('.nav-item', els => els.map(e => e.textContent.trim()));
console.log('admin nav      :', navAdmin.join(' | '));

await admin.evaluate(() => location.hash = '#users'); await admin.waitForTimeout(2500);
await admin.screenshot({ path: '/tmp/shots/users-admin.png', fullPage: true });
console.log('users rows     :', await admin.$$eval('table.data tbody tr', r => r.length));

// open the Add user modal and screenshot it
await admin.click('button:has-text("Add user")'); await admin.waitForTimeout(700);
await admin.screenshot({ path: '/tmp/shots/users-modal.png' });
console.log('modal fields   :', await admin.$$eval('.modal .field label', l => l.map(x => x.textContent.replace('*','').trim()).join(', ')));
await admin.keyboard.press('Escape'); await admin.waitForTimeout(400);

await admin.evaluate(() => location.hash = '#account'); await admin.waitForTimeout(2000);
await admin.screenshot({ path: '/tmp/shots/account.png', fullPage: true });

// ── operator: must NOT see or reach Users ──
const op = await session('operator', 'hydroflow2026');
const navOp = await op.$$eval('.nav-item', els => els.map(e => e.textContent.trim()));
console.log('operator nav   :', navOp.join(' | '));
console.log('users hidden   :', !navOp.some(t => t.includes('Users')) ? 'yes' : 'NO — LEAKED');

await op.evaluate(() => location.hash = '#users'); await op.waitForTimeout(2000);
const blocked = await op.evaluate(() => document.body.innerText.includes('requires the "admin" permission'));
console.log('direct nav gated:', blocked ? 'yes' : 'NO — LEAKED');
await op.screenshot({ path: '/tmp/shots/users-blocked.png', fullPage: true });

await op.evaluate(() => location.hash = '#account'); await op.waitForTimeout(2000);
await op.screenshot({ path: '/tmp/shots/account-operator.png', fullPage: true });

await b.close();
console.log('\nconsole errors :', errs.length ? errs.join('\n  ') : 'none');
