// Bills → Refresh (28 Nov 2026, the owner asked): a bill made on another till shows when Refresh is pressed.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billsrefresh.mjs [shot-folder]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
let hush = null;   // till 1 does not hear the server by itself until Refresh is pressed
const open = async (user = 'Afridh', pw = 'Afridh123') => { const ctx = await b.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 860 });
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.setRequestInterception(true); p.on('request', rq => { const u = rq.url(); if ((hush === p && rq.method() === 'GET' && /\/api\/books\/regal(\/rev)?(\?|$)/.test(u)) || /:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
  await p.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await p.$('#lockScreen')) {
    if (!(await p.$('#lockUser')) && !(await p.$('#lockPw'))) await p.evaluate(() => shopLockPassword());
    if (await p.$('#lockUser')) await p.type('#lockUser', user);
    await p.waitForSelector('#lockPw'); await p.type('#lockPw', pw); await p.click('#lockGo');
    await p.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await p.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(2000); return p };
const t1 = await open(); hush = t1; const t2 = await open('Akmal', 'Akmal123');   // one person per till: a second sign-in ends the first
await t1.evaluate(() => window.eval('go')('bills')); await t1.waitForSelector('[data-act="billsRefresh"]');
ok(true, 'Bills has a Refresh button');
const before = await t1.evaluate(() => window.eval('salesReal')().length);
// the other till makes a bill and it reaches the shop
const no = await t2.evaluate(async () => { const S = window.eval('S'), p = S.products.find(x => x.stock > 5 && x.retail > 0);
  const inv = window.eval('completeSale')({ lines: [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: p.retail }] }); window.eval('persist')(true); await new Promise(r => setTimeout(r, 1500)); const r = await window.regalBridge.syncNow(); return [inv.no, r.ok, r.error || ''] });
ok(no[1], 'the other till made bill ' + no[0] + ' and sent it');
await wait(500);
ok(!(await t1.evaluate(n => window.eval('S').sales.some(s => s.no === n), no[0])), 'this till does not have it yet');
hush = null; await t1.$eval('[data-act="billsRefresh"]', e => e.click());
await t1.waitForFunction(n => window.eval('S').sales.some(s => s.no === n), { timeout: 20000 }, no[0]).catch(() => {});
await wait(600);
const after = await t1.evaluate(n => ({ has: window.eval('S').sales.some(s => s.no === n), view: window.eval('S').view, n: window.eval('salesReal')().length, shown: document.querySelector('#main').innerText.includes(n), toast: [...document.querySelectorAll('.toast')].map(x => x.innerText).join(' ') }), no[0]);
ok(after.n === before + 1 && after.shown, 'Refresh: the bill is in the list', JSON.stringify(after));
if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await t1.screenshot({ path: path.join(SHOTS, 'bills-refresh.png') }) }
ok(!errs.length, 'no errors on the page', errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
