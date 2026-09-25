// Writes the shop's current books to a JSON file so they can be kept in git (server/db/backups),
// and puts such a file back when asked.
//   node db/export-books.js                       -> server/db/backups/books-<date>.json (+ books-latest.json)
//   node db/export-books.js --restore <file>      put that file's books into the database as a new revision
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, query } from '../src/db.js';
import { ensureBooksTables } from '../src/routes/regal.js';

// per-till state, the same list the server strips from every save (routes/regal.js)
const LOCAL_KEYS = ['user', 'pos', 'view', 'terminal', 'held', 'heldBills', 'portal', 'cportal', 'phoneOpen', 'phoneMode', 'notifOpen', 'signedOut', 'drawer', '_fromStore', 'locId'];
await ensureBooksTables();

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'backups');
const args = process.argv.slice(2);
const restore = args.includes('--restore') ? args[args.indexOf('--restore') + 1] : null;

try {
  if (restore) {
    // a file from this script ({ data }), or the copy a till keeps in its browser ({ v, at, S, CFG })
    const doc = JSON.parse(fs.readFileSync(path.resolve(restore), 'utf8'));
    const data = doc.data || doc;
    if (!data.S) throw new Error('that file does not hold the books (no S)');
    // what belongs to the till the copy came from — who was signed in, the bill on its screen — is not shared
    for (const k of LOCAL_KEYS) delete data.S[k];
    const { rows: [cur] } = await query(`SELECT rev FROM books WHERE key = 'regal'`);
    const rev = Number(cur?.rev || 0) + 1;
    data._fullRev = rev;                         // a whole-document save, as far as the tills' merge is concerned
    await query(`INSERT INTO books (key, rev, data, updated_at, updated_by) VALUES ('regal', $1, $2, now(), 'restore')
                 ON CONFLICT (key) DO UPDATE SET rev = EXCLUDED.rev, data = EXCLUDED.data, updated_at = now(), updated_by = 'restore'`, [rev, JSON.stringify(data)]);
    await query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ('regal', $1, $2, 'restore')`, [rev, JSON.stringify(data)]);
    console.log(`Books put back from ${path.basename(restore)} as rev ${rev} (${data.S.products?.length || 0} products, ${data.S.customers?.length || 0} customers, ${data.S.sales?.length || 0} bills). Tills pick it up on their next poll.`);
  } else {
    const { rows: [b] } = await query(`SELECT rev, data, updated_at, updated_by FROM books WHERE key = 'regal'`);
    if (!b) throw new Error('no books saved yet');
    const { rows: orders } = await query(`SELECT no, phone, name, data, created_at, imported_at FROM shop_orders ORDER BY id`).catch(() => ({ rows: [] }));
    const out = { exported_at: new Date().toISOString(), rev: Number(b.rev), updated_at: b.updated_at, updated_by: b.updated_by, data: b.data, shop_orders: orders };
    const txt = JSON.stringify(out);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `books-${stamp}.json`);
    fs.writeFileSync(file, txt);
    fs.writeFileSync(path.join(dir, 'books-latest.json'), txt);
    const S = b.data.S || {};
    console.log(`Wrote ${path.relative(process.cwd(), file)} and backups/books-latest.json — rev ${b.rev}, ${(txt.length / 1048576).toFixed(2)} MB, ${S.products?.length || 0} products, ${S.customers?.length || 0} customers, ${S.sales?.length || 0} bills, ${orders.length} web orders.`);
  }
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
