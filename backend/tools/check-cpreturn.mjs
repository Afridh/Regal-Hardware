// Goods back on the till, taken off a credit customer's account.
//  · a bill below nought (an item at −1) put on account: the panel says "Take 300.00 off their account",
//    with what they owe before and after, and it can be saved
//  · saved: their outstanding comes down by 300, the stock comes back, the return is on their account
//  · more back than they owe: the rest is held as their credit
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-cpreturn.mjs
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
const setup = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {}; window.printPaper = () => {};
  const S = window.eval('S'), C = window.eval('CFG'); window.__keep = JSON.stringify({ sales: S.sales, journal: S.journal, customers: S.customers, products: S.products, movements: S.movements, messages: S.messages });
  C.done.askSize = false; C.done.printAnim = false; C.done.preview = false;
  const bal = window.eval('partyBal'); const c = S.customers.find(x => x.id !== 1 && bal('C', x.id) > 400) || S.customers.find(x => x.id !== 1);
  const p = S.products.find(x => x.active !== false && x.stock > 5 && !(x.tiers || []).length);
  return { cid: c.id, name: c.name, owes: bal('C', c.id), pid: p.id, stock: p.stock } });
const owes0 = setup.owes;
const panel = async (qty, price) => { await pg.evaluate((s, qty, price) => { const S = window.eval('S'); window.eval('go')('pos'); S.pos.lines = [{ pid: s.pid, qty, price, disc: 0 }]; S.pos.customer = s.cid; window.eval('render')(); window.eval('creditSale')() }, setup, qty, price);
  await wait(300); await pg.evaluate(cid => window.eval('cpPick')(cid), setup.cid); await wait(200);
  return pg.evaluate(() => { const b = document.querySelector('.cp-modal [data-cp="save"]'); return { text: b && b.innerText.replace(/\s+/g, ' '), disabled: b && b.disabled, figs: (document.querySelector('.cp-modal .cp-figs') || {}).innerText } }) };
const p1 = await panel(-1, 300);
ok(p1.text && /Take 300\.00 off their account/.test(p1.text) && !p1.disabled, 'a bill of −300 put on account: "Take 300.00 off their account", and it can be saved', JSON.stringify(p1));
await pg.evaluate(() => window.eval('cpSave')()); await wait(700); await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const after = await pg.evaluate(s => { const S = window.eval('S'); const inv = S.sales[S.sales.length - 1]; return { owes: window.eval('partyBal')('C', s.cid), total: inv.total, toAccount: inv.toAccount, cust: inv.customerId, stock: window.eval('P')(s.pid).stock, open: !!document.querySelector('.cp-modal') } }, setup);
ok(after.total === -300 && after.toAccount === 300 && after.cust === setup.cid && !after.open, 'saved as a return on their account', JSON.stringify(after));
ok(Math.abs(after.owes - (owes0 - 300)) < 0.01, `their outstanding comes down by 300 (${owes0} → ${after.owes})`);
ok(Math.abs(after.stock - (setup.stock + 1)) < 0.001, 'the item is back in stock');
// more back than they owe: the rest is held as their credit
const big = +(after.owes + 500).toFixed(2);
const p2 = await panel(-1, big);
ok(/held as their credit/.test(await pg.evaluate(() => document.querySelector('.cp-modal').innerText)), 'more back than they owe: the panel says the rest is held as their credit');
await pg.evaluate(() => window.eval('cpSave')()); await wait(700); await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const held = await pg.evaluate(s => ({ owes: window.eval('partyBal')('C', s.cid), credit: window.eval('custCredit')(s.cid) }), setup);
ok(Math.abs(held.owes) < 0.01 && Math.abs(held.credit - 500) < 0.01, 'they owe nothing, and 500 is held as their credit', JSON.stringify(held));
await pg.evaluate(() => { const S = window.eval('S'); Object.assign(S, JSON.parse(window.__keep)); S.pos.lines = []; S.pos.customer = null; window.eval('render')() });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
