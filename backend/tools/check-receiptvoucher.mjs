// The customer's receipt voucher, "before − paid = now" (15 Nov 2026, the owner chose demo 2):
//  · the customer's name in the box on the right, where the bill has it, in bold
//  · previous balance − paid now = balance outstanding, from the ledger at the receipt (opened later, the same)
//  · cash + cheque together on one voucher; paying more than owed shows what is kept as credit
//  · other vouchers (a supplier payment) keep their own sheet
// Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-receiptvoucher.mjs [folder for a screenshot]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const SHOTS = process.argv[2] || '';
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
await wait(1000);
const r = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval("CFG.print.agent=''");
  const S = window.eval('S'), RC = window.eval('receiveCustomer'), bal = id => +window.eval('partyBal')('C', id).toFixed(2), F = window.eval('money2');
  const tag = 'RVX' + Date.now().toString(36).slice(-4).toUpperCase();
  const c = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: tag, name: tag + ' Builders', phone: '0700000041', level: 'retail', limit: 9999999 }; S.customers.push(c);
  const p = S.products.find(x => +x.retail > 100 && x.id !== window.eval('OPEN_PID')); p.stock = Math.max(+p.stock || 0, 100);
  window.eval('completeSale')({ lines: [{ pid: p.id, qty: 10, price: 1000, disc: 0 }], customerId: c.id, pays: [], type: 'CREDIT', override: true });
  const before = bal(c.id);
  const rv1 = RC({ customerId: c.id, amount: 3000, method: 'CASH', quiet: true });
  const rv2 = RC({ customerId: c.id, amount: 2000, method: 'CHEQUE', ref: '556201', chq: { no: '556201', date: '2026-11-20', bank: 'Sample Bank' }, quiet: true });
  const after = bal(c.id);
  const read = () => { const s = document.querySelector('.modal .print.rvx'); if (!s) return null; const t = x => (s.querySelector(x) || {}).innerText || '';
    const cn = s.querySelector('.rvx-to .rvx-cn');
    return { name: t('.rvx-to .rvx-cn'), bold: cn ? +getComputedStyle(cn).fontWeight : 0, inRight: !!cn, figs: [...s.querySelectorAll('.rvx-c b')].map(b => b.innerText), lines: s.querySelectorAll('.rvx-lines tr').length - 1, text: s.innerText.replace(/\s+/g, ' ') } };
  window.eval('receiptVoucherCombined')([rv1, rv2], false); const v1 = read(); document.querySelectorAll('.modal').forEach(m => m.remove());
  // another payment later; the first voucher opened again still shows its own day
  RC({ customerId: c.id, amount: 1000, method: 'CASH', quiet: true });
  window.eval('receiptVoucherCombined')([rv1, rv2], false); const v2 = read(); document.querySelectorAll('.modal').forEach(m => m.remove());
  // paying more than is owed
  const owe = bal(c.id), rv4 = RC({ customerId: c.id, amount: owe + 500, method: 'CASH', quiet: true });
  window.eval('receiptVoucher')(rv4, false); const v3 = read(); document.querySelectorAll('.modal').forEach(m => m.remove());
  // a supplier payment keeps its own voucher
  window.eval('voucherPrint')({ view: true, title: 'Payment Voucher', no: 'PV-T', date: '2026-11-15', payee: 'Sample Paints Ltd', amount: 100, rows: [['x', 'y']] });
  const other = { old: !!document.querySelector('.modal .print.voucher'), rvx: !!document.querySelector('.modal .print.rvx') }; document.querySelectorAll('.modal').forEach(m => m.remove());
  return { name: c.name.toUpperCase(), before: F(before), paid: F(5000), after: F(after), owe: F(owe), extra: F(500), v1, v2, v3, other };
});
ok(r.v1 && r.v1.inRight && r.v1.name === r.name && r.v1.bold >= 700, 'the customer\'s name is in the box on the right, in bold', JSON.stringify({ name: r.v1 && r.v1.name, bold: r.v1 && r.v1.bold }));
ok(r.v1 && r.v1.figs.join('|') === [r.before, r.paid, r.after].join('|'), 'previous balance − paid now = balance outstanding', JSON.stringify({ shown: r.v1 && r.v1.figs, want: [r.before, r.paid, r.after] }));
ok(r.v1 && r.v1.lines === 2 && /Cheque/.test(r.v1.text) && /556201/.test(r.v1.text) && /Sample Bank/.test(r.v1.text), 'cash and cheque on one voucher, with the cheque details', String(r.v1 && r.v1.lines));
ok(r.v2 && r.v2.figs.join('|') === r.v1.figs.join('|'), 'opened again after another payment: still the figures of that day', JSON.stringify(r.v2 && r.v2.figs));
ok(r.v3 && r.v3.figs[0] === r.owe && r.v3.figs[2] === '0.00' && r.v3.text.includes(r.extra + ' more than was owed'), 'paying more than owed: balance 0.00 and the rest kept as their credit', JSON.stringify(r.v3 && r.v3.figs));
ok(r.other.old && !r.other.rvx, 'a supplier payment voucher keeps its own sheet');
if (SHOTS) { await pg.evaluate(() => { const S = window.eval('S'); const rv = S.payments.filter(x => x.dir === 'IN' && x.method === 'CHEQUE').pop(); window.eval('receiptVoucher')(rv, false) }); await wait(300); const el = await pg.$('.modal .print.rvx'); if (el) await el.screenshot({ path: SHOTS + '/rvx.png' }); }
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
