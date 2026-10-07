// Designing the large bill: does ticking a part take it off the sheet, and does the order hold?
//   npm start            (in server/)  — then:
//   node tools/drive-a5design.mjs [out-dir]
//
// The receipt could already be arranged part by part; the A5 could not. What matters is that
// the switches really change the paper — a designer whose preview lies is worse than none —
// and that the A5's parts move only within their own part of the sheet, because the head row
// and the footer are side-by-side boxes, not one column.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!exe) { console.error('No Chrome or Edge to drive.'); process.exit(1) }

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) };

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1500, height: 980, deviceScaleFactor: 1.1 });
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

const sheet = () => pg.evaluate(() => billHtml(billSample(), 'a5'));
const sheetHas = async (cls) => (await sheet()).includes(cls);

/* ---------- 1. every part is there to begin with ---------- */
await pg.evaluate(() => { delete CFG.bill.a5; a5Cfg(); CFG.bill.showQr = true; CFG.bill.showWords = true; a5Set('qr', true); a5Set('words', true) });
for (const [cls, what] of [['sb-brand', 'the shop at the top'], ['sb-qrs', 'the QR squares'],
                           ['sb-meta', 'the invoice and customer boxes'], ['sb-addrline', 'the address line'],
                           ['sb-tbl', 'the table of what was sold'], ['sb-words', 'the amount in words'],
                           ['sb-signs', 'the signature lines'], ['sb-sum', 'the totals box']])
  ok(await sheetHas(cls), `${what} is on the sheet`);

/* ---------- 2. ticking one off takes it off the paper ---------- */
for (const [k, cls, what] of [['qr', 'sb-qrs', 'the QR squares'], ['words', 'sb-words', 'the amount in words'],
                              ['signs', 'sb-signs', 'the signature lines'], ['addr', 'sb-addrline', 'the address line'],
                              ['brand', 'sb-brand', 'the shop at the top'], ['meta', 'sb-meta', 'the invoice boxes']]) {
  await pg.evaluate(k => a5Set(k, false), k);
  ok(!(await sheetHas(cls)), `turning off ${what} takes it off the paper`);
  await pg.evaluate(k => a5Set(k, true), k);
  ok(await sheetHas(cls), `and turning it back on puts it back`);
}

/* ---------- 3. the two that cannot go ---------- */
await pg.evaluate(() => { a5Set('items', false); a5Set('summary', false) });
ok(await sheetHas('sb-tbl'), 'what was sold cannot be taken off — a bill without its lines is not a bill');
ok(await sheetHas('sb-sum'), 'and neither can the totals box');

/* ---------- 4. order, within a part of the sheet ---------- */
await pg.evaluate(() => { delete CFG.bill.a5; a5Cfg() });
let head = await pg.evaluate(() => a5Order().filter(k => A5_REGION[k] === 'head'));
ok(head.join() === 'brand,qr,meta', `the head row starts as ${head.join(' · ')}`);
await pg.evaluate(() => a5Move('meta', -1));
head = await pg.evaluate(() => a5Order().filter(k => A5_REGION[k] === 'head'));
ok(head.join() === 'brand,meta,qr', 'moving the invoice boxes up puts them before the QR squares');
ok((await sheet()).indexOf('sb-meta') < (await sheet()).indexOf('sb-qrs'), 'and the paper agrees');

/* a part cannot climb out of its own region */
const before = await pg.evaluate(() => a5Order().join());
await pg.evaluate(() => { a5Move('brand', -1); a5Move('addr', -1); a5Move('summary', -1) });
ok(await pg.evaluate(() => a5Order().join()) === before,
   'the first in a region, and the totals box, do not move — the sheet cannot be broken that way');

/* ---------- 5. the designer itself ---------- */
await pg.evaluate(() => { bdWhich = 'a5'; go('billdesign'); render() });
await new Promise(r => setTimeout(r, 900));
const txt = await pg.$eval('#main', e => e.textContent.replace(/\s+/g, ' '));
ok(/the large bill, as it comes off the A5 sheet/.test(txt), 'the page says which bill is being designed');
ok(/Across the top/.test(txt) && /Down the middle/.test(txt) && /The bottom left/.test(txt),
   'the parts are grouped by where they sit on the sheet');
ok(/Columns in the table/.test(txt), 'the table columns can be chosen');
ok(await pg.evaluate(() => document.querySelectorAll('[data-a5on]').length >= 8), 'with a tick for each part');
ok(await pg.evaluate(() => !!document.querySelector('.bd-sheet .sb-tbl')), 'and the sheet itself is on the page to look at');

/* the whole sheet is visible — an A5 is wider than its half of the screen, and a preview
   whose right-hand side is cut off cannot be judged */
const fit = await pg.evaluate(() => {
  // measured against the SCREEN, not against the grey box — the box can itself run off the
  // side of a phone, and body{overflow-x:hidden} then hides that it has
  const bill = document.querySelector('.bd-sheet .bd-bill');
  const far = Math.max(...[...bill.querySelectorAll('.sb-meta, .sb-qrs, .sb-sum, .sb-tbl')]
    .map(e => e.getBoundingClientRect().right));
  return { over: Math.round(far - innerWidth), scroll: Math.round(far - document.querySelector('.bd-sheet').getBoundingClientRect().right) };
});
ok(fit.over <= 2, `the right-hand side of the sheet is on the screen (overhang ${fit.over}px)`);
ok(fit.scroll <= 2, `and inside its own grey box too (${fit.scroll}px)`);

/* a tick in the page really changes the paper */
await pg.evaluate(() => {
  const el = document.querySelector('[data-a5on="words"]');
  el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 700));
ok(await pg.evaluate(() => !a5On('words')), 'unticking the amount in words on the page turns it off');
ok(await pg.evaluate(() => !document.querySelector('.bd-sheet .sb-words')), 'and it leaves the sheet on the page at once');

/* the tabs go both ways */
await pg.evaluate(() => { const t = document.querySelector('[data-act="bdWhich"][data-w="r80"]'); t.click() });
await new Promise(r => setTimeout(r, 800));
ok(await pg.evaluate(() => /as the printer will burn it/.test(document.getElementById('main').textContent)),
   'and the receipt is still one tab away, as it was');

await pg.evaluate(() => { bdWhich = 'a5'; render() });
await new Promise(r => setTimeout(r, 800));
await pg.screenshot({ path: (process.argv[2] || '.') + '/a5-designer.png' });

ok(errs.length === 0, errs.length ? 'the page threw: ' + errs.join(' | ') : 'nothing threw along the way');
await b.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
