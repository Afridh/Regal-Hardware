// The sync system (8 Nov 2026, the owner asked for a proper one): bills made with no internet wait on the PC and go to
// the shop by themselves when the server answers again; the sync light says where things stand (green, amber, red
// after two minutes with a bar across the top); its window lists what waits and why, has Sync now and Save a copy
// to a file. Saves go packed (gzip), and plain if the host refuses packed. The server keeps quotations and expenses a
// save leaves out, unless the till deleted the expense on purpose.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-syncnow.mjs
// The till here never reaches the print helper on this PC: its printers are the shop's.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
let cut = false, refuseGzip = false; const puts = [];
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url();
  if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET') || /\/api\/sms\//.test(u)) return rq.abort();
  if (cut && /\/api\/books\/regal(\/rev)?(\?|$)/.test(u)) return rq.abort('internetdisconnected');
  if (rq.method() === 'PUT' && /\/api\/books\/regal$/.test(u)) {
    const enc = rq.headers()['content-encoding'] || ''; puts.push(enc);
    if (refuseGzip && enc === 'gzip') return rq.respond({ status: 415, contentType: 'application/json', body: '{"error":"no packed bodies here"}' });
  }
  rq.continue() });
const quiet = () => pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''"); window.printPaper = () => {}; window.print = () => {} });
async function signIn() {
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await wait(1500); await quiet();
}
const tok = () => pg.evaluate(() => regalBridge.token());
const books = async () => { const r = await fetch(BASE + '/api/books/regal', { headers: { Authorization: 'Bearer ' + await tok() } }); return r.json() };
const serverBills = async () => ((await books()).data.S.sales || []).map(s => s.no);
const make = () => pg.evaluate(() => { const S = window.eval('S'), p = S.products.find(x => x.id !== window.eval('OPEN_PID') && +x.retail > 0); p.stock = Math.max(+p.stock || 0, 100);
  const inv = window.eval('completeSale')({ lines: [{ pid: p.id, qty: 1, price: 640, disc: 0, belowCost: true }], customerId: 1, pays: [{ method: 'CASH', amount: 640 }], override: true });
  window.eval('persist')(true); return inv.no });
const light = () => pg.evaluate(() => { const el = document.getElementById('savedAtNav') || document.getElementById('savedAt'); const d = el && el.querySelector('.sy-dot');
  return { text: el ? el.innerText : '', k: d ? (d.className.match(/sy-(ok|busy|bad)/) || [])[1] : '', bar: (document.getElementById('syncAlarm') || {}).innerText || '' } });
const until = async (fn, ms = 15000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await wait(500) } return v };

await signIn();
await wait(2500);
let L = await light();
ok(L.k === 'ok' && /all sent/.test(L.text), 'the light is green: all sent', L.text);

// ---------- 1. no internet: the bill waits, the light goes amber, then red with a bar after the alarm time
await pg.evaluate(() => { window.SYNC_ALARM_MS = 2500 });
cut = true;
const no1 = await make();
L = await until(async () => { const x = await light(); return x.k === 'busy' && x }, 6000) || await light();
ok(L.k === 'busy' && /1 bill/.test(L.text), 'cut off: the light goes amber, sending 1 bill', L.text);
L = await until(async () => { const x = await light(); return x.k === 'bad' && x }, 10000) || await light();
ok(L.k === 'bad' && /1 bill not sent/.test(L.text), 'after the alarm time it goes red', L.text);
ok(/1 bill on this till has not reached the shop since/.test(L.bar), 'and a bar across the top says so', L.bar.slice(0, 90));
// the window
await pg.evaluate(() => document.getElementById('savedAtNav').click()); await wait(400);
let panel = await pg.evaluate(() => (document.getElementById('syncPanelBody') || {}).innerText || '');
ok(panel.includes(no1), 'the light opens the Sync window, which lists the waiting bill', no1);
ok(/could not be reached/.test(panel), 'and says why in plain words', (panel.match(/The shop[^.]*\./) || [''])[0]);
await pg.evaluate(() => document.getElementById('syGo').click());
const m1 = await until(() => pg.evaluate(() => { const x = document.getElementById('syMsg'); return x && !/Sending this till/.test(x.innerText) && x.innerText }), 60000);
ok(/could not be reached|did not answer/.test(m1 || ''), 'Sync now with no internet says it could not get through', m1);
ok(!(await serverBills()).includes(no1), 'the server does not have the bill yet');

