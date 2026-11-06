// The Action centre's "Check now" button: asks the server at once instead of waiting for the next look,
// says what it found, saves this till's own work first, and cannot be used to hammer the server.
// While the Action centre is on the screen the till keeps looking every 10 s, even with nobody touching it.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-actcheck.mjs [screenshot-dir]
// The till runs at the live pace here (regal_pace=live), and never reaches the print helper on this PC.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, body, token) => { const r = await fetch(BASE + '/api/sup' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) } };

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
let revCalls = 0, cutOff = false; const revAt = [];
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url();
  if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u)) return rq.abort();
  if (/\/books\/[^/]+\/rev/.test(u)) { revCalls++; revAt.push(Date.now()) }
  if (cutOff && /\/books\//.test(u)) return rq.abort();
  rq.continue() });
await pg.evaluateOnNewDocument(() => { try { localStorage.setItem('regal_pace', 'live') } catch (e) {} });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => { window.eval("CFG.print.agent=''"); window.printPaper = () => {}; document.querySelectorAll('.modal').forEach(m => m.remove()) });

const sup = await pg.evaluate(() => { const S = window.eval('S'), s = S.suppliers.find(x => x.phone && x.enabled !== false); s.enabled = true; window.eval('persist')(true); return { id: s.id, phone: s.phone, name: s.name } });
await wait(4000);
const otp = await api('/otp', { phone: sup.phone });
const login = await api('/login', { phone: sup.phone, code: otp.code, rep: 'Check rep' });
ok(!!login.token, 'a supplier signs in on their page', sup.name);

await pg.evaluate(() => window.eval('go')('approvals')); await wait(600);
const btn = () => pg.$('[data-act="actCheck"]');
ok(!!(await btn()), 'the Action centre has the button');
const label = () => pg.evaluate(() => { const x = document.querySelector('[data-act="actCheck"]'); return x ? x.innerText : '' });
ok(/check now/i.test(await label()), 'it says Check now', await label());
const toastSays = () => pg.evaluate(() => [...document.querySelectorAll('.toast,.toasts *')].map(t => t.innerText).join(' | '));
const clearToasts = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
const press = () => pg.evaluate(() => document.querySelector('[data-act="actCheck"]').click());

// nothing new
await wait(3200); await clearToasts(); await press(); await wait(1500);
ok(/nothing new/i.test(await toastSays()), 'nothing waiting: it says nothing new', await toastSays());
ok(/checked/i.test(await pg.evaluate(() => document.querySelector('.ib-check-wrap')?.innerText || '')), 'and when it last looked', await pg.evaluate(() => document.querySelector('.ib-check-wrap')?.innerText || ''));
if (OUT) await pg.screenshot({ path: OUT + '/act-check.png' });

// something new, straight away: long before the next 10 s look would have found it
await wait(3200); await clearToasts();
const up = await api('/order', { text: 'Check-now test order: 5 bags', photos: [] }, login.token);
ok(up.status === 200, 'the supplier sends an order');
const id = 'sp' + up.id;
const t0 = Date.now(); await press();
await pg.waitForFunction(i => window.eval('S').orders.some(o => o.id === i), { timeout: 6000 }, id).catch(() => {});
const took = Date.now() - t0;
ok(await pg.evaluate(i => window.eval('S').orders.some(o => o.id === i), id), 'pressed: the new order is there', took + ' ms');
ok(took < 4000, 'well before the next regular look', took + ' ms');
await wait(600);
ok(/1 new/i.test(await toastSays()), 'it says how many are new', await toastSays());
ok(await pg.evaluate(() => [...document.querySelectorAll('.act-item')].some(x => /Check-now test order/.test(x.innerText))), 'and the order is on the screen');

// pressing again and again asks only once
await wait(3200); let before = revCalls;
await pg.evaluate(() => { const x = document.querySelector('[data-act="actCheck"]'); for (let i = 0; i < 6; i++) x.click() }); await wait(1200);
ok(revCalls - before === 1, 'six quick presses ask the server once', String(revCalls - before));

// work on this till not saved yet is saved first, never wiped
await wait(3200); await clearToasts();
const memo = 'unsaved-' + Date.now();
await pg.evaluate(m => { const S = window.eval('S'); S.notices = S.notices || []; S.notices.push({ id: m, status: 'closed', kind: 'test', text: m }) }, memo);
await press(); await wait(5000);
ok(await pg.evaluate(m => window.eval('S').notices.some(n => n.id === m), memo), 'work on this till not yet saved survives the check');

// the server cannot be reached
await wait(3200); await clearToasts(); cutOff = true;
await press(); await wait(1800); cutOff = false;
ok(/could not reach/i.test(await toastSays()), 'no server: it says so, and does not say nothing new', await toastSays());
ok(await pg.evaluate(() => !document.querySelector('[data-act="actCheck"]').disabled), 'the button works again afterwards');

// nobody touching the till: on the Action centre it keeps looking every 10 s, elsewhere every 60 s
await pg.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 6 * 60000 });   // nobody has touched it for 6 minutes
await wait(3000); before = revCalls; await wait(45000);
const onActions = revCalls - before;
const gaps = revAt.slice(before).map((t, i, a) => i ? t - a[i - 1] : 0).slice(1);
ok(onActions >= 3 && gaps.every(g => g >= 9000), 'left on the Action centre: it still looks about every 10 s', onActions + ' looks in 45 s, gaps ' + gaps.join());
await pg.evaluate(() => { window.eval('S').view = 'products'; window.eval('render')() });
await wait(3000); before = revCalls; await wait(30000);
ok(revCalls - before <= 1, 'left on another page: the slower pace stands, for the firewall', (revCalls - before) + ' looks in 30 s');

ok(errs.length === 0, 'no errors in the page', errs.join(' | '));
await pg.evaluate((i, m) => { const S = window.eval('S'); S.orders = S.orders.filter(o => o.id !== i); S.notices = S.notices.filter(n => n.id !== m); window.eval('persist')(true) }, id, memo);
await wait(4000);
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
