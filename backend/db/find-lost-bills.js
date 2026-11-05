// Bills that were once in the books and are not there now. Look only: it writes nothing.
//
//   node db/find-lost-bills.js
//
// It reads the saved copies of the books (books_history, the last 500 saves), oldest first, one at a time, and lists
// every bill seen in a copy that the books no longer have: who it was for, what for, the last save that had it (put
// it back from Bills, Find a missing bill) and the save that went without it, with who was signed in there.
// A bill that never reached the server is in no copy, so it cannot be listed: for those, the printed bill is the record.
// Works on MySQL (register.lk) and PostgreSQL.
import 'dotenv/config';
import { pool, query } from '../src/db.js';

const KEY = 'regal';
const asDoc = (d) => (typeof d === 'string' ? JSON.parse(d) : d);

async function main() {
  const { rows: [cur] } = await query(`SELECT rev, data FROM books WHERE key = $1`, [KEY]);
  if (!cur) { console.log('No books here.'); return; }
  const books = asDoc(cur.data), S = books.S || {};
  const now = new Set((S.sales || []).map(s => String(s.no)));
  const nameOf = (id) => ((S.customers || []).find(c => c.id === id) || {}).name || 'walk-in / unknown';
  const { rows: ids } = await query(`SELECT id, rev, saved_by, saved_at FROM books_history WHERE key = $1 ORDER BY id`, [KEY]);
  console.log(`The books are at save ${cur.rev}, with ${now.size} bills. Reading ${ids.length} saved copies${ids.length ? `, from ${String(ids[0].saved_at).slice(0, 24)}` : ''}.`);
  const lost = new Map();      // bill number -> what is known of it
  let before = new Set(), unread = 0;
  for (const h of ids) {       // one at a time: these are big, and the host is small
    let sales;
    try { const { rows: [row] } = await query(`SELECT data FROM books_history WHERE id = $1`, [h.id]); sales = asDoc(row.data)?.S?.sales || []; }
    catch (e) { unread++; continue; }
    const here = new Set();
    for (const s of sales) { const no = String(s.no); here.add(no);
      if (!now.has(no)) { const x = lost.get(no) || { no, firstRev: h.rev }; Object.assign(x, { lastRev: h.rev, lastAt: h.saved_at, date: s.date, time: s.time, by: s.by, total: s.total, balance: s.balance, type: s.type, who: nameOf(s.customerId), lines: (s.lines || []).length, wentAt: null }); lost.set(no, x); } }
    for (const no of before) if (!here.has(no) && lost.has(no) && !lost.get(no).wentAt) { const x = lost.get(no); Object.assign(x, { wentRev: h.rev, wentAt: h.saved_at, wentBy: h.saved_by }); }
    before = here;
  }
  if (unread) console.log(`${unread} copies could not be read and were skipped.`);
  if (!lost.size) { console.log('\nNo bill in these copies is missing from the books.'); return; }
  console.log(`\n${lost.size} bill${lost.size === 1 ? '' : 's'} missing from the books:\n`);
  for (const x of [...lost.values()].sort((a, b) => String(a.lastAt).localeCompare(String(b.lastAt)))) {
    console.log(`  ${x.no}  ${x.date || ''} ${x.time || ''}  ${x.who}  Rs ${(+x.total || 0).toFixed(2)}${+x.balance > 0 ? ` (owing ${(+x.balance).toFixed(2)})` : ''}  ${x.lines} lines, by ${x.by || '?'}`);
    console.log(`     last in save ${x.lastRev}${x.wentRev ? `; gone with save ${x.wentRev}, ${String(x.wentAt).slice(0, 24)}, by ${x.wentBy}` : ''}`);
  }
  console.log('\nTo put one back: the till, Bills, Find a missing bill, its number. This tool changed nothing.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end && pool.end());
