// Cash & bank (admins only): the entries behind the cash in hand and each bank, added, changed and deleted.
// Expenses: added by anyone who may, changed or deleted by an admin, or by anyone else with an admin's yes.
// After every change the books still balance and sales and profit have not moved. It all survives a reload.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-cashbank.mjs [screenshot-dir]
// The till here never reaches the print helper on this PC: its printers are the shop's.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let dialogs = [], answer = true; pg.on('dialog', d => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss() });
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
  await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''"); window.printPaper = () => {} });
};
await signIn();

const state = () => pg.evaluate(() => { const S = window.eval('S'), bal = window.eval('bal'), acs = new Set(); S.journal.forEach(j => j.lines.forEach(l => acs.add(l.ac)));
  const tb = [...acs].reduce((a, k) => a + bal(k), 0), inc = [...acs].filter(k => /^[4]/.test(k)).reduce((a, k) => a + bal(k), 0);
  return { cash: bal('1010'), bank: bal(S.banks[0].ac), bank2: S.banks[1] ? bal(S.banks[1].ac) : 0, open: bal('3100'), tb: Math.round(tb * 100) / 100, income: inc, sales: S.sales.length, exp: S.expenses.length, expAc: [...acs].filter(k => /^6/.test(k)).reduce((a, k) => a + bal(k), 0), je: S.journal.length } });
const go = v => pg.evaluate(x => window.eval('go')(x), v).then(() => wait(300));
const trail = re => pg.evaluate(r => window.eval('S').trail.filter(t => new RegExp(r).test(t.what)).length, re);
const fill = (o) => pg.evaluate(o => { for (const [k, v] of Object.entries(o)) { const e = document.getElementById(k); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })) } }, o);
const pressAct = (act, no) => pg.evaluate((act, no) => { const x = [...document.querySelectorAll(`[data-act="${act}"]`)].find(y => !no || y.dataset.no === no); if (!x) throw new Error('no button ' + act); x.click() }, act, no).then(() => wait(250));
const newest = () => pg.evaluate(() => { const j = window.eval('cashEntries')()[0]; return j && { no: j.j.no, amount: j.amount, note: j.note } });

// the page, for an admin
const s0 = await state();
ok(await pg.evaluate(() => window.eval('allowed')('cashbank')), 'an admin has the Cash & bank page');
await go('cashbank');
ok(await pg.evaluate(() => /Cash in hand/.test(document.body.innerText) && !!document.querySelector('[data-act="cashNew"]')), 'it shows the cash and the banks, with Add an entry');

// add to the cash
await pressAct('cashNew');
await fill({ cashAc: '1010', cashWay: 'in', cashAmt: '50000', cashDate: '2026-11-01', cashNote: 'Cash in the drawer when we started' });
if (OUT) await pg.screenshot({ path: OUT + '/cb-add.png' });
await pg.evaluate(() => document.getElementById('cashOk').click()); await wait(350);
let s1 = await state();
ok(s1.cash === s0.cash + 50000, 'added 50,000: the cash goes up by it', `${s0.cash} to ${s1.cash}`);
ok(s1.tb === 0, 'the books still balance');
ok(s1.income === s0.income && s1.sales === s0.sales && s1.expAc === s0.expAc, 'sales, income and expenses have not moved');
const cashNo = await pg.evaluate(() => window.eval('cashEntries')().find(x => x.note === 'Cash in the drawer when we started').j.no);
ok(await pg.evaluate(no => !!document.querySelector(`tr[data-cash="${no}"]`), cashNo), 'it is in the list');
ok(await pg.evaluate(no => window.eval('S').journal.find(j => j.no === no).date === '2026-11-01', cashNo), 'on its date');
ok(await trail('Cash and bank entry added') >= 1, 'it is on the trail');
if (OUT) await pg.screenshot({ path: OUT + '/cb-page.png' });

// what is refused
await pressAct('cashNew');
await fill({ cashAmt: '0', cashNote: 'x' }); await pg.evaluate(() => document.getElementById('cashOk').click()); await wait(150);
ok(await pg.evaluate(() => /amount/i.test(document.getElementById('cashMsg').textContent)), 'no amount: refused');
await fill({ cashAmt: '10', cashNote: '' }); await pg.evaluate(() => document.getElementById('cashOk').click()); await wait(150);
ok(await pg.evaluate(() => /what this entry is/i.test(document.getElementById('cashMsg').textContent)), 'no details: refused');
await fill({ cashAmt: '10', cashNote: 'x', cashDate: '2099-01-01' }); await pg.evaluate(() => document.getElementById('cashOk').click()); await wait(150);
ok(await pg.evaluate(() => /future/i.test(document.getElementById('cashMsg').textContent)), 'a future date: refused');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
ok((await state()).je === s1.je, 'nothing went in');

