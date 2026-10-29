// Damage & warranty returns: a customer's faulty piece taken back against its bill (replaced from the shelf,
// or the customer waits for the supplier); the supplier texted; the label and the customer's slip printed;
// payments to that supplier held (and the owner's pay-anyway); the management page; the supplier's page
// shows the returns and their answer comes back to the shop.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-dmg.mjs [screenshot-dir]
// Texts go to a stand-in gateway on this PC; printers are stopped.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const got = [];
const gw = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { got.push(Object.fromEntries(new URLSearchParams(b))); res.setHeader('Content-Type', 'application/json'); res.end('{"success":true}') }) });
await new Promise(r => gw.listen(4019, '127.0.0.1', r));

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

// a supplier with a mobile and its page open, an item of theirs on the shelf, and a customer's bill for it
const set = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'), CFG = window.eval('CFG');
  CFG.msg = { ...CFG.msg, apiUrl: 'http://127.0.0.1:4019/send', apiKey: 'test', sender: 'TEST', provider: 'test', testOnly: '', supTestOn: false, live: true };
  CFG.dmg = { holdPay: true, textSup: true };
  window.__slips = []; window.eval('printPaper = (html, f, no) => { window.__slips.push({ html, f, no }) }');
  const s = S.suppliers[0]; s.phone = '0775550099'; s.enabled = true; s.active = true;
  S.damages = S.damages.filter(d => d.sid !== s.id || !['held', 'sent'].includes(d.status));
  const p = S.products.find(x => x.active !== false && x.cost > 0 && x.stock >= 5);
  p.supplierId = s.id; p.warrantyMonths = 12;
  const c = S.customers.find(x => x.id !== 1 && x.phone); c.limit = 1e8;
  const inv = window.eval('completeSale')({ lines: [{ pid: p.id, qty: 2, price: window.eval('priceFor')(p, 1), disc: 0 }], customerId: c.id, pays: [{ method: 'CREDIT', amount: 0 }], override: true });
  window.eval('persist')(true);
  return { sid: s.id, sname: s.name, pid: p.id, pname: p.name, cid: c.id, cphone: c.phone, bill: inv.no, stock: p.stock, cost: p.cost, owed: window.eval('partyBal')('S', s.id) };
});
await wait(1500);

// 1. the customer brings one back: scan the bill, everything fills in
await pg.evaluate(() => window.eval('warrantyModal')()); await wait(300);
await pg.type('#wrSold', set.bill); await pg.keyboard.press('Enter'); await wait(300);
const filled = await pg.evaluate(() => ({ item: document.querySelector('#wrItem').value, cust: document.querySelector('#wrCust').value, sup: document.querySelector('#wrSup').value, war: document.querySelector('#wrWar').textContent }));
ok(filled.item === set.pname && filled.cust.length > 2 && +filled.sup === set.sid && /Under warranty/.test(filled.war), 'scanning the bill fills the item, the customer, the supplier and "under warranty"', JSON.stringify(filled));
await pg.type('#wrFault', 'motor does not start');
await pg.screenshot({ path: OUT + '/dmg-intake.png' });
await pg.click('#wrOk'); await wait(1500);
const d1 = await pg.evaluate(() => window.eval('S').damages.slice(-1)[0]);
const after1 = await pg.evaluate(pid => window.eval('P')(pid).stock, set.pid);
const owed1 = await pg.evaluate(sid => window.eval('partyBal')('S', sid), set.sid);
ok(d1.src === 'warranty' && d1.sid === set.sid && d1.cid === set.cid && d1.bill === set.bill && d1.fault === 'motor does not start' && d1.status === 'held', 'a warranty return against the bill, the customer and the supplier', d1.no);
ok(Math.abs(after1 - (set.stock - 1)) < 1e-6 && Math.abs((set.owed - owed1) - set.cost) < 0.01, 'the replacement left the shelf, and its cost came off what we owe the supplier', `stock ${set.stock}→${after1}, owed ${set.owed}→${owed1}`);
ok(got.some(g => g.to === '0775550099' || (g.text || g.message || '').includes(d1.no)), 'the supplier is texted', got.length + ' text(s)');
const slips1 = await pg.evaluate(() => window.__slips);
ok(slips1.some(s => /WARRANTY RETURN/.test(s.html) && /REPLACEMENT GIVEN TODAY/.test(s.html) && s.html.includes(d1.no)), "the customer's slip prints: WARRANTY RETURN, replacement given");
ok(await pg.evaluate(() => /DAMAGE|Damage tags/i.test((document.querySelector('.modal') || {}).textContent || '')), 'the barcode label is ready to print');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// 2. payments to that supplier are held
const blocked = await pg.evaluate(sid => { try { window.eval('paySupplier')({ supplierId: sid, lines: [{ method: 'CASH', amount: 100 }] }); return 'paid' } catch (e) { return e.message } }, set.sid);
ok(/on hold/.test(blocked), 'paying the supplier is refused while the return is open', blocked.slice(0, 90));
await pg.evaluate(sid => window.eval('supPayModal')(sid), set.sid); await wait(400);
const pm = await pg.evaluate(() => ({ banner: /Payments on hold/.test(document.querySelector('#spBody').textContent), go: document.querySelector('#spGo') ? document.querySelector('#spGo').disabled : null, own: !!document.querySelector('#spDmgOk') }));
ok(pm.banner && (pm.go === true || pm.go === null) && pm.own, 'the payment window says so, the button is held, and the owner has "Pay anyway"', JSON.stringify(pm));
await pg.screenshot({ path: OUT + '/dmg-payhold.png' });
if (pm.go !== null) { await pg.click('#spDmgOk'); await wait(300);
  ok(await pg.evaluate(() => !document.querySelector('#spGo').disabled), 'ticking "Pay anyway" lets the owner go on') }
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// 3. the customer who waits for the supplier's replacement
const d2 = await pg.evaluate(o => { const d = window.eval('addWarrantyReturn')({ pid: o.pid, sid: o.sid, qty: 1, fault: 'cracked casing', cid: o.cid, bill: o.bill, giveNow: false }); window.eval('persist')(true); return d }, set);
ok(d2.custWait && d2.noPost && Math.abs(await pg.evaluate(pid => window.eval('P')(pid).stock, set.pid) - after1) < 1e-6 && Math.abs(await pg.evaluate(sid => window.eval('partyBal')('S', sid), set.sid) - owed1) < 0.01, 'waiting for the supplier: nothing moves on the shelf or in what we owe');
const tBefore = got.length;
await pg.evaluate(no => window.eval('damageMoveModal')(no), d2.no); await wait(300);
await pg.select('#dvTo', 'replaced'); await pg.click('#dvOk'); await wait(1200);
const d2b = await pg.evaluate(no => window.eval('S').damages.find(x => x.no === no), d2.no);
ok(d2b.status === 'replaced' && d2b.toHand && Math.abs(await pg.evaluate(pid => window.eval('P')(pid).stock, set.pid) - after1) < 1e-6, 'the supplier replaced it: it is for the customer, not the shelf');
ok(got.slice(tBefore).some(g => /replacement for your/.test(g.text || g.message || '')), 'the customer is texted that their replacement is here');
await pg.evaluate(no => window.eval('dmgHandOver')(no), d2.no); await wait(300);
ok(await pg.evaluate(no => { const d = window.eval('S').damages.find(x => x.no === no); return !d.toHand && !!d.handedAt }, d2.no) && (await pg.evaluate(() => window.__slips)).some(s => /HANDED OVER/.test(s.html)), 'Hand over: given to the customer, and a slip says so');

