// The server's guard against one bill in the books twice (dropDoubleBills, 9 Nov 2026: bill 20207).
//  · copies of one and the same bill go back to one, with the entries and stock moves they doubled
//  · two different bills that share a number are both kept (keepBills renumbers those)
//  · a bill whose entries do not come in twice over is left alone, and the owner told
// Runs on its own: no server, no database.
//   node backend/tools/check-doublebills.mjs
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:x@127.0.0.1:1/x';
const { dropDoubleBills } = await import('../src/routes/regal.js');
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const bill = (no, uid, extra = {}) => ({ no, uid, customerId: 5, total: 888155, balance: 888155, lines: [{ pid: 1, qty: 5, price: 177631 }], ...extra });
const jr = no => [{ date: '2026-11-09', memo: 'Sale ' + no, ref: no, lines: [{ ac: '4100', cr: 888155 }, { ac: '1100', dr: 888155, party: { type: 'C', id: 5 } }] },
                  { date: '2026-11-09', memo: 'COGS ' + no, ref: no, lines: [{ ac: '5100', dr: 500000 }, { ac: '1200', cr: 500000 }] }];
const mv = no => [{ pid: 1, qty: -5, type: 'SALE', ref: no }];

{ // the fault: the bill, its entries and its stock move all twice; the stock taken off twice
  const S = { sales: [bill('20207', 'u1'), bill('20206', 'u0'), bill('20207', 'u1')], journal: [...jr('20206'), ...jr('20207'), ...jr('20207')],
    movements: [...mv('20206'), ...mv('20207'), ...mv('20207')], products: [{ id: 1, stock: 90 }], notif: [] };
  const done = dropDoubleBills({ S }, 'Akmal');
  ok(done.join() === '20207' && S.sales.filter(s => s.no === '20207').length === 1 && S.sales.length === 2, 'the bill is kept once', JSON.stringify(done));
  ok(S.journal.filter(j => j.ref === '20207').length === 2 && S.journal.filter(j => j.ref === '20206').length === 2, 'its journal entries once — the other bill\'s untouched', S.journal.length);
  ok(S.movements.length === 2 && S.products[0].stock === 95, 'its stock move once, and the stock put back', JSON.stringify({ m: S.movements.length, stock: S.products[0].stock }));
  ok(/20207/.test(S.notif[0]?.text || '') && S.notif[0].forApprovers, 'the owner is told', S.notif[0]?.text);
}
{ // the copy with a payment on it is the one kept
  const paid = bill('20207', 'u1', { pays: [{ method: 'CASH', amount: 100 }], balance: 888055 });
  const S = { sales: [bill('20207', 'u1'), paid], journal: [...jr('20207'), ...jr('20207')], movements: [...mv('20207'), ...mv('20207')], products: [{ id: 1, stock: 90 }] };
  dropDoubleBills({ S }, 'Akmal');
  ok(S.sales.length === 1 && S.sales[0].balance === 888055, 'the copy with more done to it is kept', JSON.stringify(S.sales[0].pays));
}
{ // two different bills, one number: not this guard's to touch
  const S = { sales: [bill('10176', 'a'), bill('10176', 'b', { total: 500, lines: [{ pid: 2, qty: 1, price: 500 }] })], journal: [...jr('10176')], movements: [], products: [] };
  const done = dropDoubleBills({ S }, 'Akmal');
  ok(!done.length && S.sales.length === 2, 'two different bills sharing a number are both kept');
}
{ // a bill twice whose entries are not there twice over: left as it is
  const S = { sales: [bill('20300', 'u3'), bill('20300', 'u3')], journal: [...jr('20300'), jr('20300')[0]], movements: [...mv('20300'), ...mv('20300')], products: [{ id: 1, stock: 90 }], notif: [] };
  const done = dropDoubleBills({ S }, 'Akmal');
  ok(!done.length && S.sales.length === 2 && S.journal.length === 3 && S.products[0].stock === 90, 'entries that do not match up: nothing taken out', JSON.stringify({ done, s: S.sales.length, j: S.journal.length }));
  ok(/20300/.test(S.notif[0]?.text || ''), 'and the owner told to look at it', S.notif[0]?.text);
  dropDoubleBills({ S }, 'Akmal');
  ok(S.notif.length === 1, 'told once, not on every save', S.notif.length);
}
{ // books with nothing doubled are not touched
  const S = { sales: [bill('1', 'a'), bill('2', 'b')], journal: [...jr('1'), ...jr('2')], movements: [], products: [] }, was = JSON.stringify(S);
  dropDoubleBills({ S }, 'Akmal');
  ok(JSON.stringify(S) === was, 'books with no bill twice are left exactly as they are');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
