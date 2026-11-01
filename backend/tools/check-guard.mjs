// The books can never be emptied by a till that has not loaded them.
//  · the server refuses a save that loses most of the products or most of the bills — from 10 of either,
//    not only from 50 products as before — unless it carries the owner's one-time wipe pass (Start fresh)
//  · a till just signed in does not save before the books are in: even pushed to save at once, what reaches
//    the server is the real books
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-guard.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const j = (r) => r.json().catch(() => ({}));

// 1. the server: an empty save over a small shop is refused
const login = await j(await fetch(BASE + '/api/books/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'Afridh', password: 'Afridh123' }) }));
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };
const cur = await j(await fetch(BASE + '/api/books/regal', { headers: H }));
const P = (cur.data.S.products || []).length, Sx = (cur.data.S.sales || []).length;
ok(P >= 10, `the test shop: ${P} products, ${Sx} bills`);
const empty = JSON.parse(JSON.stringify(cur.data)); empty.S.products = []; empty.S.sales = [];
let r = await fetch(BASE + '/api/books/regal', { method: 'PUT', headers: H, body: JSON.stringify({ data: empty, rev: cur.rev }) });
ok(r.status === 409, 'a save with no products and no bills over them: refused', String(r.status));
if (Sx >= 10) { const noBills = JSON.parse(JSON.stringify(cur.data)); noBills.S.sales = noBills.S.sales.slice(0, 2);
  r = await fetch(BASE + '/api/books/regal', { method: 'PUT', headers: H, body: JSON.stringify({ data: noBills, rev: cur.rev }) });
  ok(r.status === 409, 'a save that loses most of the bills (products all there): refused too', String(r.status)); }
else console.log('(fewer than 10 bills on this shop — the bills guard is not tried; run straight after run-e2e)');
const after = await j(await fetch(BASE + '/api/books/regal', { headers: H }));
ok((after.data.S.products || []).length === P && (after.data.S.sales || []).length === Sx, 'the books are as they were');

// 2. a till just signed in, pushed to save straight away
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const puts = []; pg.on('request', rq => { if (/\/api\/books\/regal$/.test(rq.url()) && rq.method() === 'PUT') { try { const d = JSON.parse(rq.postData()).data.S; puts.push({ p: d.products.length, s: d.sales.length }) } catch (e) {} } });
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'domcontentloaded' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
}
// the moment the lock screen goes: save, over and over, while the books may still be on their way
for (let i = 0; i < 20; i++) { await pg.evaluate(() => { try { window.eval('persist')(true) } catch (e) {} }); await wait(100) }
await wait(4000);
ok(puts.length > 0 && puts.every(x => x.p === P && x.s >= Sx), `every save that reached the server carried the real books (${puts.length} save${puts.length === 1 ? '' : 's'})`, JSON.stringify(puts.slice(0, 4)));
// the browser's sign-in as Afridh ended this script's own (one sign-in at a time): sign in again to read
const l2 = await j(await fetch(BASE + '/api/books/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'Afridh', password: 'Afridh123' }) }));
const end = await j(await fetch(BASE + '/api/books/regal', { headers: { ...H, Authorization: 'Bearer ' + l2.token } }));
ok((end.data.S.products || []).length === P, 'and the books on the server still have every product', String((end.data.S.products || []).length));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
