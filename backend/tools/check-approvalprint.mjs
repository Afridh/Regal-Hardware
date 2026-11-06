// Approving a payment in the Action centre: the voucher waits for a yes. It reached the printer the moment Approve was
// pressed, so closing the window afterwards could not stop it (6 Nov 2026).
//  · customer and supplier payments: nothing leaves the till until Print; No print, Esc and a click outside print nothing
//  · Print sends it once; the payment is on the books whichever is chosen
//  · a payment taken at the counter still prints by itself, once
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-approvalprint.mjs [screenshot-dir]
// Every request to the print helper is answered here: it never reaches the printers on this PC.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
const jobs = [];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Private-Network': 'true' };
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url();
  if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u)) {
    if (rq.method() === 'OPTIONS') return rq.respond({ status: 204, headers: CORS });
    if (!/\/print$/.test(u)) return rq.abort();
    jobs.push(JSON.parse(rq.postData())); return rq.respond({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: true, printer: 'TEST' }) }) }
  if (/\/api\/print\b/.test(u) && rq.method() !== 'GET') { jobs.push(JSON.parse(rq.postData())); return rq.abort() }
  rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent='http://localhost:4100'"); window.print = () => { window._winPrint = (window._winPrint || 0) + 1 }; window.eval('go')('approvals') });
await wait(500);

let seq = 0;
const ask = (kind) => pg.evaluate((kind, n) => { const S = window.eval('S'), id = 'tap' + n + Date.now();
  const data = kind === 'custPay'
    ? { customerId: S.customers.find(c => c.id !== 1 && c.active !== false).id, parts: [{ amount: 100, method: 'CASH' }], against: [], sms: false }
    : { supplierId: S.suppliers[0].id, lines: [{ method: 'CASH', amount: 100 }], against: [], notes: '' };
  S.approvals = S.approvals || []; S.approvals.push({ id, kind, status: 'pending', by: 'Ravi', title: 'Test payment ' + n, detail: '', at: '2026-11-06 17:00', data });
  window.eval('render')(); return { id, pays: S.payments.length } }, kind, ++seq);
const approve = async (a) => { await pg.evaluate(id => document.querySelector(`[data-act="apOk"][data-id="${id}"]`).click(), a.id); await wait(1500) };
const shown = () => pg.evaluate(() => { const v = document.querySelector('.modal .print.voucher'); return v ? v.closest('.modal').innerText.slice(0, 60) : null });
const posted = (a) => pg.evaluate(() => window.eval('S').payments.length).then(n => n > a.pays);

for (const [kind, name] of [['custPay', 'customer payment'], ['supPay', 'supplier payment']]) {
  // No print
  jobs.length = 0; let a = await ask(kind); await approve(a);
  ok(await pg.evaluate(id => window.eval('S').approvals.find(x => x.id === id).status === 'approved', a.id), `${name}: approved`);
  ok(jobs.length === 0, `${name}: nothing has gone to the printer yet`, String(jobs.length));
  ok(!!(await shown()), `${name}: the voucher is on the screen`, await shown());
  ok(await pg.evaluate(() => /No print/.test(document.querySelector('.modal .vclose').innerText) && !!document.getElementById('vAskPrint')), `${name}: it asks, Print or No print`);
  if (OUT && kind === 'custPay') await pg.screenshot({ path: OUT + '/approve-ask.png' });
  await pg.evaluate(() => document.querySelector('.modal .vclose').click()); await wait(1200);
  ok(jobs.length === 0 && !(await shown()), `${name}: No print closes it and prints nothing`);
  ok(await posted(a), `${name}: the payment is on the books all the same`);
  // Esc
  a = await ask(kind); await approve(a); await pg.keyboard.press('Escape'); await wait(1000);
  ok(jobs.length === 0 && !(await shown()), `${name}: Esc prints nothing`);
  // a click outside
  a = await ask(kind); await approve(a); await pg.evaluate(() => document.querySelector('.print.voucher').closest('.modal').click()); await wait(1000);
  ok(jobs.length === 0 && !(await shown()), `${name}: a click outside prints nothing`);
  // Print, by Enter
  a = await ask(kind); await approve(a);
  ok(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'vAskPrint'), `${name}: the cursor is on Print`);
  await pg.keyboard.press('Enter'); await wait(1500);
  ok(jobs.length === 1 && /voucher/i.test(jobs[0].html) && !(await shown()), `${name}: Enter prints it once and closes`, String(jobs.length));
  // Print, by mouse, pressed twice
  jobs.length = 0; a = await ask(kind); await approve(a);
  await pg.evaluate(() => { const p = document.getElementById('vAskPrint'); p.click(); p.click() }); await wait(1500);
  ok(jobs.length === 1, `${name}: two quick presses of Print send one`, String(jobs.length));
}

// a payment taken at the counter: the cashier chose by the No print tick, so it still prints by itself
jobs.length = 0;
await pg.evaluate(() => { const S = window.eval('S'), c = S.customers.find(x => x.id !== 1 && x.active !== false), rv = window.eval('receiveCustomer')({ customerId: c.id, amount: 50, method: 'CASH', against: [], quiet: true }); window.eval('receiptVoucherCombined')([rv], true) }); await wait(1500);
ok(jobs.length === 1, 'a payment at the counter still prints by itself, once', String(jobs.length));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
ok((await pg.evaluate(() => window._winPrint || 0)) === 0, 'the browser print window never opened');
ok(errs.length === 0, 'no errors in the page', errs.join(' | '));
await pg.evaluate(() => window.eval('persist')(true)); await wait(2500);
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
