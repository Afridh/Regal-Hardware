// Every customer an e-bill as well as the print, and registered by the mobile (5 Nov 2026). Through the real till, on End:
//  · a new mobile, no name: Enter, Enter: a new customer, the bill in their name, the printer gets it AND the e-bill goes out
//  · with a name typed; a number keyed as +94… or 77… finds the customer already there, by their second mobile too: no double
//  · left empty: a walk-in, printed, no text
//  · a bad number is refused; a new code never repeats one; a shop with the switches off gets them on, once
// No text leaves (texting is off in the test) and nothing reaches a printer (the print helper is answered here).
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-ebillall.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 90000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
const printed = [];
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url(); if (!/:41\d\d/.test(u)) return rq.continue();
  const head = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  if (rq.method() === 'OPTIONS') return rq.respond({ status: 204, headers: head });
  if (u.endsWith('/print')) { printed.push(JSON.parse(rq.postData()).format); return rq.respond({ status: 200, headers: head, contentType: 'application/json', body: '{"ok":true,"printer":"nothing, a test"}' }) }
  rq.abort() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
const seed = Date.now() % 100000000, mob = (k) => '07' + String((seed + k) % 100000000).padStart(8, '0');
const setUp = () => pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'), C = window.eval('CFG'), CS = window.eval('CS');
  C.msg.live = false; C.msg.autoBill = true; C.done.askCustomer = true; C.done.askSalesman = false; C.done.askSize = false; C.done.printAnim = false; C.done.preview = false; C.bill.printTo = ''; C.print = { agent: 'http://localhost:4100' }; CS.paper = null; window.eval('prefs')().till = 'classic';
  const p = S.products.find(x => x.active !== false && x.stock > 10 && !(x.tiers || []).length); S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.customer = null; window.eval('go')('pos') });
