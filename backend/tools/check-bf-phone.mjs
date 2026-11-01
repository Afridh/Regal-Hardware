// Previous balances are not bills, and a bill is texted to the customer's number as it is now.
//  · a previous balance brought forward: not on the Bills list, not in the bill count or the customer's bills;
//    shown as "Previous balance" on their page; still owed, paid off by a payment, and in the debtors report
//  · a customer's mobile changed after a bill was texted: "Text e-bill" on that old bill goes to the new number
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-bf-phone.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
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
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// 1. a previous balance for a customer
const bf = await pg.evaluate(() => { const S = window.eval('S'); const c = S.customers.find(x => x.id !== 1 && x.active !== false);
  const before = { bal: window.eval('partyBal')('C', c.id), bills: window.eval('billList')().length };
  const no = window.eval('openBalAdd')('C', c.id, 12345, window.eval('D')(window.eval('today')), 'old book page 4');
  window.eval("billQ=''; billType='all'; billFrom=''; billTo=''; billCust=0");
  return { cid: c.id, no, before, bal: window.eval('partyBal')('C', c.id), bills: window.eval('billList')().length, inList: window.eval('billList')().some(s => s.no === no) } });
ok(Math.abs(bf.bal - bf.before.bal - 12345) < 0.01, 'the previous balance is owed: outstanding up by 12,345', JSON.stringify({ was: bf.before.bal, now: bf.bal }));
ok(!bf.inList && bf.bills === bf.before.bills, 'it is not on the Bills list, and the bill count is unchanged', JSON.stringify({ bills: bf.bills, was: bf.before.bills }));
const page = await pg.evaluate(c => { window.eval('custSel=' + c); window.eval("custTab='overview'"); window.eval('go')('customers'); const t = document.querySelector('#main').innerText;
  const inv = window.eval('S').sales.filter(s => s.customerId === c && !window.eval('isBF')(s)); return { t: t.slice(0, 4000), shown: /Previous balance/.test(t) && /12,345/.test(t), bfInBills: window.eval('S').sales.filter(s => s.customerId === c && !window.eval('isBF')(s)).some(s => /^BF/.test(s.no)) } }, bf.cid);
ok(page.shown && !page.bfInBills, 'their page shows "Previous balance Rs 12,345", kept apart from the bills');
const rep = await pg.evaluate(c => { const r = window.eval('S').sales.filter(s => s.customerId === c && s.balance > 0.005); return r.some(s => window.eval('isBF')(s)) }, bf.cid);
ok(rep, 'it is still an open amount a payment can clear and the debtors reports count');
const paid = await pg.evaluate(c => { const owed = window.eval('partyBal')('C', c); window.eval('receiveCustomer')({ customerId: c, amount: owed, method: 'CASH' }); return { left: window.eval('partyBal')('C', c), bfLeft: window.eval('bfOf')('C', c).reduce((a, x) => a + x.balance, 0) } }, bf.cid);
ok(Math.abs(paid.left) < 0.01 && paid.bfLeft < 0.01, 'a payment clears it', JSON.stringify(paid));

// 2. the number changed after a bill was texted
const ph = await pg.evaluate(() => { const S = window.eval('S'); const inv = S.sales.filter(s => s.customerId !== 1 && !window.eval('isBF')(s) && s.lines.length).slice(-1)[0]; const c = window.eval('C')(inv.customerId);
  inv.phone = '0771111111'; c.phone = '0772222222';      // texted to the old number once; the card now says the new one
  const sent = []; window.sms = (to) => sent.push(to); window.wa = (to) => sent.push('wa:' + to); window.sendBillView = () => {};
  window.eval('billSel=' + JSON.stringify(inv.no)); window.eval('go')('bills');
  const btn = document.querySelector(`[data-act="billSms"][data-no="${inv.no}"]`); const tip = btn && btn.title; btn && btn.click();
  const wbtn = document.querySelector(`[data-act="billWa"][data-no="${inv.no}"]`); wbtn && wbtn.click();
  return { sent, tip, btn: !!btn } });
ok(ph.btn && ph.sent[0] === '0772222222', 'Text e-bill on an old bill goes to the customer\'s new number', JSON.stringify(ph));
ok(ph.sent[1] === 'wa:0772222222', 'WhatsApp too', JSON.stringify(ph.sent));
ok(/0772222222/.test(ph.tip || ''), 'the button says the new number', ph.tip);
await pg.evaluate(() => window.eval('persist')(true)); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
