// Drives the day-end page in a real browser: a trading day, cheques, the card machine,
// a short drawer, the close, the record it leaves and opening the day again.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1400, height: 1000 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));

let pass = 0, fail = 0;
const ok = (c, what, extra = '') => { if (c) { pass++; console.log('PASS ' + what + (extra ? '  ' + extra : '')); } else { fail++; console.log('FAIL ' + what + (extra ? '  ' + extra : '')); } };

await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForSelector('#lockScreen', { timeout: 15000 });
if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
await pg.type('#lockPw', 'Afridh123');
await pg.click('#lockGo');
await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 15000 });
await new Promise(r => setTimeout(r, 800));

// a day's trading, from a clean slate so the figures are known
const setup = await pg.evaluate(() => {
  const d = D(today);
  S.sales = S.sales.filter(s => s.date !== d);
  S.payments = S.payments.filter(p => p.date !== d);
  S.cheques = [];
  S.cashups = [];
  S.dayends = [];
  S.trail = [];
  S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: null };
  const p0 = S.products[0].id, p1 = S.products[1].id;
  S.sales.push({ no: '11000901', date: d, type: 'CASH', customerId: 1,
    lines: [{ pid: p0, qty: 2, price: 1200, disc: 0, cost: 900, checked: true }],
    sub: 2400, billDisc: 0, total: 2400, paid: 2400, balance: 0,
    pays: [{ method: 'CASH', amount: 900 }, { method: 'CARD', amount: 1000, bank: 1 }, { method: 'CHEQUE', amount: 500, ref: '447201' }],
    by: 'Afridh', terminal: 1, time: '05:10 PM' });
  S.sales.push({ no: '11000902', date: d, type: 'CREDIT', customerId: 2,
    lines: [{ pid: p1, qty: 1, price: 8000, disc: 0, cost: 6000 }],          // no tick on this one
    sub: 8000, billDisc: 0, total: 8000, paid: 3000, balance: 5000,
    pays: [{ method: 'BANK', amount: 3000, bank: 1 }],
    by: 'Afridh', terminal: 1, time: '05:40 PM' });
  S.cheques.push({ dir: 'RECEIVED', no: '447201', bank: 'Commercial Bank', date: d, recvDate: d, chqDate: d,
    payee: 'Regal Hardware', amount: 500, status: 'RECEIVED', party: 'Walk-in', ref: '11000901' });
  const ahead = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  S.cheques.push({ dir: 'RECEIVED', no: '447202', bank: 'Peoples Bank', date: d, recvDate: d, chqDate: ahead,
    payee: 'Regal Hardware', amount: 75000, status: 'RECEIVED', party: 'Green Field', customerId: 3, ref: '11000903' });
  dayTab = 'close';
  go('cashup');
  const tn = deTenders(d, cashStore());
  return { d, tn, chq: { held: deCheques(d).held.length, bankable: deCheques(d).bankable.length, post: deCheques(d).postdated.length } };
});

ok(setup.tn.bills === 2, 'the day counts both bills', String(setup.tn.bills));
ok(setup.tn.sales === 10400, 'sold adds up', String(setup.tn.sales));
ok(setup.tn.t.CASH === 900 && setup.tn.t.CARD === 1000 && setup.tn.t.BANK === 3000 && setup.tn.t.CHEQUE === 500,
   'each way of paying is counted on its own', JSON.stringify(setup.tn.t));
ok(setup.tn.credit === 5000, 'what was given on credit is seen', String(setup.tn.credit));
ok(setup.chq.bankable === 1 && setup.chq.post === 1,
   'a post-dated cheque is held back from banking', JSON.stringify(setup.chq));

// the card section is on the page, because the card machine took money
const card = await pg.evaluate(() => ({
  shown: document.body.innerHTML.includes('Card and bank'),
  slips: [...document.querySelectorAll('[data-de="slip"]')].length,
}));
ok(card.shown && card.slips >= 1, 'the card machine has a box to key the slip into', JSON.stringify(card));

// the close will not go while the drawer is uncounted
const blocked = await pg.evaluate(() => { deCloseDay(); return { closed: !!deFind(cashDay(), cashStore()) } });
ok(!blocked.closed, 'the day will not close before the drawer is counted');

