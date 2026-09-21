// Copies the shop's books (and the pictures, files and inboxes that go with them) from this PC's
// database to a hosted one — the database the Vercel site uses.
//   node db/push-books.js --to "postgresql://user:pass@host/db?sslmode=require"          copy, refusing to overwrite newer books there
//   node db/push-books.js --to "…" --force                                                overwrite whatever is there
//   node db/push-books.js --to "…" --check                                                just show what is on each side
// Source is DATABASE_URL from server/.env (the embedded PostgreSQL on 5433 by default).
import 'dotenv/config';
import pg from 'pg';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const to = opt('--to'), force = args.includes('--force'), check = args.includes('--check');
const HISTORY = opt('--history') !== null ? +opt('--history') : 3;      // saved versions to carry up — each is the whole books, so keep it small on a slow line
if (!to) { console.error('usage: node db/push-books.js --to "<hosted DATABASE_URL>" [--force] [--check]'); process.exit(1); }
const hosted = u => /sslmode=require|\.neon\.tech|\.supabase\.co|\.vercel-storage\.com|\.render\.com/.test(u);
const src = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: hosted(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : undefined, max: 2 });
const dst = new pg.Pool({ connectionString: to, ssl: hosted(to) ? { rejectUnauthorized: false } : undefined, max: 2 });

