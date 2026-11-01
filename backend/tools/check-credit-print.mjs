// A bill on credit always prints large (A5), whatever paper was picked; a cash bill keeps the 80mm receipt.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-credit-print.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.dismiss());
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
const r = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove());
  const sent = []; window.printPaper = (html, f, no) => sent.push({ f, no });
  const S = window.eval('S');
  const credit = S.sales.find(x => +x.balance > 0.005), cash = S.sales.find(x => !(+x.balance > 0.005) && !(x.pays || []).some(p => p.method === 'CREDIT') && x.type !== 'CREDIT');
  window.eval('printBill')(credit, 'r80');
  window.eval('billPrintNow')(credit.no, 'r80');
  window.eval('printBill')(cash, 'r80');
  window.eval('printBill')({ ...credit, proof: true }, 'r80');
  return { sent, credit: credit.no, cash: cash.no };
});
ok(r.sent[0] && r.sent[0].f === 'a5', 'a credit bill sent as the 80mm receipt prints as the A5 bill', JSON.stringify(r.sent[0]));
ok(r.sent[1] && r.sent[1].f === 'a5', 'a reprint of it from Bills ("small") still prints A5', JSON.stringify(r.sent[1]));
ok(r.sent[2] && r.sent[2].f === 'r80', 'a cash bill keeps the 80mm receipt', JSON.stringify(r.sent[2]));
ok(r.sent[3] && r.sent[3].f === 'r80', 'a test print stays as asked', JSON.stringify(r.sent[3]));
// the credit window no longer offers the small receipt
const papers = await pg.evaluate(async () => { const S = window.eval('S'); window.eval('go')('pos'); await new Promise(r => setTimeout(r, 300));
  const p = S.products.find(x => x.active !== false && x.stock > 5); window.eval('addLine') ? window.eval('addLine')(p.id) : S.pos.lines.push({ pid: p.id, qty: 1, price: p.retail });
  window.eval('CS').paper = 'r80'; window.eval('creditSale')(); await new Promise(r => setTimeout(r, 400));
  const el = document.querySelector('.cp-modal'); const txt = el ? el.innerText : ''; const paper = window.eval('ONA').paper; el && el.remove(); S.pos.lines = []; window.eval('CS').paper = null; return { small: /Small 80mm/.test(txt), paper, open: !!el } });
ok(papers.open && !papers.small && papers.paper === 'a5', 'the credit window offers Large A5 (no 80mm), even with the small bill picked at the till', JSON.stringify(papers));
// the "which bill?" question on a credit bill: no 80mm, A5 picked, and 2 still means A5
const ask = await pg.evaluate(async () => { const S = window.eval('S'), CFG = window.eval('CFG'); const inv = S.sales.find(x => +x.balance > 0.005);
  const sent = []; window.printPaper = (html, f) => sent.push(f); CFG.done.askSize = true; CFG.done.creditDefault = 'r80'; CFG.done.printAnim = false; CFG.done.preview = false;
  window.eval('askSize')(inv); await new Promise(r => setTimeout(r, 300)); const m = document.querySelector('.sizeq');
  const opts = m ? [...m.querySelectorAll('[data-bill]')].map(b => b.dataset.bill) : []; const on = m && (m.querySelector('.pick.on') || {}).dataset.bill;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
  await new Promise(r => setTimeout(r, 300)); document.querySelectorAll('.modal').forEach(x => x.remove()); return { opts, on, sent } });
ok(!ask.opts.includes('r80') && ask.on === 'a5', 'the "which bill?" question on a credit bill: no 80mm, the A5 picked', JSON.stringify(ask));
ok(ask.sent[0] === 'a5', 'pressing 2 there prints the A5', JSON.stringify(ask.sent));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
