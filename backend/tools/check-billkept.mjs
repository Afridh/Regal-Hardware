// A bill must never be lost to the books coming down while it is being made (5 Nov 2026: bills printed and then not on
// the list, with no outstanding). The network is held back to make the bad timing happen every time:
//  1. the till asks for the books (another till saved) and the answer is slow
//  2. the cashier finishes a credit bill; it prints and its save goes out
//  3. the old books arrive while that save is still on its way
//  4. the till carries on, and saves again
// The bill must still be on this till and in the server's books, with what the customer owes.
// Also: every save refused while the tills are busy keeps the work; and the server keeps a bill a save came without.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billkept.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 90000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
let net = { revBump: 0, holdGet: false, heldGet: null, holdPut: false, heldPut: null, puts: 0, gets: 0 };
await pg.setRequestInterception(true);
pg.on('request', async rq => { const u = rq.url(), m = rq.method();
  if (/:41\d\d/.test(u)) return rq.abort();
  if (/\/api\/books\/regal\/rev/.test(u) && net.revBump) { const r = await fetch(u, { headers: rq.headers() }), j = await r.json(); j.rev += net.revBump; return rq.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }) }
  if (m === 'GET' && /\/api\/books\/regal(\?|$)/.test(u)) { net.gets++; if (net.holdGet) { const r = await fetch(u, { headers: rq.headers() }), body = await r.text(); net.heldGet = () => rq.respond({ status: 200, contentType: 'application/json', body }); return } return rq.continue() }
  if (m === 'PUT' && /\/api\/books\/regal(\?|$)/.test(u) && net.storm > 0) { net.storm--; const r = await fetch(u, { headers: rq.headers() }), j = await r.json(); return rq.respond({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Someone else saved first', rev: j.rev, data: j.data, inbox: 0 }) }) }
  if (m === 'PUT' && /\/api\/books\/regal(\?|$)/.test(u)) { net.puts++; if (net.holdPut) { net.heldPut = () => rq.continue(); return } return rq.continue() }
  rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(2000);
const server = () => pg.evaluate(async () => { const r = await fetch('/api/books/regal', { headers: { Authorization: 'Bearer ' + regalBridge.token() } }), j = await r.json(); return { rev: j.rev, nos: (j.data.S.sales || []).map(s => s.no), journal: (j.data.S.journal || []).map(x => x.ref) } });
const makeBill = (cid) => pg.evaluate((cid) => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {};
  const S = window.eval('S'), C = window.eval('CFG'); C.done.askSize = false; C.done.printAnim = false; C.done.preview = false; window.eval('CS').paper = 'none';
  const p = S.products.find(x => x.active !== false && x.stock > 10 && !(x.tiers || []).length);
  S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.customer = cid;
  const c = window.eval('C')(cid), owedBefore = window.eval('partyBal')('C', cid);
  const inv = window.eval('finishTillBill')({ cust: c, pays: [{ method: 'CREDIT', amount: 0 }] });
  window.eval('render')(); window.eval('persist')(true);
  return { no: inv.no, total: inv.total, owedBefore, name: c.name } }, cid);
const here = (no, cid) => pg.evaluate((no, cid) => { const S = window.eval('S'); return { has: S.sales.some(s => s.no === no), owed: window.eval('partyBal')('C', cid) } }, no, cid);
const saveAgain = async () => { await pg.evaluate(() => { const S = window.eval('S'); S.notif = S.notif || []; S.notif.unshift({ id: 'nt' + Date.now(), kind: 'info', text: 'test: a later change on this till', at: '', read: true }); window.eval('persist')(true) }); await wait(1500) };
const cid = await pg.evaluate(() => window.eval('S').customers.find(c => c.id !== 1 && c.active !== false).id);
const nudge = () => pg.evaluate(() => { lastInputAt = 0 }).catch(() => {});

async function scenario(label, order) {
  await wait(3500);                                    // our own last save has settled
  net.revBump = 5; net.holdGet = true; net.heldGet = null;
  for (let i = 0; i < 60 && !net.heldGet; i++) await wait(250);  // the till noticed "another till saved" and asked for the books
  ok(!!net.heldGet, `${label}: the till asked for the books, and the answer is held back`);
  net.revBump = 0; net.holdGet = false; net.holdPut = order !== 'get-after-saved'; net.heldPut = null;
  const puts0 = net.puts, bill = await makeBill(cid);  // the cashier finishes the bill meanwhile
  if (order === 'get-before-save') { net.heldGet(); await wait(300); for (let i = 0; i < 12 && !net.heldPut && net.puts === puts0; i++) await wait(200); net.holdPut = false; if (net.heldPut) net.heldPut() }
  if (order === 'get-during-save') { for (let i = 0; i < 20 && !net.heldPut; i++) await wait(150); net.heldGet(); await wait(400); net.holdPut = false; if (net.heldPut) net.heldPut() }
  if (order === 'get-after-saved') { await wait(1500); net.heldGet() }
  await wait(1500);
  const a = await here(bill.no, cid);
  ok(a.has && Math.abs(a.owed - (bill.owedBefore + bill.total)) < 0.01, `${label}: bill ${bill.no} is still on this till, the customer owes it`, JSON.stringify({ ...a, want: bill.owedBefore + bill.total }));
  await saveAgain();                                    // the next thing done on this till
  await wait(4000);
  const s = await server();
  ok(s.nos.includes(bill.no) && s.journal.includes(bill.no), `${label}: and bill ${bill.no} is in the server's books after the next save`, `server rev ${s.rev}`);
  const c = await here(bill.no, cid);
  ok(c.has, `${label}: and still on this till afterwards`);
}
await scenario('old books arrive before the save goes', 'get-before-save');
await scenario('old books arrive during the save', 'get-during-save');
await scenario('old books arrive just after the save', 'get-after-saved');
// the tills very busy: every save refused again and again. The work stays, and goes up when the server lets it
{
  await wait(3500);
  net.storm = 8;                                         // the next saves all answer "someone else saved first"
  const bill = await makeBill(cid); await wait(2500);
  const a = await here(bill.no, cid);
  ok(a.has, `very busy (save refused ${8 - net.storm} times so far): bill ${bill.no} is still on this till, not reloaded away`);
  net.storm = 0;
  for (let i = 0; i < 40; i++) { const s = await server(); if (s.nos.includes(bill.no)) break; await wait(1000) }
  const s = await server();
  ok(s.nos.includes(bill.no) && s.journal.includes(bill.no), `then bill ${bill.no} goes up by itself, once the server lets it`);
}
// the server's safety net: whatever the reason, a save without a bill does not take the bill away
{
  await wait(3500);
  const bill = await makeBill(cid); await wait(3500);
  const before = await pg.evaluate(no => { const S = window.eval('S'), s = S.sales.find(x => x.no === no), pid = s.lines[0].pid; return { pid, stock: window.eval('P')(pid).stock, owed: window.eval('partyBal')('C', s.customerId), notifs: (S.notif || []).length } }, bill.no);
  await pg.evaluate(no => { const S = window.eval('S'), mv = S.movements.filter(x => x.ref === no);
    mv.forEach(x => { const p = window.eval('P')(x.pid); p.stock = +(p.stock - x.qty).toFixed(3) });
    S.sales = S.sales.filter(s => s.no !== no); S.journal = S.journal.filter(j => j.ref !== no); S.movements = S.movements.filter(x => x.ref !== no); window.eval('persist')(true) }, bill.no);
  await wait(1500);
  const s = await server();
  ok(s.nos.includes(bill.no) && s.journal.includes(bill.no), `a save that came without bill ${bill.no}: the server kept it, with its journal`);
  let back = {}; for (let i = 0; i < 30; i++) { await wait(1000); back = await pg.evaluate(no => { const S = window.eval('S'), n = (S.notif || []).find(x => x.kind === 'warn' && String(x.text).includes(no + '')); return { has: S.sales.some(x => x.no === no), notice: n && n.text } }, bill.no); if (back.has) break }
  ok(back.has, `the bill comes back to the till by itself`, JSON.stringify(back));
  ok(/kept in the books/.test(back.notice || ''), 'and the owner is told', back.notice || '');
  const after = await pg.evaluate(({ pid, cid }) => ({ stock: window.eval('P')(pid).stock, owed: window.eval('partyBal')('C', cid) }), { pid: before.pid, cid });
  ok(Math.abs(after.stock - before.stock) < 1e-6 && Math.abs(after.owed - before.owed) < 0.01, 'the stock and what the customer owes are as they were', JSON.stringify({ before, after }));
  // an owner's fresh start still can: the wipe token rides with the save
  await wait(3500);
  await pg.evaluate(no => { const S = window.eval('S'); window._allowWipeOnce = Date.now(); S.sales = S.sales.filter(s => s.no !== no); S.journal = S.journal.filter(j => j.ref !== no); window.eval('persist')(true) }, bill.no); await wait(2000);
  ok(!(await server()).nos.includes(bill.no), 'a save with the owner\'s wipe token can still take a bill out (a fresh start)');
}
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