const TABLES = [
  ['books', `CREATE TABLE IF NOT EXISTS books (key varchar(50) PRIMARY KEY, rev bigint NOT NULL DEFAULT 0, data jsonb, updated_at timestamptz DEFAULT now(), updated_by varchar(80))`],
  ['books_history', `CREATE TABLE IF NOT EXISTS books_history (id bigserial PRIMARY KEY, key varchar(50) NOT NULL, rev bigint NOT NULL, data jsonb, saved_at timestamptz DEFAULT now(), saved_by varchar(80))`],
  ['shop_orders', `CREATE TABLE IF NOT EXISTS shop_orders (id bigserial PRIMARY KEY, no varchar(20) UNIQUE NOT NULL, phone varchar(20) NOT NULL, name varchar(120) NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), imported_at timestamptz)`],
  ['shop_media', `CREATE TABLE IF NOT EXISTS shop_media (key varchar(80) PRIMARY KEY, mime varchar(40) NOT NULL, data bytea NOT NULL, link varchar(300), updated_at timestamptz NOT NULL DEFAULT now())`],
  ['files', `CREATE TABLE IF NOT EXISTS files (id bigserial PRIMARY KEY, kind varchar(20) NOT NULL, ref varchar(40) NOT NULL, name varchar(200) NOT NULL, mime varchar(100) NOT NULL, data bytea NOT NULL, bytes integer NOT NULL, uploaded_by varchar(80), created_at timestamptz NOT NULL DEFAULT now())`],
  ['sup_inbox', `CREATE TABLE IF NOT EXISTS sup_inbox (id bigserial PRIMARY KEY, sid integer NOT NULL, kind varchar(12) NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), imported_at timestamptz)`],
  ['sup_media', `CREATE TABLE IF NOT EXISTS sup_media (id bigserial PRIMARY KEY, inbox_id bigint NOT NULL, mime varchar(40) NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`],
];
const exists = async (pool, t) => (await pool.query(`SELECT to_regclass($1) AS r`, [t])).rows[0].r !== null;
const describe = async (pool, label) => {
  const out = { books: null, rows: {} };
  if (await exists(pool, 'books')) { const { rows: [b] } = await pool.query(`SELECT rev, updated_at, updated_by, pg_column_size(data) AS bytes FROM books WHERE key = 'regal'`); out.books = b || null; }
  for (const [t] of TABLES) out.rows[t] = (await exists(pool, t)) ? +(await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n : null;
  console.log(`${label}: books ${out.books ? `rev ${out.books.rev}, ${Math.round(out.books.bytes / 1024)} KB, saved ${new Date(out.books.updated_at).toLocaleString('en-GB')} by ${out.books.updated_by || '?'}` : 'none'} · ` + TABLES.map(([t]) => `${t} ${out.rows[t] ?? '—'}`).join(', '));
  return out;
};

try {
  const s = await describe(src, 'Here   '), d = await describe(dst, 'Hosted ');
  if (check) process.exit(0);
  if (!s.books) { console.error('No books here to copy.'); process.exit(1); }
  if (d.books && Number(d.books.rev) > Number(s.books.rev) && !force) { console.error(`The hosted books are NEWER (rev ${d.books.rev} > ${s.books.rev}). Nothing copied. Use --force to overwrite them anyway.`); process.exit(2); }
  for (const [, ddl] of TABLES) await dst.query(ddl);
  const client = await dst.connect();
  try {
    await client.query('BEGIN');
    const { rows: [b] } = await src.query(`SELECT key, rev, data, updated_at, updated_by FROM books WHERE key = 'regal'`);
    await client.query(`INSERT INTO books (key, rev, data, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET rev = EXCLUDED.rev, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`, [b.key, b.rev, JSON.stringify(b.data), b.updated_at, b.updated_by]);
    await client.query(`DELETE FROM books_history WHERE key = 'regal'`);
    console.log(`Books sent (${Math.round(JSON.stringify(b.data).length / 1024)} KB)…`);
    const { rows: hist } = HISTORY > 0 ? await src.query(`SELECT rev, data, saved_at, saved_by FROM books_history WHERE key = 'regal' ORDER BY id DESC LIMIT $1`, [HISTORY]) : { rows: [] };
    for (const h of hist.reverse()) { await client.query(`INSERT INTO books_history (key, rev, data, saved_at, saved_by) VALUES ('regal',$1,$2,$3,$4)`, [h.rev, JSON.stringify(h.data), h.saved_at, h.saved_by]); console.log(`  history rev ${h.rev} sent`); }
    let n = 0;
    if (await exists(src, 'shop_media')) { const { rows } = await src.query(`SELECT key, mime, data, link, updated_at FROM shop_media`); for (const m of rows) { await client.query(`INSERT INTO shop_media (key, mime, data, link, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, link = EXCLUDED.link, updated_at = EXCLUDED.updated_at`, [m.key, m.mime, m.data, m.link, m.updated_at]); n++; } }
    if (await exists(src, 'files')) { const { rows } = await src.query(`SELECT id, kind, ref, name, mime, data, bytes, uploaded_by, created_at FROM files`); for (const f of rows) { await client.query(`INSERT INTO files (id, kind, ref, name, mime, data, bytes, uploaded_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`, [f.id, f.kind, f.ref, f.name, f.mime, f.data, f.bytes, f.uploaded_by, f.created_at]); n++; } await client.query(`SELECT setval('files_id_seq', GREATEST((SELECT coalesce(max(id),0) FROM files), 1))`); }
    if (await exists(src, 'shop_orders')) { const { rows } = await src.query(`SELECT no, phone, name, data, created_at, imported_at FROM shop_orders`); for (const o of rows) await client.query(`INSERT INTO shop_orders (no, phone, name, data, created_at, imported_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (no) DO NOTHING`, [o.no, o.phone, o.name, JSON.stringify(o.data), o.created_at, o.imported_at]); await client.query(`SELECT setval('shop_orders_id_seq', GREATEST((SELECT coalesce(max(id),0) FROM shop_orders), 1))`); }
    await client.query('COMMIT');
    console.log(`Copied: books rev ${b.rev} (${Math.round(JSON.stringify(b.data).length / 1024)} KB), ${hist.length} history rows, ${n} pictures/files.`);
    await describe(dst, 'Hosted now');
    console.log('\nNext: in Vercel → Settings → Environment Variables set DATABASE_URL to this hosted URL (and JWT_SECRET), redeploy, and sign in at your-site/pos.');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
} catch (e) { console.error('FAILED:', e.message); process.exit(3); }
finally { await src.end(); await dst.end(); }
