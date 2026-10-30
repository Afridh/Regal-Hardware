// Stock from a phone: a person's link opens their page; they find an item, count it, and add / remove
// with a reason; a wrong link sees nothing; the entries wait on the till's Stock take page; posting moves
// the stock (a count against what the books said when it was counted) and books it as a stock take.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-stockphone.mjs [screenshot-dir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 860 });
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

// a person to count, made from the Stock take page
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); S.phoneCounts = []; S.stockers = []; window.eval('go')('stocktake') }); await wait(500);
await pg.click('[data-act="stkPerson"][data-id=""]'); await wait(300);
await pg.type('#spN', 'Kamal'); await pg.type('#spP', '0775550123'); await pg.click('#spOk'); await wait(300);
const set = await pg.evaluate(() => { const S = window.eval('S'); const p = S.products.find(x => x.active !== false && x.cost > 0 && x.stock >= 10 && x.num);
  const q = S.products.find(x => x.active !== false && x !== p && x.cost > 0 && x.stock >= 5);
  window.eval('persist')(true); return { key: S.stockers[0].key, pid: p.id, num: String(p.num), name: p.name, stock: p.stock, cost: p.cost, qid: q.id, qname: q.name, qstock: q.stock } });
ok(set.key && set.key.length >= 12, 'Kamal has a link of his own');
await wait(2500);

// the phone
const bad = await (await fetch(BASE + '/api/stockup/me?k=wrongwrongwrong1')).json();
ok(/not for anyone/.test(bad.error || ''), 'a wrong link sees nothing');
const ph = await b.newPage(); await ph.setViewport({ width: 390, height: 820, isMobile: true, hasTouch: true });
ph.on('pageerror', e => errs.push('phone: ' + e.message));
await ph.goto(BASE + '/stockup?k=' + set.key, { waitUntil: 'networkidle2' }); await wait(600);
ok(await ph.evaluate(() => /Kamal/.test(document.querySelector('#hName').textContent)), "Kamal's page opens on the phone");
// count: type the item's number, Enter, count 3 fewer than the books
await ph.type('#q', set.num); await ph.keyboard.press('Enter'); await wait(300);
const shown = await ph.evaluate(() => document.querySelector('.item') && document.querySelector('.item').innerText);
ok(shown && shown.includes(set.name) && /On the books/.test(shown), 'typing the item number brings the item, and what the books say', (shown || '').slice(0, 80));
await ph.type('#qn', String(set.stock - 3)); await wait(200);
{ const dt = await ph.evaluate(() => ({ d: (document.querySelector('.diff') || {}).textContent, v: document.querySelector('#qn').value })); ok(/-3 /.test(dt.d || ''), 'it shows the difference before sending (−3)', JSON.stringify(dt)) }
await ph.screenshot({ path: OUT + '/stock-phone-count.png' });
await ph.click('#send'); await wait(1200);
// remove 2 damaged of another item, found by name
await ph.type('#q', set.qname.slice(0, 6)); await wait(300);
await ph.click(`[data-pid="${set.qid}"]`); await wait(200);
await ph.click('[data-mode="remove"]'); await wait(150);
await ph.type('#qn', '2'); await ph.click('[data-r="Damaged"]'); await wait(150);
await ph.click('#send'); await wait(1200);
await ph.screenshot({ path: OUT + '/stock-phone-list.png' });
const log = await ph.evaluate(() => document.querySelector('.log') && document.querySelector('.log').innerText);
ok(/counted/.test(log || '') && /removed 2/.test(log || '') && /waiting for the shop/.test(log || ''), 'the phone lists today\'s entries, waiting for the shop');
// a sale between the count and the posting must not be counted twice
await pg.evaluate(() => regalBridge.pull && regalBridge.pull(true)); await wait(2500);
await pg.evaluate(pid => { window.eval('completeSale')({ lines: [{ pid, qty: 1, price: window.eval('priceFor')(window.eval('P')(pid), 1), disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: window.eval('priceFor')(window.eval('P')(pid), 1) }], override: true }) }, set.pid);

// the till
await pg.evaluate(() => window.eval('go')('stocktake')); await wait(500);
const card = await pg.evaluate(() => document.querySelector('#main').innerText);
ok(/From phones/.test(card) && /2 waiting/.test(card) && card.includes(set.name) && /Kamal/.test(card), 'the Stock take page shows 2 waiting from Kamal');
await pg.screenshot({ path: OUT + '/stock-phone-till.png' });
await pg.$eval('[data-act="stkPhPostAll"]', b => b.click()); await wait(600);
const after = await pg.evaluate(o => { const S = window.eval('S'), P = window.eval('P'); return { p: P(o.pid).stock, q: P(o.qid).stock, st: S.stocktakes.slice(-1)[0], left: window.eval('phonePending')().length } }, set);
ok(Math.abs(after.p - (set.stock - 1 - 3)) < 1e-6, 'the count posted: 3 short against the books then, and the sale since is not lost', `${set.stock} → sold 1 → ${after.p}`);
ok(Math.abs(after.q - (set.qstock - 2)) < 1e-6, 'the 2 damaged came off');
ok(after.st && /From phones — Kamal/.test(after.st.note) && Math.abs(after.st.short - (3 * set.cost + 2 * (await pg.evaluate(id => window.eval('P')(id).cost, set.qid)))) < 0.05 && after.left === 0, 'booked as a stock take, at cost, nothing left waiting', after.st && after.st.note);
// a turned-down entry leaves the stock alone
await pg.evaluate(() => regalBridge.pull && regalBridge.pull(true)); await wait(1500);
await fetch(BASE + '/api/stockup/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: set.key, pid: set.qid, mode: 'add', qty: 10, reason: 'Found' }) });
// the till takes the books again once it is more than 3 seconds since its own last save
for (let i = 0; i < 6 && !(await pg.evaluate(() => window.eval('phonePending')().length)); i++) { await wait(2000); await pg.evaluate(() => regalBridge.pull && regalBridge.pull(true)); await wait(800) }
const q0 = await pg.evaluate(id => window.eval('P')(id).stock, set.qid);
await pg.evaluate(() => window.eval('go')('stocktake')); await wait(400);
await pg.$eval('[data-act="stkPhRejAll"]', b => b.click()); await wait(400);
ok(await pg.evaluate(id => window.eval('P')(id).stock, set.qid) === q0 && await pg.evaluate(() => window.eval('phonePending')().length) === 0, 'turned down: the stock stays as it was');
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
