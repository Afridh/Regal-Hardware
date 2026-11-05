// A return bill on the till (5 Nov 2026: Enter said "Nothing left to pay"; PRINT failed with "Unbalanced journal" and left
// half a bill and the stock added back, one more for each press).
//  · Enter, P or the PRINT button: all of it back in cash, the books balanced, the stock back, the bill printed, the till clear
//  · C: off the customer's account, no cash; on a walk-in it asks who first
//  · card and the like are refused, and leave nothing behind
//  · a bill whose money does not add up writes nothing at all
//  · an even exchange (total 0) goes through on Enter
// Nothing reaches a printer: printPaper is replaced here and :41xx is blocked.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-tillrefund.mjs      (SHOT=<folder> to keep a screenshot)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010', SHOT = process.env.SHOT || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
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
const made = [];
const pid = await pg.evaluate(() => { const S = window.eval('S'), x = S.products.find(y => y.active !== false && y.stock > 10 && y.retail > 100 && !(y.tiers || []).length && !y.serialised); return x.id });
// a return of 2 on the till, the payment window open
const toWindow = (customer = null, qty = -2) => pg.evaluate((pid, customer, qty) => { document.querySelectorAll('.modal').forEach(m => m.remove()); window._printed = []; window.printPaper = (html, f, no) => window._printed.push({ html: String(html), f, no });
  const S = window.eval('S'), C = window.eval('CFG'), p = window.eval('prefs')(); C.done.askCustomer = false; C.done.askSalesman = false; C.done.askSize = false; C.done.printAnim = false; C.done.preview = false; p.till = 'classic'; p.tillLook = 'sepos';
  const x = S.products.find(y => y.id === pid); S.pos.lines = qty ? [{ pid, qty, price: x.retail, disc: 0 }] : [{ pid, qty: 1, price: x.retail, disc: 0 }, { pid, qty: -1, price: x.retail, disc: 0 }]; S.pos.billDisc = 0; S.pos.customer = customer; window.eval('go')('pos'); window.eval('openPay')() }, pid, customer, qty).then(() => wait(400));
const snap = id => pg.evaluate((pid, id) => { const S = window.eval('S'), s = S.sales.at(-1), bal = window.eval('bal');
  return { sales: S.sales.length, stock: S.products.find(y => y.id === pid).stock, cash: bal('1010'), owed: id ? window.eval('partyBal')('C', id) : 0, open: !!document.querySelector('.payw'), lines: S.pos.lines.length, no: s.no, total: s.total, balance: s.balance, pays: s.pays, printed: window._printed.map(p => ({ no: p.no, f: p.f, html: /-?\d/.test(p.html) })), posted: S.journal.filter(j => j.ref === s.no).length, price: S.products.find(y => y.id === pid).retail,
    toast: [...document.querySelectorAll('.toast')].map(t => t.innerText).join('|') } }, pid, id);
const near = (a, b) => Math.abs(a - b) < 0.01;

