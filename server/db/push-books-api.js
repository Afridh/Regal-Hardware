// Sends this PC's books to a running site through its own API, for a hosted database whose address
// we do not hold (a Supabase or Vercel Postgres attached to the project by the host itself).
//   node db/push-books-api.js --site https://www.regalhw.lk --user Afridh --pass Afridh123
// It signs in as a user of the shop, so nothing here needs the database password.
import 'dotenv/config';
import { gzipSync } from 'node:zlib';
import { pool, query } from '../src/db.js';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d };
const site = (opt('--site') || '').replace(/\/$/, '');
const user = opt('--user'), pass = opt('--pass');
if (!site || !user || !pass) { console.error('usage: node db/push-books-api.js --site https://your-site --user NAME --pass PASSWORD'); process.exit(1); }

/* The books are bigger than a host will take in one request, so they go up squeezed — the server
   unpacks a gzipped body by itself. 4.5 MB of books travels as about half a megabyte. */
const post = async (path, body, token, squeeze) => {
  const text = body ? JSON.stringify(body) : undefined;
  const packed = squeeze && text ? gzipSync(Buffer.from(text)) : null;
  const r = await fetch(site + path, {
    method: body ? (path.includes('/books/regal') ? 'PUT' : 'POST') : 'GET',
    headers: { 'Content-Type': 'application/json', ...(packed ? { 'Content-Encoding': 'gzip' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: packed || text,
  });
  const back = await r.text();
  let j = null; try { j = JSON.parse(back) } catch { j = { raw: back.slice(0, 200) } }
  return { status: r.status, j };
};

try {
  const { rows: [b] } = await query(`SELECT rev, data FROM books WHERE key = 'regal'`);
  if (!b) { console.error('No books on this PC to send.'); process.exit(1); }
  const S = b.data.S || {};
  const size = Buffer.byteLength(JSON.stringify(b.data));
  console.log(`Here: rev ${b.rev}, ${(size / 1048576).toFixed(2)} MB — ${S.products?.length || 0} products, ${S.customers?.length || 0} customers, ${S.sales?.length || 0} bills`);

  const login = await post('/api/books/login', { user, password: pass });
  if (!login.j?.ok) { console.error('Could not sign in:', login.status, login.j?.error || login.j?.raw); process.exit(2); }
  console.log(`Signed in as ${login.j.user.name} (${login.j.user.role})`);
  const token = login.j.token;

  const cur = await (await fetch(site + '/api/books/regal', { headers: { Authorization: 'Bearer ' + token } })).json().catch(() => ({}));
  const rev = Number(cur?.rev || 0);
  console.log(`There: rev ${rev}${cur?.data?.S ? `, ${cur.data.S.products?.length || 0} products` : ', empty'}`);

  const put = await post('/api/books/regal', { data: b.data, rev }, token, true);
  if (put.status === 413) { console.error('The site refused it as too large even squeezed — use db/push-books.js with the database address instead.'); process.exit(3); }
  if (!put.j?.ok) { console.error('Not saved:', put.status, put.j?.error || put.j?.raw); process.exit(4); }
  console.log(`Sent. The site now holds rev ${put.j.rev}.`);
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 5; }
finally { await pool.end(); }
