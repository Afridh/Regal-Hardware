// Loads a db/export-all.js export into MySQL. Rows go in as they came out of PostgreSQL; only the
// way a value is written changes — a JSON column is handed a string, a bytea comes back from base64,
// a timestamp loses the 'T' and 'Z' MySQL will not read.
//   DATABASE_URL=mysql://… node db/mysql-import.js <exportDir>
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { query, pool } from '../src/db.js';
import { mysqlSchema } from './mysql-schema.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: node db/mysql-import.js <exportDir>'); process.exit(1) }
const man = JSON.parse(fs.readFileSync(path.join(dir, '_manifest.json'), 'utf8'));

const asDate = (v) => (v instanceof Date ? v : new Date(v)).toISOString().slice(0, 19).replace('T', ' ');
function value(v, col) {
  if (v === null || v === undefined) return null;
  const t = (col.data_type || '').toLowerCase();
  if (v && typeof v === 'object' && v.__buf !== undefined) return Buffer.from(v.__buf, 'base64');
  if (t === 'jsonb' || t === 'json' || t === 'ARRAY' || Array.isArray(v)) return JSON.stringify(v);
  if (t.startsWith('timestamp')) return asDate(v);
  if (t === 'date') return String(v).slice(0, 10);
  if (t === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

// a table the server makes on first use (files, …) may be in the export but not in schema.mysql.sql:
// it is made here from the export's own description, the same way the schema file was
const { rows: have } = await query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
const present = new Set(have.map(r => r.t || r.TABLE_NAME));
const missing = Object.keys(man.tables).filter(t => !present.has(t));
if (missing.length) {
  for (const stmt of mysqlSchema(man, { only: missing, drop: false })) {
    if (/^SET /.test(stmt) || /^--/.test(stmt)) continue;
    await query(stmt.replace(/;\s*(--.*)?$/, ''));
  }
  console.log('made the tables the database did not have:', missing.join(', '));
}

await query('SET FOREIGN_KEY_CHECKS = 0');
let grand = 0;
for (const t of Object.keys(man.tables)) {
  const file = path.join(dir, t + '.jsonl');
  if (!fs.existsSync(file)) continue;
  const cols = man.tables[t].columns;
  const names = cols.map(c => '`' + c.column_name + '`').join(', ');
  await query(`DELETE FROM \`${t}\``);
  let n = 0, batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const marks = batch.map(() => '(' + cols.map(() => '?').join(',') + ')').join(',');
    await query(`INSERT INTO \`${t}\` (${names}) VALUES ${marks}`, batch.flat());
    batch = [];
  };
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    batch.push(cols.map(c => value(row[c.column_name], c)));
    n++;
    // a books row is megabytes on its own, so those go one at a time
    if (batch.length >= 200 || JSON.stringify(batch[batch.length - 1]).length > 500000) await flush();
  }
  await flush();
  if (n) console.log(String(n).padStart(8), t);
  grand += n;
}
await query('SET FOREIGN_KEY_CHECKS = 1');
console.log('\n' + grand.toLocaleString() + ' rows loaded');

// every table counted again against what the export said it held
let bad = 0;
for (const [t, info] of Object.entries(man.tables)) {
  const { rows: [{ n }] } = await query(`SELECT COUNT(*) AS n FROM \`${t}\``);
  if (Number(n) !== Number(info.rows)) { bad++; console.log(`  MISMATCH ${t}: exported ${info.rows}, in MySQL ${n}`); }
}
console.log(bad ? `${bad} table(s) do not match — do not switch over yet` : `checked: all ${Object.keys(man.tables).length} tables match the export`);
if (bad) process.exitCode = 1;
await pool.end();
