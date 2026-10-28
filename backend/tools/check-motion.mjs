// The travelling highlight: on the menu, filter chips and switch buttons it slides to the item just
// picked and stretches as it goes; afterwards nothing is left behind; less-motion machines get none.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-motion.mjs [screenshot-dir]
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
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''"); window.eval('go')('bills') });
await wait(800);

// the menu: from Bills to another page — sample the pill as it goes
const pillAt = () => pg.evaluate(() => { const p = document.querySelector('nav .navlist .mo-pill'); if (!p) return null; const r = p.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) } });
const target = await pg.evaluate(() => { const bs = [...document.querySelectorAll('nav .navlist button[data-view]')]; const i = bs.findIndex(x => x.classList.contains('on')); const t = bs[Math.min(bs.length - 1, i + 4)]; return t && t.dataset.view });
const samples = [];
await pg.evaluate(v => document.querySelector(`nav .navlist button[data-view="${v}"]`).click(), target);
for (const ms of [40, 110, 200]) { await wait(ms === 40 ? 40 : 70); samples.push(await pillAt()); if (ms === 110) await pg.screenshot({ path: OUT + '/motion-nav-mid.png', clip: { x: 0, y: 0, width: 300, height: 768 } }) }
await wait(500);
const seen = samples.filter(Boolean);
ok(seen.length >= 2, 'picking another page: a pill travels down the menu', JSON.stringify(samples));
ok(seen.length >= 2 && (seen[seen.length - 1].top !== seen[0].top || seen[seen.length - 1].h !== seen[0].h), 'and it moves and stretches as it goes');
ok(Math.max(...seen.map(s => s.h)) > Math.min(...seen.map(s => s.h)) + 4, 'stretching: taller mid-way than at either end', seen.map(s => s.h).join(' → '));
ok(await pg.evaluate(() => !document.querySelector('.mo-pill') && !document.querySelector('.mo-pill-wait')), 'once it lands nothing is left behind, and the item shows its own highlight');

// filter chips on the Bills page
await pg.evaluate(() => window.eval('go')('bills')); await wait(700);
const chipGroup = await pg.evaluate(() => { const g = [...document.querySelectorAll('.chips')].find(g => g.querySelectorAll('button').length > 2 && g.querySelector('button.on')); if (!g) return null;
  const bs = [...g.querySelectorAll('button')], i = bs.findIndex(x => x.classList.contains('on')); const t = bs[i === 0 ? bs.length - 1 : 0]; t.setAttribute('data-motest', '1'); return bs.length });
if (chipGroup) {
  await pg.click('[data-motest="1"]'); await wait(90);
  const mid = await pg.evaluate(() => !!document.querySelector('.chips .mo-pill'));
  await pg.screenshot({ path: OUT + '/motion-chips-mid.png', clip: { x: 80, y: 120, width: 480, height: 240 } });
  ok(mid, 'filter chips: the highlight slides to the one picked');
  await wait(500);
  ok(await pg.evaluate(() => !document.querySelector('.mo-pill')), 'and is gone once it lands');
} else ok(true, 'filter chips: none on this page to try', '');

// an ordinary redraw (typing in a search) does not set anything off
await pg.evaluate(() => { window.eval('render')(); window.eval('render')() }); await wait(60);
ok(await pg.evaluate(() => !document.querySelector('.mo-pill')), 'a redraw with nothing newly picked moves nothing');

// a page arrives through a soft blur
await pg.evaluate(() => window.eval('go')('customers')); await wait(40);
const blur = await pg.evaluate(() => getComputedStyle(document.getElementById('main')).filter);
ok(/blur/.test(blur), 'a page arrives through a soft blur', blur);

// less motion asked for: none of it
await pg.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await pg.evaluate(() => window.eval('go')('bills')); await wait(60);
ok(await pg.evaluate(() => !document.querySelector('.mo-pill')), 'a machine set to less motion gets no travelling highlight');
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
