// The test shop (sepos_e2e) saved and put back, so each check can start from the same books — they share one test
// server, and some (check-fresh) empty the shop, which made every check after them fail for want of goods.
//   node backend/tools/run-e2e.mjs --keep          (a fresh test shop)
//   cd backend; node tools/testshop-snap.mjs save     (once, straight after)
//   cd backend; node tools/testshop-snap.mjs restore  (before any check)
import fs from 'node:fs'; import pg from 'pg';
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }));
const u = new URL(env.DATABASE_URL); u.pathname = '/sepos_e2e';
const c = new pg.Client({ connectionString: u.href }); await c.connect();
if (process.argv[2] === 'save') { await c.query('DROP TABLE IF EXISTS books_snap'); await c.query('CREATE TABLE books_snap AS SELECT * FROM books'); }
else { await c.query(`UPDATE books b SET data = s.data, rev = b.rev + 1 FROM books_snap s WHERE s.key = b.key`); }
const { rows } = await c.query(`SELECT key, rev, jsonb_array_length(data->'S'->'products') p, jsonb_array_length(data->'S'->'sales') s FROM books`); console.log(process.argv[2], JSON.stringify(rows));
await c.end();
