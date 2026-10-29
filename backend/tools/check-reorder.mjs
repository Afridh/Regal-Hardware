// Smart reorder: an item selling 1 a day with 5 on the floor is ordered for delivery time + two weeks;
// the supplier's list becomes a supplier order; dead stock and a cost rise are found.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-reorder.mjs [screenshot-dir]
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

// a history the test controls: item A sells 1 a day (60 in 60 days), 5 on the floor, bought from one
// supplier twice — the last time 10% dearer; item B has stock and has not sold for 120 days
const set = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'), ago = window.eval('ago'), CFG = window.eval('CFG');
  CFG.reorder = { days: 60, cover: 14, lead: 7, dead: 90 };
  const ps = S.products.filter(p => p.active !== false && !p.open && p.retail > 200);
  const A = ps[0], B = ps[1], sup = S.suppliers[0]; sup.leadDays = 7;
  A.stock = 5; A.min = 2; A.retail = 1000; B.stock = 7; B.min = 20;
  S.orders = (S.orders || []).filter(o => !(o.lines || []).some(l => l.pid === A.id));
  // take A and B off every other bill and purchase, so only the test's history counts
  S.sales.forEach(s => { s.lines = (s.lines || []).filter(l => l.pid !== A.id && l.pid !== B.id) });
  S.purchases.forEach(pu => { pu.lines = (pu.lines || []).filter(l => l.pid !== A.id && l.pid !== B.id) });
  for (let d = 1; d <= 60; d++) S.sales.push({ no: 'RO' + d, date: ago(d), customerId: 1, type: 'CASH', total: 1000, balance: 0, lines: [{ pid: A.id, qty: 1, price: 1000, disc: 0 }] });
  S.sales.push({ no: 'ROB', date: ago(120), customerId: 1, type: 'CASH', total: 500, balance: 0, lines: [{ pid: B.id, qty: 1, price: 500, disc: 0 }] });
  S.purchases.push({ no: 'ROP1', date: ago(50), supplierId: sup.id, lines: [{ pid: A.id, qty: 30, cost: 600 }] });
  S.purchases.push({ no: 'ROP2', date: ago(10), supplierId: sup.id, lines: [{ pid: A.id, qty: 30, cost: 660 }] });
  return { A: A.id, B: B.id, sup: sup.id, supName: sup.name };
});

const RO = await pg.evaluate(() => { const r = window.eval('reorderData')(); return { lines: r.lines.map(x => ({ id: x.p.id, qty: x.qty, days: x.days, sup: x.sup && x.sup.id })), dead: r.dead.map(x => x.p.id), costs: r.costs.map(x => ({ id: x.p.id, up: x.up, mWas: x.mWas, mNow: x.mNow, keep: x.keep })) } });
const a = RO.lines.find(x => x.id === set.A);
ok(!!a && a.qty === 16, 'item A (1 a day, 5 on the floor, 7 days to come + 14 to hold) → order 16', a && `qty ${a.qty}`);
ok(!!a && a.days === 5 && a.sup === set.sup, 'it says it lasts 5 days, and who to order it from', a && `${a.days} days`);
ok(RO.dead.includes(set.B), 'item B (not sold for 120 days) is under Not selling');
ok(!RO.lines.some(x => x.id === set.B), 'and is not suggested for ordering, even under its reorder level');
const c = RO.costs.find(x => x.id === set.A);
ok(!!c && Math.abs(c.up - 10) < 0.01 && Math.abs(c.mWas - 40) < 0.01 && Math.abs(c.mNow - 34) < 0.01 && c.keep === 1100, 'its cost went up 10%: profit 40% → 34%, and 1,100 keeps the 40%', c && JSON.stringify(c));

// the page and the order
await pg.evaluate(() => { window.eval('purchTab = "order"'); window.eval('go')('purchasing') }); await wait(700);
ok(/What to order/.test(await pg.evaluate(() => document.getElementById('main').innerText)), 'Purchasing has What to order, Not selling, Costs gone up');
await pg.screenshot({ path: OUT + '/reorder-order.png' });
await pg.evaluate(sid => document.querySelector(`[data-act="roMake"][data-id="${sid}"]`).click(), set.sup); await wait(600);
const po = await pg.evaluate(() => { const d = window.poState(); return d && { sid: d.sid, lines: d.lines.map(l => ({ pid: l.pid, qty: l.qty })) } });
ok(!!po && po.sid === set.sup && po.lines.some(l => l.pid === set.A && l.qty === 16), 'Make the order: a supplier order opens with the line on it, to check and send', po && JSON.stringify(po.lines.slice(0, 3)));
await pg.screenshot({ path: OUT + '/reorder-po.png' });
await pg.evaluate(() => { window.eval('ordClose')(); window.eval('poDraft = null') }).catch(() => {});
for (const tab of ['dead', 'costs']) { await pg.evaluate(t => { window.eval(`purchTab = "${t}"`); window.eval('go')('purchasing') }, tab); await wait(400); await pg.screenshot({ path: `${OUT}/reorder-${tab}.png` }) }
ok(/Keeps the profit/.test(await pg.evaluate(() => document.getElementById('main').innerText)), 'Costs gone up shows the price that keeps the profit');
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
