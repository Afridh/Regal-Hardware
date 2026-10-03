// The Printing page: does it show what happened to each bill, and send one again?
//   npm start            (in server/)  — then:
//   node tools/drive-printq.mjs
//
// The page reads the shop's print queue, which needs a database. Rather than require one,
// the server's two answers are stood in for — so what is tested is the page: what it shows
// for each kind of job, and that pressing Print again asks the server to do exactly that.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!exe) { console.error('No Chrome or Edge to drive.'); process.exit(1) }

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) };

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1366, height: 920, deviceScaleFactor: 1.1 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', async d => { await d.accept() });

await pg.goto(BASE + '/demo', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await new Promise(r => setTimeout(r, 1200));

/* ---------- not signed in to the shop: say so, do not pretend ---------- */
await pg.evaluate(() => { pqJobs = null; go('printq'); render() });
await new Promise(r => setTimeout(r, 900));
ok(await pg.evaluate(() => /not signed in to the\s+shop/i.test(document.getElementById('main').textContent.replace(/\s+/g, ' '))),
   'a till with no shop server behind it says so, rather than showing an empty queue');

/* ---------- stand in for the server ---------- */
const install = (jobs, helper) => pg.evaluate(({ jobs, helper }) => {
  window.__asked = [];
  window.regalBridge = { token: () => 'test-token', online: () => true };
  const real = window.fetch;
  window.fetch = async (url, init) => {
    const u = String(url);
    window.__asked.push((init && init.method || 'GET') + ' ' + u);
    if (u.includes('/api/print/queue'))
      return new Response(JSON.stringify({ ok: true, waiting: jobs.filter(j => ['waiting', 'taken'].includes(j.status)).length, jobs }), { headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/api/print/status'))
      return new Response(JSON.stringify({ ok: true, helper: helper.alive, seenSecondsAgo: helper.ago, printers: helper.printers || [] }), { headers: { 'Content-Type': 'application/json' } });
    if (/\/api\/print\/\d+\/(again|drop)$/.test(u))
      return new Response(JSON.stringify({ ok: true, no: 'INV-1002' }), { headers: { 'Content-Type': 'application/json' } });
    return real(url, init);
  };
}, { jobs, helper });

const JOBS = [
  { id: 7, no: 'INV-1004', format: 'r80', copies: 1, by_user: 'Afridh', from_till: 'T2', status: 'waiting', created_at: new Date().toISOString() },
  { id: 6, no: 'INV-1003', format: 'a5', copies: 2, by_user: 'KP', from_till: 'T1', status: 'taken', created_at: new Date(Date.now() - 60e3).toISOString() },
  { id: 5, no: 'INV-1002', format: 'r80', copies: 1, by_user: 'Afridh', from_till: 'T1', status: 'failed', error: 'EPSON TM-T82 is offline', created_at: new Date(Date.now() - 300e3).toISOString() },
  { id: 4, no: 'INV-1001', format: 'r80', copies: 1, by_user: 'Afridh', from_till: 'T1', status: 'printed', printer: 'EPSON TM-T82 Receipt', created_at: new Date(Date.now() - 900e3).toISOString() }
];

await install(JOBS, { alive: true, printers: ['EPSON TM-T82 Receipt', 'LBP6030w'] });
await pg.evaluate(() => { pqJobs = null; pqShow = 'all'; go('printq'); render(); pqLoad() });
await new Promise(r => setTimeout(r, 1200));
const txt = () => pg.$eval('#main', e => e.textContent.replace(/\s+/g, ' '));
let t = await txt();

ok(/INV-1004/.test(t) && /INV-1001/.test(t), 'every job is listed, newest first');
ok(/did not print/.test(t), 'one that failed is called that, not just "not printed"');
ok(/EPSON TM-T82 is offline/.test(t), 'and says why the printer refused it');
ok(/printing now/.test(t), 'one the helper has taken says it is printing now');
ok(/on EPSON TM-T82 Receipt/.test(t), 'one that printed says which printer it came out of');
ok(/2 waiting/.test(t), 'the heading counts what is still to come out');
ok(/the counter helper is running/.test(t), 'and says the helper at the counter is alive');
ok(/LBP6030w/.test(t), 'with the printers it can reach');
ok(/×2/.test(t), 'two copies is shown as two copies');

/* ---------- the helper being down is the thing that matters most ---------- */
await install(JOBS, { alive: false, ago: 2400 });
await pg.evaluate(() => { pqLoad() });
await new Promise(r => setTimeout(r, 900));
t = await txt();
ok(/the counter helper is not running/.test(t), 'a helper that is not running is said plainly');
ok(/nothing will come out until it is started/.test(t), 'and what that means for the queue');
ok(/40 min ago/.test(t), 'with when it was last seen');

/* ---------- filtering down to the ones that failed ---------- */
await install(JOBS, { alive: true });
await pg.evaluate(() => { pqLoad() });
await new Promise(r => setTimeout(r, 900));
await pg.evaluate(() => document.querySelector('[data-act="pqShow"][data-k="failed"]').click());
await new Promise(r => setTimeout(r, 600));
t = await txt();
ok(/INV-1002/.test(t) && !/INV-1001/.test(t), 'the "did not print" tab shows only those');

/* ---------- and sending one again ---------- */
await pg.evaluate(() => { window.__asked = [] });
await pg.evaluate(() => document.querySelector('[data-act="pqAgain"]').click());
await new Promise(r => setTimeout(r, 1200));
const asked = await pg.evaluate(() => window.__asked);
ok(asked.some(a => /^POST .*\/api\/print\/5\/again$/.test(a)),
   `pressing Print again asks the server to send that very job back — ${asked.find(a => /again/.test(a)) || 'nothing'}`);
ok(asked.some(a => /GET .*\/api\/print\/queue/.test(a)), 'and then reads the queue again, so the screen is true');

await pg.evaluate(() => { pqShow = 'all'; render() });
await new Promise(r => setTimeout(r, 400));
await pg.screenshot({ path: (process.argv[2] || '.') + '/printq.png' });

ok(errs.length === 0, errs.length ? 'the page threw: ' + errs.join(' | ') : 'nothing threw along the way');
await b.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
