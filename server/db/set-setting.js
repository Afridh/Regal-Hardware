// Sets shop settings straight in the books, as a new revision (for keys, URLs and the like the owner
// would rather not type into a screen).  Values are JSON when they parse, text otherwise.
//   node db/set-setting.js msg.apiUrl https://smslenz.lk/api msg.live true msg.testOnly 0777849964
import 'dotenv/config';
import { pool, query } from '../src/db.js';
const args = process.argv.slice(2);
if (!args.length || args.length % 2) { console.error('usage: node db/set-setting.js group.key value [group.key value …]'); process.exit(1); }
const { rows: [cur] } = await query(`SELECT rev, data FROM books WHERE key = 'regal'`);
if (!cur) { console.error('no books yet'); process.exit(1); }
const doc = cur.data; doc.CFG = doc.CFG || {};
for (let i = 0; i < args.length; i += 2) {
  const [g, k] = args[i].split('.'); let v = args[i + 1];
  try { v = JSON.parse(v); } catch {}
  doc.CFG[g] = doc.CFG[g] || {}; doc.CFG[g][k] = v;
  console.log(`CFG.${g}.${k} = ${/key|pass|secret/i.test(k) ? '••••' : JSON.stringify(v)}`);
}
const next = Number(cur.rev) + 1, txt = JSON.stringify(doc);
await query(`UPDATE books SET rev = $1, data = $2, updated_at = now(), updated_by = 'settings' WHERE key = 'regal'`, [next, txt]);
await query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ('regal', $1, $2, 'settings')`, [next, txt]);
console.log('saved as revision', next);
await pool.end();
