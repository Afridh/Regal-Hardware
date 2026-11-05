// Return bills that were only half made. Look only: it writes nothing.
//
//   node db/find-half-bills.js
//
// Until 5 Nov 2026, PRINT on a return bill at the till failed with "Unbalanced journal" after it had already put the bill
// in the list and the goods back in stock. Each press left one more. Such a bill has a minus total and no journal entry:
// no money moved, but the stock went up. This lists them, and what each one added to the stock, so they can be put right.
// Works on MySQL (register.lk) and PostgreSQL.
import 'dotenv/config';
import { pool, query } from '../src/db.js';

async function main() {
  const { rows: [cur] } = await query(`SELECT rev, data FROM books WHERE key = $1`, ['regal']);
  if (!cur) { console.log('No books here.'); return; }
  const S = (typeof cur.data === 'string' ? JSON.parse(cur.data) : cur.data).S || {};
  const posted = new Set((S.journal || []).map(j => String(j.ref)));
  const half = (S.sales || []).filter(s => +s.total < -0.005 && (s.lines || []).length && !posted.has(String(s.no)));
  console.log(`The books are at save ${cur.rev}, with ${(S.sales || []).length} bills.`);
  if (!half.length) { console.log('\nNo half-made return bills.'); return; }
  const nameOf = id => ((S.customers || []).find(c => c.id === id) || {}).name || 'walk-in';
  const itemOf = id => ((S.products || []).find(p => p.id === id) || {}).name || 'item ' + id;
  console.log(`\n${half.length} half-made return bill${half.length === 1 ? '' : 's'}:\n`);
  for (const s of half) {
    console.log(`  ${s.no}  ${s.date || ''} ${s.time || ''}  ${nameOf(s.customerId)}  Rs ${(+s.total).toFixed(2)}  by ${s.by || '?'}`);
    for (const l of s.lines) if (+l.qty < 0) console.log(`      stock went up by ${-l.qty}: ${l.name || itemOf(l.pid)}`);
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => pool.end());
