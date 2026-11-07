// Cancelling a bill: an admin does it, anyone else asks an admin. The bill keeps its number and stays in the list, marked
// cancelled, with nothing left on it: what the customer owes comes down, the stock comes back, the books still balance.
// Clearing the till while a bill is open to be changed leaves the bill as it was, and says so.
// A bill re-made more than once is counted once, not reversed twice.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billcancel.mjs [screenshot-dir]
// The till here never reaches the print helper on this PC: its printers are the shop's.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url(); if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
const signIn = async () => {
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await wait(1500);
  await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''"); window.printPaper = () => {}; window.print = () => {} });
};
await signIn();

// a customer with no mobile (no text goes anywhere) and one item, kept plenty of
const setup = await pg.evaluate(() => { const S = window.eval('S');
  const add = (name) => { const id = Math.max(...S.customers.map(c => c.id)) + 1; S.customers.push({ id, code: 'T' + id, name, phone: '', level: 'retail', limit: 9999999, address: '', portal: false, lastLogin: null, points: 0 }); return id };
  const p = S.products.find(x => x.id !== window.eval('OPEN_PID') && +x.retail > 0); p.stock = 500; p.cost = 10;
  return { cid: add('Cancel Test One'), cid2: add('Cancel Test Two'), cid3: add('Cancel Test Three'), pid: p.id } });
const { cid, cid2, cid3, pid } = setup;
const state = (who = cid) => pg.evaluate((who, pid) => { const S = window.eval('S'), bal = window.eval('bal'), acs = new Set(); S.journal.forEach(j => j.lines.forEach(l => acs.add(l.ac)));
  const tb = [...acs].reduce((a, k) => a + bal(k), 0), inc = [...acs].filter(k => /^4/.test(k)).reduce((a, k) => a + bal(k), 0), cogs = bal('5100');
  return { owes: window.eval('partyBal')('C', who), adv: window.eval('custCredit')(who), cash: bal('1010'), stock: window.eval('P')(pid).stock, tb: Math.round(tb * 100) / 100, income: Math.round(inc * 100) / 100, cogs: Math.round(cogs * 100) / 100, sales: S.sales.length } }, who, pid);
const make = (o) => pg.evaluate((o, pid) => { const pays = o.pays || [{ method: 'CREDIT', amount: 0 }];
  const inv = window.eval('completeSale')({ lines: [{ pid, qty: o.qty || 2, price: o.price || 500, disc: 0, belowCost: true, ...(o.line || {}) }], customerId: o.cid, pays, override: true, ...(o.date ? { date: o.date } : {}) });
  return inv.no }, o, pid);
const bill = no => pg.evaluate(no => { const s = window.eval('S').sales.find(x => x.no === no); return s && JSON.parse(JSON.stringify(s)) }, no);
const go = v => pg.evaluate(x => window.eval('go')(x), v).then(() => wait(300));
const openBill = no => pg.evaluate(no => { window.eval(`billSel=${JSON.stringify(no)};billQ='';billType='all';billFrom='';billTo='';billBy='all';billCust=0`); window.eval('go')('bills') }, no).then(() => wait(350));
const pressCancel = no => pg.evaluate(no => { const x = document.querySelector(`[data-act="billCancel"][data-no="${no}"]`); if (!x) throw new Error('no Cancel bill button on ' + no); x.click() }, no).then(() => wait(250));
const sayWhy = (why) => pg.evaluate(why => { document.getElementById('abT').value = why; document.getElementById('abGo').click() }, why).then(() => wait(350));
const closeAll = () => pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const modalText = () => pg.evaluate(() => [...document.querySelectorAll('.modal')].map(m => m.innerText).join(' '));
const asStaff = () => pg.evaluate(() => { const S = window.eval('S'); window._role = window._role || S.user.role; S.user.role = 'Cashier'; window.eval('render')() }).then(() => wait(200));
const asAdmin = () => pg.evaluate(() => { const S = window.eval('S'); S.user.role = window._role; window.eval('render')() }).then(() => wait(200));
const editOnTill = (no) => pg.evaluate(no => { window.eval('billToTill')(no); document.getElementById('ebYes').click() }, no).then(() => wait(400));

// ---- a bill re-made twice counts once
const r0 = await state();
const rn = await make({ cid, price: 500 });          // 1,000
const remake = async (no, price) => { await editOnTill(no);
  await pg.evaluate((price, cid) => { const S = window.eval('S'); S.pos.lines[0].price = price; S.pos.lines[0].belowCost = true;
    window.eval('finishTillBill')({ cust: window.eval('C')(cid), pays: [{ method: 'CREDIT', amount: 0 }], override: true }) }, price, cid); await wait(250) };
