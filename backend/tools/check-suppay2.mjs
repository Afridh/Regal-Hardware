// Paying suppliers the two ways, with a director's yes before and at hand-over, the ready list and the slip.
//  · Accounts prepares a payment (cheque written, kept for the collector): it waits for a director's yes —
//    nothing is "ready" and the supplier is not told; the list shows it waiting
//  · the director says yes: it is ready, the supplier is texted to come and collect; "Ready — not collected yet"
//    lists it; the supplier's card shows it on the way; the payment slip prints for the collector to sign
//  · Accounts issues it: a director's yes again; then it is issued and posted
//  · a director prepares one: no asking — ready at once; a "no" leaves it as it was
//  · the supplier's own request: "Start preparing" by Accounts needs the yes too
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-suppay2.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const SHOT = process.env.SHOTS || '.';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.dismiss());
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
const sup = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {};
  const S = window.eval('S'); const me = { role: S.user.role, perms: S.user.perms, name: S.user.name };
  window.asAcc = () => { S.user.role = 'Accounts'; S.user.perms = ['paySupplier', 'receive']; S.user.name = 'AccTest' }; window.asMe = () => Object.assign(S.user, me);
  const s = S.suppliers.find(x => window.eval('partyBal')('S', x.id) > 1000 && window.eval('prOwingBills')(x.id).length); s.phone = s.phone || '0779998887';
  return { id: s.id, name: s.name, phone: s.phone } });
// 1. Accounts prepares a payment
await pg.evaluate(() => { window.asAcc(); window.eval('go')('payreqs') }); await wait(200);
await pg.click('[data-act="prPrep"]'); await wait(300);
await pg.select('#ppS', String(sup.id)); await wait(200);
await pg.$eval('#ppNo', el => { el.value = '000777' });
const nm0 = await pg.evaluate(() => window.eval('S').messages.length);
await pg.click('#ppGo'); await wait(400);
const r1 = await pg.evaluate((sid, n0) => { const S = window.eval('S'); const r = S.payReqs.filter(x => x.sid === sid && x.source === 'shop').pop(); const ap = S.approvals.find(a => a.id === r.apWait);
  return { id: r.id, status: r.status, ap: ap && ap.kind, texted: S.messages.length - n0, amt: window.eval('prAmt')(r) } }, sup.id, nm0);
ok(r1.status === 'final' && r1.ap === 'supPayPrep' && r1.texted === 0, 'Accounts prepares a payment: it waits for a director — not ready, the supplier not told', JSON.stringify(r1));
const waitTag = await pg.evaluate(() => { window.eval('render')(); return /waiting for a director/i.test(document.querySelector('#main').innerText) });
ok(waitTag, 'the Supplier payments page shows it waiting for a director\'s yes');
// 2. the director says yes
await pg.evaluate(() => window.asMe());
const r2 = await pg.evaluate((id, n0) => { const S = window.eval('S'); const r = S.payReqs.find(x => x.id === id); window.eval('decideApproval')(r.apWait, true);
  const msg = S.messages.slice(0, S.messages.length - n0).find(m => /ready for collection/i.test(m.body)); return { status: r.status, msg: msg && msg.to, wait: !!r.apWait } }, r1.id, nm0);