const until = async fn => { for (let i = 0; i < 30; i++) { if (await pg.evaluate(fn)) return true; await wait(100) } return false };
// to the question: End, the amount taken, it asks
const toQuestion = async () => { await setUp(); await wait(300); await pg.focus('#csQ'); printed.length = 0; await pg.keyboard.press('End'); return until(() => !!document.getElementById('bqQ')) };
const billDone = () => until(() => !document.querySelector('.payw') && !document.getElementById('bqQ'));
const last = () => pg.evaluate(() => { const S = window.eval('S'), s = S.sales.at(-1), c = window.eval('C')(s.customerId); return { no: s.no, cid: s.customerId, name: c.name, phone: c.phone, code: c.code, level: c.level, msgs: S.messages.filter(m => m.body.includes(s.no) && /View your bill/.test(m.body)).map(m => ({ to: m.to, link: /\/b\//.test(m.body) || /regalhw|localhost/.test(m.body) })), customers: S.customers.length } });

ok(await pg.evaluate(() => { const c = window.eval('CFG'); return c.done.askCustomer === true && c.msg.autoBill === true }), 'both switches are on in this shop');
ok(await toQuestion(), 'End (cash) asks for the number first');
ok(/e-bill goes to this number as well as the print/.test(await pg.evaluate(() => document.querySelector('.modal:last-of-type').innerText) + await pg.evaluate(() => [...document.querySelectorAll('.modal')].map(m => m.innerText).join(' '))), 'the question says what it is for');
const before = await pg.evaluate(() => window.eval('S').customers.length);
// 1. a new mobile, nothing else: Enter, Enter
await pg.keyboard.type(mob(1)); await wait(100); await pg.keyboard.press('Enter'); await wait(150);
ok(await pg.evaluate(() => document.activeElement.id === 'bqNm'), 'a new number: Enter goes to the name');
await pg.keyboard.press('Enter'); await billDone(); await wait(500);
let r = await last();
ok(r.customers === before + 1 && r.phone === mob(1) && r.name === 'Customer ' + mob(1), 'Enter on the empty name: registered by the mobile alone', JSON.stringify({ name: r.name, phone: r.phone, code: r.code }));
ok(r.msgs.length === 1 && r.msgs[0].to === mob(1) && r.msgs[0].link, 'the e-bill with its link goes to that number', JSON.stringify(r.msgs));
ok(printed.length >= 1, 'and the bill is printed as well', printed.join());
const cid1 = r.cid, code1 = r.code;
// 2. with a name
ok(await toQuestion(), 'the next bill asks again');
await pg.keyboard.type(mob(2)); await pg.keyboard.press('Enter'); await wait(150); await pg.keyboard.type('Sunil Mason'); await pg.keyboard.press('Enter'); await billDone(); await wait(500);
r = await last(); ok(r.name === 'Sunil Mason' && r.phone === mob(2) && r.code !== code1, 'a name typed is kept, and the code is its own', JSON.stringify({ name: r.name, code: r.code })); const cid2 = r.cid;
// 3. the same customer, however the number is keyed: never twice
const n2 = await pg.evaluate(() => window.eval('S').customers.length);
for (const [label, keyed] of [['as +94', '+94 ' + mob(1).slice(1)], ['without the 0', mob(1).slice(1)], ['with spaces', mob(1).slice(0, 3) + ' ' + mob(1).slice(3)]]) {
  await toQuestion(); await pg.keyboard.type(keyed); await wait(150); await pg.keyboard.press('Enter'); await billDone(); await wait(400);
  r = await last(); ok(r.cid === cid1 && r.customers === n2 && r.msgs.length === 1, `the number keyed ${label} finds them: the bill is theirs, nobody added`, keyed) }
await pg.evaluate(([id, p]) => { window.eval('C')(id).phone2 = p }, [cid2, mob(3)]);
await toQuestion(); await pg.keyboard.type(mob(3)); await wait(150); await pg.keyboard.press('Enter'); await billDone(); await wait(400);
r = await last(); ok(r.cid === cid2 && r.customers === n2, 'their second mobile finds them too');
// 4. part of a number picks nobody by Enter alone; the arrows do; a bad number is refused; then walk-in
const part = mob(1).slice(0, 6);
await toQuestion(); await pg.keyboard.type(part); await wait(150); await pg.keyboard.press('Enter'); await wait(200);
ok(await pg.evaluate(() => !!document.getElementById('bqQ') && !window.eval('S').pos.customer), 'part of a number that matches somebody: Enter does not pick them', part);
await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('Enter'); await billDone(); await wait(400);
r = await last(); ok(r.cid === cid1, 'chosen with the arrows, it does', r.name);
await toQuestion(); await pg.keyboard.type('0900'); await wait(150); for (let i = 0; i < 3; i++) { await pg.keyboard.press('Enter'); await wait(150) }
ok(await pg.evaluate(() => !!document.getElementById('bqQ') && /Enter a mobile/.test(document.getElementById('bqMsg').textContent)), 'too short a number is refused: it says so, nobody added');
await pg.keyboard.press('Escape'); await billDone(); await wait(500);
r = await last(); ok(r.cid === 1 && r.msgs.length === 0 && printed.length >= 1, 'Esc: a walk-in, printed, no text', JSON.stringify({ cid: r.cid, printed }));
await toQuestion(); await pg.keyboard.press('Enter'); await billDone(); await wait(500);
r = await last(); ok(r.cid === 1 && r.customers === n2, 'Enter with the box empty: a walk-in too, straight on');
// 5. the code is never one in use
ok(await pg.evaluate(() => { const S = window.eval('S'), want = 'C' + String(S.customers.length + 1).padStart(4, '0'); S.customers.push({ id: 99999, code: want, name: 'Code Clash', phone: '', active: false }); const got = window.eval('freeCustCode')(); S.customers.pop(); return got !== want }), 'a new code skips one already in use');
// tidy: the test customers and bills go
await pg.evaluate(ids => { const S = window.eval('S'), nos = S.sales.filter(s => ids.includes(s.customerId) || s.customerId === 1 && /^\d+$/.test(s.no) && false).map(s => s.no); window._allowWipeOnce = Date.now(); S.sales = S.sales.filter(s => !nos.includes(s.no)); S.journal = S.journal.filter(j => !nos.includes(j.ref)); S.customers = S.customers.filter(c => !ids.includes(c.id)); window.eval('persist')(true) }, [cid1, cid2]); await wait(1500);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
