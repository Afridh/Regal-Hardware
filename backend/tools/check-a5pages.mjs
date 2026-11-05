// A long large bill on real pages (5 Nov 2026), checked on PDF, never on paper.
//  · every design: a 45-line bill makes several sheets, each row once and in order, each sheet no taller than the page,
//    the column heads on every sheet, the totals only on the last, "Page 1 of n" on each
//  · the letterhead and customer band on the first sheet only, and later sheets use that room for rows
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
  return sh.map(s => ({ top: !!s.querySelector('.x-head,.sp-top,.x-band,.sp-head'), h: Math.round(s.getBoundingClientRect().height), rows: row(s), head: !!s.querySelector('thead'), total: /INVOICE TOTAL|Net Total/i.test(s.innerText), page: (s.querySelector('.a5-pg') || {}).textContent || '' })) });
for (const style of ['sepos', 'boxed', 'bw', 'bands', 'standard']) {
  const html = await doc(45, style), p = await open(html, 794);
  const n = await p.evaluate(() => window.regalA5Pages({ sheets: true })); await wait(100);
  const sh = await read(p), all = sh.flatMap(s => s.rows);
  ok(n >= 2 && sh.length === n, `${style}: 45 lines make ${n} sheets`, JSON.stringify(sh.map(s => [s.rows.length, s.h])));
  ok(all.length === 45 && all.every((v, i) => v === i + 1), `${style}: every row once, in order`);
  ok(sh.every(s => s.h <= 516), `${style}: no sheet taller than the page`, JSON.stringify(sh.map(s => s.h)));
  ok(sh.every(s => s.head) && sh.every((s, i) => s.total === (i === n - 1)), `${style}: column heads on every sheet, totals only on the last`);
  ok(sh.every((s, i) => s.page.startsWith(`Page ${i + 1} of ${n}`)), `${style}: each sheet says its page`, sh[0].page);
  ok(sh.every((s, i) => s.top === (i === 0)), `${style}: the letterhead and customer band on the first page only`, JSON.stringify(sh.map(s => s.top)));
  ok(n < 3 || sh[1].rows.length > sh[0].rows.length, `${style}: the second page holds more rows than the first`, JSON.stringify(sh.map(s => s.rows.length)));
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
// the till sends it page by page: what an older Regal POS or helper does with each document (never to a printer: answered here)
const posted = []; let held = 0;
pg.removeAllListeners('request');
pg.on('request', rq => { const u = rq.url(); if (!/:41\d\d/.test(u)) return rq.continue();
  const head = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Private-Network': 'true' };
  if (rq.method() === 'OPTIONS') return rq.respond({ status: 204, headers: head });
  if (u.endsWith('/print')) { posted.push(JSON.parse(rq.postData())); return setTimeout(() => rq.respond({ status: 200, headers: head, contentType: 'application/json', body: JSON.stringify({ ok: true, printer: 'nothing, a test' }) }), 150) }
  return rq.abort() });
await pg.evaluate(() => { window.__keepTo = window.eval('CFG').bill.printTo; window.eval('CFG').bill.printTo = ''; window.eval('CFG').print = { agent: 'http://localhost:4100' } });
const sendBill = async (n, style) => { posted.length = 0; const html = await doc(n, style); await pg.evaluate(h => { window.eval('printPaper')(h, 'a5', 'PG-TEST', () => { window.__fell = true }) }, html); await wait(n > 10 ? 3500 : 1200); return posted.map(p => p.html) };
for (const style of ['sepos', 'boxed', 'bw']) {
  const docs = await sendBill(27, style), seen = [];
  ok(docs.length >= 2, `${style}: a 27-line bill leaves the till as ${docs.length} documents`, posted.map(p => p.no).join(', '));
  for (const h of docs) { const p = await open(h, 733); const sh = await read(p); seen.push(...sh);
    if (sh.length !== 1 || sh[0].h > 520) held++; await p.close() }   // not calling regalA5Pages: as the older programs do
  ok(!held && seen.length === docs.length, `${style}: to an older program each is one page, none over the page height, so none is shrunk`, JSON.stringify(seen.map(s => s.h)));
  const rows = seen.flatMap(s => s.rows);
  ok(rows.length === 27 && rows.every((v, i) => v === i + 1), `${style}: all 27 rows, once each, in order`);
  ok(seen.every((s, i) => s.page.startsWith(`Page ${i + 1} of ${docs.length}`) && s.total === (i === docs.length - 1)), `${style}: each says its page, totals on the last`);
  const q = await open(docs[0], 794);
  ok(await q.evaluate(() => window.regalA5Pages({ sheets: true })) === 1, `${style}: Regal POS 1.1.3 does not share a page out again`); await q.close();
}
const shortDocs = await sendBill(4, 'sepos');
ok(shortDocs.length === 1 && !/<div class="a5-pg"/.test(shortDocs[0]), 'a 4-line bill goes as one document, no page mark', String(shortDocs.length));
ok(!(await pg.evaluate(() => window.__fell)), 'the fallback was never needed');
await pg.evaluate(() => { window.eval('CFG').bill.printTo = window.__keepTo });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
