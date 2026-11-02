// Petty cash handed in waits for approval.
//  · Accounts (or anyone but the owner or an admin) hands in the balance: it goes to Approvals, the petty cash
//    stays open, the card says "waiting for approval", and the counter cannot count it in meanwhile
//  · approved: counted into the cash drawer and closed (a short taken from their pay); the holder is told
//  · turned down: the hand-in is cleared, to be handed in again
//  · the owner or an admin handing in: no approval needed
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-pettyapprove.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
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
// in the page only, never saved
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {}; window.voucherPrint = () => {};
  const S = window.eval('S'); window.__keep = JSON.stringify({ petty: S.petty || [], approvals: S.approvals || [], journal: S.journal, advances: S.advances || [], employees: S.employees || [] }); window.__user = S.user });
const ACC = ['receive', 'paySupplier', 'adjustInvoice', 'overLimit', 'cost', 'profit', 'payroll', 'products_view', 'dashboard_view', 'attendance_view'];
// petty cash for the accountant: 2,000 given, 1,200 spent → should have 800
const give = (who) => pg.evaluate(who => { const S = window.eval('S'); S.petty = S.petty || [];
  const p = { id: 'pcT' + Math.random().toString(36).slice(2, 6), no: 'PC-T' + S.petty.length, who, given: [{ amount: 2000, from: 'Cash drawer', ac: '1010', date: window.eval('D')(window.eval('today')), at: '', by: 'Afridh', note: '' }],
    spent: [{ id: 'EXP-T', cat: '6040', amount: 1200, desc: 'transport', date: '', at: '', by: who }], status: 'open', opened: window.eval('D')(window.eval('today')) };
  S.petty.push(p); S.employees = (S.employees || []).concat([{ id: 99950, name: who, phone: '', active: true, advance: 0 }]); return p.id }, who);
const handIn = async (id, amount) => { await pg.evaluate(id => window.eval('pettySubmitModal')(id), id); await wait(200);
  await pg.evaluate(a => { const i = document.getElementById('pbAmt'); i.value = String(a); i.dispatchEvent(new Event('input')) }, amount); await pg.click('#pbOk'); await wait(300) };
const asAcc = () => pg.evaluate(ACC => { const S = window.eval('S'); S.user = { ...window.__user, name: 'Acc Petty', role: 'Accounts', perms: ACC } }, ACC);
const asBoss = () => pg.evaluate(() => { window.eval('S').user = window.__user });
const state = (id) => pg.evaluate(id => { const S = window.eval('S'); const p = S.petty.find(x => x.id === id); const ap = p.submitted && p.submitted.apId && S.approvals.find(a => a.id === p.submitted.apId);
  return { status: p.status, submitted: p.submitted && p.submitted.amount, ap: ap && { status: ap.status, kind: ap.kind, title: ap.title }, settled: p.settled && { back: p.settled.back, gap: p.settled.gap, how: p.settled.how } } }, id);
// 1. Accounts hands in 800
await asAcc(); const id1 = await give('Acc Petty');
await handIn(id1, 800);
let s = await state(id1);
ok(s.status === 'open' && s.submitted === 800 && s.ap && s.ap.status === 'pending' && s.ap.kind === 'pettyBack', 'Accounts hands in the balance: it waits in Approvals, the petty cash stays open', JSON.stringify(s));
await pg.evaluate(() => { window.eval('go')('petty') }); await wait(200);
ok(/waiting for approval/.test(await pg.evaluate(() => document.getElementById('main').innerText)), 'the petty cash card says "waiting for approval"');
const blocked = await pg.evaluate(ACC => { const S = window.eval('S'); S.user = { ...window.__user, name: 'Counter Kid', role: 'Cashier', perms: ['receive'] }; const n = document.querySelectorAll('.modal').length; return n }, ACC);
await pg.evaluate(id => window.eval('pettySettleModal')(id), id1); await wait(200);
ok(!(await pg.$('#psOk')), 'the counter cannot count it in while it waits for the owner');
// 2. approved
await asBoss();
const n0 = await pg.evaluate(() => window.eval('S').journal.length);
await pg.evaluate(id => { const S = window.eval('S'); const p = S.petty.find(x => x.id === id); window.eval('decideApproval')(p.submitted.apId, true, '') }, id1); await wait(200);
s = await state(id1);
const posted = await pg.evaluate(n0 => window.eval('S').journal.length > n0, n0);
ok(s.status === 'settled' && s.settled.back === 800 && Math.abs(s.settled.gap) < 0.005 && posted, 'approved: counted into the drawer and closed', JSON.stringify(s.settled));
// 3. short, approved: from their pay
await asAcc(); const id2 = await give('Acc Petty'); await handIn(id2, 700); await asBoss();
await pg.evaluate(id => { const S = window.eval('S'); const p = S.petty.find(x => x.id === id); window.eval('decideApproval')(p.submitted.apId, true, '') }, id2); await wait(200);
s = await state(id2);
const adv = await pg.evaluate(() => (window.eval('S').advances || []).some(a => /petty cash short/.test(a.note) && Math.abs(a.amount - 100) < 0.01));
ok(s.status === 'settled' && s.settled.how === 'pay' && adv, '100 short, approved: taken from their pay as an advance', JSON.stringify(s.settled));
// 4. turned down
await asAcc(); const id3 = await give('Acc Petty'); await handIn(id3, 800); await asBoss();
await pg.evaluate(id => { const S = window.eval('S'); const p = S.petty.find(x => x.id === id); window.eval('decideApproval')(p.submitted.apId, false, 'count again') }, id3); await wait(200);
s = await state(id3);
ok(s.status === 'open' && s.submitted == null, 'turned down: the hand-in is cleared, to be handed in again', JSON.stringify(s));
// 5. the owner hands in: no approval
const id4 = await give(await pg.evaluate(() => window.__user.name)); await handIn(id4, 800);
s = await state(id4);
ok(s.submitted === 800 && !s.ap, 'the owner or an admin handing in needs no approval', JSON.stringify(s));
await pg.evaluate(() => { const S = window.eval('S'); const k = JSON.parse(window.__keep); Object.assign(S, k); S.user = window.__user; document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('go')('pos') });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
