// A save that reached the server, but whose answer never came back to the till (9 Nov 2026: bill 20207 was in the
// books twice for one customer, with its outstanding counted twice). The host restarts the app every few minutes, so
// "503" or a dropped line after the books were already written does happen. The till took the save as failed; its
// next save met the newer books (409), put them together with its own from the old starting point, and the bill —
// new on both sides — went in twice, with its journal entries.
//  · the bill is in the books once, its journal entries and stock movements once
//  · a change made to the bill after the lost answer is kept
// Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-lostreply.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.evaluateOnNewDocument(() => { try { localStorage.setItem('regal_gzip_off', '1') } catch (e) {} });   // the body is read as text below
let dropReply = 0, dropped = 0;
await pg.setRequestInterception(true);
pg.on('request', async rq => { const u = rq.url();
  if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort();
  if (dropReply && rq.method() === 'PUT' && /\/api\/books\/regal$/.test(u)) {
    dropReply--;
    // the save goes to the server and is written; the till hears only "503"
    const r = await fetch(u, { method: 'PUT', headers: rq.headers(), body: rq.postData() });
    dropped = r.status;
    return rq.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Service Unavailable' }) });
  }
  rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => window.eval('S').products.filter(x => +x.retail > 0).length > 5, { timeout: 30000 }); await wait(2500);
const server = () => pg.evaluate(async () => { const r = await fetch('/api/books/regal', { headers: { Authorization: 'Bearer ' + regalBridge.token() } }); return (await r.json()) });
const tally = (d, no) => ({ bills: d.data.S.sales.filter(s => s.no === no).length, journal: d.data.S.journal.filter(j => String(j.ref) === no).length,
  moves: (d.data.S.movements || []).filter(m => String(m.ref) === no).length, note: (d.data.S.sales.find(s => s.no === no) || {}).note || '' });
const sell = () => pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval("CFG.print.agent=''");
  const S = window.eval('S'), CFG = window.eval('CFG'); CFG.msg.autoBill = false;
  let c = S.customers.find(x => x.name === 'SAMPLE TEST BUILDERS');
  if (!c) { c = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: 'STB', name: 'SAMPLE TEST BUILDERS', phone: '0700000002', level: 'retail', limit: 99999999 }; S.customers.push(c) }
  const ps = S.products.filter(x => x.id !== window.eval('OPEN_PID') && +x.retail > 0).slice(0, 3); ps.forEach(p => p.stock = Math.max(+p.stock || 0, 1000));
  const inv = window.eval('completeSale')({ lines: ps.map((p, i) => ({ pid: p.id, qty: 2 + i, price: 1000 + i, disc: 0, belowCost: true })), customerId: c.id, pays: [{ method: 'CREDIT', amount: 0 }], override: true });
  return inv.no });
const saved = () => pg.waitForFunction(() => /saved/.test(document.body.innerText) && !window.eval('regalBridge').busy, { timeout: 4000 }).catch(() => {});

for (const [label, change] of [['the bill changed after the lost answer', true], ['the bill not changed', false]]) {
  const before = await server();
  dropReply = 1; dropped = 0;
  const no = await sell();
  await pg.evaluate(() => window.persist && window.persist(true));
  for (let i = 0; i < 40 && !dropped; i++) await wait(150);
  await wait(800);
  const landed = tally(await server(), no);
  ok(dropped === 200 && landed.bills === 1 && (await server()).rev > before.rev, `${label}: the save reached the server, the till heard 503`, JSON.stringify({ dropped, landed }));
  // the till carries on: a note on the bill (as a text sent, a payment, a print would change it), and saves again
  await pg.evaluate((no, change) => { const s = window.eval('S').sales.find(x => x.no === no); if (change) s.note = 'checked after the lost answer'; window.eval('S').__touch = Date.now(); window.persist(true) }, no, change);
  await wait(3000); await pg.evaluate(() => window.persist(true)); await wait(3000);
  const end = tally(await server(), no), here = await pg.evaluate(no => ({ bills: window.eval('S').sales.filter(s => s.no === no).length, journal: window.eval('S').journal.filter(j => String(j.ref) === no).length }), no);
  ok(end.bills === 1, `${label}: the bill is in the books once`, JSON.stringify(end));
  ok(end.journal === landed.journal && end.moves === landed.moves, `${label}: its journal entries and stock movements once`, JSON.stringify({ landed, end }));
  ok(here.bills === 1 && here.journal === landed.journal, `${label}: and once on the till`, JSON.stringify(here));
  if (change) ok(end.note === 'checked after the lost answer', `${label}: the change made after it is kept`, end.note);
}

// a save with a bill in it twice (a PC still on the old page, or 20207 already in the books): the server keeps it
// once, with its outstanding and stock as they should be, and the till takes the mended books back
{
  const no = await sell(); await wait(3000);
  const was = await pg.evaluate(no => { const S = window.eval('S'), s = S.sales.find(x => x.no === no), cid = s.customerId;
    const bal = window.eval('partyBal')('C', cid), pid = s.lines[0].pid, stock = window.eval('P')(pid).stock;
    // as the fault left it: the bill, its entries and its stock moves all in twice
    S.sales.push(JSON.parse(JSON.stringify(s)));
    S.journal.filter(j => String(j.ref) === no).forEach(j => S.journal.push(JSON.parse(JSON.stringify(j))));
    S.movements.filter(m => String(m.ref) === no).forEach(m => { S.movements.push({ ...m }); const p = window.eval('P')(m.pid); p.stock = +(p.stock + m.qty).toFixed(3) });
    const dblBal = window.eval('partyBal')('C', cid); window.persist(true);
    return { cid, bal, pid, stock, dblBal } }, no);
  await wait(2500);
  const srv = await server(), t = tally(srv, no);
  ok(was.dblBal > was.bal && t.bills === 1,
    'the server keeps the bill once', JSON.stringify({ was, server: t }));
  ok(srv.data.S.products.find(p => p.id === was.pid).stock === was.stock, 'the server puts the stock back as it was', srv.data.S.products.find(p => p.id === was.pid).stock + ' / ' + was.stock);
  let here = null;
  for (let i = 0; i < 40; i++) { await wait(1000); here = await pg.evaluate((no, was) => ({ bills: window.eval('S').sales.filter(x => x.no === no).length, bal: window.eval('partyBal')('C', was.cid), stock: window.eval('P')(was.pid).stock }), no, was); if (here.bills === 1) break }
  ok(here.bills === 1 && Math.abs(here.bal - was.bal) < 0.01 && Math.abs(here.stock - was.stock) < 0.001, 'the till has the mended books: bill once, outstanding and stock right', JSON.stringify({ was, here }));
  ok(/more than once/.test((srv.data.S.notif || [])[0]?.text || ''), 'the owner is told', (srv.data.S.notif || [])[0]?.text);
}
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