await remake(rn, 750); ok((await state()).owes === r0.owes + 1500, 're-made once: they owe the new amount', String((await state()).owes - r0.owes));
await remake(rn, 1000); const r2 = await state(); ok(r2.owes === r0.owes + 2000, 're-made twice: they owe the newest amount, once', String(r2.owes - r0.owes));
ok(r2.income === r0.income - 2000, 're-made twice: the sale counts once', String(r2.income - r0.income));
ok(r2.cogs === r0.cogs + 20, 're-made twice: the cost counts once', String(r2.cogs - r0.cogs));
ok(r2.stock === r0.stock - 2, 're-made twice: the goods go out once', String(r2.stock - r0.stock));
ok(r2.tb === 0, 're-made twice: the books balance');
await remake(rn, 500); ok((await state()).owes === r0.owes + 1000, 're-made a third time: still right', String((await state()).owes - r0.owes));
if (process.env.ONLY_REMAKE) { await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0) }

// ---- the fault that was reported: open a bill in the till, clear the till
const cn = await make({ cid, price: 500 }), c1 = await state();
await editOnTill(cn);
ok(await pg.evaluate(() => { window.eval('csClearAsk')(); return true }), 'clear while changing a bill: it asks');
const said = await modalText();
ok(/stays/i.test(said) && /still owes|still owe/i.test(said), 'it says the bill stays and is still owed', said.slice(0, 120));
ok(await pg.evaluate(() => !!document.getElementById('clCancel')), 'and it offers Cancel the bill');
if (OUT) await pg.screenshot({ path: OUT + '/bc-clear.png' });
await pg.evaluate(() => document.getElementById('clYes').click()); await wait(250);
const c2 = await state();
ok(c2.owes === c1.owes && (await bill(cn)).total === 1000, 'left as it was: the bill and what they owe have not moved');
ok(await pg.evaluate(() => !window.eval('S').pos.editing && !window.eval('S').pos.lines.length), 'the till is clear');

// ---- an admin cancels a bill on credit
await openBill(cn);
if (OUT) await pg.screenshot({ path: OUT + '/bc-bill.png' });
await pressCancel(cn);
const asked = await modalText();
ok(/owe/i.test(asked) && /stock/i.test(asked), 'it says what will happen, first', asked.slice(0, 160));
if (OUT) await pg.screenshot({ path: OUT + '/bc-ask.png' });
await pg.evaluate(() => document.getElementById('abGo').click()); await wait(150);
ok(/Write it first/.test(await modalText()), 'a reason is needed');
await sayWhy('Wrong price, billed again');
const c3 = await state(), cb = await bill(cn);
ok(c3.owes === c1.owes - 1000, 'what they owe comes down by the bill', `${c1.owes} to ${c3.owes}`);
ok(c3.stock === c1.stock + 2, 'the goods are back in stock');
ok(c3.income === c1.income + 1000 && c3.cogs === c1.cogs - 20, 'the sale and its cost are out of the books');
ok(c3.tb === 0, 'the books balance');
ok(c3.sales === c1.sales && cb && cb.cancelled && cb.total === 0 && cb.balance === 0 && !cb.lines.length, 'the number stays in the list, with nothing on it');
ok(cb.cancelled.total === 1000 && cb.cancelled.lines.length === 1 && cb.cancelled.why === 'Wrong price, billed again' && cb.cancelled.by, 'and it remembers what it was, why and who');
ok(await pg.evaluate(no => { const t = document.querySelector('.bl-detail').innerText; return /cancelled/i.test(t) && /Wrong price/.test(t) && !document.querySelector('[data-act="billEdit"][data-no="' + no + '"]') && !document.querySelector('.bl-detail [data-act="billPrint"]') }, cn), 'the bill shows CANCELLED, why, and no buttons to print or edit');
ok(await pg.evaluate(no => /cancelled/i.test(document.querySelector(`.bl-row[data-no="${no}"]`).innerText), cn), 'the list says cancelled too');
if (OUT) await pg.screenshot({ path: OUT + '/bc-done.png' });
ok(await pg.evaluate(() => window.eval('S').trail.some(t => t.kind === 'billCancelled')), 'it is on the trail');
ok(await pg.evaluate(no => !window.eval('salesReal')().some(s => s.no === no), cn), 'reports do not count it');
const cn0 = await state();
ok(await pg.evaluate(no => { try { window.eval('billCancelNow')(no, 'again', 'x'); return false } catch (e) { return /already/.test(e.message) } }, cn), 'it cannot be cancelled twice');
await pg.evaluate(no => { window.eval('billToTill')(no) }, cn); await wait(150); ok(!/Change bill/.test(await modalText()), 'it cannot be opened in the till'); await closeAll();
await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines = []; S.pos.editing = null });
ok((await state()).owes === cn0.owes, 'and nothing moved');
ok(await pg.evaluate(() => { const s = window.eval('S'); window.eval("billType='cancelled'"); window.eval('render')(); const has = window.eval('billList')().every(x => x.cancelled) && window.eval('billList')().length > 0; window.eval("billType='all'"); return has }), 'the Cancelled filter finds them');