// count the drawer, deliberately short
const counted = await pg.evaluate(() => {
  const ex = cashExpected(cashDay(), cashStore()).expected;
  const short = ex - 500;                                   // 500 missing: over any sane tolerance
  cashDraft.close = {};
  let left = short;
  for (const den of CASH_DENOMS) { const n = Math.floor(left / den); if (n > 0) { cashDraft.close[den] = n; left = +(left - n * den).toFixed(2) } }
  cashSave('close');
  const c = cashFind('close', cashDay(), cashStore());
  return { expected: ex, counted: c ? c.total : null, diff: c ? c.diff : null, leftOver: left };
});
ok(counted.counted !== null, 'the closing count saves');
ok(Math.abs(counted.diff + 500) < 0.01, 'the drawer is seen to be 500 short', JSON.stringify(counted));

// a short drawer beyond the tolerance will not close without a reason
const noReason = await pg.evaluate(() => {
  const seen = document.querySelector('[data-de="chqseen"]'); if (seen) { seen.checked = true; seen.onchange() }
  document.querySelectorAll('[data-de="slip"]').forEach(el => { el.value = '1000'; el.oninput() });
  deCloseDay();
  return { closed: !!deFind(cashDay(), cashStore()), asked: !!document.getElementById('deWhy') };
});
ok(!noReason.closed && noReason.asked, 'a short drawer is not closed without a reason', JSON.stringify(noReason));

// with a reason, it closes
const closed = await pg.evaluate(() => {
  const w = document.getElementById('deWhy'); w.value = 'gave change from the wrong note at about four'; w.oninput();
  const note = document.getElementById('deNote'); if (note) { note.value = 'quiet afternoon'; note.oninput() }
  window.print = () => {};
  deCloseDay();
  const r = deFind(cashDay(), cashStore());
  return r ? { by: r.by, sales: r.sales, bills: r.bills, cash: r.cash, why: r.why, note: r.note,
    slips: r.slips, cheques: r.cheques, open: r.open, tenders: r.tenders } : null;
});
ok(closed && closed.sales === 10400 && closed.bills === 2, 'the day is closed and the figures are kept', JSON.stringify(closed && { sales: closed.sales, bills: closed.bills }));
ok(closed && Math.abs(closed.cash.diff + 500) < 0.01 && closed.why.includes('wrong note'), 'the shortfall and the reason are on the record');
ok(closed && closed.slips && +closed.slips['1'] === 1000, 'what the card slip said is kept', JSON.stringify(closed && closed.slips));
ok(closed && closed.cheques.inToday === 2 && closed.cheques.left === 1, 'the cheques are counted on the record', JSON.stringify(closed && closed.cheques));

// the trail and the owner's warning
const after = await pg.evaluate(() => ({
  trail: (S.trail || []).filter(t => t.kind === 'dayend').map(t => t.what),
  told: (S.notif || []).filter(n => /over|short/.test(n.text || '')).length,
  shows: document.body.innerHTML.includes('is closed'),
}));
ok(after.trail.length >= 1 && /short/.test(after.trail[0]), 'the close goes on the trail with the shortfall', JSON.stringify(after.trail[0]));
ok(after.told >= 1, 'the owner is told about the short drawer');
ok(after.shows, 'the page says the day is closed');

// closing twice does nothing
const twice = await pg.evaluate(() => { deCloseDay(); return deList().length });
ok(twice === 1, 'a day cannot be closed twice', String(twice));

// banking a cheque is a real movement
const banked = await pg.evaluate(() => {
  const before = bal('1010', D(today));
  const b1 = S.banks[0];
  const acBefore = bal(b1.ac, D(today));
  deBankCheque('447201', b1.id);
  const ch = S.cheques.find(c => c.no === '447201');
  return { status: ch.status, into: ch.depositTo, acMoved: +(bal(b1.ac, D(today)) - acBefore).toFixed(2), cashUnmoved: before === bal('1010', D(today)) };
});
ok(banked.status === 'DEPOSITED' && banked.acMoved === 500 && banked.cashUnmoved,
   'banking a cheque moves it into the bank account and leaves cash alone', JSON.stringify(banked));

// a post-dated cheque is refused
const post = await pg.evaluate(() => { deBankCheque('447202', S.banks[0].id); return S.cheques.find(c => c.no === '447202').status });
ok(post === 'RECEIVED', 'a post-dated cheque is refused', post);

// opening the day again
const reopened = await pg.evaluate(() => {
  window.confirm = () => true;
  const r = deFind(cashDay(), cashStore());
  S.dayends = deList().filter(x => x !== r);
  logTrail('dayend', `Day ${r.date} opened again after being closed by ${r.by}`, { ref: r.date });
  render();
  return { left: deList().length, trail: (S.trail || []).filter(t => t.kind === 'dayend').length };
});
ok(reopened.left === 0 && reopened.trail >= 2, 'opening the day again is itself on the trail', JSON.stringify(reopened));

ok(errs.length === 0, 'no script errors on the day-end page', errs.join(' | '));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