// change it: another amount, and over to a bank
await pressAct('cashEdit', cashNo);
ok(await pg.evaluate(() => document.getElementById('cashAmt').value === '50000' && document.getElementById('cashAc').value === '1010' && document.getElementById('cashNote').value === 'Cash in the drawer when we started'), 'Edit opens with what is there');
await fill({ cashAmt: '42000.50' }); await pg.evaluate(() => document.getElementById('cashOk').click()); await wait(350);
let s2 = await state();
ok(s2.cash === s0.cash + 42000.5 && s2.je === s1.je && s2.tb === 0, 'changed to 42,000.50: the cash follows, no extra entry', String(s2.cash - s0.cash));
await pressAct('cashEdit', cashNo);
const bankAc = await pg.evaluate(() => window.eval('S').banks[0].ac);
await fill({ cashAc: bankAc, cashNote: 'Actually in the bank' }); await pg.evaluate(() => document.getElementById('cashOk').click()); await wait(350);
s2 = await state();
ok(s2.cash === s0.cash && s2.bank === s0.bank + 42000.5 && s2.tb === 0, 'moved to the bank: off the cash, on the bank');
ok(await trail('It was: Cash in hand') >= 1, 'the trail keeps what it was');
ok(await pg.evaluate(no => window.eval('S').journal.find(j => j.no === no).edits.length === 2, cashNo), 'and the entry keeps its history');
// take from it
await pressAct('cashEdit', cashNo);
await fill({ cashWay: 'out', cashAmt: '100' }); await pg.evaluate(() => document.getElementById('cashOk').click()); await wait(350);
s2 = await state();
ok(s2.bank === s0.bank - 100 && s2.tb === 0, 'Take from it: the bank goes down', String(s2.bank - s0.bank));

// delete it: Cancel first
answer = false; await pressAct('cashDel', cashNo); answer = true;
ok((await state()).je === s1.je, 'Cancel on the question: nothing is deleted');
ok(/Delete this entry/.test(dialogs.at(-1)) && /100/.test(dialogs.at(-1)), 'the question says what it is', dialogs.at(-1).slice(0, 60));
await pressAct('cashDel', cashNo);
let s3 = await state();
ok(s3.bank === s0.bank && s3.cash === s0.cash && s3.je === s0.je && s3.tb === 0, 'deleted: everything back where it was');
ok(await trail('Cash and bank entry deleted') >= 1, 'on the trail');

// an opening balance made another way shows too: a new bank account
await pg.evaluate(() => window.eval('bankModal')()); await wait(200);
await fill({ bkName: 'Test Bank Kaduruwela', bkNo: '99887766', bkOpen: '1500' }); await pg.evaluate(() => document.getElementById('bkOk').click()); await wait(350);
const opened = await pg.evaluate(() => { const x = window.eval('cashEntries')().find(y => y.where === 'Test Bank Kaduruwela'); return x && { no: x.j.no, amount: x.amount, ac: x.ac } });
ok(opened && opened.amount === 1500, 'a new bank account\'s opening money is in the list to change');
await pressAct('cashDel', opened.no);
ok(await pg.evaluate(ac => window.eval('bal')(ac) === 0, opened.ac), 'and can be deleted');
await pg.evaluate(() => { const S = window.eval('S'); S.banks = S.banks.filter(b => b.name !== 'Test Bank Kaduruwela') });

