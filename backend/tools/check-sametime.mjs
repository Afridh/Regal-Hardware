// Two tills make a bill at the same moment (8 Nov 2026: two PCs printed bill 10176 at 5:17 pm — the same
// number on two different bills — and the books kept only one of them).
//  · both bills reach the server, and both tills: nothing is lost
//  · no two bills in the books carry the same number
//  · the same with one till cut off from the server while it bills
// Two separate browser profiles stand for the two PCs. Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-sametime.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const errs = [];
async function till(name, user, pass) {
  const ctx = await b.createBrowserContext();             // its own storage: another PC
  const pg = await ctx.newPage(); await pg.setViewport({ width: 1366, height: 800 });
  pg.on('pageerror', e => errs.push(name + ': ' + e.message)); pg.on('dialog', d => d.accept());
  pg.cut = false;
  await pg.setRequestInterception(true);
  pg.on('request', rq => { const u = rq.url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET') || /\/api\/sms\//.test(u)) return rq.abort();
    if (pg.cut && /\/api\/(books|bills)\//.test(u)) return rq.abort('internetdisconnected');
    rq.continue() });
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', user);
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', pass); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await wait(2000);
  await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''"); window.printPaper = () => {}; window.print = () => {} });
  if (process.env.DIAG) await pg.evaluate(() => {        // a record of every time the server's books are laid over this till
    window.__log = []; window.__mergeDbg = [];
    const notes = (sales) => (sales || []).filter(s => /^[AB]\d-/.test(s.note || '')).map(s => s.no + ':' + s.note).join(',');
    const ak = window.applyKept; window.applyKept = function (doc) { const before = notes(window.eval('S').sales); const r = ak.apply(this, arguments);
      window.__log.push({ t: Date.now() % 100000, ev: 'apply', before, incoming: notes(doc && doc.S && doc.S.sales), after: notes(window.eval('S').sales), stack: new Error().stack.split('\n').slice(2, 5).map(x => x.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < ') }); return r };
    const f = window.fetch; window.fetch = async function (u, o) { const r = await f.apply(this, arguments); if (/\/api\/books\/regal(\?|$)/.test(String(u))) window.__log.push({ t: Date.now() % 100000, ev: (o && o.method || 'GET') + ' ' + r.status }); return r };
  });
  return pg;
}
// a bill made the way the till's Pay button makes one: the number, then the sale, then the save
const make = (pg, tag) => pg.evaluate(async (tag) => {
  const S = window.eval('S'), p = S.products.find(x => x.id !== window.eval('OPEN_PID') && +x.retail > 0); p.stock = Math.max(+p.stock || 0, 100);
  let take = null; try { take = window.eval('takeBillNo') } catch (e) {}
  const no = typeof take === 'function' ? await take() : undefined;
  const inv = window.eval('completeSale')({ no, lines: [{ pid: p.id, qty: 1, price: 777, disc: 0, belowCost: true }], customerId: 1, pays: [{ method: 'CASH', amount: 777 }], override: true });
  inv.note = tag; window.eval('persist')(true); return inv.no }, tag);
// looked at from here with a sign-in of its own, never through either till
let TOK = null;
const serverSales = async () => {
  if (!TOK) TOK = (await (await fetch(BASE + '/api/books/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'KP', password: 'KP123' }) })).json()).token;
  const j = await (await fetch(BASE + '/api/books/regal', { headers: { Authorization: 'Bearer ' + TOK } })).json();
  if (!j.data) { TOK = null; throw new Error('could not read the books: ' + JSON.stringify(j).slice(0, 120)) }
  return j.data.S.sales || [] };
const settle = async (pgs, tags) => { for (let i = 0; i < 60; i++) { await wait(1500); const s = await serverSales(pgs[0]); if (tags.every(t => s.some(x => x.note === t))) break } await wait(4000) };
const dupes = (sales) => { const c = {}; sales.forEach(s => { c[s.no] = (c[s.no] || 0) + 1 }); return Object.keys(c).filter(k => c[k] > 1) };

// two different people on two PCs, on the same number run (as Afridh and Akmal were): each signs in once only
const A = await till('A', 'Afridh', 'Afridh123'), B = await till('B', 'Akmal', 'Akmal123');
for (const pg of [A, B]) await pg.evaluate(() => { const S = window.eval('S'); for (const n of ['Afridh', 'Akmal']) { const u = S.users.find(x => x.name === n); if (u) u.no = 1 } S.seqBy = S.seqBy || {}; window.eval('persist')(true) });
await wait(3000);
const keys = await Promise.all([A, B].map(pg => pg.evaluate(() => window.eval('billKey')())));
ok(keys[0] === keys[1], 'both tills are on the same number run', keys.join(' / '));
const run = Date.now().toString(36).slice(-4);
// each till has its next number held for it by the server before the customer pays
const held = (pg) => pg.evaluate(() => { try { return window.eval('heldOk')() ? window.eval('peekBillNo')() : null } catch (e) { return null } });
const waitHeld = async () => { for (let i = 0; i < 30; i++) { const [ha, hb] = [await held(A), await held(B)]; if (ha && hb) return [ha, hb]; await A.evaluate(() => { try { window.eval('billHold')() } catch (e) {} }); await B.evaluate(() => { try { window.eval('billHold')() } catch (e) {} }); await wait(1000) } return [await held(A), await held(B)] };
const [ha, hb] = await waitHeld();
ok(ha && hb && ha !== hb, 'each till shows a different next bill number, held for it by the server', `${ha} / ${hb}`);

// ---------- 1. both online, both press Pay at the same moment
const [na, nb] = await Promise.all([make(A, 'A1-' + run), make(B, 'B1-' + run)]);
ok(na !== nb, 'two tills at the same moment are given different bill numbers', `${na} / ${nb}`);
await settle([A, B], ['A1-' + run, 'B1-' + run]);
if (process.env.DIAG) for (const [pg, nm] of [[A, 'A'], [B, 'B']]) console.log('LOG', nm, JSON.stringify(await pg.evaluate(() => window.__log), null, 0));
if (process.env.DIAG) for (const [pg, nm] of [[A, 'A'], [B, 'B']]) console.log('DIAG', nm,JSON.stringify(await pg.evaluate(() => ({ info: regalBridge.syncInfo ? regalBridge.syncInfo() : null, mine: window.eval('S').sales.slice(-4).map(s => s.no + ':' + (s.note || '')) }))));
let S = await serverSales(A);
ok(S.some(x => x.note === 'A1-' + run) && S.some(x => x.note === 'B1-' + run), 'both bills are in the books on the server');
ok(!dupes(S).length, 'no bill number is used twice in the books', dupes(S).join(', '));
for (const [pg, nm] of [[A, 'A'], [B, 'B']]) {
  const t = await pg.evaluate(() => window.eval('S').sales.map(s => ({ no: s.no, note: s.note })));
  ok(t.some(x => x.note === 'A1-' + run) && t.some(x => x.note === 'B1-' + run), `till ${nm} has both bills`);
}

// ---------- 2. till B cannot reach the server, bills, and comes back: both kept, numbers still unique
if (process.env.DIAG) for (const pg of [A, B]) await pg.evaluate(() => { window.__mark = window.__log.length });
B.cut = true;
const nb2 = await make(B, 'B2-' + run);
const na2 = await make(A, 'A2-' + run);
await wait(2500);
B.cut = false;
await B.evaluate(() => regalBridge.syncNow && regalBridge.syncNow());
await settle([A, B], ['A2-' + run, 'B2-' + run]);
if (process.env.DIAG) for (const [pg, nm] of [[A, 'A'], [B, 'B']]) { console.log('LOG2', nm, JSON.stringify(await pg.evaluate(() => { const L = window.__log.slice(window.__mark || 0); return L }))); console.log('MERGE2', nm, JSON.stringify(await pg.evaluate(() => window.__mergeDbg.slice(-3)))); }
if (process.env.DIAG) for (const [pg, nm] of [[A, 'A'], [B, 'B']]) console.log('DIAG2', nm, JSON.stringify(await pg.evaluate(() => ({ info: regalBridge.syncInfo ? regalBridge.syncInfo() : null, mine: window.eval('S').sales.slice(-4).map(s => s.no + ':' + (s.note || '')) }))));
S = await serverSales(A);
if (process.env.DIAG) console.log('DIAG2 server', S.slice(-4).map(s => s.no + ':' + (s.note || '')).join(' | '));
const a2 =S.find(x => x.note === 'A2-' + run), b2 = S.find(x => x.note === 'B2-' + run);
ok(!!a2 && !!b2, 'cut off and back: both bills are in the books', `${na2} / ${nb2}`);
ok(!dupes(S).length, 'and no bill number is used twice', dupes(S).join(', '));
if (b2 && b2.no !== nb2) ok(/printed as/i.test(JSON.stringify(b2)) || b2.printedNo === nb2, 'a bill renumbered in the books still says the number printed on its paper', JSON.stringify({ no: b2.no, printedNo: b2.printedNo }));

ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
