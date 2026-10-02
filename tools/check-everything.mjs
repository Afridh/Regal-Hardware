// The Everything page: does it actually report what is in the books, and does it only read?
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1500, height: 1100 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let pass = 0, fail = 0;
const ok = (c, w, x = '') => { c ? (pass++, console.log('PASS ' + w + (x ? '  ' + x : ''))) : (fail++, console.log('FAIL ' + w + (x ? '  ' + x : ''))) };

await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForSelector('#lockScreen');
if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
await pg.type('#lockPw', 'Afridh123');
await pg.click('#lockGo');
await pg.waitForFunction(() => !document.getElementById('lockScreen'));
await new Promise(r => setTimeout(r, 800));

/* make the shop have something to report, then see whether the page says so */
const seeded = await pg.evaluate(() => {
  const d = D(today);
  const old = (n) => { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() - n); return D(t) };

  // a customer 90 days late, and one over their limit
  // ageing is built from the bills themselves, so this has to be a real one
  const late = S.customers.find(c => c.id !== 1);
  S.sales.push({ no: 'OLD-1', date: old(95), type: 'CREDIT', customerId: late.id, lines: [], sub: 48000,
    billDisc: 0, total: 48000, paid: 0, balance: 48000, pays: [], by: 'Afridh', terminal: 1 });
  post(old(95), 'Sale OLD-1', 'OLD-1', [{ ac: '4100', cr: 48000 }, { ac: '1100', dr: 48000, party: { type: 'C', id: late.id } }]);
  const over = S.customers.filter(c => c.id !== 1)[1];
  over.limit = 1000;
  post(d, 'Sale OVR-1', 'OVR-1', [{ ac: '4100', cr: 25000 }, { ac: '1100', dr: 25000, party: { type: 'C', id: over.id } }]);

  // a supplier asking to be paid
  const sup = S.suppliers[0];
  S.payReqs = S.payReqs || [];
  S.payReqs.push({ id: 'prX', sid: sup.id, rep: 'Nimal', date: d, lines: [{ no: 'X' }], total: 184500,
    note: 'cheque please', status: 'sent', events: [{ actor: 'supplier', name: 'Nimal', action: 'asked', at: Date.now() }] });

  // a website order waiting
  S.web = S.web || { orders: [] };
  S.web.orders = S.web.orders || [];
  S.web.orders.push({ no: 'WEB-9', date: d, total: 7400, status: 'placed' });

  // an item below its reorder level
  const p = S.products[0]; p.min = Math.max(1, (+p.stock || 0) + 10);

  go('everything');
  return { late: late.name, lateId: late.id, over: over.name, sup: sup.name, item: p.name,
    owedLate: partyBal('C', late.id), overBal: partyBal('C', over.id) };
});

const page = await pg.evaluate(() => {
  const mn = document.getElementById('main');
  return { html: mn.innerHTML, text: mn.textContent.replace(/\s+/g, ' '),
    tiles: mn.querySelectorAll('.daytile').length,
    cards: mn.querySelectorAll('.ev-card').length,
    opens: mn.querySelectorAll('[data-act="deGo"]').length };
});

ok(page.tiles === 5 && page.cards >= 9, 'the whole shop in one page: five figures and every block',
   JSON.stringify({ tiles: page.tiles, cards: page.cards }));

ok(page.text.includes(seeded.late) && /Customers late paying/.test(page.text),
   'the customer who is 90 days late is named', seeded.late);
ok(page.text.includes(seeded.over) && /Over their credit limit/.test(page.text),
   'and the one over their limit', seeded.over);
ok(page.text.includes(seeded.sup) && /184,500/.test(page.text),
   'the supplier asking to be paid, with what they are asking for', seeded.sup);
ok(/Online/.test(page.text) && /Orders waiting/.test(page.text),
   'the website orders waiting');
ok(page.text.includes(seeded.item) && /Running low/.test(page.text),
   'the item below its reorder level', seeded.item);
ok(/Who is in today/.test(page.text), 'who is in today');
ok(/In the drawer/.test(page.text) && /Our cheques not presented/.test(page.text),
   'the money: the drawer, the banks and the cheques both ways');
ok(/waiting on somebody/.test(page.text), 'and a line at the top for anything waiting on a person');
ok(page.opens >= 8, 'every block says where it came from', String(page.opens) + ' ways through');

/* the figures are the books, not a copy of them */
const agrees = await pg.evaluate(() => {
  const mn = document.getElementById('main');
  const num = (label) => {
    const t = [...mn.querySelectorAll('.daytile')].find(x => x.textContent.toUpperCase().includes(label));
    return t ? +t.querySelector('.v').dataset.count : null;
  };
  const cust = S.customers.filter(c => c.id !== 1).reduce((a, c) => a + Math.max(0, partyBal('C', c.id)), 0);
  const sup = S.suppliers.reduce((a, s) => a + Math.max(0, partyBal('S', s.id)), 0);
  return { drawer: num('IN THE DRAWER'), cash: bal('1010', D(today)),
    owed: num('CUSTOMERS OWE US'), cust: +cust.toFixed(2),
    owing: num('WE OWE SUPPLIERS'), sup: +sup.toFixed(2) };
});
ok(Math.abs(agrees.drawer - agrees.cash) < 0.005, 'the drawer figure is the journal, not a copy', JSON.stringify(agrees.drawer));
ok(Math.abs(agrees.owed - agrees.cust) < 0.005, 'and so is what customers owe', JSON.stringify({ shown: agrees.owed, books: agrees.cust }));
ok(Math.abs(agrees.owing - agrees.sup) < 0.005, 'and what the shop owes', JSON.stringify({ shown: agrees.owing, books: agrees.sup }));

/* it reads and never writes */
const quiet = await pg.evaluate(() => {
  const before = JSON.stringify({ j: S.journal.length, s: S.sales.length, p: S.purchases.length,
    c: S.cheques.length, r: (S.payReqs || []).length, cu: S.customers.length });
  for (let i = 0; i < 5; i++) { go('everything'); render() }
  const after = JSON.stringify({ j: S.journal.length, s: S.sales.length, p: S.purchases.length,
    c: S.cheques.length, r: (S.payReqs || []).length, cu: S.customers.length });
  return { same: before === after, before, after };
});
ok(quiet.same, 'drawing it over and over changes nothing in the books', quiet.same ? '' : quiet.before + ' -> ' + quiet.after);

/* and it is the owner's page, like the AI one */
const who = await pg.evaluate(() => {
  const was = S.user.role, out = {};
  out.owner = allowed('everything');
  S.user.role = 'Salesman'; out.salesman = allowed('everything');
  S.user.role = 'Cashier'; out.cashier = allowed('everything');
  S.user.role = was;
  return out;
});
ok(who.owner && !who.salesman && !who.cashier,
   'the owner sees it and the counter does not — every figure in the shop is on it', JSON.stringify(who));

ok(errs.length === 0, 'no script errors', errs.join(' | '));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
