// Brings the shop's real books back after a till saved its sample data over them (26 sample products
// where the shop has 6,402), keeping what has been set up since: users, staff, attendance, holidays.
//
//   node db/recover-books.js                                        look only: what is there now, the saved
//                                                                   revisions and the backup files, with counts
//   node db/recover-books.js --from-rev 812 --write                 put back revision 812 of books_history
//   node db/recover-books.js --from-file db/backups/books-latest.json --write
//
// What comes back from the chosen copy: products, customers, suppliers, bills, purchases, the ledger,
// banks, cheques, stock — everything in the books — and the shop's settings (CFG).
// What stays as it is now: the users (S.users, S.deletedUsers, S.roles), the staff (S.employees) and
// attendance (S.shift: punches, holidays, opened days, rules). Those were set up after the move, and the
// staff numbers in them match today's users, not the old copy's.
//
// Before writing, the books as they are now go to db/backups/books-before-recover-<time>.json, and the
// recovered books are saved as a new revision (with its history row), so this can itself be undone with
// --from-file on that backup. Works on MySQL (register.lk) and PostgreSQL.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, query, dbKind } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const fromRev = opt('--from-rev'), fromFile = opt('--from-file'), write = args.includes('--write');
const KEY = 'regal';
// what is set up per shop since the move and is kept as it is now
const KEEP = ['users', 'deletedUsers', 'roles', 'employees', 'shift'];

const asJson = v => typeof v === 'string' ? (v ? JSON.parse(v) : null) : (v ?? null);
const n = a => Array.isArray(a) ? a.length : 0;
const counts = S => ({ products: n(S?.products), customers: n(S?.customers), sales: n(S?.sales), suppliers: n(S?.suppliers), users: n(S?.users) });

async function current() {
  const { rows: [row] } = await query(`SELECT rev, data, updated_at, updated_by FROM books WHERE key = $1`, [KEY]);
  return row ? { rev: Number(row.rev), data: asJson(row.data), at: row.updated_at, by: row.updated_by } : null;
}

async function look() {
  const cur = await current();
  console.log('\nBooks now:', cur ? { rev: cur.rev, saved: new Date(cur.at).toLocaleString('en-GB'), by: cur.by, ...counts(cur.data?.S) } : 'none');

  // counted in the database, so the history's big documents are not all read into memory
  const lenSql = dbKind === 'mysql'
    ? `SELECT rev, saved_by, saved_at, JSON_LENGTH(data, '$.S.products') AS products, JSON_LENGTH(data, '$.S.customers') AS customers, JSON_LENGTH(data, '$.S.sales') AS sales FROM books_history WHERE key = $1 ORDER BY rev DESC LIMIT 200`
    : `SELECT rev, saved_by, saved_at, jsonb_array_length(data->'S'->'products') AS products, jsonb_array_length(data->'S'->'customers') AS customers, jsonb_array_length(data->'S'->'sales') AS sales FROM books_history WHERE key = $1 ORDER BY rev DESC LIMIT 200`;
  const { rows } = await query(lenSql, [KEY]);
  const real = rows.filter(r => Number(r.products) > 100);
  console.log(`\nSaved revisions: ${rows.length} (newest first). Those holding the real product list (over 100 products):`);
  if (!real.length) console.log('  none — the history no longer has them; use a backup file below');
  else console.table(real.slice(0, 15).map(r => ({ rev: Number(r.rev), saved: new Date(r.saved_at).toLocaleString('en-GB'), by: r.saved_by, products: Number(r.products), customers: Number(r.customers), sales: Number(r.sales) })));
  if (real.length) console.log(`  → the newest real one is revision ${real[0].rev}:  node db/recover-books.js --from-rev ${real[0].rev} --write`);

  const dir = path.join(here, 'backups');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
  console.log('\nBackup files in db/backups:');
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const b = d.data || d;
      const c = counts(b.S); console.log(`  ${f.padEnd(52)} ${c.products} products · ${c.customers} customers · ${c.sales} bills · ${c.suppliers} suppliers`);
    } catch { console.log(`  ${f}   (could not be read)`); }
  }
  console.log('\nNothing was changed. Add --from-rev <rev> --write or --from-file <file> --write to recover.\n');
}

async function recover() {
  let src;
  if (fromRev) {
    const { rows: [h] } = await query(`SELECT data FROM books_history WHERE key = $1 AND rev = $2`, [KEY, Number(fromRev)]);
    if (!h) throw new Error(`There is no revision ${fromRev} in books_history`);
    src = asJson(h.data);
  } else {
    const d = JSON.parse(fs.readFileSync(path.resolve(fromFile), 'utf8'));
    src = d.data || d;
  }
  if (!src?.S || n(src.S.products) < 100) throw new Error(`That copy has ${n(src?.S?.products)} products — it is not the real books`);

  const cur = await current();
  if (!cur?.data?.S) throw new Error('There are no books on the server to keep the users and attendance from');

  // the books as they are now are kept first, so this can be undone
  const bdir = path.join(here, 'backups'); fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `books-before-recover-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify({ rev: cur.rev, data: cur.data }));

  const data = JSON.parse(JSON.stringify(src));
  for (const k of KEEP) if (cur.data.S[k] !== undefined) data.S[k] = cur.data.S[k];
  data.CFG = { ...(cur.data.CFG || {}), ...(src.CFG || {}) };        // the shop's own settings, over the sample ones
  if (cur.data.CFG?.shift) data.CFG.shift = cur.data.CFG.shift;       // the attendance set-up made since the move
  data.at = new Date().toISOString();
  const next = cur.rev + 1;
  data._fullRev = next;                                               // a whole-document save: tills reload it

  await query(`UPDATE books SET rev = $2, data = $3, updated_at = now(), updated_by = $4 WHERE key = $1`, [KEY, next, JSON.stringify(data), 'recover-books']);
  await query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ($1,$2,$3,$4)`, [KEY, next, JSON.stringify(data), 'recover-books']);

  console.log('\nRecovered as revision', next);
  console.log('  now:', counts(data.S));
  console.log('  kept from before:', KEEP.join(', '));
  console.log('  the books as they were are in', path.relative(process.cwd(), backup));
  console.log('\nOpen the POS on each till and press F5 once.\n');
}

try {
  if ((fromRev || fromFile) && write) await recover();
  else {
    if (fromRev || fromFile) console.log('\n(--write was not given, so this only looks)');
    await look();
  }
} catch (e) {
  console.error('\n' + e.message + '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
