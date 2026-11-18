// Credit bills print (18 Nov 2026, the owner asked — they went out as an e-bill only): with "Always print" on (the
//   default) a credit bill texted as an e-bill prints its A5 too; "Copies" 2 adds one marked COPY; "No print" stays no
//   print; a cash bill is as before.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-creditprint.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(1000);
const run = (k, credit, set) => pg.evaluate(async (k, credit, set) => {
  const CFG = window.eval('CFG'), S = window.eval('S'); const was = { ...CFG.done };
  Object.assign(CFG.done, { printAnim: false, preview: false }, set || {});
  const c = S.customers.find(x => x.id !== 1 && x.phone) ;
  const inv = { no: 'TST-' + k, customerId: c.id, total: 1000, paid: credit ? 0 : 1000, balance: credit ? 1000 : 0, type: credit ? 'CREDIT' : 'CASH', pays: credit ? [{ method: 'CREDIT', amount: 0 }] : [{ method: 'CASH', amount: 1000 }], lines: [], link: 'https://x/b/1' };
  const got = []; const pb = window.printBill, sm = window.sms;
  window.printBill = (i, f) => got.push(['print', f, !!i.reprint]); window.sms = (to) => got.push(['sms', to]);
  try { window.eval('printAnim')(inv, k); await new Promise(r => setTimeout(r, 1800)) } finally { window.printBill = pb; window.sms = sm; Object.keys(CFG.done).forEach(x => delete CFG.done[x]); Object.assign(CFG.done, was) }
  return got;
}, k, credit, set);
let g = await run('sms', true);
ok(g.some(x => x[0] === 'sms') && g.filter(x => x[0] === 'print' && x[1] === 'a5').length === 1, 'a credit bill sent as an e-bill also prints its A5', JSON.stringify(g));
g = await run('a5', true);
ok(g.length === 1 && g[0][1] === 'a5' && !g[0][2], 'a credit bill on A5 prints once', JSON.stringify(g));
g = await run('a5', true, { creditCopies: 2 });
ok(g.length === 2 && !g[0][2] && g[1][2], 'Copies 2: the bill, then one marked COPY', JSON.stringify(g));
g = await run('sms', true, { creditCopies: '2' });
ok(g.filter(x => x[0] === 'print').length === 2 && g.some(x => x[0] === 'sms'), 'e-bill and both copies', JSON.stringify(g));
g = await run('none', true);
ok(!g.length, '"No print" picked on the bill is still no print', JSON.stringify(g));
g = await run('sms', true, { creditPrint: false });
ok(!g.some(x => x[0] === 'print'), 'with "Always print" off, an e-bill is only texted', JSON.stringify(g));
g = await run('sms', false);
ok(!g.some(x => x[0] === 'print'), 'a cash bill texted is not printed (as before)', JSON.stringify(g));
// the settings
await pg.evaluate(() => { window.eval('go')('settings'); window.eval('setTab = "done"'); window.eval('render')() }); await wait(400);
const s = await pg.evaluate(() => ({ chk: document.querySelector('[data-set="done.creditPrint"]')?.checked, sel: document.querySelector('[data-set="done.creditCopies"]')?.value }));
ok(s.chk === true && s.sel === '1', 'Settings → Bill end: "Always print" ticked, 1 copy', JSON.stringify(s));
await pg.select('[data-set="done.creditCopies"]', '2'); await wait(200);
const cp = await pg.evaluate(() => window.eval('CFG').done.creditCopies); await pg.select('[data-set="done.creditCopies"]', '1');
ok(+cp === 2, 'choosing 2 copies saves', JSON.stringify(cp));
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