// ---------- 2. the internet comes back: it goes by itself
cut = false;
await pg.evaluate(() => window.dispatchEvent(new Event('online')));
const got1 = await until(async () => (await serverBills()).includes(no1), 20000);
ok(got1, 'the internet back, the bill reaches the server by itself');
L = await until(async () => { const x = await light(); return x.k === 'ok' && x }, 10000) || await light();
ok(L.k === 'ok' && !L.bar, 'the light is green again and the bar is gone', L.text);
panel = await pg.evaluate(() => (document.getElementById('syncPanelBody') || {}).innerText || '');
ok(/Nothing is waiting/.test(panel), 'the open window says nothing is waiting');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// ---------- 3. Sync now sends it at once
cut = true;
const no2 = await make();
await wait(1500);
cut = false;
await pg.evaluate(() => document.getElementById('savedAtNav').click()); await wait(300);
await pg.evaluate(() => document.getElementById('syGo').click());
const m2 = await until(() => pg.evaluate(() => { const x = document.getElementById('syMsg'); return x && !/Sending this till/.test(x.innerText) && x.innerText }), 60000);
ok(/Sent/.test(m2 || ''), 'Sync now sends what waits', m2);
ok((await serverBills()).includes(no2), 'the server has it');
ok(puts.some(e => e === 'gzip'), 'saves go packed (gzip), and the server takes them');

// ---------- 4. Save a copy to a file
const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'regal-copy-'));
const cdp = await pg.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
await pg.evaluate(() => document.getElementById('syCopy').click());
const file = await until(() => { const f = fs.readdirSync(dl).filter(x => x.endsWith('.json')); return f.length && f[0] }, 10000);
let copyOk = false; try { const d = JSON.parse(fs.readFileSync(path.join(dl, file), 'utf8')); copyOk = Array.isArray(d.S.sales) && d.S.sales.some(s => s.no === no2) } catch (e) {}
ok(copyOk, 'Save a copy to a file writes the books, with the latest bill in', file || 'no file');
fs.rmSync(dl, { recursive: true, force: true });
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// ---------- 5. a host that refuses packed bodies: sent plain, and this till stops packing
refuseGzip = true; puts.length = 0;
const no3 = await make();
const got3 = await until(async () => (await serverBills()).includes(no3), 20000);
ok(got3 && puts.includes('gzip') && puts.includes(''), 'refused packed, it is sent plain and goes through', puts.join(','));
ok(await pg.evaluate(() => localStorage.getItem('regal_gzip_off')) === '1', 'and the till remembers not to pack');
await pg.evaluate(() => localStorage.removeItem('regal_gzip_off')); refuseGzip = false;

// ---------- 6. the server keeps a quotation a save leaves out, and an expense, unless deleted on purpose
const j = await books();
const S0 = j.data.S;
S0.docs = (S0.docs || []).concat([{ no: 'QTN-T9001', kind: 'QUOTE', date: '2026-11-08', customerId: 1, lines: [], total: 1234, status: 'open', by: 'Afridh' }]);
S0.expenses = (S0.expenses || []).concat([{ no: 'EXP-T9001', date: '2026-11-08', cat: '6100', amount: 50, method: 'CASH', desc: 'test', by: 'Afridh' }, { no: 'EXP-T9002', date: '2026-11-08', cat: '6100', amount: 60, method: 'CASH', desc: 'test two', by: 'Afridh' }]);
const put = async (data, rev) => { const r = await fetch(BASE + '/api/books/regal', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await tok() }, body: JSON.stringify({ data, rev }) }); return r.json() };
let r1 = await put(j.data, j.rev);
const j2 = await books(); const S2 = j2.data.S;
S2.docs = S2.docs.filter(d => d.no !== 'QTN-T9001');
S2.expenses = S2.expenses.filter(e => e.no !== 'EXP-T9001' && e.no !== 'EXP-T9002');
S2.gone = (S2.gone || []).concat([{ k: 'expense', no: 'EXP-T9002', by: 'Afridh' }]);
const r2 = await put(j2.data, j2.rev);
const S3 = (await books()).data.S;
ok(S3.docs.some(d => d.no === 'QTN-T9001'), 'a save without a quotation: the server keeps it', JSON.stringify(r2.keptBills || []));
ok(S3.expenses.some(e => e.no === 'EXP-T9001'), 'a save without an expense: the server keeps it');
ok(!S3.expenses.some(e => e.no === 'EXP-T9002'), 'an expense deleted on purpose stays out');

const real = errs.filter(e => !/Failed to fetch/.test(e));
ok(real.length === 0, 'no page errors', real.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
