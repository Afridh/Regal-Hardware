// A bill that printed but is not in the books: found in the server's saved copies and put back.
//  · a cash bill is made and saved; then lost (taken out of the books and saved again, as a lost save would)
//  · Bills → "Find a missing bill" (admins only) finds it by number in the server's copies, with the save
//    that went without it, and "Put it back" restores the bill, its stock movements (stock down again) and
//    its journal entries (the drawer)
//  · a bill that is in the books is said to be there; a number never used is said to be nowhere
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-findbill.mjs
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
// 1. a cash bill, saved
const made = await pg.evaluate(async () => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {};
  const S = window.eval('S'), C = window.eval('CFG'); C.done.askSize = false; C.done.printAnim = false; C.done.preview = false; window.eval('CS').paper = 'none';
  const p = S.products.find(x => x.active !== false && x.stock > 10 && !(x.tiers || []).length);
  S.pos.lines = [{ pid: p.id, qty: 2, price: p.retail, disc: 0 }]; S.pos.customer = null;
  const inv = window.eval('finishTillBill')({ cust: window.eval('C')(1), pays: [{ method: 'CASH', amount: +(2 * p.retail).toFixed(2) }] });
  window.eval('persist')(true); return { no: inv.no, pid: p.id, stockAfter: p.stock, total: inv.total, cash: window.eval('bal')('1010') } });
await wait(3500);
// 2. lost: taken out of the books, the stock put back, saved
await pg.evaluate(m => { const S = window.eval('S'); S.sales = S.sales.filter(s => s.no !== m.no); S.journal = S.journal.filter(j => j.ref !== m.no);
  const mv = S.movements.filter(x => x.ref === m.no); mv.forEach(x => { const p = window.eval('P')(x.pid); p.stock = +(p.stock - x.qty).toFixed(3) }); S.movements = S.movements.filter(x => x.ref !== m.no);
  window.eval('persist')(true) }, made);
await wait(3500);
const lost = await pg.evaluate(m => ({ inList: window.eval('S').sales.some(s => s.no === m.no), stock: window.eval('P')(m.pid).stock }), made);
ok(!lost.inList && Math.abs(lost.stock - (made.stockAfter + 2)) < 1e-6, `bill ${made.no} is lost from the books (stock back up)`, JSON.stringify(lost));
// 3. find it
await pg.evaluate(() => { window.eval('go')('bills') }); await wait(300);
ok(!!(await pg.$('[data-act="findBill"]')), 'Bills has "Find a missing bill" for an admin');
await pg.click('[data-act="findBill"]'); await wait(300);
await pg.type('#fbNo', made.no); await pg.click('#fbGo'); await wait(2500);
const shown = await pg.evaluate(() => (document.getElementById('fbOut') || {}).innerText || '');
ok(/Found/.test(shown) && /server's copy/.test(shown) && /went missing with the save after that/.test(shown), 'found in the server\'s copy, with the save that went without it', shown.replace(/\s+/g, ' ').slice(0, 220));
await pg.click('#fbPut'); await wait(600);
const back = await pg.evaluate(m => { const S = window.eval('S'); const s = S.sales.find(x => x.no === m.no); return { there: !!s, total: s && s.total, stock: window.eval('P')(m.pid).stock, journal: S.journal.filter(j => j.ref === m.no).length, cash: window.eval('bal')('1010') } }, made);
ok(back.there && back.total === made.total, 'put back: the bill is on the list again', JSON.stringify(back));
ok(Math.abs(back.stock - made.stockAfter) < 1e-6, 'its stock movement is back (stock down by the 2 again)');
ok(back.journal >= 1 && Math.abs(back.cash - made.cash) < 0.01, 'its journal entries are back (the drawer as it was)', `${made.cash} vs ${back.cash}`);
// 4. in the books / nowhere
await pg.evaluate(() => window.eval('findBillModal')()); await wait(300);
await pg.type('#fbNo', made.no); await pg.click('#fbGo'); await wait(2000);
ok(/is in the books/.test(await pg.evaluate(() => document.getElementById('fbOut').innerText)), 'a bill in the books: it says so, with a link to open it');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await pg.evaluate(() => window.eval('findBillModal')()); await wait(300);
await pg.type('#fbNo', '99999999'); await pg.click('#fbGo'); await wait(2000);
ok(/not on this till and not in any copy/.test(await pg.evaluate(() => document.getElementById('fbOut').innerText)), 'a number never used: nowhere, and what to check on the till it was made on');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// tidy up: take the test bill out again
await pg.evaluate(m => { const S = window.eval('S'); S.sales = S.sales.filter(s => s.no !== m.no); S.journal = S.journal.filter(j => j.ref !== m.no);
  S.movements.filter(x => x.ref === m.no).forEach(x => { const p = window.eval('P')(x.pid); p.stock = +(p.stock - x.qty).toFixed(3) }); S.movements = S.movements.filter(x => x.ref !== m.no); window.eval('persist')(true) }, made);
await wait(2000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
