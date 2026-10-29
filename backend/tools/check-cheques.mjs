// Cheques: the calendar of what to bank, a bounce whose bank charge goes on the customer's account, the
// count of their bounces, and the warning when a cheque is next taken from them.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-cheques.mjs [screenshot-dir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
const set = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove());
  window.__texts = []; window.sms = (to, body) => { window.__texts.push({ to, body }); return {} };
  const S = window.eval('S'), ago = window.eval('ago'), c = S.customers.find(x => x.id !== 1 && x.phone);
  c.bounces = 0; delete c.lastBounce; c.limit = 10000000;
  S.cheques = S.cheques.filter(x => !/^CHK-T/.test(x.no));
  S.cheques.push({ no: 'CHK-T1', dir: 'RECEIVED', status: 'RECEIVED', amount: 15000, date: ago(2), recvDate: ago(10), party: c.name, customerId: c.id, bank: 'HNB' });
  S.cheques.push({ no: 'CHK-T2', dir: 'RECEIVED', status: 'RECEIVED', amount: 8000, date: ago(-5), recvDate: ago(1), party: c.name, customerId: c.id, bank: 'BOC' });
  return { cid: c.id, name: c.name };
});

// the calendar
await pg.evaluate(() => window.eval('go')('chequesIn')); await wait(700);
const cal = await pg.evaluate(() => { const card = [...document.querySelectorAll('#main .card')].find(x => /Cheques to bank/.test(x.innerText)); return card ? card.innerText : '' });
ok(/Cheques to bank/.test(cal) && /to bank now/.test(cal), 'Cheques coming in: a calendar of what to bank, with what is due now', cal.split('\n')[1]);
ok(await pg.evaluate(() => document.querySelectorAll('.chq-cal-d.has').length >= 2 && !!document.querySelector('.chq-cal-d.has.past')), 'each cheque on its date; one past its date shows as to bank now');
await pg.screenshot({ path: OUT + '/cheques-calendar.png' });

// a bounce: the charge on their account, counted, texted
const sales0 = await pg.evaluate(() => window.eval('S').sales.length);
await pg.evaluate(() => window.eval('bounceModal')('CHK-T1', 'RECEIVED')); await wait(300);
await pg.evaluate(() => { const i = document.querySelector('#bcAmt'); i.value = '250' });
await pg.click('#bcOk'); await wait(600);
const after = await pg.evaluate(id => { const S = window.eval('S'), c = window.eval('C')(id), s = S.sales.slice(-1)[0];
  return { status: S.cheques.find(x => x.no === 'CHK-T1').status, bounces: c.bounces, n: S.sales.length, bill: { cust: s.customerId, name: (s.lines[0] || {}).name, balance: s.balance }, text: (window.__texts.slice(-1)[0] || {}).body || '' } }, set.cid);
ok(after.status === 'BOUNCED', 'the cheque is marked bounced');
ok(after.n === sales0 + 1 && after.bill.cust === set.cid && /Returned cheque charge — CHK-T1/.test(after.bill.name) && Math.abs(after.bill.balance - 250) < 0.01, 'the 250 bank charge goes on their account as a bill they owe', after.bill.name);
ok(after.bounces === 1, 'their bounces are counted');
ok(/returned by the bank/.test(after.text), 'and they are texted');

// the next cheque from them: warned
await pg.evaluate(id => window.eval('custPayModal')(id), set.cid); await wait(400);
await pg.evaluate(() => { const b = document.querySelector('.modal [data-pm="CHEQUE"]'); b && b.click() }); await wait(300);
const warn = await pg.evaluate(() => (document.querySelector('.modal .cp-warn') || {}).innerText || '');
ok(/1 cheque from them has bounced/.test(warn), 'taking a cheque from them again: the payment window warns', warn);
await pg.screenshot({ path: OUT + '/cheques-warn.png' });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