// ---- a bill already on someone's till when it is cancelled cannot be saved over it
const ln = await make({ cid, price: 500 });
await editOnTill(ln);
ok(await pg.evaluate(no => { try { window.eval('billCancelNow')(no, 'x', 'x'); return false } catch (e) { return /till/.test(e.message) } }, ln), 'open on this till: finish or clear it first');
await pg.evaluate(() => document.querySelector('[data-act="editDrop"]') ? document.querySelector('[data-act="editDrop"]').click() : window.eval('S').pos.editing = null); await wait(200);
await pg.evaluate(no => window.eval('billCancelNow')(no, 'gone', 'Azhad'), ln);
await pg.evaluate((no, cid) => { const S = window.eval('S'); S.pos = { ...S.pos, editing: no, lines: [{ pid: S.products[0].id, qty: 1, price: 100, disc: 0, belowCost: true }], customer: cid } }, ln, cid);
ok(await pg.evaluate(cid => { try { window.eval('finishTillBill')({ cust: window.eval('C')(cid), pays: [{ method: 'CREDIT', amount: 0 }], override: true }); return false } catch (e) { return /cancelled/.test(e.message) } }, cid), 'changed on another till meanwhile: the save is refused');
ok((await bill(ln)).cancelled && !(await bill(ln)).lines.length, 'and it stays cancelled');
await pg.evaluate(() => { const S = window.eval('S'); S.pos = { ...S.pos, editing: null, lines: [], customer: null } });

// ---- staff ask, and an admin decides
const sn = await make({ cid, price: 500 }), s0 = await state();
await openBill(sn); await asStaff();
await pg.evaluate(no => window.eval('billCancelAsk')(no), sn); await wait(200);
ok(/approv/i.test(await modalText()), 'staff: it says an admin approves it first');
await sayWhy('Customer changed their mind');
let s1 = await state();
ok(s1.owes === s0.owes && !(await bill(sn)).cancelled, 'staff: asking changes nothing yet');
const apId = await pg.evaluate(no => { const a = window.eval('S').approvals.find(x => x.kind === 'billCancel' && x.data.no === no && x.status === 'pending'); return a && a.id }, sn);
ok(!!apId, 'it goes to the admins');
await pg.evaluate(no => window.eval('billCancelAsk')(no), sn); await wait(150);
ok(await pg.evaluate(() => window.eval('S').approvals.filter(x => x.kind === 'billCancel' && x.status === 'pending').length === 1 && !document.getElementById('abGo')), 'asking twice does not make two');
await pg.evaluate(() => { window.eval('S').user.perms = (window.eval('S').user.perms || []).concat('approve') });
await pg.evaluate(id => window.eval('decideApproval')(id, true), apId); await wait(150);
ok(!(await bill(sn)).cancelled, 'someone who is not an admin cannot say yes');
await asAdmin();
await pg.evaluate(id => window.eval('decideApproval')(id, false, 'No'), apId); await wait(150);
ok(!(await bill(sn)).cancelled && (await state()).owes === s0.owes, 'turned down: the bill stands');
// asked again, then the bill changes, then yes: refused, the admin is deciding on something else
await asStaff(); await pg.evaluate(no => window.eval('billCancelAsk')(no), sn); await wait(200); await sayWhy('Second try');
const ap2 = await pg.evaluate(no => window.eval('S').approvals.find(x => x.kind === 'billCancel' && x.data.no === no && x.status === 'pending').id, sn);
await asAdmin();
await pg.evaluate(no => { const s = window.eval('S').sales.find(x => x.no === no); s._t = s.total; s.total = s.total + 1 }, sn);
await pg.evaluate(id => window.eval('decideApproval')(id, true), ap2); await wait(150);
ok(await pg.evaluate(id => window.eval('S').approvals.find(x => x.id === id).status === 'failed', ap2) && !(await bill(sn)).cancelled, 'the bill changed after asking: not applied');
await pg.evaluate(no => { const s = window.eval('S').sales.find(x => x.no === no); s.total = s._t; delete s._t }, sn);
await asStaff(); await pg.evaluate(no => window.eval('billCancelAsk')(no), sn); await wait(200); await sayWhy('Third try');
const ap3 = await pg.evaluate(no => window.eval('S').approvals.find(x => x.kind === 'billCancel' && x.data.no === no && x.status === 'pending').id, sn);
await asAdmin(); await pg.evaluate(id => window.eval('decideApproval')(id, true), ap3); await wait(200);
const s2 = await state(), sb = await bill(sn);
ok(sb.cancelled && s2.owes === s0.owes - 1000 && s2.stock === s0.stock + 2 && s2.tb === 0, 'approved: cancelled, what they owe comes down, stock back, books balance');
ok(/\w/.test(sb.cancelled.askedBy || '') && sb.cancelled.by, 'it keeps who asked and who approved', `${sb.cancelled.askedBy} / ${sb.cancelled.by}`);

