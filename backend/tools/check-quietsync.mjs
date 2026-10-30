// Another till saving is not a pop-up: it is said quietly in the till's status line. And the same message
// shown again while it is still up refreshes that one instead of stacking a second under it.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-quietsync.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
async function till() {
  const ctx = await b.createBrowserContext(), pg = await ctx.newPage(); await pg.setViewport({ width: 1366, height: 800 });
  await pg.setRequestInterception(true);
  pg.on('request', rq => { if (/:41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
  pg.on('dialog', d => d.accept());
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
  await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('go')('pos') });
  return pg;
}
const A = await till();
// someone else saving: a phone stock entry is a real save on the server, under another name
const key = await A.evaluate(() => { const S = window.eval('S'); S.stockers = [{ id: 'skq', name: 'Quiet', key: 'quietsynckey12345', active: true }]; window.eval('persist')(true); return S.stockers[0].key });
await wait(5000);
// till A watches every pop-up that appears
await A.evaluate(() => { window.__seen = []; new MutationObserver(() => document.querySelectorAll('#toasts .tt').forEach(t => { if (!window.__seen.includes(t.textContent)) window.__seen.push(t.textContent) })).observe(document.body, { childList: true, subtree: true }) });
// three saves elsewhere, as a busy shop makes
const pid = await A.evaluate(() => window.eval('S').products.find(p => p.active !== false).id);
for (let i = 0; i < 3; i++) { await fetch(BASE + '/api/stockup/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: key, pid, mode: 'count', qty: 5 + i }) }); await wait(1500) }
await wait(9000);
const seen = await A.evaluate(() => window.__seen), status = await A.evaluate(() => (document.getElementById('csSync') || document.getElementById('savedAt') || {}).textContent || '');
ok(!seen.some(t => /Books updated/.test(t)), 'till A shows no "Books updated" pop-up when someone else saves', JSON.stringify(seen));
ok(/updated \d\d:\d\d/.test(status), "till A's status line says it was updated, quietly", status);
// the same message four times: one pop-up
const n = await A.evaluate(async () => { document.getElementById('toasts') && (document.getElementById('toasts').innerHTML = ''); for (let i = 0; i < 4; i++) window.eval('toast')('Saved'); return document.querySelectorAll('#toasts .toast:not(.out)').length });
ok(n === 1, 'the same message four times shows once', n + ' shown');
const n2 = await A.evaluate(() => { window.eval('toast')('Something else'); return document.querySelectorAll('#toasts .toast:not(.out)').length });
ok(n2 === 2, 'a different message still shows beside it');
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
