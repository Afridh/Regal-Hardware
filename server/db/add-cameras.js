// Put the shop's cameras into the books, the way Settings → Cameras would.
//
//   node db/add-cameras.js                 look only: what is there and what would be added
//   node db/add-cameras.js --write         add the ones that are missing
//
// Only where each camera is and what it is called. The password is not here and never will be —
// it lives in tools/camera-agent/config.local.json on the shop PC, so it never reaches a browser
// or the books, and the books are the one thing that travels.
//
// A recorder answers on two channels per camera: N01 is the full picture and N02 the smaller one
// it keeps for playing back over a thin line. They are the same camera pointed at the same thing,
// so only the N01 of each goes in — otherwise the wall shows every camera twice.
import 'dotenv/config';
import { pool, query } from '../src/db.js';

const WRITE = process.argv.includes('--write');

const CAMERAS = [
  { id: 'cam101', name: 'Paint aisle', host: '192.168.1.2', port: 80, channel: 101 },
  { id: 'cam201', name: 'Paint store', host: '192.168.1.2', port: 80, channel: 201 },
];

const { rows: [row] } = await query(`SELECT rev, data FROM books WHERE key = 'regal'`);
if (!row) { console.error('There are no books to add them to.'); process.exit(1); }
const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
const S = data.S;
S.cameras = Array.isArray(S.cameras) ? S.cameras : [];

console.log(`books revision ${row.rev} · ${S.cameras.length} camera${S.cameras.length === 1 ? '' : 's'} on record\n`);

const here = (c) => S.cameras.find(x => x.host === c.host && +x.channel === +c.channel);
const adding = CAMERAS.filter(c => !here(c));
for (const c of CAMERAS)
  console.log(`  ${here(c) ? 'already there' : 'to add      '}  ${c.name.padEnd(14)} ${c.host}:${c.port} channel ${c.channel}`);

if (!adding.length) { console.log('\nNothing to add.'); await pool.end(); process.exit(0); }
if (!WRITE) { console.log('\nLook only — nothing written. Add --write to put them in.'); await pool.end(); process.exit(0); }

S.cameras.push(...adding);
const nextRev = Number(row.rev) + 1;
const txt = JSON.stringify(data);
await query(`UPDATE books SET rev = $1, data = $2, updated_at = now(), updated_by = 'cameras' WHERE key = 'regal'`, [nextRev, txt]);
await query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ('regal', $1, $2, 'cameras')`, [nextRev, txt]);
console.log(`\n${adding.length} added, as revision ${nextRev}. Every till picks it up on its next poll.`);
await pool.end();
