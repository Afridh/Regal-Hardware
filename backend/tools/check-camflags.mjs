// Risky moments at the till keep a camera clip and tell the owner; the Trail has a Watch button.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-camflags.mjs [screenshot-dir]
// The camera requests are answered here and counted — no camera job reaches any server's queue.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
const shots = [];
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url();
  // a saved bill's own pictures are answered but not counted — only the Trail's clips (TR-…)
  if (/\/api\/cams\/shot$/.test(u) && rq.method() === 'POST') { const j = JSON.parse(rq.postData() || '{}'); if (/^TR-/.test(j.ref)) shots.push(j); return rq.respond({ status: 200, contentType: 'application/json', body: '{"ok":true,"keepDays":122,"clip":30}' }) }
  if (/\/api\/cams\/shots\//.test(u)) return rq.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shots: [], clips: [], clip: { state: 'new' } }) });
  if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u) || (/\/api\/print\b/.test(u) && rq.method() === 'POST')) return rq.abort();
  rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const c = window.eval('camCfg')(); c.counter = '101'; c.flagOn = true; c.flagDisc = 10; c.flagLine = 1000; window.eval('go')('pos') });
const put = (lines) => pg.evaluate(ls => { const S = window.eval('S'), ps = S.products.filter(p => p.retail > 0 && p.stock > 50 && !p.open);
  S.pos.lines = ls.map((q, i) => ({ pid: ps[i].id, qty: q, price: ps[i].retail, disc: 0 })); S.pos.customer = null; S.pos.billDisc = 0; window.eval('render')(); return S.pos.lines.map(l => l.qty * l.price) }, lines);

// a bill cleared off the till with things on it
await put([2, 1]);
await pg.evaluate(() => window.eval('csClearAsk')()); await wait(200);
await pg.click('#clYes'); await wait(400);
const t1 = await pg.evaluate(() => window.eval('S').trail[0]);
ok(t1.kind === 'billCleared' && t1.cam && /^TR-/.test(t1.cam.ref), 'a bill cleared off the till: the Trail entry keeps a camera clip', t1.what);
ok(shots.length === 1 && shots[0].credit === true && shots[0].ref === t1.cam.ref && shots[0].ch === '101', 'the counter camera is asked for pictures and a clip, kept as long as a credit bill\'s');
ok(await pg.evaluate(() => /📹 Bill cleared/.test((window.eval('S').notif[0] || {}).text || '')), 'and the owner is told, with 📹');

// a line taken off: small does not count, large does
const vals = await put([1, 20]);
const small = vals[0] < 1000 ? 0 : -1, big = vals[1] >= 1000 ? 1 : -1;
const n0 = shots.length;
if (small === 0) { await pg.evaluate(() => window.eval('logTrail')('lineOff', 'test small line', { amount: 100 })); }
await pg.evaluate(() => window.eval('logTrail')('lineOff', 'test big line', { amount: 25000 }));
ok(shots.length === n0 + 1, 'a line taken off: only one worth the shop\'s amount (Rs 1,000 here) keeps a clip', `${shots.length - n0} asked`);

// a big discount on a bill that is saved
const n1 = shots.length;
await put([2]);
await pg.evaluate(() => { const S = window.eval('S'); const tot = S.pos.lines.reduce((a, l) => a + l.qty * l.price, 0); S.pos.billDisc = +(tot * 0.2).toFixed(2);
  window.eval('finishTillBill')({ cust: window.eval('C')(1), pays: [{ method: 'CASH', amount: +(tot * 0.8).toFixed(2) }] }) });
await wait(300);
const t3 = await pg.evaluate(() => window.eval('S').trail[0]);
ok(t3.kind === 'bigDisc' && /20\.0%/.test(t3.what) && shots.length === n1 + 1, 'a 20% discount on a saved bill: on the Trail, with a clip', t3.what);

// a small discount does not
const n2 = shots.length, topBefore = await pg.evaluate(() => window.eval('S').trail[0].id);
await put([2]);
await pg.evaluate(() => { const S = window.eval('S'); const tot = S.pos.lines.reduce((a, l) => a + l.qty * l.price, 0); S.pos.billDisc = +(tot * 0.02).toFixed(2);
  window.eval('finishTillBill')({ cust: window.eval('C')(1), pays: [{ method: 'CASH', amount: +(tot * 0.98).toFixed(2) }] }) });
await wait(200);
ok(shots.length === n2 && (await pg.evaluate(() => window.eval('S').trail[0].id)) === topBefore, 'a 2% discount is not flagged (nothing new on the Trail)');

// the Trail page: Watch opens the camera window for that moment
await pg.evaluate(() => window.eval('go')('trail')); await wait(600);
const watch = await pg.$('[data-act="trCam"]');
ok(!!watch, 'the Trail shows 📹 Watch on the entries with a clip');
if (watch) { await watch.click(); await wait(800);
  const win = await pg.evaluate(() => (document.querySelector('.bc-box') || {}).innerText || '');
  ok(/Saved with the bill|Recording/.test(win) && /Big discount|Bill cleared|Line taken off/.test(win), 'Watch opens the camera window at that moment', win.split('\n')[0]);
  await pg.screenshot({ path: OUT + '/camflag-window.png' });
  await pg.keyboard.press('Escape'); await wait(200); }

// switched off: nothing is asked of the cameras
const n3 = shots.length;
await pg.evaluate(() => { window.eval('camCfg')().flagOn = false; window.eval('logTrail')('holdDiscard', 'switched off test', { amount: 5000 }) });
ok(shots.length === n3, 'switched off in Settings → Cameras: no clip is asked for');
await pg.evaluate(() => { window.eval('camCfg')().flagOn = true });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · ${shots.length} camera requests answered here`);
await b.close();
