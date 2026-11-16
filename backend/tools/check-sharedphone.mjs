// One mobile number on two customers (16 Nov 2026, the owner asked): asked about, then allowed —
//   Customers → Add customer, the till's "Customer's number" box (+ Someone else on this number), and repair jobs pick by name.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-sharedphone.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 860 });
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
await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(1000);
const PH = '0770009' + String(Date.now()).slice(-3);
const first = await pg.evaluate((ph) => { const S = window.eval('S'); const id = Math.max(...S.customers.map(c => c.id)) + 1;
  S.customers.push({ id, code: 'CT' + id, name: 'Shared Phone One', phone: ph, level: 'retail', limit: 0, address: '' }); return id }, PH);
// Customers → Add customer with the same number
await pg.evaluate(() => window.eval('custModal')()); await wait(300);
await pg.type('#cmName', 'Shared Phone Two'); await pg.type('#cmPhone', PH);
const asked = []; pg.removeAllListeners('dialog'); pg.on('dialog', d => { asked.push(d.message()); d.accept() });
await pg.$eval('#cmOk', e => e.click()); await wait(400);
let r = await pg.evaluate(ph => window.eval('S').customers.filter(c => c.phone === ph).map(c => c.name), PH);
ok(asked.length === 1 && /Shared Phone One already has/.test(asked[0]), 'Add customer asks first, naming who has the number', JSON.stringify(asked));
ok(r.length === 2 && r.includes('Shared Phone Two'), 'and then both customers have the number', JSON.stringify(r));
// saying no keeps it off
await pg.evaluate(() => window.eval('custModal')()); await wait(300);
await pg.type('#cmName', 'Shared Phone Three'); await pg.type('#cmPhone', PH);
pg.removeAllListeners('dialog'); pg.on('dialog', d => d.dismiss());
await pg.$eval('#cmOk', e => e.click()); await wait(300);
r = await pg.evaluate(ph => window.eval('S').customers.filter(c => c.phone === ph).length, PH);
ok(r === 2 && !!(await pg.$('#cmName')), 'saying no keeps the form open and adds nobody');
await pg.evaluate(() => window.eval('closeModals')());
// the till's customer box: the number shows both, and a third can be added on it
await pg.evaluate(() => window.eval('askBillCustomer')(() => {})); await wait(300);
await pg.type('#bqQ', PH); await wait(300);
const rows = await pg.$$eval('[data-bqid]', e => e.length);
ok(rows === 2 && !!(await pg.$('#bqOther')), 'the till lists both on that number, with "+ Someone else on this number"', rows);
await pg.$eval('#bqOther', e => e.click()); await pg.type('#bqNm', 'Shared Phone Four');
pg.removeAllListeners('dialog'); pg.on('dialog', d => d.accept());
await pg.$eval('#bqAdd', e => e.click()); await wait(400);
r = await pg.evaluate(ph => { const S = window.eval('S'); return [S.customers.filter(c => c.phone === ph).length, window.eval('C')(S.pos.customer).name] }, PH);
ok(r[0] === 3 && r[1] === 'Shared Phone Four', 'a new name on that number is a new customer, and the bill goes to them', JSON.stringify(r));
// a repair job with that number finds the one with that name
r = await pg.evaluate(ph => { const S = window.eval('S'), j = window.eval('jobCustomer'); return [window.eval('C')(j({ who: 'Shared Phone Two', phone: ph })).name, window.eval('C')(j({ who: 'Shared Phone One', phone: ph })).name] }, PH);
ok(r[0] === 'Shared Phone Two' && r[1] === 'Shared Phone One', 'a repair job picks the customer with that name', JSON.stringify(r));
// tidy up
await pg.evaluate(ph => { const S = window.eval('S'); S.customers = S.customers.filter(c => c.phone !== ph); S.pos.customer = 1; window.eval('persist')(true) }, PH);
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
