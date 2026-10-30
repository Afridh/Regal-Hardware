// The black and red lists, and credit past the limit — the directors' (Super Admin, Owner, Admin) say only.
//  · a director puts a customer on the black list; a cashier picking them is told at once and cannot bill
//    them; asked from the till, a director's yes on Approvals lets one bill go, and only one
//  · someone with the "approve" right who is not a director cannot decide it
//  · past the limit on the On account panel: a cashier has no "Allow it", asks; a director's yes lets it go
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-lists.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/:41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'); window.__me = { role: S.user.role, perms: S.user.perms };
  window.asCashier = () => { S.user.role = 'Cashier'; S.user.perms = ['sell', 'approve', 'overLimit'] };     // may approve other things, and had "over limit"
  window.asBoss = () => { S.user.role = window.__me.role; S.user.perms = window.__me.perms } });

// 1. a director puts a customer on the black list, from their page
const cid = await pg.evaluate(() => { const S = window.eval('S'); const c = S.customers.find(x => x.id !== 1 && x.phone); c.limit = 1e8; delete c.list; window.eval('go')('customers'); window.eval('custSel=' + c.id); window.eval('render')(); return c.id });
await pg.evaluate(id => window.eval('custListModal')(id), cid); await wait(300);
await pg.click('[name=clL][value=black]'); await pg.type('#clWhy', 'cheques returned twice'); await pg.click('#clOk'); await wait(300);
ok(await pg.evaluate(id => window.eval('C')(id).list, cid) === 'black', 'a director puts them on the black list, with why');
await pg.screenshot({ path: process.env.SHOT || 'list-cust.png' });

// 2. a cashier picks them: told at once, and cannot bill them
const t1 = await pg.evaluate(id => { window.asCashier(); document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('go')('pos'); window.eval('setBillCustomer')(id); return 1 }, cid); await wait(400);
const told = await pg.evaluate(() => (document.querySelector('.modal') || {}).innerText || '');
ok(/black list/i.test(told) && /cheques returned twice/.test(told) && /Ask a director/.test(told), 'a cashier picking them is told at once — the list, why, and how through');
await pg.screenshot({ path: process.env.SHOT2 || 'list-till.png' });
const sell = (id) => pg.evaluate(id => { try { return window.eval('completeSale')({ lines: [{ pid: window.eval('OPEN_PID'), name: 'Test', qty: 1, price: 100, disc: 0, open: true }], customerId: id, pays: [{ method: 'CASH', amount: 100 }] }).no } catch (e) { return 'NO: ' + e.message } }, id);
let r = await sell(cid);
ok(/^NO: .*black list/.test(r), 'the cashier cannot bill them', r);
await pg.click('#lsAsk'); await wait(300);
const ap = await pg.evaluate(() => window.eval('S').approvals.find(a => a.kind === 'listBill' && a.status === 'pending'));
ok(!!ap, 'asked from the till: it waits on Approvals');
// someone allowed to approve other things, but not a director, cannot decide it
await pg.evaluate(id => window.eval('decideApproval')(id, true), ap.id);
ok(await pg.evaluate(id => window.eval('S').approvals.find(a => a.id === id).status, ap.id) === 'pending', 'a non-director with the approve right cannot decide it');
// a director says yes: one bill goes, the next does not
await pg.evaluate(id => { window.asBoss(); window.eval('decideApproval')(id, true); window.asCashier() }, ap.id);
r = await sell(cid);
ok(!/^NO/.test(r), "after a director's yes the cashier's bill goes", r);
const r2 = await sell(cid);
ok(/^NO/.test(r2), 'the yes was for one bill: the next is stopped again');
// a director bills them straight away (with it written in the trail)
r = await pg.evaluate(id => { window.asBoss(); try { const inv = window.eval('completeSale')({ lines: [{ pid: window.eval('OPEN_PID'), name: 'Test', qty: 1, price: 100, disc: 0, open: true }], customerId: id, pays: [{ method: 'CASH', amount: 100 }] }); return inv.listBy } catch (e) { return 'NO ' + e.message } }, cid);
ok(r === 'Afridh', 'a director bills them, and the bill says who allowed it', r);

// 3. past the limit on the On account panel
const lim = await pg.evaluate(() => { const S = window.eval('S'); const c = S.customers.find(x => x.id !== 1 && !x.list && window.eval('partyBal')('C', x.id) > 0); c.limit = 1;
  window.asCashier(); document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('go')('pos');
  S.pos.lines = [{ pid: window.eval('OPEN_PID'), name: 'Roof sheets', qty: 1, price: 5000, disc: 0, open: true }]; S.pos.customer = c.id; window.eval('render')(); window.eval('creditSale')(); return c.id });
await wait(500);
let panel = await pg.evaluate(() => ({ allow: !!document.querySelector('[data-cp="allow"]'), ask: !!document.querySelector('[data-cp="askdir"]'), saveOff: document.querySelector('[data-cp="save"]').disabled }));
ok(!panel.allow && panel.ask && panel.saveOff, 'past the limit, a cashier (even one who had "over limit") gets no Allow — only PIN or Ask', JSON.stringify(panel));
await pg.$eval('[data-cp="askdir"]', b => b.click()); await wait(300);
const ap2 = await pg.evaluate(() => window.eval('S').approvals.find(a => a.kind === 'overLimit' && a.status === 'pending'));
ok(!!ap2, 'asked: it waits on Approvals', ap2 && ap2.title);
await pg.evaluate(id => { window.asBoss(); window.eval('decideApproval')(id, true); window.asCashier(); window.eval('cpDraw')(true) }, ap2.id); await wait(300);
panel = await pg.evaluate(() => ({ text: document.querySelector('.cp-modal').innerText, saveOff: document.querySelector('[data-cp="save"]').disabled }));
ok(/allowed by Afridh/.test(panel.text) && !panel.saveOff, "after a director's yes the panel says allowed by them, and the bill can be saved");
await pg.evaluate(() => { window.asBoss(); const S = window.eval('S'); S.customers.forEach(c => { if (c.list) delete c.list }); document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('cpClose')(); S.pos.lines = []; S.pos.customer = null; window.eval('persist')(true) });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
