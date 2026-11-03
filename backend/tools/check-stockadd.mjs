// Adding stock from the item itself.
//  · the product updater has "＋ Add stock" (and F4): goods came in — 5 at a cost, from a supplier, on their
//    account — is a real purchase: stock +5, the supplier owed, and the updater comes back with the new figure
//  · the records grid: F4 on the picked row opens it; "Correct the count" sets what is on the shelf (a stock take)
//  · someone whose stock adjustments need approval: it is sent for approval and the stock waits
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-stockadd.mjs
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
// in the page only, never saved
const s0 = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {};
  const S = window.eval('S'); window.__keep = JSON.stringify({ products: S.products, purchases: S.purchases, journal: S.journal, movements: S.movements, stocktakes: S.stocktakes, approvals: S.approvals || [] }); window.__user = S.user;
  const p = S.products.find(x => x.active !== false && x.stock > 10 && !x.serialised); const sup = S.suppliers.find(x => x.active !== false);
  window.eval('go')('inventory'); return { pid: p.id, stock: p.stock, cost: p.cost, sid: sup.id, owed: window.eval('partyBal')('S', sup.id), np: S.purchases.length } });
const stock = () => pg.evaluate(id => window.eval('P')(id).stock, s0.pid);
const nonPu = () => pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => { if (!m.querySelector('.pu-box')) m.remove() }));
// 1. from the updater
await pg.evaluate(id => window.eval('productModal')(id, { pu: true }), s0.pid); await wait(300);
ok(!!(await pg.$('#puStock')) && !!(await pg.$('#puStock2')), 'the product updater has "＋ Add stock" (by the stock figure and at the foot)');
await pg.click('#puStock2'); await wait(300);
ok(!!(await pg.$('#saQty')) && !(await pg.$('.pu-box')), 'it opens Add stock for this item');
await pg.type('#saQty', '5'); await pg.evaluate(sid => { document.getElementById('saSup').value = String(sid) }, s0.sid);
ok(/→ /.test(await pg.evaluate(() => document.getElementById('saSay').innerText)), 'it says what the stock will become');
await pg.click('#saOk'); await wait(600);
const after = await pg.evaluate(s => { const S = window.eval('S'); const pur = S.purchases[S.purchases.length - 1];
  return { n: S.purchases.length, sup: pur.supplierId, line: pur.lines[0] && { pid: pur.lines[0].pid, qty: pur.lines[0].qty }, owed: window.eval('partyBal')('S', s.sid), back: !!document.querySelector('.pu-box'), labels: [...document.querySelectorAll('.modal')].some(m => !m.querySelector('.pu-box')) } }, s0);
ok(after.n === s0.np + 1 && after.sup === s0.sid && after.line.pid === s0.pid && after.line.qty === 5, 'goods came in: a purchase from that supplier, 5 of the item', JSON.stringify(after));
ok(Math.abs((await stock()) - (s0.stock + 5)) < 1e-6, 'stock +5');
ok(after.owed > s0.owed + 0.005, 'on their account: the supplier is owed more', `${s0.owed} → ${after.owed}`);
ok(after.back && after.labels, 'the updater comes back with the new figure, and the labels are asked for');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// 2. from the grid: F4 and correct the count
await pg.evaluate(id => { window.eval('PR').sel = id; window.eval('go')('inventory'); window.eval('render')() }, s0.pid); await wait(300);
await pg.evaluate(() => document.activeElement && document.activeElement.blur()); await pg.keyboard.press('F4'); await wait(300);
ok(!!(await pg.$('#saQty')), 'F4 on the picked row opens Add stock');
await pg.click('[data-sa="fix"]'); const st1 = await stock();
await pg.evaluate(() => { const i = document.getElementById('saBy'); i.value = '-2'; i.dispatchEvent(new Event('input')) });
await pg.type('#saWhy', 'two broken'); await pg.click('#saOk'); await wait(500); await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const st2 = await stock(); const stk = await pg.evaluate(() => { const S = window.eval('S'); const t = S.stocktakes[S.stocktakes.length - 1]; return t && t.note });
ok(Math.abs(st2 - (st1 - 2)) < 1e-6 && /two broken/.test(stk || ''), 'correct the count: −2 booked as a stock take', `${st1} → ${st2} · ${stk}`);
// 3. someone who needs approval
await pg.evaluate(() => { const S = window.eval('S'); S.user = { ...window.__user, name: 'Stock Kid', role: 'Cashier', perms: ['receive'] } });
await pg.evaluate(id => window.eval('stockAddModal')(id), s0.pid); await wait(300);
await pg.click('[data-sa="fix"]');
await pg.evaluate(() => { const i = document.getElementById('saBy'); i.value = '3'; i.dispatchEvent(new Event('input')) });
const btn = await pg.evaluate(() => document.getElementById('saOk').innerText);
await pg.click('#saOk'); await wait(400);
const ap = await pg.evaluate(() => { const S = window.eval('S'); const a = (S.approvals || [])[0]; return a && { kind: a.kind, status: a.status, title: a.title } });
ok(/approval/i.test(btn) && ap && ap.kind === 'stockAdj' && ap.status === 'pending' && Math.abs((await stock()) - st2) < 1e-6, 'needs approval: sent for approval, the stock waits', JSON.stringify(ap));
await pg.evaluate(() => { const S = window.eval('S'); Object.assign(S, JSON.parse(window.__keep)); S.user = window.__user; document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('render')() });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
