// Looking at a voucher does not print it; a payment or a bill can be made without printing anything.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-noprint.mjs [screenshot-dir]
// Every call to a printer is stopped and counted here — the print helper on this PC is the shop's.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
// the helper on this machine and the shop's print queue: both stopped, both counted
let prints = 0;
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url();
  if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u)) { if (/\/(print|label)\b/.test(u)) prints++; return rq.abort() }
  if (/\/api\/print\b/.test(u) && rq.method() === 'POST') { prints++; return rq.abort() }
  rq.continue() });
await pg.evaluateOnNewDocument(() => { window.print = () => { window.__browserPrints = (window.__browserPrints || 0) + 1 } });
// one print tries the helper first, then the queue, then the browser: counted once, at the helper
const printed = async () => prints;

await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const close = () => pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// 1. a supplier payment made now prints its voucher; opening it again later does not
const pvNo = await pg.evaluate(() => { const S = window.eval('S'), s = S.suppliers[0];
  const pv = window.eval('paySupplier')({ supplierId: s.id, lines: [{ method: 'CASH', bank: 1, amount: 100 }], against: [], notes: 'check-noprint' });
  window.eval('supplierVoucher')(pv, true); return pv.no });
await wait(800);
let n = await printed(); ok(n === 1, 'a payment made now prints its voucher', n + ' print');
await close();
await pg.evaluate(no => window.eval('supplierVoucher')(window.eval('S').payments.find(x => x.no === no)), pvNo); await wait(800);
ok(await printed() === n, 'opening that voucher again later only shows it', (await printed() - n) + ' prints');
ok(await pg.evaluate(() => !!document.querySelector('.modal [data-act="rePrintPaper"]')), 'with Print on it');
await pg.screenshot({ path: OUT + '/voucher-view.png' });
await pg.click('.modal [data-act="rePrintPaper"]'); await wait(800);
ok(await printed() === n + 1, 'and Print prints it'); n = await printed(); await close();
for (const [what, js] of [['a receipt voucher', "const S=window.eval('S'),rv=S.payments.find(p=>p.dir==='IN'&&p.voucher); rv?window.eval('receiptVoucher')(rv):null"],
  ['an expense voucher', "const S=window.eval('S'),e=(S.expenses||[]).find(x=>x.voucher); e?window.eval('voucher')(e.no):null"],
  ['a salary voucher', "const S=window.eval('S'),e=S.employees[0]; window.eval('salaryVoucher')(e,window.eval('payFor')(e,window.eval('D')(window.eval('today')).slice(0,7)),window.eval('D')(window.eval('today')).slice(0,7))"]]) {
  await pg.evaluate(j => { try { eval(j) } catch (e) { window.__err = e.message } }, js); await wait(600);
  const shown = await pg.evaluate(() => !!document.querySelector('.modal .voucher'));
  ok(await printed() === n, `viewing ${what} does not print it`, shown ? 'shown' : 'none on file to open'); await close();
}

// 2. "No print" on a payment window
await pg.evaluate(() => window.eval('advanceModal')(window.eval('S').employees[0].id)); await wait(300);
ok(await pg.evaluate(() => !!document.querySelector('.modal .np-chk')), 'the advance window has the "No print" box');
await pg.screenshot({ path: OUT + '/noprint-box.png' });
await pg.type('#avAmt', '250'); await pg.click('.modal .np-chk'); await pg.click('#avOk'); await wait(800);
ok(await printed() === n && !(await pg.$('.modal .voucher')), 'ticked: the advance is paid, no voucher printed or left open');
ok(await pg.evaluate(() => (window.eval('S').advances || []).some(a => a.amount === 250)), 'and the advance is recorded');
await pg.evaluate(() => window.eval('advanceModal')(window.eval('S').employees[0].id)); await wait(300);
await pg.type('#avAmt', '260'); await pg.click('#avOk'); await wait(800);
ok(await printed() === n + 1, 'not ticked: the voucher prints as before'); n = await printed(); await close();
for (const [what, js] of [['a customer payment', "window.eval('custPayModal')(window.eval('S').customers.find(c=>c.id!==1).id)"],
  ['a supplier payment', "window.eval('supPayModal')(window.eval('S').suppliers[0].id)"],
  ['petty cash', "window.eval('pettyGiveModal')()"]]) {
  await pg.evaluate(j => { try { eval(j) } catch (e) { window.__err = e.message } }, js); await wait(400);
  ok(await pg.evaluate(() => !!document.querySelector('.modal .np-chk')), `${what} window has the "No print" box`); await close();
}

// 3. the bill: No print after payment
await pg.evaluate(() => { const S = window.eval('S'); window.eval('go')('pos'); window.eval('CS').paper = null;
  window.eval('CFG').done.askSize = true; const p = S.products.find(x => x.retail > 0 && x.stock > 5);
  S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; window.eval('render')() }); await wait(300);
ok(await pg.evaluate(() => [...document.querySelectorAll('.till-paper i')].some(i => /NO PRINT/.test(i.textContent))), 'the till has NO PRINT beside SMALL BILL / LARGE BILL');
await pg.evaluate(() => [...document.querySelectorAll('.till-paper i')].find(i => /NO PRINT/.test(i.textContent)).click()); await wait(300);
ok(await pg.evaluate(() => window.eval('CS').paper === 'none'), 'clicking it picks no print for this bill');
await pg.screenshot({ path: OUT + '/till-noprint.png' });
const inv = { no: 'TEST-NP', customerId: 1, total: 100, balance: 0, lines: [] };
await pg.evaluate(i => window.eval('askSize')(i), inv); await wait(1500);
ok(await printed() === n, 'a bill with NO PRINT picked is saved and nothing prints');
await pg.evaluate(i => window.eval('askSize')(i), inv); await wait(300);
ok(await pg.evaluate(() => !!document.querySelector('.billpick [data-bill="none"]')), 'the after-payment question has "4 · No print"');
await pg.screenshot({ path: OUT + '/bill-noprint.png' });
await pg.keyboard.press('4'); await wait(1500);
ok(await printed() === n && !(await pg.$('.modal')), 'pressing 4 there saves it without printing');
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · ${prints} print calls stopped`);
await b.close();
