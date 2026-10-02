// Drive the cash-up page in a real browser and check the counting works end to end.
//   npm start            (in server/)  — then:
//   node tools/drive-cashup.mjs [out-dir]
//
// It runs against /demo, which is sealed off from the shop and needs no database, so this
// is safe to run at any time and never touches real books. Screenshots land in out-dir.
//
// The page is woven into the rest of the till (the day tabs, deStrip, deSteps), so lifting
// the grid into a stub DOM means stubbing half the app. This drives the real thing instead.
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
await pg.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1.2 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
// the till asks things with confirm()/prompt(); a native dialog blocks the driver dead
const asked = [];
pg.on('dialog', async d => { asked.push(d.type() + ': ' + d.message()); await d.accept() });

await pg.goto(BASE + '/demo', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
  await pg.waitForSelector('#lockPw');
  await pg.type('#lockPw', 'Afridh123');
  await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await new Promise(r => setTimeout(r, 1200));

// a day's trading, so the summary has something real in it
await pg.evaluate(() => {
  go('pos');
  for (const [pid, qty] of [[1, 10], [13, 4], [15, 6]]) {
    const lines = [{ pid, qty, price: P(pid).retail, disc: 0 }];
    completeSale({ lines, customerId: 1, billDisc: 0,
      pays: [{ method: 'CASH', amount: lines.reduce((a, l) => a + l.qty * l.price, 0) }] });
  }
  S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill };
  go('cashup');
});
await new Promise(r => setTimeout(r, 700));
const shot = async n => pg.screenshot({ path: `${OUT}/cash-${n}.png` });

/* ---- the opening float, keyed with nothing but the keyboard ---- */
await pg.evaluate(() => { dayTab = 'start'; render() });
await new Promise(r => setTimeout(r, 400));
const openBox = await pg.$('.cd-in[data-cash="open"][data-d="5000"]');
ok(!!openBox, 'the opening float has a grid to key into');
if (openBox) {
  await openBox.focus();
  for (const n of ['5', '15', '8', '10', '', '', '', '', '', '']) {
    if (n) await pg.keyboard.type(n);
    await pg.keyboard.press('Enter');
  }
  await new Promise(r => setTimeout(r, 300));
  ok(await pg.$eval('#ct-open', e => e.textContent.replace(/\s/g, '')) === '45,000.00',
     '5+15+8+10 keyed straight down comes to 45,000.00');
  ok(await pg.evaluate(() => (document.activeElement.dataset || {}).act === 'cashSave'),
     'and Enter on the last row lands on Save');
  await shot('1-open-keyed');
  await pg.evaluate(() => document.querySelector('[data-act="cashSave"][data-k="open"]').click());
  await new Promise(r => setTimeout(r, 600));
}

/* ---- the closing count, with the difference showing as it goes ---- */
await pg.evaluate(() => { dayTab = 'close'; render() });
await new Promise(r => setTimeout(r, 500));
const expected = await pg.evaluate(() => cashExpected(cashDay(), cashStore()).expected);
ok(expected > 0, `the books say ${expected} ought to be in the drawer`);

await pg.focus('.cd-in[data-cash="close"][data-d="5000"]');
await pg.keyboard.type('3');
await new Promise(r => setTimeout(r, 250));
ok(/still to find/.test(await pg.$eval('#cdDiff', e => e.textContent)), 'partway through, it says how much is still to find');
await shot('2-close-partway');

await pg.evaluate(exp => {                      // count it out exactly, largest notes first
  let left = Math.round(exp * 100) / 100;
  for (const d of [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1]) {
    const n = Math.floor(left / d + 1e-9);
    const el = document.querySelector(`.cd-in[data-cash="close"][data-d="${d}"]`);
    el.value = n ? String(n) : '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    left = +(left - n * d).toFixed(2);
  }
}, expected);
await new Promise(r => setTimeout(r, 300));
ok(/agrees/.test(await pg.$eval('#cdDiff', e => e.textContent)), 'counted exactly, it says it agrees');
await shot('3-close-agrees');

const pulled = await pg.evaluate(() => {        // take one note back out
  const el = [...document.querySelectorAll('.cd-in[data-cash="close"]')].find(x => (+x.value || 0) > 0);
  if (!el) return null;
  el.value = String((+el.value || 0) - 1);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return +el.dataset.d;
});
await new Promise(r => setTimeout(r, 250));
const diff = await pg.$eval('#cdDiff', e => e.textContent.replace(/\s+/g, ' ').trim());
ok(diff.includes(pulled.toLocaleString('en-US')), `one ${pulled} note short, and it says so: "${diff}"`);

await pg.evaluate(() => document.querySelector('[data-act="cashSave"][data-k="close"]').click());
await new Promise(r => setTimeout(r, 800));
const main = await pg.$eval('#main', e => e.textContent);
ok(/Ought to be in the drawer/.test(main), 'the summary says what ought to be there');
ok(/short/.test(main), 'and that the drawer is short');
ok(!/float[^.]{0,40}short/i.test(main), 'the morning float is never itself called short');
await shot('4-summary');

if (asked.length) console.log("  --   the till asked: " + asked.join(" | "));
ok(errs.length === 0, errs.length ? 'the page threw: ' + errs.join(' | ') : 'nothing threw along the way');
await b.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
