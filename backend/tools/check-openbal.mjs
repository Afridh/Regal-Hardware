// A previous balance for a customer or a supplier, and who may put a customer on the black or red list.
//  · "Previous balance" on their page: a Balance brought forward bill on its date — outstanding goes up, it can be
//    paid against, it ages — and it is not a sale or a purchase (the day's sales and the reports leave it out)
//  · anyone not the owner or a director asks; the yes on Approvals brings it forward
//  · the black / red list: the Super Admin and an Admin (a director) only — not Management, Accounts or the Owner
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-openbal.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
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
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'); window.__me = { role: S.user.role, perms: S.user.perms };
  window.asRole = (r, perms) => { S.user.role = r; S.user.perms = perms || ['sell'] }; window.asMe = () => { S.user.role = window.__me.role; S.user.perms = window.__me.perms } });

// 1. a customer's previous balance, from their page
const asAt = await pg.evaluate(() => window.eval('D')(new Date(Date.now() - 20 * 864e5)));
const c0 = await pg.evaluate(() => { const S = window.eval('S'); const c = S.customers.find(x => x.id !== 1 && x.phone); window.eval('custSel=' + c.id); window.eval('go')('customers');
  return { id: c.id, bal: window.eval('partyBal')('C', c.id), todaySales: window.eval('salesReal')().filter(s => s.date === window.eval('D')(window.eval('today'))).reduce((a, s) => a + s.total, 0) } });
ok(!!(await pg.$(`[data-act="openBal"][data-pk="C"][data-id="${c0.id}"]`)), 'the customer\'s page has "Previous balance"');
await pg.evaluate(() => document.querySelectorAll(".modal").forEach(m => m.remove()));
await pg.$eval(`[data-act="openBal"][data-pk="C"][data-id="${c0.id}"]`, x => x.click()); await wait(300);
await pg.type('#obAmt', '5000'); await pg.$eval('#obDate', (el, d) => { el.value = d }, asAt); await pg.type('#obNote', 'old book page 45');
await pg.screenshot({ path: process.env.SHOT || 'openbal.png' });
await pg.$eval('#obOk', x => x.click()); await wait(400);
const c1 = await pg.evaluate(id => { const S = window.eval('S'); const bf = S.sales.filter(s => s.customerId === id && s.opening).slice(-1)[0];
  return { bal: window.eval('partyBal')('C', id), bf: bf && { no: bf.no, date: bf.date, total: bf.total, balance: bf.balance }, age: window.eval('custAge')(id).oldest } }, c0.id);
ok(c1.bf && /^BF-/.test(c1.bf.no) && c1.bf.total === 5000 && c1.bf.date === asAt && Math.abs(c1.bal - c0.bal - 5000) < 0.01, 'brought forward: a BF bill of Rs 5,000 on its date, outstanding up by 5,000', JSON.stringify(c1));
ok(c1.age >= 20, 'and it ages from its date', `oldest ${c1.age} days`);
const rep = await pg.evaluate(d => { window.eval(`repKey='salesday'; repFrom='${d}'; repTo='${d}'`); const r = window.eval('reportData')(); return JSON.stringify(r.rows) }, asAt);
ok(!/5,000\.00/.test(rep), 'it is not a sale: Sales by Day leaves it out', rep.slice(0, 120));
// paid against
const paid = await pg.evaluate(([id, no]) => { window.eval('receiveCustomer')({ customerId: id, amount: 5000, method: 'CASH', against: [no] }); const S = window.eval('S'); return S.sales.find(s => s.no === no).balance }, [c0.id, c1.bf.no]);
ok(paid < 0.01, 'a payment against it settles it', String(paid));

// 2. a supplier's
const s0 = await pg.evaluate(() => { const S = window.eval('S'); const s = S.suppliers[0]; window.eval('supSel=' + s.id); window.eval('go')('suppliers'); return { id: s.id, bal: window.eval('partyBal')('S', s.id) } });
ok(!!(await pg.$(`[data-act="openBal"][data-pk="S"][data-id="${s0.id}"]`)), 'the supplier\'s page has "Previous balance"');
await pg.evaluate(() => document.querySelectorAll(".modal").forEach(m => m.remove()));
await pg.$eval(`[data-act="openBal"][data-pk="S"][data-id="${s0.id}"]`, x => x.click()); await wait(300);
await pg.type('#obAmt', '12000'); await pg.$eval('#obOk', x => x.click()); await wait(400);
const s1 = await pg.evaluate(id => { const S = window.eval('S'); const bf = S.purchases.filter(p => p.supplierId === id && p.opening).slice(-1)[0]; return { bal: window.eval('partyBal')('S', id), bf: bf && { no: bf.no, total: bf.total } } }, s0.id);
ok(s1.bf && s1.bf.total === 12000 && Math.abs(s1.bal - s0.bal - 12000) < 0.01, 'a supplier: Rs 12,000 owed to them brought forward', JSON.stringify(s1));

// 3. not the owner or a director: it waits for a yes
const ask = await pg.evaluate(id => { window.asRole('Management'); window.eval('openBalModal')('C', id); return !!document.querySelector('#obOk') && /approval/i.test(document.querySelector('#obOk').textContent) }, c0.id);
await pg.type('#obAmt', '700'); await pg.$eval('#obOk', x => x.click()); await wait(300);
const ap = await pg.evaluate(id => { window.asMe(); const S = window.eval('S'); const a = S.approvals.find(x => x.kind === 'openBal' && x.status === 'pending'); const before = window.eval('partyBal')('C', id); if (a) window.eval('decideApproval')(a.id, true); return { a: !!a, before, after: window.eval('partyBal')('C', id) } }, c0.id);
ok(ask && ap.a && Math.abs(ap.after - ap.before - 700) < 0.01, 'Management asks; the yes on Approvals brings it forward', JSON.stringify(ap));

// 4. the black and red lists: the Super Admin and an Admin only
const lists = await pg.evaluate(id => { const out = {};
  for (const r of ['Super Admin', 'Admin', 'Owner', 'Management', 'Accounts']) { window.asRole(r); document.querySelectorAll('.modal').forEach(m => m.remove());
    window.eval('go')('customers'); const btn = !!document.querySelector(`[data-act="custList"][data-id="${id}"]`); window.eval('custListModal')(id);
    out[r] = { btn, opens: !!document.querySelector('[name=clL]') } }
  window.asMe(); document.querySelectorAll('.modal').forEach(m => m.remove()); return out }, c0.id);
ok(lists['Super Admin'].btn && lists['Super Admin'].opens && lists.Admin.btn && lists.Admin.opens, 'the Super Admin and an Admin (director) can put a customer on the list', JSON.stringify({ sa: lists['Super Admin'], ad: lists.Admin }));
ok(['Owner', 'Management', 'Accounts'].every(r => !lists[r].btn && !lists[r].opens), 'the Owner, Management and Accounts cannot — no button, and the window refuses', JSON.stringify({ ow: lists.Owner, mg: lists.Management, ac: lists.Accounts }));
await pg.evaluate(() => window.eval('persist')(true));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
