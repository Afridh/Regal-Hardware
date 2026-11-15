// The held bills window asks the server itself (15 Nov 2026: a bill held on another PC took a while to show —
// the till asks every 10 seconds, every minute when left alone, and not while a bill is being keyed):
//  · opened, it asks the server at once — a bill just held at the other till is there
//  · R (or F5 again) asks again, with the window open; it says what came in
//  · opened with nothing on hold, it looks too, and shows the list if one came in
// Two tills, each its own browser profile and person (Afridh, Akmal), signed in to the test server. Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-heldrefresh.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const errs = [];
async function till(name, live, user = 'Afridh', pass = 'Afridh123') {
  const ctx = await b.createBrowserContext(); const pg = await ctx.newPage(); await pg.setViewport({ width: 1366, height: 768 });
  pg.on('pageerror', e => errs.push(name + ': ' + e.message)); pg.on('dialog', d => d.accept());
  await pg.setRequestInterception(true); pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
  if (live) await pg.evaluateOnNewDocument(() => { try { localStorage.setItem('regal_pace', 'live') } catch (e) {} });   // the shop's own pace: every 10 s
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', user);
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', pass); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(1500);
  await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval('go')('pos') });
  return pg;
}
const A = await till('A'), B = await till('B', true, 'Akmal', 'Akmal123');   // one person per till: a second sign-in ends the first
const hold = async (ref) => {
  await A.evaluate(ref => { const S = window.eval('S'); const p = S.products.find(x => +x.retail > 0 && x.id !== window.eval('OPEN_PID'));
    S.pos.lines = [{ pid: p.id, qty: 1, price: +p.retail, disc: 0 }]; S.pos.customer = null; window.eval('holdCurrentBill')(true, ref) }, ref);
  await wait(4500);
};
const onB = (ref) => B.evaluate(ref => (window.eval('S').heldBills || []).some(h => h.ref === ref), ref);
const cards = () => B.evaluate(() => [...document.querySelectorAll('.hb-card .hb-c-name')].map(x => x.textContent.trim()));
const status = () => B.evaluate(() => (document.querySelector('#hbSt') || {}).textContent || '');
const seen = (t) => B.waitForFunction(t => [...document.querySelectorAll('.hb-card .hb-c-name')].some(x => x.textContent.includes(t)), { timeout: 15000 }, t).catch(() => {});
// B is keying a bill, so its own poll does not pull anything
await B.evaluate(() => { const S = window.eval('S'); const p = S.products.find(x => +x.retail > 0 && x.id !== window.eval('OPEN_PID')); S.pos.lines = [{ pid: p.id, qty: 1, price: +p.retail, disc: 0 }]; window.eval('render')() });
const keepBusy = setInterval(() => { B.keyboard.press('Shift').catch(() => {}) }, 700);
const tag = 'HB' + Date.now().toString(36).slice(-4).toUpperCase();
// 1) A holds one; B, with nothing on hold, opens the window
await hold(tag + '-1');
await B.evaluate(() => window.eval('showHeldBillsModal')(0));
await seen(tag + '-1');
ok((await cards()).some(c => c.includes(tag + '-1')), 'opened: it asks the server itself, and the bill from A comes up', JSON.stringify(await cards()));
// 2) with the window open, A holds another; R brings it
await hold(tag + '-2');
ok(!(await cards()).some(c => c.includes(tag + '-2')), "the second one is not on B's window yet");
await B.keyboard.press('r'); await seen(tag + '-2');
ok((await cards()).some(c => c.includes(tag + '-2')) && /1 new from another till/.test(await status()), 'R asks again: it comes up, and the window says one came in', await status());
// 3) F5 in the window refreshes too (it does not reload the page)
await hold(tag + '-3');
const mark = await B.evaluate(() => (window.__mark = Math.random()));
await B.keyboard.press('F5'); await seen(tag + '-3');
ok((await cards()).some(c => c.includes(tag + '-3')) && (await B.evaluate(() => window.__mark)) === mark, 'F5 in the window does the same, and the page is not reloaded');
ok(!!(await B.$('#hbRef')), 'there is a Refresh button on the window');
ok((await B.evaluate(() => window.eval('S').pos.lines.length)) === 1, 'the bill being keyed on B is untouched');
clearInterval(keepBusy);
// tidy: take the test bills off hold
await B.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); S.heldBills = (S.heldBills || []).filter(h => !/^HB/.test(h.ref || '')); S.pos.lines = []; window.eval('render')(); window.eval('persist')(true) });
await wait(3000);
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
