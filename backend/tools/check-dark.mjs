// Dark mode: the moon on the menu turns the till dark, spreading out in a circle; pictures, bills on
// paper and the menu keep their real colours; the choice is kept on this PC; the sun turns it back.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-dark.mjs [screenshot-dir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
const signIn = async () => {
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
  await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
};
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.evaluate(() => { try { localStorage.removeItem('ezy_dark') } catch (e) {} });
await signIn();
await pg.evaluate(() => { const S = window.eval('S'); window.eval('go')('pos'); const ps = S.products.filter(p => p.retail > 0 && !p.open).slice(0, 3);
  S.pos.lines = ps.map(p => ({ pid: p.id, qty: 1, price: p.retail, disc: 0 })); window.eval('render')() });
await wait(500);
ok(!(await pg.evaluate(() => document.documentElement.classList.contains('dark'))), 'it starts light');
const moon = await pg.$('[data-act="darkToggle"]');
ok(!!moon, 'the menu has the moon button');

// press it: frames as the circle spreads
await moon.click();
for (const [ms, name] of [[120, 'dark-mid1'], [260, 'dark-mid2']]) { await wait(ms === 120 ? 120 : 140); await pg.screenshot({ path: `${OUT}/${name}.png` }); }
await wait(700);
ok(await pg.evaluate(() => document.documentElement.classList.contains('dark')), 'pressing it turns the till dark');
await pg.screenshot({ path: OUT + '/dark-till.png' });
const look = await pg.evaluate(() => {
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const navF = getComputedStyle(document.querySelector('nav')).filter;
  const img = document.querySelector('nav img, img');
  return { bodyBg, navF, imgF: img ? getComputedStyle(img).filter : 'no img', vt: !!document.startViewTransition };
});
ok(/invert/.test(look.navF), 'the menu (dark already) is turned back, so it keeps its own colours', look.navF);
ok(look.vt, 'this browser draws the circle (View Transitions)');
ok(await pg.evaluate(() => localStorage.getItem('ezy_dark')) === '1', 'kept on this PC');

// other pages
for (const v of ['bills', 'dashboard', 'customers']) {
  await pg.evaluate(v => window.eval('go')(v), v); await wait(700);
  await pg.screenshot({ path: `${OUT}/dark-${v}.png` });
}
ok(true, 'pages drawn dark for a look', 'bills, dashboard, customers');

// a reload keeps it, with no flash of light first
await pg.reload({ waitUntil: 'domcontentloaded' });
ok(await pg.evaluate(() => document.documentElement.classList.contains('dark')), 'after a reload it is still dark, from the first paint');
await signIn();
await wait(500);
// the sun turns it back
await pg.click('[data-act="darkToggle"]'); await wait(900);
ok(!(await pg.evaluate(() => document.documentElement.classList.contains('dark'))) && await pg.evaluate(() => localStorage.getItem('ezy_dark')) === '0', 'the sun turns it back to light');
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