// expenses: add
await go('expenses');
const e0 = await state();
await pressAct('newExp');
ok(await pg.evaluate(() => document.getElementById('ea').value === ''), 'a new expense does not start with an amount in it');
await fill({ ea: '2500', edt: '2026-11-03', em: 'CASH', ed: 'Three-wheeler hire' }); await pg.evaluate(() => document.getElementById('eok').click()); await wait(350);
const exNo = await pg.evaluate(() => window.eval('S').expenses.at(-1).no);
let e1 = await state();
ok(e1.exp === e0.exp + 1 && e1.cash === e0.cash - 2500 && e1.tb === 0, 'an expense added: the cash goes down', exNo);
ok(await pg.evaluate(no => window.eval('S').expenses.find(x => x.no === no).date === '2026-11-03', exNo), 'on the date given');
if (OUT) await pg.screenshot({ path: OUT + '/exp-list.png' });
// edit: to a bank, another amount and category
await pressAct('expEdit', exNo);
ok(await pg.evaluate(() => document.getElementById('ea').value === '2500' && document.getElementById('ed').value === 'Three-wheeler hire'), 'Edit opens with what is there');
const cat2 = await pg.evaluate(() => [...document.getElementById('ec').options].map(o => o.value).find(v => v !== document.getElementById('ec').value));
const bankId = await pg.evaluate(() => String(window.eval('S').banks[0].id));
await fill({ ea: '3000', ec: cat2, em: 'BANK', eb: bankId, ed: 'Lorry hire' }); await pg.evaluate(() => document.getElementById('eok').click()); await wait(350);
let e2 = await state();
ok(e2.cash === e0.cash && e2.bank === e0.bank - 3000 && e2.tb === 0 && e2.je === e1.je, 'changed to 3,000 from the bank: cash back, bank down, no extra entry');
ok(e2.expAc === e0.expAc + 3000, 'the expense accounts show 3,000');
ok(await pg.evaluate((no, c) => { const S = window.eval('S'), x = S.expenses.find(y => y.no === no), j = S.journal.find(y => y.ref === no); return x.amount === 3000 && x.cat === c && x.desc === 'Lorry hire' && x.method === 'BANK' && j.lines.some(l => l.ac === c && l.dr === 3000) }, exNo, cat2), 'the expense and its book entry say the same');
ok(await trail('Expense ' + exNo + ' changed') >= 1, 'on the trail with what it was');

// not an admin: no page, no bank details, and asks about expenses
await pg.evaluate(() => { const S = window.eval('S'); window._role = S.user.role; S.user.role = 'Cashier'; window.eval('render')() }); await wait(250);
ok(await pg.evaluate(() => !window.eval('allowed')('cashbank')), 'anyone else: no Cash & bank page');
ok(await pg.evaluate(() => !/Cash in hand/.test(window.eval('cashBankPage')())), 'and it shows nothing if reached');
const j0 = (await state()).je;
await pg.evaluate(() => { window.eval('cashEntryModal')(); window.eval('bankModal')() }); await wait(200);
ok(await pg.evaluate(() => !document.getElementById('cashOk') && !document.getElementById('bkOk')), 'the windows do not open');
await pg.evaluate(no => { window.eval('cashEntryDelete')(no) }, await pg.evaluate(() => (window.eval('cashEntries')()[0] || { j: {} }).j.no)); await wait(150);
ok((await state()).je === j0, 'deleting is refused too');
await go('expenses');
ok(await pg.evaluate(no => /Ask to change/.test(document.querySelector(`tr[data-exp="${no}"]`).innerText), exNo), 'expenses say Ask to change, Ask to delete');
await pressAct('expEdit', exNo);
await fill({ ea: '3500' }); await pg.evaluate(() => document.getElementById('eok').click()); await wait(350);
let asked = await pg.evaluate(() => { const a = window.eval('S').approvals.find(x => x.kind === 'expChange' && x.status === 'pending'); return a && { id: a.id, title: a.title } });
ok(asked && (await state()).expAc === e0.expAc + 3000, 'asking to change: it goes to an admin, the expense has not changed yet', asked && asked.title);
ok(await pg.evaluate(no => /waiting for an admin/.test(document.querySelector(`tr[data-exp="${no}"]`).innerText), exNo), 'it shows as waiting, and cannot be asked twice');
// a cashier cannot say yes
await pg.evaluate(id => window.eval('decideApproval')(id, true), asked.id); await wait(200);
ok(await pg.evaluate(id => window.eval('S').approvals.find(x => x.id === id).status === 'pending', asked.id), 'a cashier cannot approve it');
await pg.evaluate(() => { const S = window.eval('S'); S.user.role = window._role; window.eval('render')() }); await wait(200);
// turned down
await pg.evaluate(id => window.eval('decideApproval')(id, false, 'no'), asked.id); await wait(200);
ok((await state()).expAc === e0.expAc + 3000, 'an admin turns it down: nothing changes');
// asked again, approved
await pg.evaluate(() => { window.eval('S').user.role = 'Cashier' });
await pg.evaluate(no => window.eval('expModal')(no), exNo); await wait(200);
await fill({ ea: '3500' }); await pg.evaluate(() => document.getElementById('eok').click()); await wait(300);
asked = await pg.evaluate(() => window.eval('S').approvals.find(x => x.kind === 'expChange' && x.status === 'pending').id);
await pg.evaluate(() => { window.eval('S').user.role = window._role });
await pg.evaluate(id => window.eval('decideApproval')(id, true), asked); await wait(300);
e2 = await state();
ok(e2.expAc === e0.expAc + 3500 && e2.bank === e0.bank - 3500 && e2.tb === 0, 'an admin approves: it changes');
// asked to delete, approved
await pg.evaluate(() => { window.eval('S').user.role = 'Cashier' });
await pg.evaluate(no => window.eval('expDelete')(no), exNo); await wait(300);
ok(await pg.evaluate(no => window.eval('S').expenses.some(x => x.no === no), exNo), 'asking to delete: still there');
asked = await pg.evaluate(() => window.eval('S').approvals.find(x => x.kind === 'expChange' && x.status === 'pending').id);
await pg.evaluate(() => { window.eval('S').user.role = window._role });
await pg.evaluate(id => window.eval('decideApproval')(id, true), asked); await wait(300);
e2 = await state();
ok(e2.exp === e0.exp && e2.cash === e0.cash && e2.bank === e0.bank && e2.expAc === e0.expAc && e2.tb === 0, 'approved: gone, and the money is back');

