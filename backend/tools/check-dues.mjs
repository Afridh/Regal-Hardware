// Credit follow-up: the server reminds customers who owe, once per step per debt, sends statements,
// never twice; the page shows it; new credit is stopped past the shop's days.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-dues.mjs [screenshot-dir]
// No real text goes anywhere: the test shop's SMS settings are pointed at a stand-in gateway on this
// PC, which counts what arrives.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

// a fresh start: what earlier runs of this test sent is forgotten — in the TEST database only (sepos_e2e)
{
  const path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const env = Object.fromEntries(fs.readFileSync(path.join(here, '../../server/.env'), 'utf8').split(/\r?\n/).map(l => /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]));
  const { default: pgmod } = await import('file:///' + path.join(here, '../node_modules/pg/lib/index.js').replace(/\\/g, '/'));
  const db = new pgmod.Client({ connectionString: env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/sepos_e2e$1') });
  await db.connect();
  for (const t of ['due_sent', 'due_log', 'due_runs']) await db.query(`DELETE FROM ${t}`).catch(() => {});
  await db.end();
}

// the stand-in gateway
const got = [];
const gw = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { const p = Object.fromEntries(new URLSearchParams(b)); got.push(p); res.setHeader('Content-Type', 'application/json'); res.end('{"success":true}') }) });
await new Promise(r => gw.listen(4019, '127.0.0.1', r));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
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
const api = (p, body) => fetch(BASE + '/api/dues' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());

// three customers who owe: oldest bills 10, 40 and 70 days old; the rest settled; SMS to the stand-in
const setup = await pg.evaluate(() => {
  const S = window.eval('S'), CFG = window.eval('CFG'), D = window.eval('D'), ago = n => D(new Date(Date.now() - n * 864e5));
  document.querySelectorAll('.modal').forEach(m => m.remove());
  CFG.msg = { ...CFG.msg, apiUrl: 'http://127.0.0.1:4019/send', apiKey: 'test', sender: 'TEST', provider: 'test', testOnly: '', supTestOn: false };
  const cs = S.customers.filter(c => c.id !== 1).slice(0, 3);
  const phones = ['0771110001', '0771110002', '0771110003'];
  S.sales.forEach(s => { if (s.customerId && s.customerId !== 1) s.balance = 0 });
  const ages = [10, 40, 70];
  cs.forEach((c, i) => { c.phone = phones[i]; c.noRemind = false; c.limit = 10000000;
    const s = S.sales.find(x => x.customerId === c.id) || S.sales[i];
    s.customerId = c.id; s.date = ago(ages[i]); s.balance = 1000 * (i + 1); s.type = 'CREDIT'; });
  CFG.dues = { on: true, at: '00:00', steps: [7, 30, 60], monthly: false, monthDay: 1, stopDays: 0 };
  window.eval("_caKey = ''");   // the ages are cached until a bill or payment is added; the dates were changed in place here
  window.eval('persist')(true);
  return cs.map((c, i) => ({ id: c.id, name: c.name, age: ages[i] }));
});
await wait(3500);

const g0 = await api('');
const plan = g0.plan || [];
ok(plan.length === 3, 'the server sees three customers to remind today', plan.map(p => p.kind + '@' + p.days).join(', '));
ok(plan.find(p => p.cid == setup[0].id)?.kind === 'remind1' && plan.find(p => p.cid == setup[1].id)?.kind === 'remind2' && plan.find(p => p.cid == setup[2].id)?.kind === 'remind3',
  '10 days → first reminder, 40 → overdue, 70 → final');

const r1 = await api('/run', {});
await wait(300);
ok(r1.sent === 3 && got.length === 3, 'Send now: three texts go out', `${r1.sent} sent, gateway got ${got.length}`);
const t70 = got.find(g => /0001|0002|0003/.test(g.to) && /Final reminder/.test(g.text));
ok(!!t70 && /Oldest bill: 70 days/.test(t70.text) && /Rs 3,000\.00/.test(t70.text), 'the final reminder says the days and the amount', (t70 || {}).text && t70.text.split('\n').slice(0, 4).join(' / '));
ok(got.every(g => /^Dear/.test(g.text)), 'laid out like every message from the shop (greeting, sign-off)');

const r2 = await api('/run', {});
ok(r2.sent === 0 && got.length === 3, 'run again: nothing is sent twice for the same step', `${r2.sent} sent`);

// by hand, one customer, again
const r3 = await api('/one', { cid: String(setup[1].id) });
ok(r3.sent === 1 && got.length === 4, '"Remind now" sends one by hand, even after the day\'s run');

// the server's own clock: switched on from 00:00, it has a run for today within a minute
let ran = null;
for (let i = 0; i < 14 && !ran; i++) { await wait(5000); const g = await api(''); ran = (g.runs || []).find(x => String(x.day) === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })); }
ok(!!ran, 'the server runs it by itself once a day (today\'s run is recorded)', ran ? `sent ${ran.sent}` : 'none');
ok(got.length === 4, 'and its own run sent nothing already sent');

// the page
await pg.evaluate(() => { window.eval('DUES').data = null; window.eval('go')('dues') }); await wait(1500);
const page = await pg.evaluate(() => document.getElementById('main').innerText);
ok(/Credit follow-up/.test(page) && /Who owes/.test(page) && /What has gone out/.test(page), 'the Credit follow-up page shows who owes and what has gone out');
ok(/Final reminder/.test(page) && /sent/.test(page), 'with each reminder that went');
await pg.screenshot({ path: OUT + '/dues-page.png', fullPage: true });

// stop new credit past 30 days: the panel says so and waits for an allow
await pg.evaluate(id => { const S = window.eval('S'), CFG = window.eval('CFG'); CFG.dues.stopDays = 30;
  const p = S.products.find(x => x.retail > 0 && x.stock > 20 && !x.open); window.eval('go')('pos');
  S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.customer = id; window.eval('render')() }, setup[1].id);
await pg.keyboard.press('F6'); await wait(500);
const panel = await pg.evaluate(() => (document.querySelector('.cp-sheet') || {}).innerText || '');
ok(/New credit is stopped/.test(panel) && await pg.evaluate(() => document.querySelector('.cp-save').disabled), 'a customer past the days: the credit panel says credit is stopped, and Save waits');
await pg.screenshot({ path: OUT + '/dues-stopped.png' });
await pg.keyboard.press('Escape');
await pg.evaluate(() => { window.eval('CFG').dues = { on: false, at: '10:00', steps: [7, 30, 60], monthly: true, monthDay: 1, stopDays: 0 }; window.eval('S').pos.lines = []; window.eval('persist')(true) });
await wait(1500);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · the stand-in gateway got ${got.length} texts, nothing real was sent`);
await b.close(); gw.close();
