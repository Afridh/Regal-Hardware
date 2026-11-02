// Leave asked for somebody else.
//  · an Accounts user gets "For" on the Leave page; leave asked for another employee is in that employee's name
//    (asked by the Accounts user), and the approval it waits on names the employee
//  · a Cashier only ever asks for themselves
//  · the large bill: a thin line between two items (Boxed and Old SePOS designs)
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-leavefor.mjs
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
// this check works in the page only and never saves
const setup = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {};
  const S = window.eval('S'); window.__user = S.user; window.__leaves = JSON.stringify(S.leaves || []); window.__aps = JSON.stringify(S.approvals || []);
  const other = (S.users || []).find(u => u.active !== false && u.name !== S.user.name);
  S.user = { ...S.user, name: 'Acc Tester', role: 'Accounts', perms: ['receive','paySupplier','adjustInvoice','overLimit','cost','profit','payroll','products_view','dashboard_view','attendance_view'] };
  return { other: other && other.name, approve: window.eval('canApprove')(), payroll: window.eval('can')('payroll') } });
ok(setup.other && !setup.approve && setup.payroll, 'an Accounts user: keeps the pay, does not approve', JSON.stringify(setup));
const day = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
await pg.evaluate(() => { window.eval('go')('leave') }); await wait(300);
ok(!!(await pg.$('#lvWho')), 'the Leave page gives Accounts "For" — anyone on the staff');
const asked = await pg.evaluate((other, day) => { const LV = window.eval('LV'); LV.who = other; window.eval('render')();
  LV.from = day; LV.to = day; LV.type = LV.type || 'casual'; window.eval('lvAsk')();
  const S = window.eval('S'); const l = S.leaves[S.leaves.length - 1]; const ap = (S.approvals || []).find(a => a.id === l.apId);
  return { who: l.who, by: l.by, status: l.status, ap: ap && { title: ap.title, status: ap.status } } }, setup.other, day);
ok(asked.who === setup.other && asked.by === 'Acc Tester' && asked.status === 'pending', 'the leave is in the employee\'s name, asked by Accounts, waiting', JSON.stringify(asked));
ok(asked.ap && asked.ap.status === 'pending' && asked.ap.title.startsWith(setup.other + ':') && !/Acc Tester/.test(asked.ap.title), 'the approval names the employee, not the accountant', asked.ap && asked.ap.title);
// a cashier asks only for themselves
const cash = await pg.evaluate(() => { const S = window.eval('S'); S.user = { ...S.user, name: 'Cash Tester', role: 'Cashier', perms: ['receive','discount'] }; window.eval('render')(); return !!document.getElementById('lvWho') });
ok(!cash, 'a Cashier gets no "For" — only their own leave');
await pg.evaluate(() => { const S = window.eval('S'); S.user = window.__user });
// approved: the employee is texted — the mobile found on their employee card, whatever the capitals of the name
const told = await pg.evaluate((other, day) => { const S = window.eval('S'); window.__emps = JSON.stringify(S.employees || []); window.__usersK = JSON.stringify(S.users);
  const u = S.users.find(x => x.name === other); delete u.phone; delete u.mobile;
  S.employees = (S.employees || []).filter(e => String(e.userName || '').toLowerCase() !== other.toLowerCase() && String(e.name || '').toLowerCase() !== other.toLowerCase());
  S.employees.push({ id: 99901, name: other.toUpperCase(), phone: '077 123 4599', active: true });
  const l = S.leaves.filter(x => x.who === other && x.status === 'pending').pop(); const n0 = S.messages.length;
  window.eval('decideApproval')(l.apId, true, '');
  const sent = S.messages.slice(0, S.messages.length - n0).filter(m => /leave/i.test(m.body));
  return { status: l.status, to: sent.map(m => m.to), body: (sent.find(m => m.to === '0771234599') || {}).body || '' } }, setup.other, day);
ok(told.status === 'approved' && told.to.includes('0771234599') && /approved/i.test(told.body) && /Dates:/.test(told.body), 'approved: the employee gets a text, to the mobile on their employee card', JSON.stringify(told));
// no mobile anywhere: the one approving is told
const none = await pg.evaluate(async (other) => { const S = window.eval('S'); S.employees = S.employees.filter(e => e.id !== 99901);
  const l = { id: 'lvT' + Date.now(), who: other, from: '2026-12-20', to: '2026-12-20', type: 'annual', half: false, reason: '', status: 'pending', by: S.user.name, at: '', group: 'employee' };
  S.leaves.push(l); window.eval('lvApprove')(l.id); await new Promise(r => setTimeout(r, 600));
  return (document.getElementById('toasts') || {}).textContent || '' }, setup.other);
ok(/No mobile for/.test(none), 'no mobile on file: the one approving is told the employee was not texted', none.slice(0, 160));
await pg.evaluate(() => { const S = window.eval('S'); S.leaves = JSON.parse(window.__leaves); S.approvals = JSON.parse(window.__aps); S.employees = JSON.parse(window.__emps); S.users = JSON.parse(window.__usersK); S.user = window.__user; window.eval('go')('pos') });
// a line between two items on the large bill
const lines = await pg.evaluate(() => { const C = window.eval('CFG'); const keep = C.bill.a5Style; const S = window.eval('S'); const inv = S.sales.filter(s => s.lines && s.lines.length > 1).pop();
  const out = {}; for (const st of ['boxed', 'sepos']) { C.bill.a5Style = st; const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:794px;height:559px'; d.innerHTML = window.eval('billHtml')(inv, 'a5'); document.body.appendChild(d);
    const td = d.querySelector('tbody tr td'); const cs = getComputedStyle(td); out[st] = cs.borderBottomStyle + ' ' + cs.borderBottomWidth + ' ' + cs.borderBottomColor; d.remove() }
  C.bill.a5Style = keep; return out });
ok(/^solid /.test(lines.boxed) && /^solid /.test(lines.sepos), 'the large bill has a thin line between two items (Boxed and Old SePOS)', JSON.stringify(lines));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
