// Goods back off a credit customer's account, printed (9 Nov 2026: return 10236 printed "CHANGE RS. 5,090.80" as
// though cash went back, and the outstanding after the return as the previous balance — nothing seemed to come off).
//  · every bill design shows what came off the account, the outstanding before and after, and no change
// Nothing reaches a printer: the bills are drawn, not printed.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-returnbill.mjs
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
  const S = window.eval('S'), CFG = window.eval('CFG'), cs = window.eval('completeSale'), bal = id => window.eval('partyBal')('C', id); CFG.msg.autoBill = false;
  const c = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: 'STR', name: 'SAMPLE RETURN TRADERS', phone: '0700000003', level: 'retail', limit: 99999999 }; S.customers.push(c);
  const p = S.products.find(x => x.id !== window.eval('OPEN_PID') && +x.retail > 0); p.stock = Math.max(+p.stock || 0, 100);
  cs({ lines: [{ pid: p.id, qty: 10, price: 3264.83, disc: 0, belowCost: true }], customerId: c.id, pays: [{ method: 'CREDIT', amount: 0 }], override: true });
  const before = bal(c.id);
  const ret = cs({ lines: [{ pid: p.id, qty: -2, price: 2545.40, disc: 0 }], customerId: c.id, pays: [], toAccount: true, override: true });
  const afterBal = bal(c.id), out = {};
  for (const st of ['sepos', 'boxed', 'modern']) { CFG.bill.a5Style = st; const d = document.createElement('div'); d.innerHTML = window.eval('billHtml')(ret, 'a5'); out[st] = d.innerText.replace(/\s+/g, ' ') }
  { const d = document.createElement('div'); d.innerHTML = window.eval('billHtml')(ret, 'r80'); out.r80 = d.innerText.replace(/\s+/g, ' ') }
  const m = window.eval('money2');
  return { before: m(before), after: m(afterBal), back: m(-ret.total), out };
});
ok(r.before !== r.after, 'the account comes down by the return', JSON.stringify({ before: r.before, after: r.after, back: r.back }));
for (const [st, t] of Object.entries(r.out)) {
  const has = x => t.includes(x);
  ok(has(r.back) && /taken off/i.test(t) && !/change/i.test(t.replace(/exchange/ig, '')), `${st}: shows what came off the account, and no change`, t.slice(t.search(/taken off/i) - 60, t.search(/taken off/i) + 200));
  ok(has(r.before) && has(r.after) && t.indexOf(r.before) < t.lastIndexOf(r.after), `${st}: the outstanding before (${r.before}) and after (${r.after})`, t.slice(Math.max(0, t.search(/previous/i) - 20), t.search(/previous/i) + 200));
}
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
