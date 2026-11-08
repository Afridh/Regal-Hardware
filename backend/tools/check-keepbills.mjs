// The server's save guard for bills (keepBills): a bill in the books is never taken out by a till's save.
//  · two different bills with the same number (each with its own uid): both kept, the second as 10176-2,
//    remembering the number printed on its paper, its journal and stock entries moved with it
//  · a re-made bill (same uid) replaces itself: nothing is added
//  · bills from before uids, matched by number as before
//  · a bill a save simply lost comes back under its own number
// Runs on its own: no server, no database.
//   node backend/tools/check-keepbills.mjs
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:x@127.0.0.1:1/x';
const { keepBills } = await import('../src/routes/regal.js');
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const sale = (no, uid, total, extra = {}) => ({ no, ...(uid ? { uid } : {}), total, lines: [{ pid: 1, qty: 1, price: total }], ...extra });
const jr = (ref, amt) => ({ ref, lines: [{ ac: '1010', dr: amt }, { ac: '4000', cr: amt }] });
const mv = (ref, qty) => ({ ref, pid: 1, qty: -qty, type: 'SALE' });
const books = (sales, journal = [], movements = []) => ({ S: { sales, journal, movements, products: [{ id: 1, stock: 10 }], notif: [] } });

// 1. the same number on two different bills
{ const cur = books([sale('10175', 'u0', 50), sale('10176', 'uA', 40)], [jr('10176', 40)], [mv('10176', 1)]);
  const next = books([sale('10175', 'u0', 50), sale('10176', 'uB', 400)], [jr('10176', 400)], [mv('10176', 2)]);
  const out = keepBills(next, cur, 'Akmal'), S = next.S;
  const a = S.sales.find(s => s.uid === 'uA'), b = S.sales.find(s => s.uid === 'uB');
  ok(!!a && !!b, 'two bills printed as 10176: both are in the books', JSON.stringify(out));
  ok(b && b.no === '10176' && a && a.no === '10176-2', 'the second is kept as 10176-2', a && a.no);
  ok(a && a.printedNo === '10176' && /printed as 10176/.test(a.note || ''), 'and says the number printed on its paper', a && a.note);
  ok(S.journal.some(j => j.ref === '10176-2' && j.lines[0].dr === 40) && S.journal.some(j => j.ref === '10176' && j.lines[0].dr === 400), 'each bill keeps its own takings in the journal');
  ok(S.movements.some(m => m.ref === '10176-2' && m.qty === -1) && S.products[0].stock === 9, 'and its own stock movement', 'stock ' + S.products[0].stock);
  ok(/same number/.test(S.notif[0] && S.notif[0].text), 'the owner is told', S.notif[0] && S.notif[0].text);
  ok(new Set(S.sales.map(s => s.no)).size === S.sales.length, 'no number is used twice in the books') }

// 2. a re-made bill keeps its uid: it replaces itself
{ const cur = books([sale('10176', 'uA', 40)]), next = books([sale('10176', 'uA', 60)]);
  const out = keepBills(next, cur, 'Afridh');
  ok(!out.length && next.S.sales.length === 1 && next.S.sales[0].total === 60, 'a re-made bill (same uid) replaces itself: nothing added') }

// 3. bills from before uids: by number, as before
{ const cur = books([sale('10100', null, 10)]), next = books([sale('10100', null, 12)]);
  ok(!keepBills(next, cur, 'x').length && next.S.sales.length === 1, 'an old bill without a uid, saved again: nothing added') }
{ const cur = books([sale('10101', 'uX', 10)]), next = books([sale('10101', null, 12)]);
  ok(!keepBills(next, cur, 'x').length && next.S.sales.length === 1, 'a till not yet updated re-makes a bill (no uid): taken as the same bill') }

// 4. a save that simply lost a bill
{ const cur = books([sale('10200', 'u1', 10), sale('10201', 'u2', 20)], [jr('10201', 20)], [mv('10201', 1)]);
  const next = books([sale('10200', 'u1', 10)]);
  const out = keepBills(next, cur, 'x');
  ok(out.join() === '10201' && next.S.sales.some(s => s.no === '10201' && s.uid === 'u2'), 'a bill a save lost comes back under its own number', out.join());
  ok(next.S.journal.length === 1 && next.S.movements.length === 1 && next.S.products[0].stock === 9, 'with its journal entry and stock movement') }

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
