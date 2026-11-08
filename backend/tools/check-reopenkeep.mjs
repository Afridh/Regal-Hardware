// A till that cannot reach the server keeps its bills on the PC. Opening it again with the internet back must send
// them, not lay the server's books over them (8 Nov 2026: 26 bills and 5 quotations went that way on one till).
// Also checks "Bring back work from a saved copy" on the Find a missing bill window.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-reopenkeep.mjs
// The till here never reaches the print helper on this PC: its printers are the shop's.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
let cut = false;                                       // true: the till cannot reach the server's books
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url();
  if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET') || /\/api\/sms\//.test(u)) return rq.abort();
  if (cut && /\/api\/books\/regal(\/rev)?(\?|$)/.test(u)) return rq.abort('internetdisconnected');
  rq.continue() });
const quiet = () => pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''"); window.printPaper = () => {}; window.print = () => {} });
async function signIn() {
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await wait(1500); await quiet();
}
// looked at from here, not from the page, so it is never cut off with the till
const serverBills = async () => { const tok = await pg.evaluate(() => regalBridge.token()); const r = await fetch(BASE + '/api/books/regal', { headers: { Authorization: 'Bearer ' + tok } }); const j = await r.json(); return (j.data.S.sales || []).map(s => s.no) };
const make = (tag) => pg.evaluate((tag) => { const S = window.eval('S'), p = S.products.find(x => x.id !== window.eval('OPEN_PID') && +x.retail > 0); p.stock = Math.max(+p.stock || 0, 100);
  const inv = window.eval('completeSale')({ lines: [{ pid: p.id, qty: 1, price: 777, disc: 0, belowCost: true }], customerId: 1, pays: [{ method: 'CASH', amount: 777 }], override: true });
  inv.note = tag; window.eval('persist')(true); return inv.no }, tag);

await signIn();
// ---------- 1. a bill made while the server cannot be reached, then the till is opened again with it back
cut = true;
const lost = await make('made while cut off');
await wait(2500);
const waiting = await pg.evaluate(() => regalBridge.unsynced());
ok(waiting === true, 'with the server out of reach the bill waits on this PC', String(waiting));
const before = await serverBills();
ok(!before.includes(lost), 'the server does not have it yet');
cut = false;
await pg.reload({ waitUntil: 'networkidle2' });          // "Close anyway", then open Regal POS again
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) await signIn(); else { await wait(1500); await quiet() }
await wait(6000);
const onTill = await pg.evaluate(no => window.eval('S').sales.some(s => s.no === no), lost);
ok(onTill, 'opened again, the bill is still on the till', lost);
let after = await serverBills();
for (let i = 0; i < 10 && !after.includes(lost); i++) { await wait(1500); after = await serverBills() }
ok(after.includes(lost), 'and it reached the server');
ok(after.filter(n => n === lost).length === 1, 'once');
ok(await pg.evaluate(() => regalBridge.unsynced()) === false, 'nothing is left waiting');

// ---------- 2. a till that opens with nothing waiting takes the server's books as before: it brings nothing back
const other = (await serverBills()).length;
await pg.reload({ waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) await signIn(); else { await wait(1500); await quiet() }
await wait(3000);
const n2 = (await serverBills()).length, till2 = await pg.evaluate(() => window.eval('S').sales.length);
ok(n2 === other && till2 === n2, 'opening with nothing waiting adds no bill anywhere', `server ${other} -> ${n2}, till ${till2}`);

// ---------- 3. Bring back work from a saved copy
const copy = await pg.evaluate(() => JSON.stringify({ v: 1, S: window.eval('S') }));
const gone = await pg.evaluate(() => { const S = window.eval('S'), p = S.products.find(x => x.id !== window.eval('OPEN_PID') && +x.retail > 0);
  const stock0 = p.stock; const inv = window.eval('completeSale')({ lines: [{ pid: p.id, qty: 2, price: 500, disc: 0, belowCost: true }], customerId: 1, pays: [{ method: 'CASH', amount: 1000 }], override: true });
  return { no: inv.no, pid: p.id, stock0, stock1: p.stock, journal: S.journal.length, moves: S.movements.length } });
const fileCopy = await pg.evaluate(() => JSON.stringify({ v: 1, S: window.eval('S') }));
// the bill is lost from the till's books the way it was on 8 Nov: as if it had never been made
await pg.evaluate((txt) => { const S = window.eval('S'), d = JSON.parse(txt).S; ['sales', 'journal', 'movements', 'products', 'seq', 'seqBy'].forEach(k => S[k] = d[k]); window.eval('render')() }, copy);
const tmp = path.join(os.tmpdir(), 'regal-copy-test.json'); fs.writeFileSync(tmp, fileCopy);
await pg.evaluate(() => window.eval('findBillModal')()); await wait(300);
await (await pg.$('#fbFile')).uploadFile(tmp);
await pg.waitForFunction(() => { const x = document.getElementById('fbRest'); return x && x.innerText.trim() && !/Reading/.test(x.innerText) }, { timeout: 30000 });
const shown = await pg.evaluate(() => document.getElementById('fbRest').innerText);
ok(shown.includes(gone.no), 'the copy shows the lost bill', gone.no);
await pg.click('#fbRestGo'); await wait(1200);
const back = await pg.evaluate((g) => { const S = window.eval('S'); return { n: S.sales.filter(s => s.no === g.no).length, stock: window.eval('P')(g.pid).stock, journal: S.journal.length, moves: S.movements.length } }, gone);
ok(back.n === 1, 'the bill is back, once');
ok(Math.abs(back.stock - gone.stock1) < 0.0005, 'its stock is taken again', `${gone.stock0} -> ${back.stock}`);
ok(back.journal === gone.journal + 2 || back.journal === gone.journal, 'its account entries are back', `${gone.journal} -> ${back.journal}`);
await pg.evaluate(() => window.eval('findBillModal')()); await wait(300);
await (await pg.$('#fbFile')).uploadFile(tmp);
await pg.waitForFunction(() => { const x = document.getElementById('fbRest'); return x && x.innerText.trim() && !/Reading/.test(x.innerText) }, { timeout: 30000 });
ok(/already in the books/.test(await pg.evaluate(() => document.getElementById('fbRest').innerText)), 'a second time there is nothing to bring back');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const asStaff = await pg.evaluate(() => { const S = window.eval('S'), r = S.user.role; S.user.role = 'Cashier'; window.eval('findBillModal')(); const open = !!document.getElementById('fbFile'); S.user.role = r; document.querySelectorAll('.modal').forEach(m => m.remove()); return open });
ok(!asStaff, 'only an admin can open it');
fs.rmSync(tmp, { force: true });
// 'Failed to fetch' is the till finding the server cut off in part 1, as it should
const real = errs.filter(e => !/Failed to fetch/.test(e));
ok(real.length === 0, 'no page errors', real.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
