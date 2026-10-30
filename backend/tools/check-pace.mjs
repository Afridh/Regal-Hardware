// How often the shop's screens ask the server. The shop reaches regalhw.lk from one internet address, and the
// hosting firewall blocked it as a bot on 30 Oct 2026 — tills every 2 s, the counter screen every 0.9 s, the print
// helper every 2 s. Measured here with the live pace switched on:
//  · a till in use asks for the books' revision about every 10 s, not every 2
//  · the counter screen holds its question until the bill changes — a handful of asks a minute — yet shows a
//    change from the till within a couple of seconds
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-pace.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });

// 1. a till at the live pace, being used
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.evaluateOnNewDocument(() => { try { localStorage.setItem('regal_pace', 'live') } catch (e) {} });
let revs = [];
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/\/books\/regal\/rev/.test(rq.url())) revs.push(Date.now()); if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(3000); revs = [];
const t0 = Date.now();
for (let i = 0; i < 8; i++) { await pg.mouse.click(700, 500); await wait(5000) }     // someone at the till, clicking now and then
const secs = (Date.now() - t0) / 1000, perMin = revs.length / secs * 60;
ok(perMin <= 8 && revs.length >= 2, `a till in use asks about every 10 s — ${revs.length} in ${Math.round(secs)} s (${perMin.toFixed(1)}/min; it was 30/min)`);

// 2. the counter screen: a held question, and a change shows at once
const tok = await pg.evaluate(() => regalBridge.token());
const show = (data) => fetch(BASE + '/api/display/9', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ data }) });
await show({ state: 'idle' });
const sc = await b.newPage(); await sc.setViewport({ width: 1280, height: 800 });
let asks = 0; await sc.setRequestInterception(true);
sc.on('request', rq => { if (/\/api\/display\/9/.test(rq.url())) asks++; rq.continue() });
await sc.goto(BASE + '/count9', { waitUntil: 'domcontentloaded' }); await wait(3000); asks = 0;
await wait(30000);
ok(asks <= 4, `the counter screen, nothing changing: ${asks} asks in 30 s (it was ~33)`);
const sent = Date.now();
await show({ shop: { name: 'REGAL HARDWARE' }, state: 'bill', lines: [{ k: '1|2350|', n: 'TOKYO SUPER CEMENT 50KG', q: 1, u: 2350, m: 0, a: 2350 }], items: 1, disc: 0, total: 2350, save: 0, cust: 'Nimal' });
await sc.waitForFunction(() => /2,350/.test(document.body.innerText), { timeout: 8000 }).catch(() => {});
const took = Date.now() - sent, shown = await sc.evaluate(() => /2,350/.test(document.body.innerText));
ok(shown && took < 3000, `and a bill from the till shows on it at once — ${took} ms`);
await show({ state: 'idle' });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
