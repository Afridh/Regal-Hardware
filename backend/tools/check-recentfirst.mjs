// Those billed lately come first in a search (10 Nov 2026, the owner asked): a customer who bought today before one
// who matches as well but has not, in the till's customer search, Put on account, Ctrl+M and the number window at
// the end of a bill; an item rung up today before the others that match, in the till's item search — an exact code
// still first. Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-recentfirst.mjs
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
await pg.waitForFunction(() => window.eval('S').products.filter(x => +x.retail > 0).length > 5, { timeout: 30000 }); await wait(1500);
const r = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval("CFG.print.agent=''");
  const S = window.eval('S'), CFG = window.eval('CFG'); CFG.msg.autoBill = false;
  const tag = 'ZQX' + Date.now().toString(36).slice(-4).toUpperCase(), nid = () => Math.max(...S.customers.map(x => x.id)) + 1;
  // A is first by name and by what it owes; B has bought today
  const A = { id: nid(), code: tag + 'A', name: tag + ' Builders Alpha', phone: '0700000011', level: 'retail', limit: 999999 }; S.customers.push(A);
  const B = { id: nid(), code: tag + 'B', name: tag + ' Builders Beta', phone: '0700000012', level: 'retail', limit: 999999 }; S.customers.push(B);
  const pid = () => Math.max(...S.products.map(x => +x.id || 0)) + 1, base = S.products.find(x => +x.retail > 0);
  const P1 = { ...base, id: pid(), code: tag + '1', num: '', short: '', barcode: '', name: tag + ' Hinge', stock: 50, active: true }; S.products.push(P1);
  const P2 = { ...base, id: pid(), code: tag + '2', num: '', short: '', barcode: '', name: tag + ' Hinge Brass 4in', stock: 50, active: true }; S.products.push(P2);
  const cs = window.eval('completeSale');
  cs({ lines: [{ pid: P1.id, qty: 1, price: 100, disc: 0, belowCost: true }], customerId: A.id, pays: [{ method: 'CREDIT', amount: 0 }], date: '2025-01-05', override: true });   // A: long ago
  cs({ lines: [{ pid: P2.id, qty: 1, price: 100, disc: 0, belowCost: true }], customerId: B.id, pays: [{ method: 'CASH', amount: 100 }], override: true });                     // B and P2: today
  const names = list => list.slice(0, 2).map(x => x.name);
  return { tag, A: A.name, B: B.name, P1: P1.name, P2: P2.name, P1code: P1.code,
    till: names(window.eval('csFind')(tag.toLowerCase() + ' hinge')), exact: window.eval('csFind')(P1.code.toLowerCase())[0]?.name };
});
ok(r.till[0] === r.P2, 'the till item search: the item billed today first', JSON.stringify(r.till));
ok(r.exact === r.P1, 'an exact code still comes first', r.exact);
// the till's customer search
await pg.evaluate(() => window.eval('pickCustomer')(() => {})); await wait(300);
await pg.type('#cq', r.tag.toLowerCase() + ' builders'); await wait(300);
const pick = await pg.evaluate(() => [...document.querySelectorAll('#cl [data-cid]')].slice(1, 3).map(x => x.querySelector('b').textContent));
ok(pick[0] === r.B && pick[1] === r.A, 'Customer on the bill: the one who bought today first', JSON.stringify(pick));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// Ctrl+M
await pg.evaluate(() => window.eval('credPayPick')()); await wait(300);
await pg.type('#cpQ', r.tag.toLowerCase()); await wait(300);
const cm = await pg.evaluate(() => [...document.querySelectorAll('.cpk-row b')].slice(0, 2).map(x => x.textContent));
ok(cm[0] === r.B, 'Ctrl+M search: the one who bought today first', JSON.stringify(cm));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// the number window at the end of a bill
await pg.evaluate(() => window.eval('askBillCustomer')(() => {})); await wait(300);
await pg.type('#bqQ', r.tag.toLowerCase()); await wait(300);
const bq = await pg.evaluate(() => [...document.querySelectorAll('#bqL [data-bqid] b')].slice(0, 2).map(x => x.textContent));
ok(bq[0] === r.B, "Customer's number: the one who bought today first", JSON.stringify(bq));
await pg.keyboard.press('Escape'); await wait(200);
// put on account
const acct = await pg.evaluate(tag => { window.eval('ONA = {q:"' + tag.toLowerCase() + '"}'); const l = window.eval('cpList')().slice(0, 2).map(c => c.name); window.eval('ONA = null'); return l }, r.tag);
ok(acct[0] === r.B, 'Put on account search: the one who bought today first', JSON.stringify(acct));
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
