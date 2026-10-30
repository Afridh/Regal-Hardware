// A supplier's payment, the seven steps: requested → invoices checked → amount finalised → preparing →
// prepared → ready for collection → issued. Each is one button at the shop and a tick on the supplier's page.
//  · the supplier asks from their page; it reaches the shop at step 1, in the Action centre too
//  · the shop moves it on, step by step; the amount finalised is what is paid; the prepared cheque fills in the issue
//  · the supplier's page shows the tracker at each step, and is texted at finalised, ready and issued
//  · only "issued" touches the books — their balance goes down by the finalised amount, and not before
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-suppay.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const CHQ = '7' + String(Date.now()).slice(-5);      // a cheque number not written before, run after run
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, body, token) => { const r = await fetch(BASE + '/api/sup' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json() };
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1440, height: 1000 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/:41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});

// a supplier with an open bill, their page on, and no damage return holding their payments
const sup = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'), CFG = window.eval('CFG'); window.__hold = (CFG.dmg || {}).holdPay; CFG.dmg = { ...(CFG.dmg || {}), holdPay: false };
  const s = S.suppliers.find(x => x.phone && S.purchases.some(p => p.supplierId === x.id && p.total - (+p.paid || 0) > 100));
  s.enabled = true; window.eval('persist')(true);
  const p = S.purchases.find(p => p.supplierId === s.id && p.total - (+p.paid || 0) > 100);
  return { id: s.id, phone: s.phone, name: s.name, bill: p.no, owing: +(p.total - (+p.paid || 0)).toFixed(2), bal: window.eval('partyBal')('S', s.id) } });
await wait(1500);
const otp = await api('/otp', { phone: sup.phone });
const login = await api('/login', { phone: sup.phone, code: otp.code });
ok(!!login.token, 'the supplier signs in on their page', sup.name);
const sent = await api('/payreq', { lines: [{ no: sup.bill }], note: 'cheque please' }, login.token);
ok(sent.ok !== false && !sent.error, 'they ask to be paid for a bill', sent.error || sup.bill);

// the shop: it arrives at step 1, and waits in the Action centre
let r = null;
for (let i = 0; i < 10 && !r; i++) { await pg.evaluate(() => window.regalBridge && regalBridge.pull && regalBridge.pull(true)); await wait(2000);
  r = await pg.evaluate(sid => { const x = (window.eval('S').payReqs || []).find(q => q.sid === sid && q.status === 'sent'); return x && { id: x.id, total: x.total } }, sup.id) }
ok(!!r, 'it reaches the shop at step 1 — Payment requested');
const ac = await pg.evaluate(id => window.eval('actionItems')().find(x => x.key === id), r && r.id);
ok(ac && /1\/7/.test(ac.tag) && /Invoices checked/.test(ac.acts.join('')), 'the Action centre has it, with the next step on its button', ac && ac.tag);

const page = async () => pg.evaluate(id => { window.eval(`prSel=${JSON.stringify(id)}; prShow='open'`); window.eval('go')('payreqs'); const c = document.querySelector('#main');
  return { now: (c.querySelector('.prt:not(.sm) .prt-s.now span') || {}).textContent || '', done: c.querySelectorAll('.prt:not(.sm) .prt-s.done').length, btn: (c.querySelector('[data-act="prNext"]') || {}).textContent || '' } }, r.id);
const next = async (fill) => { await pg.$eval(`[data-act="prNext"][data-id="${r.id}"]`, x => x.click()); await wait(300); if (fill) await pg.evaluate(fill); await wait(300) };
const supSees = async () => { const me = await api('/me', null, login.token); return (me.payReqs || []).find(x => x.id === r.id) || {} };

