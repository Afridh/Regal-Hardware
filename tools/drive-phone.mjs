// Make a bill on a phone, the way a person would: search, tap, change a quantity, pay.
//   npm start            (in server/)  — then:
//   node tools/drive-phone.mjs [out-dir]
//
// Runs against /demo in a real phone-sized browser with touch, so it catches the things
// only a phone shows: panels landing on top of each other, a total scrolled off the
// screen, a button too small for a thumb, the page sliding sideways.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!exe) { console.error('No Chrome or Edge to drive.'); process.exit(1) }

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) };

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await pg.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', async d => { await d.accept() });

await pg.goto(BASE + '/demo', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await new Promise(r => setTimeout(r, 1200));

/* the saved choice is the desktop one; the phone till should win anyway */
await pg.evaluate(() => { setPref('till', 'classic'); go('pos'); render() });
await new Promise(r => setTimeout(r, 700));
ok(await pg.$('.ph') !== null, 'a phone gets the phone till even though "classic" is the saved choice');
ok(await pg.evaluate(() => tillNow()) === 'phone', 'and the till knows which one it is');

const shot = n => pg.screenshot({ path: `${OUT}/ph-${n}.png` });
const noSideways = async where => ok(
  await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  `the page does not slide sideways ${where}`);
await noSideways('on an empty bill');
await shot('1-empty');

/* ---- find something and put it on ---- */
await pg.focus('#phQ');
await pg.keyboard.type('cement');
await new Promise(r => setTimeout(r, 450));
const hits = await pg.$$('.ph-hit');
ok(hits.length >= 2, `typing "cement" offers ${hits.length} things`);
ok(await pg.evaluate(() => { const r = document.querySelector('.ph-hit').getBoundingClientRect(); return r.height >= 44 }),
   'each one is big enough to hit with a thumb');
await shot('2-searching');

await hits[0].click();
await new Promise(r => setTimeout(r, 450));
ok(await pg.evaluate(() => S.pos.lines.length) === 1, 'tapping one puts it on the bill');
ok(await pg.evaluate(() => (document.getElementById('phQ') || {}).value) === '', 'and clears the search, ready for the next');

/* ---- scanning the same thing again should count it, not list it twice ---- */
const onIt = await pg.evaluate(() => S.pos.lines[0].pid);
const sameCode = await pg.evaluate(id => String(P(id).num || P(id).code), onIt);
await pg.focus('#phQ');
await pg.keyboard.type(sameCode);
await new Promise(r => setTimeout(r, 400));
await pg.keyboard.press('Enter');
await new Promise(r => setTimeout(r, 450));
ok(await pg.evaluate(() => S.pos.lines.length) === 1, 'scanning the same item again does not put it on twice');
ok(await pg.evaluate(() => S.pos.lines[0].qty) === 2, 'it counts two of them instead');

/* ---- and a different code makes a second line ---- */
const other = await pg.evaluate(on => {
  const p = S.products.find(x => x.id !== on && x.active !== false && (x.num || x.code) && !/cement/i.test(x.name));
  return String(p.num || p.code);
}, onIt);
await pg.focus('#phQ');
await pg.keyboard.type(other);
await new Promise(r => setTimeout(r, 400));
await pg.keyboard.press('Enter');
await new Promise(r => setTimeout(r, 450));
ok(await pg.evaluate(() => S.pos.lines.length) === 2, 'keying a code and pressing Enter adds it — which is what a scanner does');

/* ---- change a quantity with the buttons ---- */
const qty = () => pg.evaluate(() => S.pos.lines[0].qty);
const tapQty = async which => {        // the search list can be open above the lines, so aim by hand
  await pg.evaluate(w => document.querySelector(`.ph-line .qty button[data-act="${w}"]`).click(), which);
  await new Promise(r => setTimeout(r, 300));
};
const before = await qty();
await tapQty('phMore'); await tapQty('phMore');
ok(await qty() === before + 2, `the plus button takes the first line from ${before} to ${before + 2}`);
await tapQty('phLess');
ok(await qty() === before + 1, `and the minus brings it back to ${before + 1}`);
await pg.evaluate(() => { PH.q = ''; render() });
await new Promise(r => setTimeout(r, 300));

/* ---- the total, and the button, where a thumb is ---- */
const bar = await pg.evaluate(() => {
  const el = document.querySelector('.ph-bar'); if (!el) return null;
  const r = el.getBoundingClientRect(), go = el.querySelector('.go').getBoundingClientRect();
  return { onScreen: r.bottom <= window.innerHeight + 2 && r.top < window.innerHeight,
           goH: go.height, text: el.textContent.replace(/\s+/g, ' ').trim() };
});
ok(bar && bar.onScreen, 'the total and the pay button stay on the screen');
ok(bar && bar.goH >= 48, `the pay button is ${Math.round(bar.goH)}px tall — a thumb can hit it`);
const shown = await pg.evaluate(() => money2(billTotal()));
ok(bar && bar.text.includes(shown), `and the total on it is the real total (${shown})`);
await noSideways('with a bill on it');
await shot('3-bill');

/* ---- a long bill still keeps the bar in place ---- */
await pg.evaluate(() => { for (let i = 3; i <= 12; i++) addLine(i); render() });
await new Promise(r => setTimeout(r, 600));
await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await new Promise(r => setTimeout(r, 300));
ok(await pg.evaluate(() => {
  const r = document.querySelector('.ph-bar').getBoundingClientRect();
  return r.bottom <= window.innerHeight + 2 && r.height > 0;
}), 'a long bill scrolls under the bar rather than pushing it away');
await noSideways('with a long bill');
await shot('4-long');

/* ---- and the payment window has to work at this width too ---- */
await pg.evaluate(() => document.querySelector('.ph-bar .go').click());
await new Promise(r => setTimeout(r, 800));
const pay = await pg.evaluate(() => {
  const m = document.querySelector('.modal'); if (!m) return null;
  const r = m.getBoundingClientRect();
  return { w: r.width, win: window.innerWidth, fits: r.width <= window.innerWidth + 1, text: m.textContent.slice(0, 60) };
});
ok(pay, 'the pay button opens the payment window');
ok(pay && pay.fits, pay ? `the payment window fits the screen (${Math.round(pay.w)} of ${pay.win}px)` : 'no payment window');
await shot('5-pay');

ok(errs.length === 0, errs.length ? 'the page threw: ' + errs.join(' | ') : 'nothing threw along the way');
await b.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
