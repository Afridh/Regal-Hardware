// Puts back what a test run wrote over.
//
//   node db/undo-test-writes.js --from-rev 421            look only: what differs from that revision
//   node db/undo-test-writes.js --from-rev 421 --write    put those things back
//
// The checks under tools/ sign in as a real user and save the books when they are done, so running
// them against the shop's own server leaves their fixtures behind: staff deleted, stock tracking
// switched on, a product given a few in stock, a test mobile number for messages. On demo books
// that cost nothing. On the shop's real books it matters — stock tracking on, with every item at
// zero because the old system never kept a count, stops the till selling anything at all.
//
// This compares the live books against a revision that is known good and puts back only what the
// checks are known to touch. Everything else is left exactly as it is, so a day's real work done
// since is not rolled back with it.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from '../src/db.js';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const REV = +(args[args.indexOf('--from-rev') + 1] || 0);
if (!REV) { console.error('Which revision is known good?  --from-rev <n>'); process.exit(1); }

/* What the checks under tools/ are known to write. Anything outside this is left alone: the point
   is to undo the fixtures, not to wind the shop back to an earlier evening. */
const LISTS = ['employees'];
const SETTINGS = [['stock', 'track'], ['bill', 'printTo'], ['msg', 'supTestOn'], ['msg', 'supTestTo'],
  ['alexa', 'on'], ['alexa', 'skillId'], ['alexa', 'word'], ['alexa', 'money'],
  ['shop', 'zones'], ['shop', 'promos']];

const { rows: [live] } = await query(`SELECT rev, data FROM books WHERE key = 'regal'`);
const { rows: [good] } = await query(`SELECT rev, data FROM books_history WHERE key = 'regal' AND rev = $1`, [REV]);
if (!live) { console.error('There are no books to mend.'); process.exit(1); }
if (!good) { console.error(`Revision ${REV} is not in the history.`); process.exit(1); }

const L = typeof live.data === 'string' ? JSON.parse(live.data) : live.data;
const G = typeof good.data === 'string' ? JSON.parse(good.data) : good.data;
console.log(`live revision ${live.rev} · putting back what differs from revision ${good.rev}\n`);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const changes = [];

for (const k of LISTS) {
  if (same(L.S[k], G.S[k])) continue;
  changes.push({ what: `S.${k}`, now: `${L.S[k]?.length} entries`, back: `${G.S[k]?.length} entries`,
    put: () => { L.S[k] = G.S[k] } });
}
for (const [grp, key] of SETTINGS) {
  const now = L.CFG?.[grp]?.[key], was = G.CFG?.[grp]?.[key];
  if (same(now, was)) continue;
  changes.push({ what: `CFG.${grp}.${key}`, now: JSON.stringify(now), back: JSON.stringify(was),
    put: () => { L.CFG[grp] = { ...(L.CFG[grp] || {}) }; if (was === undefined) delete L.CFG[grp][key]; else L.CFG[grp][key] = was } });
}
/* A product the checks gave a few of. Matched on the old system's own item code, so this holds
   even if the order of the list has moved. */
const byCode = new Map((G.S.products || []).map(p => [p.code, p]));
const stocked = (L.S.products || []).filter(p => {
  const was = byCode.get(p.code);
  return was && (+p.stock || 0) !== (+was.stock || 0);
});
for (const p of stocked) changes.push({ what: `${p.name} · stock`, now: String(p.stock), back: String(byCode.get(p.code).stock || 0),
  put: () => { p.stock = byCode.get(p.code).stock || 0 } });

if (!changes.length) { console.log('Nothing a test run is known to touch has moved.'); await pool.end(); process.exit(0); }
for (const c of changes) console.log(`  ${c.what}\n      now: ${c.now}\n      back to: ${c.back}`);

if (!WRITE) { console.log('\nLook only — nothing written. Add --write to put these back.'); await pool.end(); process.exit(0); }

for (const c of changes) c.put();
const nextRev = Number(live.rev) + 1;
const txt = JSON.stringify(L);
await query(`UPDATE books SET rev = $1, data = $2, updated_at = now(), updated_by = 'undo test writes' WHERE key = 'regal'`, [nextRev, txt]);
await query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ('regal', $1, $2, 'undo test writes')`, [nextRev, txt]);
console.log(`\n${changes.length} put back, as revision ${nextRev}.`);
await pool.end();