ok(r2.status === 'ready' && r2.msg === sup.phone && !r2.wait, 'the director says yes: ready, and the supplier is texted to come and collect', JSON.stringify(r2));
const list = await pg.evaluate(() => { window.eval("prShow='open'"); window.eval('go')('payreqs'); return document.querySelector('#main').innerText });
ok(/Ready — not collected yet/.test(list) && list.includes(sup.name.slice(0, 10)), 'Supplier payments: "Ready — not collected yet" lists it');
await pg.screenshot({ path: SHOT + '/suppay-ready.png' });
const card = await pg.evaluate(sid => { window.eval('supSel=' + sid); window.eval("supTab='overview'"); window.eval('go')('suppliers'); return document.querySelector('#main').innerText }, sup.id);
ok(/Payments on the way/.test(card) && /Ready for collection/i.test(card), 'the supplier\'s card shows the payment on the way, ready for collection');
// the slip
await pg.evaluate(id => window.eval('prSlip')(window.eval('payReqs')().find(x => x.id === id)), r1.id); await wait(300);
const slip = await pg.evaluate(() => (document.querySelector('.modal .voucher') || {}).innerText || '');
ok(/PAYMENT SLIP/i.test(slip) && /000777/.test(slip) && /COLLECTED BY/i.test(slip) && /NIC/.test(slip), 'the payment slip: the cheque number, the bills, and a place for the collector\'s name, NIC and signature', slip.replace(/\s+/g, ' ').slice(0, 160));
await pg.screenshot({ path: SHOT + '/suppay-slip.png' });
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// 3. Accounts issues it: the yes again
await pg.evaluate(id => { window.asAcc(); window.eval('prSel=' + JSON.stringify(id)); window.eval('go')('payreqs'); window.eval('prIssue')(window.eval('payReqs')().find(x => x.id === id)) }, r1.id); await wait(300);
await pg.click('#piGo'); await wait(400);
const r3 = await pg.evaluate(id => { const S = window.eval('S'); const r = S.payReqs.find(x => x.id === id); const ap = S.approvals.find(a => a.kind === 'supPay' && a.status === 'pending' && a.data.prId === id); return { status: r.status, ap: !!ap, apId: ap && ap.id } }, r1.id);
ok(r3.status === 'ready' && r3.ap, 'Accounts hands it over: a director\'s yes is asked first — still ready, nothing posted', JSON.stringify(r3));
await pg.evaluate(() => window.asMe());
const r4 = await pg.evaluate((id, apId) => { const S = window.eval('S'); const before = window.eval('partyBal')('S', S.payReqs.find(x => x.id === id).sid); window.eval('decideApproval')(apId, true); document.querySelectorAll('.modal').forEach(m => m.remove());
  const r = S.payReqs.find(x => x.id === id); return { status: r.status, voucher: r.pay && r.pay.voucher, fell: before - window.eval('partyBal')('S', r.sid) } }, r1.id, r3.apId);
ok(r4.status === 'issued' && r4.voucher && Math.abs(r4.fell - r1.amt) < 0.01, 'the yes: issued, a voucher, and what is owed to them falls by the amount', JSON.stringify(r4));
// 4. a director prepares one: ready at once; a "no" leaves it as it was
const d1 = await pg.evaluate(sid => { const S = window.eval('S'); window.eval('prPrepareNew')(sid); const m = document.querySelector('.modal'); m.querySelector('#ppNo').value = '000888'; m.querySelector('#ppA').value = '1500'; m.querySelector('#ppGo').click();
  const r = S.payReqs.filter(x => x.sid === sid && x.source === 'shop').pop(); return { status: r.status, wait: !!r.apWait } }, sup.id);
ok(d1.status === 'ready' && !d1.wait, 'a director prepares one: no asking, ready at once', JSON.stringify(d1));
const no1 = await pg.evaluate(sid => { const S = window.eval('S'); window.asAcc(); window.eval('prPrepareNew')(sid); const m = document.querySelector('.modal'); m.querySelector('#ppNo').value = '000999'; m.querySelector('#ppA').value = '1200'; m.querySelector('#ppGo').click();
  const r = S.payReqs.filter(x => x.sid === sid && x.source === 'shop').pop(); window.asMe(); window.eval('decideApproval')(r.apWait, false, 'not this week'); return { status: r.status, wait: !!r.apWait, last: (r.events.pop() || {}).action } }, sup.id);
ok(no1.status === 'final' && !no1.wait && no1.last === 'declined', 'a director says no: it is not made up, and it says so', JSON.stringify(no1));
// 5. the supplier's own request: Start preparing by Accounts needs the yes
const q = await pg.evaluate(sid => { const S = window.eval('S'); const r = { id: 'PRT' + Date.now(), sid, rep: 'Rep', date: window.eval('D')(window.eval('today')), status: 'final', final: { amount: 1000, by: 'x' }, lines: [], total: 1000, events: [] }; S.payReqs.push(r);
  window.asAcc(); window.eval('prNext')(r); const asked = !!r.apWait && r.status === 'final'; window.asMe(); window.eval('decideApproval')(r.apWait, true); return { asked, after: r.status } }, sup.id);
ok(q.asked && q.after === 'preparing', 'their own request: "Start preparing" by Accounts waits for the yes, then goes on', JSON.stringify(q));
await pg.evaluate(() => { const S = window.eval('S'); S.payReqs = S.payReqs.filter(x => !String(x.id).startsWith('PRT')); window.eval('persist')(true) }); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