let p = await page();
ok(p.now === 'Payment requested' && /Invoices checked/.test(p.btn), 'the page: the tracker at step 1, and one button for the next', JSON.stringify(p));
await pg.screenshot({ path: process.env.SHOT || 'suppay.png', fullPage: true });
// 2. invoices checked
await next(() => { document.querySelector('#prN').value = 'matched to the GRN'; document.querySelector('#prGo').click() });
p = await page(); ok(p.now === 'Invoices checked' && p.done === 1, '2 — invoices checked', JSON.stringify(p));
// 3. amount finalised — a little less than asked
const fin = Math.max(1, Math.round(sup.owing - 50));
await next();
await pg.evaluate(f => { const a = document.querySelector('#prA'); if (a) { a.value = String(f); document.querySelector('#prN').value = 'less the damaged tin'; document.querySelector('#prGo').click() } }, fin); await wait(300);
p = await page(); const rr = await pg.evaluate(id => window.eval('S').payReqs.find(x => x.id === id), r.id);
ok(p.now === 'Amount finalised' && rr.final && rr.final.amount === fin, '3 — amount finalised: what will be paid', `${rr.final && rr.final.amount} of ${sup.owing}`);
// 4, 5: preparing, prepared — as a cheque
await next(); p = await page(); ok(p.now === 'Amount preparing', '4 — amount preparing');
await next(); await pg.evaluate(n => { document.querySelector('#ppHow').value = 'CHEQUE'; document.querySelector('#ppNo').value = n; document.querySelector('#prGo').click() }, CHQ); await wait(300);
p = await page(); const rp = await pg.evaluate(id => window.eval('S').payReqs.find(x => x.id === id).prep, r.id);
ok(p.now === 'Amount prepared' && rp && rp.method === 'CHEQUE' && rp.no === CHQ, '5 — amount prepared: a cheque, its number kept', JSON.stringify(rp));
const balBefore = await pg.evaluate(sid => window.eval('partyBal')('S', sid), sup.id);
ok(Math.abs(balBefore - sup.bal) < 0.01, 'nothing has touched the books yet', `${sup.bal} → ${balBefore}`);
// 6. ready for collection — the supplier's page says so
await next(); p = await page(); ok(p.now === 'Ready for collection', '6 — ready for collection');
await pg.evaluate(() => window.eval('persist')(true)); await wait(2500);
let ss = await supSees();
ok(ss.status === 'ready' && ss.final && ss.final.amount === fin && ss.prep && ss.prep.method === 'CHEQUE', "the supplier's page has it: ready, the finalised amount, a cheque", JSON.stringify({ st: ss.status, final: ss.final, prep: ss.prep }));
// the supplier's own page draws the tracker
const sp = await b.newPage(); await sp.setViewport({ width: 420, height: 900, isMobile: true, hasTouch: true });
await sp.evaluateOnNewDocument(t => { localStorage.setItem('rs_token', JSON.stringify(t)) }, login.token);
await sp.goto(BASE + '/supplier', { waitUntil: 'networkidle2' });
await sp.waitForFunction(() => !document.getElementById('intro'), { timeout: 8000 }).catch(() => {});
await sp.evaluate(() => { const t = [...document.querySelectorAll('[data-t]')].find(x => x.dataset.t === 'pay'); if (t) t.click() }); await wait(700);
// the newest request is the first on their page
const st = await sp.evaluate(() => { const k = document.querySelector('.ptrk'); return { now: (k.querySelector('.ptrk-s.now span') || {}).textContent || '', done: k.querySelectorAll('.ptrk-s.done').length, ready: /Ready for collection/.test(document.body.innerText) } });
ok(st.now === 'Ready for collection' && st.done === 5, "the supplier's page shows the tracker: five ticked, ready for collection now", JSON.stringify(st));
await sp.screenshot({ path: process.env.SHOT2 || 'suppay-supplier.png', fullPage: true });
// 7. issued — the cheque and the finalised amount already filled in; the books move now
await next(); await wait(300);
const filled = await pg.evaluate(() => ({ amt: +document.querySelector('#piAmt').value, how: document.querySelector('#piHow').value, ref: document.querySelector('#piRef').value }));
ok(filled.amt === fin && filled.how === 'CHEQUE' && filled.ref === CHQ, 'Issue: the finalised amount and the prepared cheque are filled in', JSON.stringify(filled));
await pg.$eval('#piGo', x => x.click()); await wait(800);
const piMsg = await pg.evaluate(() => (document.querySelector('#piMsg') || {}).textContent || ''); if (piMsg) console.log('issue said: ' + piMsg);
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const done = await pg.evaluate(([id, sid]) => { const x = window.eval('S').payReqs.find(q => q.id === id); return { st: x.status, pay: x.pay, bal: window.eval('partyBal')('S', sid) } }, [r.id, sup.id]);
ok(done.st === 'issued' && done.pay && Math.abs((balBefore - done.bal) - fin) < 0.01, '7 — issued: posted, and their balance is down by the finalised amount', `${balBefore} → ${done.bal}`);
p = await page(); ok(p.done === 7 && !p.btn, 'all seven ticked, nothing more to press', JSON.stringify(p));
// the texts to the supplier: at finalised, ready, issued
const msgs = await pg.evaluate(ph => (window.eval('S').messages || []).filter(m => String(m.to).replace(/\D/g, '').endsWith(String(ph).replace(/\D/g, '').slice(-9))).map(m => m.body), sup.phone);
ok(msgs.some(m => /will be paid/.test(m)) && msgs.some(m => /ready for collection/.test(m)) && msgs.some(m => /issued/.test(m)), 'the supplier is texted at finalised, ready and issued', `${msgs.length} text(s)`);
await pg.evaluate(() => { const CFG = window.eval('CFG'); CFG.dmg.holdPay = window.__hold; window.eval('persist')(true) }); await wait(2000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
