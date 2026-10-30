// Maintenance mode end to end: the owner switches it on from the till, a stranger meets the page everywhere,
// the owner opens again and the stranger's page finds its own way back.  npm start (in backend/), then:
//   node backend/tools/check-maintenance.mjs [screenshot-dir]   (it leaves maintenance OFF)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };

// the owner, at the till
const owner = await b.createBrowserContext(); const pg = await owner.newPage(); await pg.setViewport({ width: 1440, height: 1000 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.goto((process.env.BASE || 'http://localhost:4000') + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {}); await wait(400);
await pg.evaluate(() => { document.querySelectorAll('.modal-bg,.modal').forEach(m => m.remove()); window.eval("setTab='mx'"); window.eval('go')('settings') });
await pg.waitForFunction(() => /The site is open|Maintenance is ON/.test(document.getElementById('main').textContent), { timeout: 8000 }).catch(() => {});
ok(/The site is open/.test(await pg.$eval('#main', e => e.textContent)), 'Settings → Maintenance shows the site open');
await pg.screenshot({ path: OUT + '/tab-off.png' });
await pg.click('.mx-opt input[value="all"]').catch(() => pg.evaluate(() => { document.querySelector('.mx-opt input[value="all"]').checked = true }));
await pg.$eval('#mxMsg', e => { e.value = '' }); await pg.type('#mxMsg', 'Stock-taking today — back this evening.');
await pg.evaluate(() => { const d = new Date(Date.now() + 2 * 3600e3); document.getElementById('mxUntil').value = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) });
await pg.click('[data-act="mxOn"]');
await pg.waitForFunction(() => /Maintenance is ON/.test(document.getElementById('main').textContent), { timeout: 8000 }).catch(() => {});
ok(/Maintenance is ON/.test(await pg.$eval('#main', e => e.textContent)), 'switching it on from the till');
ok(!!(await pg.$('.mx-link code')), 'the preview link is shown');
await pg.screenshot({ path: OUT + '/tab-on.png' });

// the owner's browser still gets in
const r1 = await pg.goto((process.env.BASE || 'http://localhost:4000') + '/pos', { waitUntil: 'networkidle2' });
ok(r1.status() === 200, 'the owner still opens the till', r1.status());

// a stranger
const other = await b.createBrowserContext(); const sp = await other.newPage(); await sp.setViewport({ width: 1280, height: 860 });
for (const p of ['/', '/pos', '/shift', '/my']) { const r = await sp.goto((process.env.BASE || 'http://localhost:4000') + p, { waitUntil: 'networkidle2' }); ok(r.status() === 503 && !!(await sp.$('#gearBig')), `a stranger opening ${p} gets the page`, r.status()); }
const api = await sp.evaluate(async () => (await fetch('/api/books/regal/rev')).status);
ok(api === 503, 'and the till API answers 503 (an open till keeps its work)', api);
await wait(1500);
ok(/Stock-taking today/.test(await sp.$eval('#lead', e => e.textContent)), 'the message shows');
ok(!!(await sp.$('#cnt')), 'the countdown runs');
await sp.screenshot({ path: OUT + '/stranger-all.png' });

// open again: the stranger's page notices by itself
await pg.evaluate(() => { window.eval("setTab='mx'"); window.eval('go')('settings') });
await pg.waitForSelector('[data-act="mxOff"]', { timeout: 8000 }).catch(() => {});
await pg.click('[data-act="mxOff"]'); await wait(800);
ok(/The site is open/.test(await pg.$eval('#main', e => e.textContent)), 'Open again from the till');
// leave the switch as a new shop would have it: off, no message, the shutter
await pg.evaluate(() => window.eval('mxCall')('POST', { on: false, scope: 'site', msg: '', until: '', intro: 'reveal' })); await wait(500);
await sp.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await sp.waitForFunction(() => !document.getElementById('gearBig'), { timeout: 12000 }).catch(() => {});
ok(!(await sp.$('#gearBig')), 'the stranger\'s page reloads into the real page by itself', sp.url());
ok(!errs.length, 'no script errors at the till', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
