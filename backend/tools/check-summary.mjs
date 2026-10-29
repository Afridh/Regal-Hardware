// The owner's closing summary: the server sends it at the shop's time when the day is not closed, with
// the day's figures and anything unusual, marks the day, and the till's close then stays quiet; a close
// sends it once.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-summary.mjs
// Texts go to a stand-in gateway on this PC (the server's) or are caught in the page (the till's).
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

// forget earlier runs of this test — the TEST database only
{ const here = path.dirname(fileURLToPath(import.meta.url));
  const env = Object.fromEntries(fs.readFileSync(path.join(here, '../../server/.env'), 'utf8').split(/\r?\n/).map(l => /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]));
  const { default: pgmod } = await import('file:///' + path.join(here, '../node_modules/pg/lib/index.js').replace(/\\/g, '/'));
  const db = new pgmod.Client({ connectionString: env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/sepos_e2e$1') }); await db.connect();
  await db.query('DELETE FROM sum_runs').catch(() => {}); await db.end(); }

const got = [];
const gw = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { got.push(Object.fromEntries(new URLSearchParams(b))); res.setHeader('Content-Type', 'application/json'); res.end('{"success":true}') }) });
await new Promise(r => gw.listen(4019, '127.0.0.1', r));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
const day = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'), CFG = window.eval('CFG'), D = window.eval('D');
  CFG.msg = { ...CFG.msg, apiUrl: 'http://127.0.0.1:4019/send', apiKey: 'test', sender: 'TEST', provider: 'test', testOnly: '', autoSummary: true };
  CFG.shop.owner = '0770000009'; CFG.bill.summaryTime = '00:00'; S.summarySent = {};
  window.eval('logTrail')('billCleared', '3 lines thrown away before billing', { amount: 4500 });
  window.eval('persist')(true);
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
});

// the server: within a minute it sends it, because the day is not closed and the time has passed
let t1 = null;
for (let i = 0; i < 16 && !t1; i++) { await wait(5000); t1 = got.find(g => /Today's summary/.test(g.text || '')) }
ok(!!t1 && t1.to === '94770000009', 'the day not closed by the shop\'s time: the server texts the owner', t1 ? 'to ' + t1.to : 'nothing came');
ok(!!t1 && /Bills: \d+/.test(t1.text) && /Profit: Rs/.test(t1.text) && /Collected from customers/.test(t1.text) && /Drawer: not counted yet/.test(t1.text), 'with the day\'s figures, profit, money collected and the drawer');
ok(!!t1 && /To look at \(\d+\):/.test(t1.text) && /bill cleared/.test(t1.text), 'and what is unusual on the Trail', t1 && t1.text.split('\n').slice(-3).join(' / '));
ok(!!t1 && /^Dear Owner,/.test(t1.text), 'laid out as a message to the owner');
await wait(6000);
ok(got.filter(g => /Today's summary/.test(g.text || '')).length === 1, 'only once, however many minutes pass');

// the till learns it went, and its close stays quiet
await pg.evaluate(() => regalBridge.pull && regalBridge.pull(true)); await wait(2500);
const sent = await pg.evaluate(d => (window.eval('S').summarySent || {})[d], day);
ok(sent === 'server' || sent === undefined, 'the server marks the day in the books (the till may not have pulled it yet)', String(sent));
// the till's own copy of the books may not have the mark yet: its close asks the server before sending
const quiet = await pg.evaluate(async d => { const tx = []; window.sms = (to, body) => { tx.push(body); return {} }; window.eval('S').summarySent = {}; await window.eval('deTellOwner')({ date: d, paidBy: {}, paidOut: 0 }); return tx.length }, day);
ok(quiet === 0, 'the close that day asks the server, hears it went, and sends nothing more');

// a day closed at the till: sent once, at the close
const fresh = await pg.evaluate(async () => { const tx = []; window.sms = (to, body) => { tx.push(body); return {} };
  await window.eval('deTellOwner')({ date: '2099-01-01', paidBy: {}, paidOut: 0 }); await window.eval('deTellOwner')({ date: '2099-01-01', paidBy: {}, paidOut: 0 });
  return { n: tx.length, body: tx[0] || '', mark: window.eval('S').summarySent['2099-01-01'] } });
ok(fresh.n === 1 && /Today's summary \(2099-01-01\)/.test(fresh.body) && fresh.mark === 'till', 'a day closed at the till: the summary goes once, at the close', `${fresh.n} sent`);
await pg.evaluate(() => { window.eval('CFG').bill.summaryTime = '19:30'; window.eval('persist')(true) }); await wait(1500);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · the stand-in gateway got ${got.length} text(s), nothing real was sent`);
await b.close(); gw.close();
