// A bill texted as it is saved is not texted again when "e-bill" is chosen after (8 Nov 2026: bill 10184 went to
// the customer twice — once as it was saved, once from the e-bill choice).
//  · auto-text on, a customer with a mobile: one text for the bill, not two
//  · auto-text off: choosing e-bill still sends it, once
// Texts are kept in the books only (the test server sends nothing). Nothing is printed.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-ebillonce.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
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
await wait(1500);
const run = (auto) => pg.evaluate(async (auto) => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.print = () => {};
  const S = window.eval('S'), CFG = window.eval('CFG'); CFG.msg.autoBill = auto; CFG.msg.live = false; CFG.done.printAnim = false;
  const phone = '07' + String(Date.now()).slice(-8);
  const c = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: 'T' + phone.slice(-5), name: 'Customer ' + phone, phone, level: 'retail', limit: 0, byNumber: true };
  S.customers.push(c);
  const p = S.products.find(x => x.id !== window.eval('OPEN_PID') && +x.retail > 0); p.stock = Math.max(+p.stock || 0, 100);
  const inv = window.eval('completeSale')({ lines: [{ pid: p.id, qty: 1, price: 2250, disc: 0, belowCost: true }], customerId: c.id, pays: [{ method: 'CASH', amount: 2250 }], override: true });
  const afterSale = S.messages.filter(m => m.to === phone).length;
  window.eval('printAnim')(inv, 'sms'); await new Promise(r => setTimeout(r, 300));
  const afterEbill = S.messages.filter(m => m.to === phone && m.body.includes(inv.no)).length;
  return { afterSale, afterEbill, toast: (document.querySelector('.toast') || {}).textContent || '' };
}, auto);
let r = await run(true);
ok(r.afterSale === 1 && r.afterEbill === 1, 'texted as the bill is saved; choosing e-bill after does not text it again', JSON.stringify(r));
r = await run(false);
ok(r.afterSale === 0 && r.afterEbill === 1, 'with auto-text off, choosing e-bill sends it once', JSON.stringify(r));
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
