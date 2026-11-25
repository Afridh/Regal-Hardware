// Clear and put in again (25 Nov 2026, the owner asked): supplier outstanding and the cheques given come off so the right
//   figures can be put in by hand; customers, stock, sales, profit and (unless ticked) cash and bank are not touched;
//   it can be put back.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-acctclear.mjs [shot-folder]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
const signIn = async () => {
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(1500);
};
await signIn();
const snap = () => pg.evaluate(() => {
  const S = window.eval('S'), pb = window.eval('partyBal'), bal = window.eval('bal'), r = v => Math.round(v * 100) / 100;
  const pl = ['4100', '4110', '5100', '5200', '5300', '1100', '1200', '2050', '1030', '2120'].map(a => [a, r(bal(a))]);
  return { sup: r(S.suppliers.reduce((a, x) => a + pb('S', x.id), 0)), each: S.suppliers.map(x => [x.id, r(pb('S', x.id))]), ap: r(bal('2100')), out: r(bal('2110')), iss: S.cheques.filter(c => c.dir === 'ISSUED').length,
    rec: JSON.stringify(S.cheques.filter(c => c.dir !== 'ISSUED')), cust: JSON.stringify(S.customers.map(c => [c.id, r(pb('C', c.id))])), custBills: JSON.stringify(S.sales.map(s => [s.no, s.balance])),
    other: JSON.stringify(pl), exp: r(Object.keys(window.eval('GL')).filter(a => a[0] === '6').reduce((a, k) => a + bal(k), 0)), money: JSON.stringify([...window.eval('moneyAcs')()].map(([a]) => r(bal(a)))), monSum: r([...window.eval('moneyAcs')()].reduce((s, [a]) => s + Math.abs(bal(a)), 0)),
    stock: JSON.stringify(S.products.map(p => [p.id, p.stock, p.cost])), pays: S.payments.length, purs: S.purchases.length, open: r(S.purchases.reduce((a, p) => a + ((p.onNote && !p.invoiced) ? 0 : p.total - p.paid), 0)), bf: S.purchases.filter(p => p.opening).length,
    bad: window.eval('acctHealth')().filter(h => !h.ok).map(h => h.key).join(',') };
});
// something of each kind: balances, a previous balance, a cheque out and a cleared one, a cheque book
await pg.evaluate(() => {
  const S = window.eval('S'), sp = S.suppliers[0], bk = S.banks[0];
  window.eval('openBalAdd')('S', S.suppliers[1].id, 7500, null, 'test');
  (S.chqBooks = S.chqBooks || []).push({ id: 'cbT', bankId: bk.id, from: '888001', to: '888010', marks: {} });
  window.eval('paySupplier')({ supplierId: sp.id, lines: [{ method: 'CHEQUE', bank: bk.id, no: '888001', date: window.eval('D(today)'), amount: 1000 }], allowDamage: true });
  window.eval('paySupplier')({ supplierId: sp.id, lines: [{ method: 'CHEQUE', bank: bk.id, no: '888002', date: window.eval('D(today)'), amount: 500 }], allowDamage: true });
  window.eval('chequeStatus')(S.cheques.find(c => c.no === '888002'), 'CLEARED');
});
const A = await snap();
ok(A.sup > 0 && A.out < 0 && A.iss >= 2 && A.bf >= 1, 'to start with: money owed to suppliers, cheques out, a previous balance', JSON.stringify([A.sup, A.out, A.iss, A.bf]));
// through the screen, as the owner does it
await pg.evaluate(() => { window.__dl = []; const o = URL.createObjectURL; URL.createObjectURL = x => { x.text && x.text().then(t => window.__dl.push(t)); return o.call(URL, x) }; window.eval('go')('chequesOut') });
await pg.waitForSelector('[data-act="acctClear"]', { timeout: 10000 }); await pg.$eval('[data-act="acctClear"]', e => e.click()); await pg.waitForSelector('#acOk', { timeout: 5000 });
ok(await pg.evaluate(() => document.getElementById('acSup').checked && document.getElementById('acChq').checked && !document.getElementById('acMon').checked), 'supplier outstanding and cheques given are ticked; cash and bank are not');
if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await wait(400); await pg.screenshot({ path: path.join(SHOTS, 'acctclear.png') }) }
await pg.$eval('#acOk', e => e.click()); await wait(200);
ok((await snap()).sup === A.sup && !!(await pg.$('#acOk')), 'nothing goes without typing CLEAR');
await pg.type('#acWord', 'clear'); await pg.$eval('#acOk', e => e.click()); await wait(800);
const B = await snap();
ok(B.sup === 0 && B.ap === 0 && B.each.every(x => x[1] === 0), 'every supplier is at nothing', JSON.stringify([B.sup, B.ap]));
ok(B.open < 0.01 && B.bf === 0 && B.purs === A.purs - A.bf, 'their bills stay, nothing left to pay; the previous balance is gone');
ok(B.iss === 0 && B.out === 0, 'no cheques given are left', JSON.stringify([B.iss, B.out]));
ok(B.cust === A.cust && B.custBills === A.custBills, 'what customers owe, and their bills, are the same');
ok(B.other === A.other && B.exp === A.exp, 'sales, cost, stock, customer and received-cheque accounts are the same');
ok(B.money === A.money, 'the cash and bank figures are the same');
ok(B.stock === A.stock && B.rec === A.rec && B.pays === A.pays, 'stock, cheques received and the payments made are the same');
ok(B.bad === A.bad, 'the books check: nothing new is out', `before [${A.bad}] after [${B.bad}]`);
const dl = (await pg.evaluate(() => window.__dl)).join('\n');
ok(/888001/.test(dl) && /SUPPLIER OUTSTANDING/.test(dl), 'a list of what goes was downloaded');
ok(await pg.evaluate(() => { const S = window.eval('S'); return window.eval('cbNextN')(S.banks[0].id, 1)[0] === '888003' }), 'the next cheque suggested is not one already given');
// saved at the server: a fresh sign-in sees it so
await wait(4000); await signIn();
const C = await snap();
ok(C.sup === 0 && C.iss === 0 && C.out === 0 && C.cust === A.cust && await pg.evaluate(() => window.eval('S').acctClears.length === 1), 'it is so on the server too, after signing in again');
// put back, exactly
await pg.evaluate(() => { const S = window.eval('S'); window.eval('acctClearUndo')(S.acctClears.at(-1).id) }); await wait(600);
const U = await snap();
ok(U.sup === A.sup && JSON.stringify(U.each) === JSON.stringify(A.each) && U.out === A.out && U.iss === A.iss && U.open === A.open && U.bf === A.bf && U.bad === A.bad, 'Put it back: as it was', JSON.stringify([U.sup, A.sup, U.out, A.out, U.open, A.open]));
// cleared again with cash and bank, then the right figures put in by hand
await pg.evaluate(() => window.eval('acctClearDo')({ sup: true, chq: true, chqOld: true, money: true }));
const M = await snap();
ok(M.monSum === 0 && M.bad === A.bad, 'with cash and bank ticked they are at nothing too');
await pg.evaluate(() => { const S = window.eval('S'); window.eval('openBalAdd')('S', S.suppliers[0].id, 12345, null, 'by hand') });
await pg.evaluate(() => { window.eval('go')('chequesOut') }); await pg.waitForSelector('[data-act="oldChq"]'); await wait(300); await pg.$eval('[data-act="oldChq"]', e => e.click()); await pg.waitForSelector('#ocNo');
await pg.evaluate(() => { const S = window.eval('S'), set = (i, v) => { document.getElementById(i).value = v }; set('ocSup', S.suppliers[0].id); set('ocBank', S.banks[0].id); set('ocNo', '888001'); set('ocAmt', '2000'); set('ocSt', 'OUT'); set('ocOff', 'yes') });
await pg.click('#ocOk'); await wait(600);
const H = await snap();
ok(H.sup === 12345 && H.open === 12345 && H.out === -2000 && H.iss === 1 && H.bad === A.bad, 'by hand: a previous balance and the same cheque number go in again, and the books agree', JSON.stringify([H.sup, H.open, H.out, H.iss, H.bad]));
// only the owner
ok(await pg.evaluate(() => { const S = window.eval('S'), r = S.user.role; S.user.role = 'Cashier'; let refused = false; try { window.eval('acctClearDo')({ sup: true }) } catch (e) { refused = true } S.user.role = r; return refused }), 'anyone but the owner is refused');
ok(!errs.length, 'no errors on the page', errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
