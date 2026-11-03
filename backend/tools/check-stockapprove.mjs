// Every stock adjustment waits for an admin.
//  · a Manager allowed to approve other things: adding stock on an item still goes to Approvals, and the
//    Manager cannot approve it; an Admin approves it and the stock goes up
//  · a Cashier writing goods off as damaged: sent for approval, the stock waits; approved, written off
//  · an Admin adjusting: straight through
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-stockapprove.mjs
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
const s0 = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {};
  const S = window.eval('S'); window.__keep = JSON.stringify({ products: S.products, journal: S.journal, movements: S.movements, stocktakes: S.stocktakes, damages: S.damages, approvals: S.approvals || [] }); window.__user = S.user;
  const p = S.products.find(x => x.active !== false && x.stock > 10 && !x.serialised); return { pid: p.id } });
const stock = () => pg.evaluate(id => window.eval('P')(id).stock, s0.pid);
const as = (role, perms) => pg.evaluate((role, perms) => { const S = window.eval('S'); S.user = role ? { ...window.__user, name: role + ' Tester', role, perms } : window.__user }, role, perms);
const lastAp = () => pg.evaluate(() => { const a = (window.eval('S').approvals || [])[0]; return a && { id: a.id, kind: a.kind, status: a.status, title: a.title } });
// 1. a Manager who may approve other things
await as('Manager', ['approve', 'receive', 'cost', 'products_view']);
const st0 = await stock();
ok(await pg.evaluate(() => window.eval('canApprove')() && window.eval('stockAsk')()), 'a Manager who approves other things still has to ask for a stock adjustment');
await pg.evaluate(id => window.eval('stockAddModal')(id), s0.pid); await wait(300);
await pg.type('#saQty', '4'); await pg.click('#saOk'); await wait(400);
let ap = await lastAp();
ok(ap && ap.kind === 'stockAdj' && ap.status === 'pending' && Math.abs((await stock()) - st0) < 1e-6, 'Manager adds 4: sent for approval, the stock waits', JSON.stringify(ap));
await pg.evaluate(id => window.eval('decideApproval')(id, true, ''), ap.id); await wait(200);
ok((await lastAp()).status === 'pending' && Math.abs((await stock()) - st0) < 1e-6, 'the Manager cannot approve it');
await as(null);
await pg.evaluate(id => window.eval('decideApproval')(id, true, ''), ap.id); await wait(200);
ok((await lastAp()).status === 'approved' && Math.abs((await stock()) - (st0 + 4)) < 1e-6, 'an Admin approves it: +4', `${st0} → ${await stock()}`);
// 2. a Cashier writing goods off
await as('Cashier', ['receive']);
const st1 = await stock(), dm0 = await pg.evaluate(() => window.eval('S').damages.length);
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('dmgModal')() }); await wait(300);
await pg.evaluate(id => { document.getElementById('dp').value = String(id); document.getElementById('dq').value = '2' }, s0.pid);
await pg.click('#dok'); await wait(400);
ap = await lastAp();
ok(ap.kind === 'stockAdj' && ap.status === 'pending' && /Write off 2/.test(ap.title) && Math.abs((await stock()) - st1) < 1e-6 && (await pg.evaluate(() => window.eval('S').damages.length)) === dm0, 'a Cashier writing 2 off: sent for approval, nothing written off yet', ap.title);
await as(null);
await pg.evaluate(id => window.eval('decideApproval')(id, true, ''), ap.id); await wait(200);
ok(Math.abs((await stock()) - (st1 - 2)) < 1e-6 && (await pg.evaluate(() => window.eval('S').damages.length)) === dm0 + 1, 'approved: written off, stock −2');
// 3. an Admin: straight through
const st2 = await stock(), na = await pg.evaluate(() => (window.eval('S').approvals || []).length);
await pg.evaluate(id => window.eval('stockAddModal')(id), s0.pid); await wait(300);
await pg.type('#saQty', '1'); await pg.click('#saOk'); await wait(400);
ok(Math.abs((await stock()) - (st2 + 1)) < 1e-6 && (await pg.evaluate(() => (window.eval('S').approvals || []).length)) === na, 'an Admin adjusting: straight through, no approval');
await pg.evaluate(() => { const S = window.eval('S'); Object.assign(S, JSON.parse(window.__keep)); S.user = window.__user; document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('render')() });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
