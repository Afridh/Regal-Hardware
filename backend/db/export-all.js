// A whole-database export: one JSON Lines file per table, plus a manifest describing the columns.
// It is the safety net taken before the MySQL migration, and it is what the importer reads back.
//   node db/export-all.js [outDir]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pool, query } from '../src/db.js';

const out = process.argv[2] || path.join('db', 'backups', 'full-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
fs.mkdirSync(out, { recursive: true });

const { rows: tables } = await query(`
  SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
const { rows: cols } = await query(`
  SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length,
         numeric_precision, numeric_scale, ordinal_position
    FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`);
const { rows: idx } = await query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`);
const { rows: views } = await query(`SELECT table_name, view_definition FROM information_schema.views WHERE table_schema = 'public'`);

const manifest = { takenAt: new Date().toISOString(), tables: {}, views, indexes: idx };
let grand = 0;

for (const { table_name: t } of tables) {
  const mine = cols.filter(c => c.table_name === t);
  const { rows } = await query(`SELECT * FROM "${t}"`);
  const file = path.join(out, t + '.jsonl');
  const fh = fs.createWriteStream(file);
  for (const r of rows) fh.write(JSON.stringify(r, (k, v) => (v instanceof Buffer ? { __buf: v.toString('base64') } : v)) + '\n');
  await new Promise(res => fh.end(res));
  manifest.tables[t] = { rows: rows.length, columns: mine };
  grand += rows.length;
  console.log(String(rows.length).padStart(8), t);
}
fs.writeFileSync(path.join(out, '_manifest.json'), JSON.stringify(manifest, null, 1));
console.log('\n' + tables.length + ' tables, ' + grand.toLocaleString() + ' rows ->', out);
await pool.end();
