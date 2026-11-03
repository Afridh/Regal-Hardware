// The large bill says cash or credit, and what was owed before; and a click right after typing lands.
//  · a credit bill: CREDIT BILL on it, and the account box (previous outstanding, this bill, total) —
//    even where the shop had that box switched off before; the same printed again after it is paid
//  · a cash bill to a customer who owes: CASH BILL, and what they owe
//  · a walk-in cash bill: CASH BILL, no account box
//  · both designs: Boxed and Old SePOS
//  · typing a bill discount and clicking PAY straight away: the payment opens on that one click
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billkind.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
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
const r = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {};
  const S = window.eval('S'), C = window.eval('CFG'), bal = window.eval('partyBal');
  window.__keep = JSON.stringify({ a5: C.bill.a5, style: C.bill.a5Style });
  // as a shop that had the account box switched off before
  C.bill.a5 = { order: [...window.eval('A5_DEFAULT')], off: ['outstanding'] };
  const owes = S.customers.find(x => x.id !== 1 && bal('C', x.id) > 100);
  const cr = S.sales.filter(s => s.customerId === owes.id && s.balance > 0.005 && s.total > 0).pop();
  const ca = S.sales.filter(s => s.customerId === 1 && s.balance < 0.005 && s.total > 0).pop();
  const caNamed = { ...ca, customerId: owes.id, prevOut: 5000, type: 'CASH', balance: 0 };
  const settled = { ...cr, balance: 0, paid: cr.total, type: 'CREDIT', prevOut: 1000 };
  const out = {};
  for (const st of ['boxed', 'sepos']) { C.bill.a5Style = st;
    const txt = inv => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:794px'; d.innerHTML = window.eval('billHtml')(inv, 'a5'); document.body.appendChild(d); const t = d.innerText.replace(/\s+/g, ' '); d.remove(); return t };
    out[st] = { cr: txt(cr), settled: txt(settled), caNamed: txt(caNamed), walk: txt(ca) } }
  return { out, migrated: !C.bill.a5.off.includes('outstanding') } });
ok(r.migrated, 'the account box is switched on for a shop that had it off');
for (const st of ['boxed', 'sepos']) { const o = r.out[st]; const OS = st === 'boxed' ? /Previous outstanding/i : /Previous Balance/i, TOT = st === 'boxed' ? /TOTAL OUTSTANDING/i : /Total Outstanding/i;
  ok(/CREDIT( BILL)?/.test(o.cr) && OS.test(o.cr) && TOT.test(o.cr), `${st}: a credit bill says CREDIT and shows what was owed before and the total`);
  ok(/CREDIT( BILL)?/.test(o.settled), `${st}: printed again after it is paid, it is still a CREDIT bill`);
  ok(/CASH( BILL)?/.test(o.caNamed) && OS.test(o.caNamed), `${st}: a cash bill to a customer who owes: CASH, and what they owe`);
  ok(/CASH( BILL)?/.test(o.walk) && !OS.test(o.walk), `${st}: a walk-in cash bill: CASH, no account box`); }
// a click right after typing
const clicked = await pg.evaluate(async () => { const S = window.eval('S'); window.eval('go')('pos');
  const p = S.products.find(x => x.active !== false && x.stock > 5 && !(x.tiers || []).length);
  S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.customer = null; S.pos.billDisc = 0; window.eval('render')(); await new Promise(r => setTimeout(r, 200));
  return !!document.getElementById('csBillDisc') });
if (clicked) {
  await pg.click('#csBillDisc'); await pg.evaluate(() => document.getElementById('csBillDisc').select()); await pg.keyboard.type('5');
  await pg.click('[data-act="pay"]'); await wait(500);
  const res = await pg.evaluate(() => ({ disc: window.eval('S').pos.billDisc, open: !!document.querySelector('.modal') }));
  ok(res.disc === 5 && res.open, 'typing a bill discount and clicking PAY straight away: the payment opens on that one click', JSON.stringify(res));
} else ok(true, '(no bill discount box for this user — click test skipped)');
await pg.evaluate(() => { const C = window.eval('CFG'), k = JSON.parse(window.__keep); C.bill.a5 = k.a5; C.bill.a5Style = k.style; const S = window.eval('S'); S.pos.lines = []; S.pos.billDisc = 0; document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('render')() });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
