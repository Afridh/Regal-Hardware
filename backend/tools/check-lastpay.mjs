// Two payments from a customer on the same day: the one taken last is the "Last payment", and comes first.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-lastpay.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
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
const r = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'); const c = S.customers.find(x => x.id !== 1 && window.eval('partyBal')('C', x.id) > 80000);
  window.eval('receiveCustomer')({ customerId: c.id, amount: 50000, method: 'CASH', quiet: true });
  window.eval('receiveCustomer')({ customerId: c.id, amount: 20000, method: 'CASH', quiet: true });
  window.eval('recSel=' + c.id); window.eval("recQ=''"); window.eval('go')('receipts');
  const t1 = document.querySelector('#main').innerText;
  const last = (t1.match(/Last payment\s*Rs ([\d,.]+)/) || [])[1];
  const firstRow = [...document.querySelectorAll('#main table')].find(x => /Receipt/.test(x.innerText)).querySelectorAll('tr')[1].innerText;
  window.eval('custSel=' + c.id); window.eval("custTab='overview'"); window.eval('go')('customers');
  const t2 = document.querySelector('#main').innerText;
  const last2 = (t2.match(/Last payment\s*Rs ([\d,.]+)/i) || [])[1];
  window.eval("recSel=null"); window.eval('go')('receipts');
  const row = (document.querySelector(`.rec-owe tr[data-id="${c.id}"]`) || {}).innerText || '';
  return { last, firstRow, last2, row } });
ok(r.last === '20,000.00', 'Take a payment: Last payment is the Rs 20,000 taken after the Rs 50,000', r.last);
ok(/20,000\.00/.test(r.firstRow), 'and it is first under Payments received before', r.firstRow.replace(/\s+/g, ' '));
ok(r.last2 === '20,000.00', 'the customer\'s record says the same', r.last2);
ok(/Rs 20,000\.00/.test(r.row), 'the Who owes list shows it as the last paid', r.row.replace(/\s+/g, ' ').slice(0, 120));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