// 4. the page
await pg.evaluate(() => { window.eval("dmgTab='open'; dmgSrc='all'"); window.eval('go')('damages') }); await wait(600);
const page = await pg.evaluate(() => document.querySelector('#main').innerText);
ok(/Damage & warranty returns/.test(page) && /Open, by supplier/.test(page) && page.includes(d1.no) && /warranty/.test(page), 'Damage & warranty returns: open by supplier, and each return');
await pg.screenshot({ path: OUT + '/dmg-page.png', fullPage: true });

// 5. the supplier's page: sign in with a code, see the returns, answer one
const H = { 'Content-Type': 'application/json' };
const otp = await (await fetch(BASE + '/api/sup/otp', { method: 'POST', headers: H, body: JSON.stringify({ phone: '0775550099' }) })).json();
await wait(500);
const code = otp.code || ((got.map(g => /sign-in code is (\d+)/.exec(g.text || g.message || '')).filter(Boolean).pop()) || [])[1];
const login = await (await fetch(BASE + '/api/sup/login', { method: 'POST', headers: H, body: JSON.stringify({ phone: '0775550099', code }) })).json();
if (!login.token) ok(false, 'the supplier signs in', JSON.stringify(otp).slice(0, 120) + ' ' + JSON.stringify(login).slice(0, 120));
else {
  const AH = { ...H, Authorization: 'Bearer ' + login.token };
  const me = await (await fetch(BASE + '/api/sup/me', { headers: AH })).json();
  const mine = (me.damages || []).find(x => x.no === d1.no);
  ok(mine && mine.warranty && mine.fault === 'motor does not start' && me.damageHold === true, "the supplier's page lists the return, says it came from a customer, and that payments are held", JSON.stringify(mine || {}).slice(0, 140));
  const r = await (await fetch(BASE + '/api/sup/dmg/' + encodeURIComponent(d1.no) + '/respond', { method: 'POST', headers: AH, body: JSON.stringify({ action: 'credit', ref: 'CN-5521' }) })).json();
  ok(r.ok, 'the supplier answers: credit note CN-5521');
  const sp = await b.newPage(); await sp.setViewport({ width: 400, height: 860, isMobile: true });
  await sp.evaluateOnNewDocument(t => { localStorage.setItem('rs_token', JSON.stringify(t)); localStorage.setItem('rs_phone', JSON.stringify('0775550099')) }, login.token);
  await sp.goto(BASE + '/supplier', { waitUntil: 'networkidle2' }); await wait(800);
  if (await sp.$('[data-t="dmg"]')) { await sp.click('[data-t="dmg"]'); await wait(600); await sp.screenshot({ path: OUT + '/dmg-portal.png', fullPage: true }) }
  await pg.evaluate(() => regalBridge.pull && regalBridge.pull(true)); await wait(3000);
  const back = await pg.evaluate(no => window.eval('S').damages.find(x => x.no === no), d1.no);
  ok(back.supSaid && back.supSaid.action === 'credit' && back.supSaid.ref === 'CN-5521', "the supplier's answer comes back to the shop", JSON.stringify(back.supSaid || {}));
}

// 5. settled: payments free again
await pg.evaluate(no => { window.eval('damageSet')(no, 'credited', 'CN-5521'); window.eval('persist')(true) }, d1.no);
const free = await pg.evaluate(sid => window.eval('dmgHold')(sid).length, set.sid);
ok(free === 0, 'once every return is settled, payments to them are free again');
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · the stand-in gateway got ${got.length} text(s)`);
await b.close(); gw.close();
