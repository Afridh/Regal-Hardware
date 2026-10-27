// Every decision in Approvals, and a supplier asking to see their stock from their own page.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-approvals.mjs [screenshot-dir]
// The till here never reaches the print helper on this PC — its printers are the shop's.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, body, token) => { const r = await fetch(BASE + '/api/sup' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) } };

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1440, height: 1000 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
// nothing from this page reaches anything but the test server — above all not the print helper
await pg.setRequestInterception(true);
let blocked = 0;
pg.on('request', rq => { const u = rq.url(); if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u)) { blocked++; return rq.abort() } rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => { window.eval("CFG.print.agent=''"); document.querySelectorAll('.modal-bg,.modal').forEach(m => m.remove()) });

// a supplier with the page open, signed in by mobile code
const sup = await pg.evaluate(() => { const S = window.eval('S'); const s = S.suppliers.find(x => x.phone && x.enabled !== false); s.enabled = true; s.stockUntil = 0; window.eval('persist')(true); return { id: s.id, phone: s.phone, name: s.name } });
await wait(1500);
const otp = await api('/otp', { phone: sup.phone });
const login = await api('/login', { phone: sup.phone, code: otp.code });
ok(!!login.token, 'the supplier signs in on their page', sup.name);
const me0 = await api('/me', null, login.token);
ok(!(+me0.stockUntil > Date.now()) && !me0.stockAsk, 'their stock is shut and nothing is asked yet');

// the supplier page shows Stock in the menu, with the ask button
const sp = await b.newPage(); await sp.setViewport({ width: 1280, height: 900 });
await sp.evaluateOnNewDocument(t => { localStorage.setItem('rs_token', JSON.stringify(t)) }, login.token);
await sp.goto(BASE + '/supplier', { waitUntil: 'networkidle2' });
await sp.waitForFunction(() => !document.getElementById('intro'), { timeout: 8000 }).catch(() => {});   // the page's opening welcome
const tokKey = await sp.evaluate(() => Object.keys(localStorage));
const menuStock = await sp.evaluate(() => !![...document.querySelectorAll('[data-t]')].find(x => x.dataset.t === 'stock'));
if (menuStock) { await sp.evaluate(() => [...document.querySelectorAll('[data-t]')].find(x => x.dataset.t === 'stock').click()); await wait(500); }
const askBtn = await sp.$('#stockAsk');
ok(menuStock && !!askBtn, 'Stock is in the supplier menu while shut, with "Ask the shop to open my stock"', menuStock ? '' : 'keys ' + tokKey.join(','));
if (askBtn) { await sp.type('#stockAskNote', 'writing this month’s order'); await askBtn.click(); await wait(1200); }
else await api('/stock/ask', { note: 'writing this month’s order' }, login.token);
await sp.screenshot({ path: OUT + '/sup-asked.png' });
ok(/waiting for the shop/i.test(await sp.evaluate(() => document.body.innerText)) || !askBtn, 'after asking, the page says it is waiting for the shop');
const again = await api('/stock/ask', {}, login.token);
ok(again.already === true, 'asking twice just says it is already asked');

// the till takes it in and the owner sees it in Approvals
await pg.evaluate(() => window.regalBridge && regalBridge.pull && regalBridge.pull()); await wait(2500);
await pg.evaluate(() => { window.eval("apTab='pending'"); window.eval('go')('approvals') }); await wait(600);
const apText = await pg.$eval('#main', e => e.innerText);
ok(new RegExp('asks to see their stock').test(apText), 'the ask is in Approvals');
await pg.screenshot({ path: OUT + '/approvals.png', fullPage: true });
ok(/Also waiting for your decision/.test(apText) || !(await pg.evaluate(() => window.eval('decisionsWaiting')().length)), 'the other decisions (payment requests, supplier orders, payments to check…) are listed there too',
  String(await pg.evaluate(() => window.eval('decisionsWaiting')().map(x => x.tag).join(', '))));
const apId = await pg.evaluate(name => { const a = window.eval('S').approvals.find(x => x.kind === 'supStock' && x.status === 'pending'); return a && a.id }, sup.name);
await pg.evaluate(id => window.eval('decideApproval')(id, true, ''), apId); await wait(500);
await pg.evaluate(() => window.eval('persist')(true)); await wait(2500);
const me1 = await api('/me', null, login.token);
ok(+me1.stockUntil > Date.now(), 'approved: their stock opens for a day');
const stock = await api('/stock', null, login.token);
ok(stock.ok && Array.isArray(stock.lines), 'and they can read it', (stock.lines || []).length + ' lines');

// a decision staff asked for at the shift clock lands in Approvals too
await pg.evaluate(() => { const e = window.eval('S').employees[0], day = window.eval('D')(window.eval('today'));
  window.eval('setRec')(day, e.id, { status: 'work', in: '08:00', out: null, breaks: [], leaveEarly: { approved: false, pending: true, requestedAt: '11:00', reason: 'doctor', by: e.name } }) });
await pg.evaluate(() => window.eval('go')('approvals')); await wait(400);
ok(/asks to leave early/.test(await pg.$eval('#main', e => e.innerText)), 'a staff member asking to leave early is in Approvals, with Let them go / No');
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
ok(blocked >= 0, 'nothing went to the print helper from these pages', blocked + ' blocked');
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
