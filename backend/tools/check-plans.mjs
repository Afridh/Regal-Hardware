// Easy payments: a bill split into monthly parts (with a fee), parts ticked off as they pay, the page, and
// the server reminding before a part falls due and when one is late (and not with the ordinary reminders).
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-plans.mjs [screenshot-dir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
{ const here = path.dirname(fileURLToPath(import.meta.url));
  const env = Object.fromEntries(fs.readFileSync(path.join(here, '../../server/.env'), 'utf8').split(/\r?\n/).map(l => /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]));
  const { default: pgmod } = await import('file:///' + path.join(here, '../node_modules/pg/lib/index.js').replace(/\\/g, '/'));
  const db = new pgmod.Client({ connectionString: env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/sepos_e2e$1') }); await db.connect();
  for (const t of ['due_sent', 'due_log', 'due_runs']) await db.query(`DELETE FROM ${t}`).catch(() => {}); await db.end(); }

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
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
const token = await pg.evaluate(() => regalBridge.token());

// a 9,000 credit bill for a customer with nothing else owed
const set = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove());
  window.__texts = []; window.sms = (to, body) => { window.__texts.push({ to, body }); return {} };
  const S = window.eval('S'), c = S.customers.find(x => x.id !== 1 && x.phone); c.limit = 10000000; c.noRemind = false;
  S.sales.forEach(s => { if (s.customerId === c.id) s.balance = 0 }); S.plans = [];
  const inv = window.eval('completeSale')({ lines: [{ pid: window.eval('OPEN_PID'), name: 'Plan test goods', qty: 1, price: 9000, disc: 0, open: true }], customerId: c.id, pays: [{ method: 'CREDIT', amount: 0 }], override: true });
  window.eval('persist')(true);
  return { cid: c.id, no: inv.no, phone: c.phone };
});

await pg.evaluate(no => window.eval('planNew')(no), set.no); await wait(300);
await pg.evaluate(() => { const n = document.querySelector('#epN'); n.value = '3'; n.dispatchEvent(new Event('input')); const f = document.querySelector('#epF'); f.value = '300'; f.dispatchEvent(new Event('input')) });
await wait(200);
const prev = await pg.evaluate(() => document.querySelector('#epP').innerText);
ok(/3 parts · Rs 9,300\.00|3 parts · 9,300\.00/.test(prev) && /3,100\.00/.test(prev), 'the window shows 3 parts of 3,100 (9,000 + 300 fee)', prev.split('\n')[0]);
await pg.screenshot({ path: OUT + '/plans-new.png' });
await pg.click('#epOk'); await wait(500);
const p = await pg.evaluate(() => { const S = window.eval('S'), p = S.plans[0]; return { p, st: window.eval('planState')(p), text: (window.__texts.slice(-1)[0] || {}).body || '' } });
ok(p.p && p.p.total === 9300 && p.p.parts.length === 3 && p.p.bills.length === 2, 'set up: 9,300 over 3 parts, the fee a bill of its own in the plan');
ok(/3 monthly parts of/.test(p.text) && /9,300/.test(p.text), 'the customer is texted the plan');
ok(p.st.paid === 0 && p.st.next && p.st.next.i === 0, 'nothing paid yet: part 1 is next');

// they pay 3,100 (the oldest bill first): part 1 is paid
await pg.evaluate(() => { const S = window.eval('S'), p = S.plans[0]; let left = 3100;
  for (const no of p.bills) { const s = S.sales.find(x => x.no === no); const a = Math.min(left, s.balance); s.balance = +(s.balance - a).toFixed(2); left -= a } });
const st2 = await pg.evaluate(() => window.eval('planState')(window.eval('S').plans[0]));
ok(st2.paid === 3100 && st2.parts[0].paid && !st2.parts[1].paid && st2.next.i === 1, 'after paying 3,100: part 1 ticked off, part 2 next', `paid ${st2.paid}`);

// the server: part 2 due tomorrow → a reminder; part 2 due yesterday → late
await pg.evaluate(() => { const S = window.eval('S'), p = S.plans[0], D = window.eval('D'); p.parts[1].due = D(new Date(Date.now() + 864e5)); window.eval('persist')(true) });
await wait(3000);
const api = () => fetch(BASE + '/api/dues', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json());
const g1 = await api(), mine = (g1.plan || []).filter(x => x.cid == set.cid);
ok(mine.length === 1 && mine[0].kind === 'planDue', 'the server: part 2 due tomorrow → a "due soon" reminder (and not an ordinary one)', JSON.stringify(mine));
await pg.evaluate(() => { const S = window.eval('S'), p = S.plans[0]; p.parts[1].due = window.eval('ago')(1); window.eval('persist')(true) });
await wait(3000);
const g2 = await api(), mine2 = (g2.plan || []).filter(x => x.cid == set.cid);
ok(mine2.length === 1 && mine2[0].kind === 'planLate', 'part 2 a day late → a "late" reminder', JSON.stringify(mine2));

// the page
await pg.evaluate(() => window.eval('go')('plans')); await wait(600);
const page = await pg.evaluate(() => document.getElementById('main').innerText);
ok(/Easy payments/.test(page) && /2 of 3/.test(page) && /late/.test(page), 'the Easy payments page: next part 2 of 3, late');
await pg.screenshot({ path: OUT + '/plans-page.png' });
await pg.evaluate(() => { window.eval('S').plans = []; window.eval('persist')(true) }); await wait(1500);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
