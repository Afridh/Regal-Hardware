// Off-database backup of the shop's books, for cron and for the deploy script.
//
//   node db/backup-books.js                 write a timestamped copy to db/backups, keep 60 days
//   node db/backup-books.js --keep 30       keep 30 days instead
//   node db/backup-books.js --tag predeploy label this copy (books-predeploy-<time>.json)
//
// It only READS the database (a single SELECT) and writes a file, so it is safe to run any time.
// books-latest.json always points at the newest good copy. A copy with fewer than 100 products is
// written but NOT promoted to books-latest.json (so a bad day cannot become "the latest backup").
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, query } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const keepDays = Math.max(1, +(opt('--keep') || 60));
const tag = (opt('--tag') || '').replace(/[^a-z0-9]/gi, '').slice(0, 20);
const KEY = 'regal';
const n = a => Array.isArray(a) ? a.length : 0;
const asJson = v => typeof v === 'string' ? (v ? JSON.parse(v) : null) : (v ?? null);

try {
  const { rows: [row] } = await query(`SELECT rev, data, updated_at, updated_by FROM books WHERE key = $1`, [KEY]);
  if (!row || !row.data) { console.error('No books on the server to back up.'); process.exitCode = 1; }
  else {
    const data = asJson(row.data);
    const products = n(data?.S?.products);
    const dir = path.join(here, 'backups'); fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `books-${tag ? tag + '-' : ''}${stamp}.json`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify({ rev: Number(row.rev), at: row.updated_at, by: row.updated_by, data }));
    const size = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
    console.log(`Backed up rev ${row.rev} — ${products} products, ${n(data?.S?.customers)} customers, ${n(data?.S?.sales)} bills (${size} MB) -> db/backups/${name}`);

    // only a healthy copy becomes "the latest"
    if (products >= 100) {
      fs.writeFileSync(path.join(dir, 'books-latest.json'), JSON.stringify({ rev: Number(row.rev), at: row.updated_at, by: row.updated_by, data }));
      console.log('  books-latest.json updated.');
    } else {
      console.log(`  NOT promoted to books-latest.json (only ${products} products — looks like sample data).`);
    }

    // prune old timestamped copies (never touch books-latest.json or the -before-/-predeploy- safety copies)
    const cutoff = Date.now() - keepDays * 86400000;
    let pruned = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('books-') || !f.endsWith('.json')) continue;
      if (f === 'books-latest.json' || f.includes('-before-') || f.includes('predeploy')) continue;
      const fp = path.join(dir, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); pruned++; } } catch {}
    }
    if (pruned) console.log(`  pruned ${pruned} copy(ies) older than ${keepDays} days.`);
  }
} catch (e) {
  console.error('Backup failed:', e.message || e.code || String(e));
  if (e.code === 'ECONNREFUSED') console.error('  The database could not be reached — check DATABASE_URL and that the DB is up.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
