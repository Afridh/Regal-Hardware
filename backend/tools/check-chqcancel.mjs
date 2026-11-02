// Cancelling a cheque written by mistake.
//  · Cheques out: Cancel asks why first; nothing happens without a reason
//  · a director cancels: the cheque stays, marked CANCELLED with who and why; what is owed to the supplier goes
//    back up by the amount, and their bill opens again
//  · Accounts cancels: a director's yes first — until then nothing changes
//  · a printed cheque has Cancel too
//  · a cheque that paid a payment from Supplier payments: that payment goes back to be made up again
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-chqcancel.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
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
// a cheque written to a supplier, against one of their bills
const pay = async () => pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {};
  const S = window.eval('S'); const me = S.user; window.__me = { role: me.role, perms: me.perms, name: me.name };
  const s = S.suppliers.find(x => window.eval('prOwingBills')(x.id).some(p => (p.total - p.paid) > 1500)); const bill = window.eval('prOwingBills')(s.id).find(p => (p.total - p.paid) > 1500);
  const before = { owed: window.eval('partyBal')('S', s.id), billPaid: bill.paid };
  window.eval('paySupplier')({ supplierId: s.id, lines: [{ method: 'CHEQUE', bank: S.banks[0].id, amount: 1000, date: window.eval('D')(window.eval('today')) }], against: [bill.no], notes: 'test' });
  const c = S.cheques.filter(x => x.dir === 'ISSUED').pop(); window.eval("chqStatus='all'; chqQ=''"); window.eval('go')('chequesOut');
  return { sid: s.id, bill: bill.no, no: c.no, before, afterPay: window.eval('partyBal')('S', s.id) } });
const p1 = await pay();
ok(Math.abs(p1.before.owed - p1.afterPay - 1000) < 0.01, 'a Rs 1,000 cheque to a supplier: they are owed Rs 1,000 less', JSON.stringify(p1));
await pg.click(`[data-act="chqSet"][data-no="${p1.no}"][data-st="CANCELLED"]`); await wait(300);
ok(!!(await pg.$('#abT')), 'Cancel asks why first');
await pg.click('#abGo'); await wait(200);
ok(await pg.evaluate(no => window.eval('S').cheques.find(x => x.no === no && x.dir === 'ISSUED').status, p1.no) === 'ISSUED' && !!(await pg.$('#abT')), 'no reason given: nothing is cancelled');
await pg.type('#abT', 'written to the wrong supplier'); await pg.click('#abGo'); await wait(400);
const c1 = await pg.evaluate(p => { const S = window.eval('S'); const c = S.cheques.find(x => x.no === p.no && x.dir === 'ISSUED'); const bill = S.purchases.find(x => x.no === p.bill);
  return { status: c.status, why: c.cancelWhy, by: c.cancelBy, owed: window.eval('partyBal')('S', p.sid), billPaid: bill.paid, row: [...document.querySelectorAll('#main tr')].find(tr => tr.innerText.includes(p.no))?.innerText || '' } }, p1);
ok(c1.status === 'CANCELLED' && /wrong supplier/.test(c1.why) && c1.by, 'a director cancels: the cheque stays, marked CANCELLED, with who and why', JSON.stringify({ s: c1.status, why: c1.why, by: c1.by }));
ok(Math.abs(c1.owed - p1.before.owed) < 0.01 && Math.abs(c1.billPaid - p1.before.billPaid) < 0.01, 'the payment is taken back: owed to them as before, and the bill open again', JSON.stringify({ owed: c1.owed, was: p1.before.owed, billPaid: c1.billPaid }));
ok(/wrong supplier/.test(c1.row), 'the cheque list shows why it was cancelled');
// Accounts: a director's yes first
const p2 = await pay();
await pg.evaluate(() => { const S = window.eval('S'); S.user.role = 'Accounts'; S.user.perms = ['paySupplier']; S.user.name = 'AccTest'; window.eval('render')() });
await pg.click(`[data-act="chqSet"][data-no="${p2.no}"][data-st="CANCELLED"]`); await wait(300);
await pg.type('#abT', 'wrong amount'); await pg.click('#abGo'); await wait(400);
const c2 = await pg.evaluate(no => { const S = window.eval('S'); const c = S.cheques.find(x => x.no === no && x.dir === 'ISSUED'); const ap = S.approvals.find(a => a.kind === 'chqCancel' && a.status === 'pending' && a.data.no === no); return { status: c.status, ap: ap && ap.id } }, p2.no);
ok(c2.status === 'ISSUED' && c2.ap, 'Accounts cancels: it waits for a director — the cheque still stands', JSON.stringify(c2));
const c3 = await pg.evaluate((no, apId, sid) => { const S = window.eval('S'); Object.assign(S.user, window.__me); window.eval('decideApproval')(apId, true); const c = S.cheques.find(x => x.no === no && x.dir === 'ISSUED'); return { status: c.status, owed: window.eval('partyBal')('S', sid) } }, p2.no, c2.ap, p2.sid);
ok(c3.status === 'CANCELLED' && Math.abs(c3.owed - p2.before.owed) < 0.01, 'the director\'s yes: cancelled and taken back', JSON.stringify(c3));
// a printed cheque has Cancel too
const p3 = await pay();
await pg.evaluate(no => { const c = window.eval('S').cheques.find(x => x.no === no && x.dir === 'ISSUED'); window.eval('chequeStatus')(c, 'PRINTED'); window.eval('render')() }, p3.no);
ok(!!(await pg.$(`[data-act="chqSet"][data-no="${p3.no}"][data-st="CANCELLED"]`)), 'a printed cheque has Cancel too');
// a cheque that paid a Supplier payments payment
const pr = await pg.evaluate(p => { const S = window.eval('S'); const c = S.cheques.find(x => x.no === p.no && x.dir === 'ISSUED');
  const r = { id: 'PRC' + Date.now(), sid: p.sid, rep: 'x', date: c.date, status: 'issued', lines: [], total: 1000, final: { amount: 1000 }, pay: { no: c.ref, amount: 1000, date: c.date }, events: [] }; S.payReqs.push(r);
  window.eval('chqCancelNow')(c, 'test', 'Afridh'); return { status: r.status, pay: !!r.pay, last: r.events.pop().action } }, p3);
ok(pr.status === 'final' && !pr.pay && pr.last === 'chqCancelled', 'its payment from Supplier payments goes back to be made up again', JSON.stringify(pr));
await pg.evaluate(() => { const S = window.eval('S'); S.payReqs = S.payReqs.filter(x => !String(x.id).startsWith('PRC')); window.eval('persist')(true) }); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