// ---- paid in cash today: the money comes out of the drawer
const cashNo = await make({ cid, price: 500, pays: [{ method: 'CASH', amount: 1000 }] }), m0 = await state();
await pg.evaluate(no => window.eval('billCancelAsk')(no), cashNo); await wait(200);
ok(/1,000/.test(await modalText()) && /back/i.test(await modalText()), 'paid in cash: it says the money has to be given back');
await sayWhy('Wrong item');
const m1 = await state();
ok(m1.cash === m0.cash - 1000 && m1.owes === m0.owes && m1.tb === 0, 'paid in cash: the cash comes out, they owe the same', `${m0.cash} to ${m1.cash}`);
ok(await pg.evaluate(() => { const d = window.eval('D')(window.eval('today')); return window.eval('deTenders')(d).t.CASH >= 0 }), 'the day book still adds up');

// ---- what cannot be cancelled here, and why
const refuse = async (no, re, what) => { const said = await pg.evaluate(no => { try { window.eval('billCancelNow')(no, 'x', 'x'); return 'done' } catch (e) { return e.message } }, no); ok(re.test(said), what, said.slice(0, 90)) };
const old = await pg.evaluate(() => window.eval('ago')(5));
const oldCash = await make({ cid, price: 500, date: old, pays: [{ method: 'CASH', amount: 1000 }] });
await refuse(oldCash, /Return/i, 'cash taken on an earlier day: use a return, so it counts in today\'s drawer');
const oldCredit = await make({ cid, price: 500, date: old }), e0 = await state();
await pg.evaluate(no => window.eval('billCancelNow')(no, 'old', 'x'), oldCredit);
ok((await state()).owes === e0.owes - 1000, 'a credit bill from an earlier day can be cancelled');
const chqNo = await make({ cid, price: 500, pays: [{ method: 'CHEQUE', amount: 1000, ref: 'C999', date: old }] });
await refuse(chqNo, /cheque/i, 'paid by cheque: refused');
const retOf = await make({ cid, price: 500 });
const retNo = await pg.evaluate((no, cid, pid) => window.eval('completeSale')({ lines: [{ pid, qty: -1, price: 500, disc: 0 }], customerId: cid, pays: [], toAccount: true, returnOf: no }).no, retOf, cid, pid);
await refuse(retOf, /came back|return/i, 'goods already came back on it: refused');
await refuse(retNo, /return/i, 'a return itself: refused');
const planNo = await make({ cid, price: 500 });
await pg.evaluate(no => { const S = window.eval('S'); S.plans = S.plans || []; S.plans.push({ id: 'pl-test', status: 'open', bills: [no] }) }, planNo);
await refuse(planNo, /easy payment/i, 'on easy payments: refused');
await pg.evaluate(() => { const S = window.eval('S'); S.plans = S.plans.filter(p => p.id !== 'pl-test') });
const dlvNo = await make({ cid, price: 500 });
await pg.evaluate(no => { const S = window.eval('S'); S.deliveries = S.deliveries || []; S.deliveries.push({ id: 'dl-test', bill: no, status: 'planned' }) }, dlvNo);
await refuse(dlvNo, /deliver/i, 'on a delivery: refused');
await pg.evaluate(() => { const S = window.eval('S'); S.deliveries = S.deliveries.filter(p => p.id !== 'dl-test') });

