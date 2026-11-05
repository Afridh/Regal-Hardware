// A long large bill on real pages (5 Nov 2026), checked on PDF, never on paper.
//  · every design: a 45-line bill makes several sheets, each row once and in order, each sheet no taller than the page,
//    the column heads on every sheet, the totals only on the last, "Page 1 of n" on each
//  · the PDF has as many pages as there are sheets, with real text in it
//  · a bill that fits one page is untouched; as pictures (the helper's way, 733 wide) it is paged the same way
//  · a program that does not call it still has the whole bill in one sheet (as before: nothing lost)
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-a5pages.mjs          (OUT=<folder> keeps the PDF)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010', OUT = process.env.OUT || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 90000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
const doc = (n, style) => pg.evaluate((n, style) => { const S = window.eval('S'), C = window.eval('CFG'), keep = C.bill.a5Style; C.bill.a5Style = style;
  const ps = S.products.filter(p => p.active !== false), lines = Array.from({ length: n }, (_, i) => ({ pid: ps[i % ps.length].id, qty: 1 + i % 3, price: 100 + i, disc: 0, name: 'LINE-' + (i + 1) + ' ' + ps[i % ps.length].name, warranty: i % 9 === 0 ? '1 YEAR' : '' }));
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const inv = { no: 'PG-TEST', date: '2026-11-05', time: '10:00:00 am', by: 'Afridh', customerId: 1, type: 'CASH', total, paid: total, balance: 0, sub: total, billDisc: 0, lines, pays: [{ method: 'CASH', amount: total }] };
  const html = window.eval('printDocument')(window.eval('billHtml')(inv, 'a5'), 'a5'); C.bill.a5Style = keep; return html }, n, style);
const open = async (html, width) => { const p = await b.newPage(); p.on('pageerror', e => errs.push('doc: ' + e.message)); await p.setViewport({ width, height: 800 }); await p.setContent(html, { waitUntil: 'load' }); await p.emulateMediaType('print');
  await p.evaluate(() => { document.body.classList.add('direct-print'); const st = document.createElement('style'); st.textContent = '@page{size:A5 landscape;margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important}'; document.head.appendChild(st) }); await wait(150); return p };
const read = p => p.evaluate(() => { const sh = [...document.querySelectorAll('#printArea .print')];
  const row = s => [...s.querySelectorAll('table.x-tbl tbody tr,table.sp-tbl tbody tr')].map(r => (r.innerText.match(/LINE-(\d+)/) || [])[1]).filter(Boolean).map(Number);
  return sh.map(s => ({ h: Math.round(s.getBoundingClientRect().height), rows: row(s), head: !!s.querySelector('thead'), total: /INVOICE TOTAL|Net Total/i.test(s.innerText), page: (s.querySelector('.a5-pg') || {}).textContent || '' })) });
for (const style of ['sepos', 'boxed', 'bw', 'bands', 'standard']) {
  const html = await doc(45, style), p = await open(html, 794);
  const n = await p.evaluate(() => window.regalA5Pages({ sheets: true })); await wait(100);
  const sh = await read(p), all = sh.flatMap(s => s.rows);
  ok(n >= 2 && sh.length === n, `${style}: 45 lines make ${n} sheets`, JSON.stringify(sh.map(s => [s.rows.length, s.h])));
  ok(all.length === 45 && all.every((v, i) => v === i + 1), `${style}: every row once, in order`);
  ok(sh.every(s => s.h <= 516), `${style}: no sheet taller than the page`, JSON.stringify(sh.map(s => s.h)));
  ok(sh.every(s => s.head) && sh.every((s, i) => s.total === (i === n - 1)), `${style}: column heads on every sheet, totals only on the last`);
  ok(sh.every((s, i) => s.page.startsWith(`Page ${i + 1} of ${n}`)), `${style}: each sheet says its page`, sh[0].page);
  const pdf = Buffer.from(await p.pdf({ preferCSSPageSize: true, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok(pages === n, `${style}: the PDF has ${pages} pages`, `${Math.round(pdf.length / 1024)} KB`);
  if (OUT) fs.writeFileSync(`${OUT}/a5-${style}.pdf`, pdf);
  await p.close();
  // the helper's way: pictures at 733 wide
  const q = await open(html, 733), m = await q.evaluate(() => window.regalA5Pages()), s2 = await read(q);
  ok(m >= 2 && s2.flatMap(s => s.rows).length === 45 && s2.every(s => s.h <= 516), `${style}: as pictures, ${m} sheets, all 45 rows`); await q.close();
  // one page: untouched; and a program that never calls it keeps the whole bill in one sheet
  const r = await open(await doc(4, style), 794), one = await r.evaluate(() => window.regalA5Pages({ sheets: true })), s3 = await read(r);
  ok(one === 1 && s3.length === 1 && !s3[0].page && s3[0].total, `${style}: a 4-line bill stays one page, no page mark`); await r.close();
  const t = await open(html, 733), s4 = await read(t);
  ok(s4.length === 1 && s4[0].rows.length === 45, `${style}: not called, the whole bill in one sheet (an older program, nothing lost)`); await t.close();
}
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