// the window says what is going on
await toWindow(); const a0 = await snap();
const look = await pg.evaluate(() => { const box = document.getElementById('payAmt'), btn = [...document.querySelectorAll('[data-paym]')].map(x => x.dataset.paym); return { box: box.value, ro: box.readOnly, btn, words: document.querySelector('.payw').innerText } });
ok(+look.box === a0.price * 2 && look.ro, 'the amount shows as a plain figure and cannot be typed over', JSON.stringify({ box: look.box, ro: look.ro }));
ok(look.btn.join() === 'CASH,CREDIT' && /GIVE BACK IN CASH/.test(look.words) && /TAKE OFF THEIR ACCOUNT/.test(look.words) && /REFUND DUE/.test(look.words), 'it offers cash back or off the account, nothing else', look.btn.join());
if (SHOT) await pg.screenshot({ path: SHOT + '/till-refund.png' });
// card is refused, nothing left behind
await pg.keyboard.press('a'); await wait(400); const a1 = await snap();
ok(a1.sales === a0.sales && a1.stock === a0.stock && a1.open && /cash, or off/.test(a1.toast), 'card is refused, and no bill or stock is touched', a1.toast);
// Enter, P and the button
for (const [name, press] of [['Enter', () => pg.keyboard.press('Enter')], ['P', () => pg.keyboard.press('p')], ['the PRINT button', () => pg.click('#payPrint')]]) {
  await toWindow(); const x0 = await snap(); await press(); await wait(1200); const x1 = await snap(); made.push(x1.no);
  ok(x1.sales === x0.sales + 1 && near(x1.total, -2 * x1.price) && x1.posted >= 1 && x1.balance === 0, `${name}: one return bill, in the books`, JSON.stringify({ no: x1.no, total: x1.total, balance: x1.balance, posted: x1.posted, pays: x1.pays }));
  ok(near(x0.cash - x1.cash, 2 * x1.price) && x1.stock === x0.stock + 2, `${name}: the cash goes down by it and the stock comes back`, JSON.stringify({ cash: x0.cash - x1.cash, stock: x1.stock - x0.stock }));
  ok(x1.printed.length === 1 && x1.printed[0].no === x1.no && !x1.open && x1.lines === 0, `${name}: the bill prints, the window closes, the till is clear`, JSON.stringify(x1.printed));
}
// the end-of-bill question, as the shop has it switched on: Enter on the empty box is a walk-in
await toWindow(); await pg.evaluate(() => { window.eval('CFG').done.askCustomer = true }); const q0 = await snap(); await pg.keyboard.press('Enter'); await wait(500);
const asked = await pg.evaluate(() => !!document.getElementById('bqQ')); await pg.keyboard.press('Enter'); await wait(1200); const q1 = await snap(); made.push(q1.no);
ok(asked && q1.sales === q0.sales + 1 && q1.printed.length === 1 && !q1.open, 'with the customer question on: Enter, Enter, printed', JSON.stringify({ asked, printed: q1.printed.length }));
// off the account
const cust = await pg.evaluate(() => { const S = window.eval('S'), pb = window.eval('partyBal'); return S.customers.filter(x => x.id !== 1 && x.active !== false).sort((a, b) => pb('C', b.id) - pb('C', a.id))[0].id });
await toWindow(cust); const c0 = await snap(cust); await pg.keyboard.press('c'); await wait(1200); const c1 = await snap(cust); made.push(c1.no);
ok(c1.sales === c0.sales + 1 && near(c0.owed - c1.owed, 2 * c1.price) && near(c1.cash, c0.cash) && c1.stock === c0.stock + 2 && c1.printed.length === 1 && !c1.open, 'C: off what they owe, no cash moves, the stock comes back, printed', JSON.stringify({ owed: c0.owed - c1.owed, cash: c1.cash - c0.cash }));
await toWindow(); await pg.keyboard.press('c'); await wait(500);
ok(await pg.evaluate(() => !document.querySelector('.payw') && !!document.querySelector('.modal')), 'C on a walk-in: it asks who the customer is first');
// a bill that does not add up writes nothing
const guard = await pg.evaluate(pid => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'), p = S.products.find(y => y.id === pid), n = S.sales.length, st = p.stock, jn = S.journal.length, mv = S.movements.length; let msg = '';
  try { window.eval('completeSale')({ lines: [{ pid, qty: -1, price: p.retail, disc: 0 }], customerId: 1, pays: [] }) } catch (e) { msg = e.message }
  return { msg, same: S.sales.length === n && p.stock === st && S.journal.length === jn && S.movements.length === mv } }, pid);
ok(guard.same && /cash or take it off/.test(guard.msg), 'a return with no money side is refused, with nothing written', JSON.stringify(guard));
const guard2 = await pg.evaluate(pid => { const S = window.eval('S'), p = S.products.find(y => y.id === pid), n = S.sales.length, st = p.stock; let msg = '';
  try { window.eval('completeSale')({ lines: [{ pid, qty: 1, price: p.retail, disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: p.retail + 500 }] }) } catch (e) { msg = e.message }
  return { msg, same: S.sales.length === n && p.stock === st } }, pid);
ok(guard2.same && /change/.test(guard2.msg), 'so is a sale with too much taken', JSON.stringify(guard2));
// an even exchange
await toWindow(null, 0); const e0 = await snap(); await pg.keyboard.press('Enter'); await wait(1200); const e1 = await snap(); made.push(e1.no);
ok(e1.sales === e0.sales + 1 && e1.total === 0 && e1.printed.length === 1 && !e1.open && e1.stock === e0.stock, 'an even exchange: Enter makes the bill, nothing to pay', JSON.stringify({ total: e1.total, printed: e1.printed.length }));
// tidy: the bills go, with their journal and movements; the stock goes back
await pg.evaluate(nos => { const S = window.eval('S'); window._allowWipeOnce = Date.now(); const bad = S.sales.filter(s => nos.includes(s.no)); bad.forEach(s => s.lines.forEach(l => { const p = S.products.find(y => y.id === l.pid); if (p) p.stock += l.qty })); S.sales = S.sales.filter(s => !nos.includes(s.no)); S.journal = S.journal.filter(j => !nos.includes(j.ref)); S.movements = S.movements.filter(m => !nos.includes(m.ref)); S.pos.lines = []; S.pos.customer = null; window.eval('CFG').done.askCustomer = true; document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('persist')(true) }, made); await wait(1500);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
