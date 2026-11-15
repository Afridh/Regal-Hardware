// "NO REFUND WILL BE GIVEN" on the bill (15 Nov 2026, the owner):
//  · printed on a sale bill in every layout — 80mm, A5 (each look) and the SEPOS A5
//  · not on a return bill, nor on a quotation
//  · Settings → Bills changes the words; left empty, nothing prints
// Nothing reaches a printer — the bills are only drawn.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-norefund.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => window.eval('S').sales.length > 0, { timeout: 30000 }); await wait(1200);
const r = await pg.evaluate(() => {
  const S = window.eval('S'), CFG = window.eval('CFG'), H = window.eval('billHtml'), was = { a5: CFG.bill.a5Style, nr: CFG.bill.noRefund };
  const txt = h => { const d = document.createElement('div'); d.innerHTML = h; return d.innerText.replace(/\s+/g, ' ').toUpperCase() };
  const sale = S.sales.find(s => +s.total > 0 && !s.returnOf && !s.cancelled && (s.lines || []).length);
  const ret = { ...sale, no: 'R-TEST', total: -Math.abs(sale.total), returnOf: sale.no, lines: sale.lines.map(l => ({ ...l, qty: -Math.abs(l.qty) })), paid: 0, balance: 0, pays: [] };
  const out = { def: CFG.bill.noRefund, sale: {}, ret: {}, quote: null, off: {} };
  const looks = [['r80', null], ['a5', 'modern'], ['a5', 'bw'], ['a5', 'bands'], ['a5', 'boxed'], ['a5', 'sepos']];
  for (const [f, st] of looks) { if (st) CFG.bill.a5Style = st; const k = f + (st ? ':' + st : '');
    out.sale[k] = txt(H(sale, f)).includes('NO REFUND WILL BE GIVEN'); out.ret[k] = txt(H(ret, f)).includes('NO REFUND WILL BE GIVEN') }
  CFG.bill.a5Style = 'modern'; out.quote = txt(H({ ...sale, docKind: 'QUOTE', valid: 14 }, 'a5')).includes('NO REFUND WILL BE GIVEN');
  CFG.bill.noRefund = 'Goods sold are not refunded'; out.words = txt(H(sale, 'r80')).includes('GOODS SOLD ARE NOT REFUNDED') && !txt(H(sale, 'r80')).includes('NO REFUND WILL BE GIVEN');
  CFG.bill.noRefund = ''; for (const [f, st] of looks) { if (st) CFG.bill.a5Style = st; out.off[f + (st ? ':' + st : '')] = /REFUND/.test(txt(H(sale, f))) }
  CFG.bill.a5Style = was.a5; CFG.bill.noRefund = was.nr;
  // the box for it in Settings → Bills
  window.eval('setTab="bill"'); window.eval('go')('settings'); const box = document.querySelector('[data-set="bill.noRefund"]');
  out.setting = !!box; window.eval('go')('pos');
  return out;
});
ok(r.def === 'NO REFUND WILL BE GIVEN', 'it is on by default, worded as the owner asked', r.def);
ok(Object.values(r.sale).every(Boolean), 'a sale bill prints it in every layout', JSON.stringify(r.sale));
ok(!Object.values(r.ret).some(Boolean), 'a return bill does not', JSON.stringify(r.ret));
ok(r.quote === false, 'a quotation does not');
ok(r.words, 'other words typed in Settings print instead');
ok(!Object.values(r.off).some(Boolean), 'left empty: nothing prints in any layout', JSON.stringify(r.off));
ok(r.setting, 'there is a box for it in Settings → Bills');
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
