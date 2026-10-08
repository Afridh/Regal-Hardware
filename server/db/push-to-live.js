// Put this PC's real books onto the live site (regalhw.lk), replacing the demo data there — while
// keeping the two things on the live site worth keeping: everyone's sign-ins, and the SMS key.
//
//   node db/push-to-live.js --site https://www.regalhw.lk --user Afridh --pass Afridh123
//   node db/push-to-live.js --site https://www.regalhw.lk --user Afridh --pass Afridh123 --go
//
// Without --go it is a dry run: it signs in, shows what is here and what is there, and writes
// nothing. With --go it backs the live site up to db/backups/ first, then sends this PC's books.
//
// It refuses unless this PC holds the full real shop (thousands of products, hundreds of customers,
// a balanced ledger), so a half-set-up or demo copy can never be pushed over the live site by
// mistake. Use this only while the live site is still being set up — it replaces the live sales
// with this PC's, which is right for a first load and wrong once real selling has started there.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { pool, query } from '../src/db.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const site = (opt('--site') || '').replace(/\/$/, '');
const user = opt('--user'), pass = opt('--pass'), GO = args.includes('--go');
if (!site || !user || !pass) { console.error('usage: node db/push-to-live.js --site https://your-site --user NAME --pass PASSWORD [--go]'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));

const api = async (p, { method = 'GET', token, body, gzip } = {}) => {
  const text = body ? JSON.stringify(body) : undefined;
  const packed = gzip && text ? gzipSync(Buffer.from(text)) : null;
  const r = await fetch(site + p, { method, headers: {
    'Content-Type': 'application/json', ...(packed ? { 'Content-Encoding': 'gzip' } : {}),
    ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: packed || text });
  const back = await r.text(); let j = null; try { j = JSON.parse(back) } catch { j = { raw: back.slice(0, 200) } }
  return { status: r.status, j };
};

// ---- this PC's books, and a hard check that they are the real shop ----
const { rows: [b] } = await query(`SELECT rev, data FROM books WHERE key = 'regal'`);
if (!b) { console.error('No books on this PC.'); process.exit(1); }
const data = typeof b.data === 'string' ? JSON.parse(b.data) : b.data;
const S = data.S, CFG = data.CFG;
console.log(`HERE   rev ${b.rev}: ${S.products.length} products, ${S.customers.length} customers, ${S.suppliers.length} suppliers, ${S.employees.length} staff, ${S.sales.length} bills`);
let dr = 0, cr = 0; for (const j of S.journal) for (const l of (j.lines || [])) { dr += +l.dr || 0; cr += +l.cr || 0; }
const real = S.products.length > 5000 && S.customers.length > 400 && S.suppliers.length > 100 && S.employees.length >= 5 && Math.abs(dr - cr) < 0.01;
if (!real) { console.error('These books are not the full real shop (or the ledger is out of balance) — refusing to push.'); process.exit(1); }
console.log('       looks like the real shop, ledger balanced.');

// ---- sign in to the live site and read what is there now ----
const login = await api('/api/books/login', { method: 'POST', body: { user, password: pass } });
if (!login.j?.ok) { console.error('Could not sign in to the live site:', login.status, login.j?.error || login.j?.raw); process.exit(2); }
console.log(`Signed in to ${site} as ${login.j.user.name} (${login.j.user.role})`);
const token = login.j.token;
const cur = (await api('/api/books/regal', { token })).j || {};
const there = cur.data?.S || {};
console.log(`THERE  rev ${cur.rev || 0}: ${there.products?.length || 0} products, ${there.customers?.length || 0} customers, ${there.sales?.length || 0} bills`);

// ---- keep the live site's own sign-ins and SMS key, overwrite the rest with the real data ----
const pmsg = cur.data?.CFG?.msg || {};
CFG.msg = CFG.msg || {};
for (const k of ['apiKey', 'userId', 'live', 'apiUrl', 'sender']) if (pmsg[k] !== undefined) CFG.msg[k] = pmsg[k];
if (Array.isArray(there.users) && there.users.length) { S.users = there.users; S.deletedUsers = there.deletedUsers || S.deletedUsers; }
console.log(`       keeping the live site's sign-ins (${(S.users || []).length}) and SMS key (set: ${!!CFG.msg.apiKey}, live: ${CFG.msg.live})`);

if (!GO) { console.log('\nDry run — nothing sent. Add --go to back up the live site and push.'); await pool.end(); process.exit(0); }

// ---- back up the live site, then push ----
if (cur.data) {
  fs.mkdirSync(path.join(here, 'backups'), { recursive: true });
  const f = path.join(here, 'backups', `live-before-push-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(f, JSON.stringify(cur.data));
  console.log(`Backed up the live site to ${f}`);
}
const put = await api('/api/books/regal', { method: 'PUT', token, body: { data, rev: Number(cur.rev || 0) }, gzip: true });
if (put.status === 409) { console.error('The live site changed between reading and sending — run it again.'); process.exit(4); }
if (!put.j?.ok) { console.error('Not saved:', put.status, put.j?.error || put.j?.raw); process.exit(5); }
console.log(`\nDone. The live site now holds rev ${put.j.rev} — the real shop.`);
await pool.end();
