// Changing the price on a saved bill.
//  · a credit bill opened in the till: a new price typed on a line stays when the credit window picks the
//    customer again, and the bill saved on account carries it — not what they "paid last time" (the old bill)
//  · a price typed by hand on a new bill is not replaced when the customer is picked
//  · Correct a line: a price typed and saved straight away (no Tab first) is the one kept
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-editprice.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
const clear = () => pg.evaluate(() => document.querySelectorAll('.modal:not(.cp-modal)').forEach(m => m.remove()));
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const C = window.eval('CFG'); C.print.agent = ''; C.done.askSize = false; C.done.printAnim = false; C.done.preview = false; C.pos.repriceToLast = true;
  window.printPaper = () => {}; window.eval('CS').paper = 'none' });

// a credit bill for a customer, made here so we know its price
const made = await pg.evaluate(() => { const S = window.eval('S'); const p = S.products.find(x => x.active !== false && x.stock > 10 && !(x.tiers || []).length && x.retail > 50);
  const c = S.customers.find(x => x.id !== 1 && x.active !== false); c.limit = 1e9;
  S.pos.lines = [{ pid: p.id, qty: 2, price: p.retail, disc: 0 }]; S.pos.customer = c.id;
  return { pid: p.id, cid: c.id, retail: p.retail, cost: p.cost } });
// finish it on account through the credit window, the way the counter does
await pg.evaluate(() => { window.eval('go')('pos') }); await wait(300);
await pg.evaluate(c => { window.eval('creditSale')(); }, made.cid); await wait(400);
await pg.evaluate(c => window.eval('cpPick')(c), made.cid); await wait(200);
await pg.evaluate(() => window.eval('cpSave')()); await wait(800); await clear();
const inv0 = await pg.evaluate(c => { const S = window.eval('S'); const s = S.sales.filter(x => x.customerId === c).slice(-1)[0]; return s && { no: s.no, price: s.lines[0].price, bal: s.balance } }, made.cid);
ok(inv0 && inv0.price === made.retail && inv0.bal > 0, 'a credit bill is made at the normal price', JSON.stringify(inv0));

// 1. open it in the till and type a new price on the line
const newPrice = Math.round(made.retail * 1.1 + 7);
await pg.evaluate(no => window.eval('billToTill')(no), inv0.no); await wait(300); await pg.click('#ebYes'); await wait(500);
await pg.evaluate(() => window.eval('csLineEdit')(0, 'price')); await wait(300);
await pg.$eval('#lnPrice', (el, v) => { el.value = String(v) }, newPrice); await pg.focus('#lnPrice'); await pg.keyboard.press('Enter'); await wait(400); await clear();
const onTill = await pg.evaluate(() => window.eval('S').pos.lines[0].price);
ok(onTill === newPrice, 'the new price is on the line', `${onTill} (wanted ${newPrice})`);
// 2. back on account through the credit window: it picks the same customer again
await pg.evaluate(() => window.eval('creditSale')()); await wait(400);
await pg.evaluate(c => window.eval('cpPick')(c), made.cid); await wait(200);
const afterPick = await pg.evaluate(() => window.eval('S').pos.lines[0].price);
ok(afterPick === newPrice, 'the credit window picking the customer leaves the typed price alone', `${afterPick} (wanted ${newPrice})`);
await pg.evaluate(() => window.eval('cpSave')()); await wait(800); await clear();
const inv1 = await pg.evaluate(no => { const s = window.eval('S').sales.find(x => x.no === no); return s && { price: s.lines[0].price, total: s.total } }, inv0.no);
ok(inv1 && inv1.price === newPrice, 'the bill saved on account carries the new price', JSON.stringify(inv1));

// 3. a new bill: a price typed by hand is not replaced when the customer is picked
await pg.evaluate(m => { const S = window.eval('S'); S.pos.editing = null; S.pos.customer = null; S.pos.lines = [{ pid: m.pid, qty: 1, price: m.retail + 33, disc: 0, auto: false }]; window.eval('setBillCustomer')(m.cid); const u = document.getElementById('pcaUse'); if (u) u.click() }, made);
const typed = await pg.evaluate(() => window.eval('S').pos.lines[0].price);
ok(typed === made.retail + 33, 'a new bill: a typed price stays when the customer is picked', typed);
// …while a line at the till's own price still follows the customer's last price
await pg.evaluate(m => { const S = window.eval('S'); S.pos.customer = null; S.pos.lines = [{ pid: m.pid, qty: 1, price: m.retail, disc: 0 }]; window.eval('setBillCustomer')(m.cid); const u = document.getElementById('pcaUse'); if (u) u.click() }, made);
const follows = await pg.evaluate(() => window.eval('S').pos.lines[0]);
ok(follows.price === newPrice && follows.fromLast, 'a line at the normal price still goes to what they paid last time', JSON.stringify({ price: follows.price, fromLast: follows.fromLast }));
await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines = []; S.pos.customer = null });

// 4. Correct a line: type the price and click Save straight away
await pg.evaluate(no => window.eval('editSaleModal')(no), inv0.no); await wait(300);
const p3 = newPrice + 11;
await pg.focus('[data-ep="0"]'); await pg.$eval('[data-ep="0"]', (el, v) => { el.value = String(v) }, p3);
await pg.type('#esWhy', 'price agreed after'); await pg.focus('[data-ep="0"]');
await pg.click('#esOk'); await wait(500); await clear();
const inv2 = await pg.evaluate(no => window.eval('S').sales.find(x => x.no === no).lines[0].price, inv0.no);
ok(inv2 === p3, 'Correct a line: a price typed and saved at once is kept', `${inv2} (wanted ${p3})`);
await pg.evaluate(() => window.eval('persist')(true)); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