// ---- payments already taken on the bill go on the customer's other bills, then stay as their credit
const pa = await make({ cid: cid2, price: 500 }), pb = await make({ cid: cid2, qty: 1, price: 500 });
await pg.evaluate((cid, no) => window.eval('receiveCustomer')({ customerId: cid, amount: 400, method: 'CASH', against: [no], quiet: true }), cid2, pa); await wait(100);
ok((await bill(pa)).balance === 600, 'test bill part paid');
const pz = await state(cid2);
await pg.evaluate(no => window.eval('billCancelNow')(no, 'x', 'x'), pa);
const p1 = await state(cid2);
ok(p1.owes === 100 && (await bill(pb)).balance === 100, 'the 400 paid moves onto their other bill', `owes ${p1.owes}, other bill ${(await bill(pb)).balance}`);
ok(p1.cash === pz.cash && p1.tb === 0, 'the 400 stays in the shop\'s cash; the books balance');
const pc = await make({ cid: cid3, price: 500 });
await pg.evaluate((cid, no) => window.eval('receiveCustomer')({ customerId: cid, amount: 400, method: 'CASH', against: [no], quiet: true }), cid3, pc);
await pg.evaluate(no => window.eval('billCancelNow')(no, 'x', 'x'), pc);
const p2 = await state(cid3);
ok(p2.owes === 0 && p2.adv === 400 && await pg.evaluate(cid => window.eval('C')(cid).advance === 400, cid3) && p2.tb === 0, 'no other bill: it stays as their credit', `owes ${p2.owes}, credit ${p2.adv}`);
// their credit spent on a bill comes back with it
const pd = await make({ cid: cid3, price: 100 });       // 200, off the 400 held
const pdb = await bill(pd); ok(pdb.usedCredit === 200, 'test bill used their credit', String(pdb.usedCredit));
await pg.evaluate(no => window.eval('billCancelNow')(no, 'x', 'x'), pd);
const p3 = await state(cid3);
ok(p3.adv === 400 && await pg.evaluate(cid => window.eval('C')(cid).advance === 400, cid3) && p3.owes === 0 && p3.tb === 0, 'credit used on the bill goes back to them', `credit ${p3.adv}`);

// ---- goods to collect, serials and points
const ln2 = await make({ cid, price: 500, line: { later: 2 } });
ok(await pg.evaluate(no => window.eval('billPending')(window.eval('S').sales.find(x => x.no === no)), ln2), 'test bill has goods pending');
await pg.evaluate(no => window.eval('billCancelNow')(no, 'x', 'x'), ln2);
ok(await pg.evaluate(no => !window.eval('pendingBills')().has(no), ln2), 'goods to collect: gone from the list');
const serial = 'SN' + Date.now();
const sv = await make({ cid, qty: 1, price: 500, line: { serials: [serial] } });
ok(await pg.evaluate(s => window.eval('S').serials.find(x => x.no === s).status === 'out', serial), 'test serial is out');
await pg.evaluate(no => window.eval('billCancelNow')(no, 'x', 'x'), sv);
ok(await pg.evaluate(s => { const r = window.eval('S').serials.find(x => x.no === s); return r.status === 'in' && !r.outRef && !r.customerId }, serial), 'a serial number comes back in stock');
const pts = await make({ cid, price: 500 });
await pg.evaluate((no, cid) => { const S = window.eval('S'); S.sales.find(x => x.no === no).pointsEarned = 5; window.eval('C')(cid).points = 7 }, pts, cid);
await pg.evaluate(no => window.eval('billCancelNow')(no, 'x', 'x'), pts);
ok(await pg.evaluate(cid => window.eval('C')(cid).points === 2, cid), 'points earned on the bill are taken back');

// ---- it survives a reload, and the customer's link says it was cancelled
const linkNo = await pg.evaluate(() => { const S = window.eval('S'), inv = S.sales.find(x => x.cancelled && x.link); return inv ? inv.link : '' });
const before = await state();
await pg.evaluate(() => window.eval('persist')(true)); await wait(4000);
await signIn();
const after = await state();
ok((await bill(cn)).cancelled && !(await bill(cn)).lines.length && after.owes === before.owes && after.stock === before.stock, 'it is still cancelled after a reload', `${before.owes} / ${after.owes}`);
ok(await pg.evaluate(no => { const t = window.eval('S').sales.find(x => x.no === no); return !!t }, cn), 'the number was not put back as a live bill by the server');
if (linkNo) { const id = linkNo.split('/').pop(), j = await pg.evaluate(id => fetch('/api/my/b/' + id).then(r => r.json()), id);
  ok(j.bill && j.bill.cancelled === true && !j.bill.html, 'the customer\'s link says cancelled, and does not show the old paper') }
else ok(false, 'a cancelled bill with a link to try');
ok(after.tb === 0, 'the books balance at the end');
ok(errs.length === 0, 'no errors in the page', errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