// an admin deletes directly; petty cash and cheque ones stay where they were made
await go('expenses');
await pressAct('newExp');
await fill({ ea: '75', em: 'CASH', ed: 'Tea' }); await pg.evaluate(() => document.getElementById('eok').click()); await wait(300);
const tea = await pg.evaluate(() => window.eval('S').expenses.at(-1).no);
await pressAct('expDel', tea);
e2 = await state();
ok(e2.exp === e0.exp && e2.cash === e0.cash && e2.tb === 0, 'an admin deletes one directly');
const locked = await pg.evaluate(() => { const S = window.eval('S'), add = window.eval('addExpense'), a = add({ cat: Object.keys(window.eval('GL')).find(k => k.startsWith('6')), amount: 20, method: 'CASH', bank: null, desc: 'petty one' }); a.method = 'PETTY'; a.petty = 'PC-1'; window.eval('render')(); return a.no });
await wait(200);
ok(await pg.evaluate(no => { const r = document.querySelector(`tr[data-exp="${no}"]`); return r && !r.querySelector('[data-act="expEdit"]') && !r.querySelector('[data-act="expDel"]') }, locked), 'a petty cash expense has no Edit or Delete here');
await pg.evaluate(no => { window.eval('expModal')(no); window.eval('expDelete')(no) }, locked); await wait(150);
ok(await pg.evaluate(no => !document.getElementById('eok') && window.eval('S').expenses.some(x => x.no === no), locked), 'and cannot be got at by other means');
await pg.evaluate(no => { const S = window.eval('S'), e = S.expenses.find(x => x.no === no); e.method = 'CASH'; delete e.petty; window.eval('expApplyDel')(no, 'test') }, locked);

// the cheque books page keeps its own buttons
await go('chqbooks'); await pg.evaluate(() => document.querySelector('[data-act="cbNew"]')?.click()); await wait(250);
ok(await pg.evaluate(() => /cheque book/i.test((document.querySelector('.modal') || {}).innerText || '') && !document.getElementById('cashOk')), 'Cheque books: its button still opens its own window');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// a change survives a reload, with the books saved and read back
await go('cashbank'); await pressAct('cashNew');
await fill({ cashAc: '1010', cashWay: 'in', cashAmt: '777', cashNote: 'Survives a reload' }); await pg.evaluate(() => document.getElementById('cashOk').click()); await wait(350);
await pg.evaluate(() => window.eval('persist')(true)); await wait(4000);
const beforeReload = await state();
await signIn();
const afterReload = await state();
ok(afterReload.cash === beforeReload.cash && await pg.evaluate(() => window.eval('cashEntries')().some(x => x.note === 'Survives a reload')), 'it is still there after a reload', String(afterReload.cash));
const keepNo = await pg.evaluate(() => window.eval('cashEntries')().find(x => x.note === 'Survives a reload').j.no);
await go('cashbank'); await pressAct('cashDel', keepNo);
await pg.evaluate(() => window.eval('persist')(true)); await wait(4000);
await signIn();
ok(await pg.evaluate(() => !window.eval('cashEntries')().some(x => x.note === 'Survives a reload')), 'a delete survives a reload too');
ok((await state()).tb === 0, 'the books balance at the end');
ok(errs.length === 0, 'no errors in the page', errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
