// Builds the MySQL schema from what the PostgreSQL database actually is — the manifest written by
// db/export-all.js — rather than from a hand-copied file, so the two cannot drift apart.
//   node db/mysql-schema.js <exportDir>
// db/mysql-import.js uses mysqlSchema() too, to make any table the export has that the database lacks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* How each PostgreSQL type is written in MySQL. Nothing here changes what a column can hold; each
   pair was chosen so the same values go in and the same values come out. */
function typeOf(c) {
  const t = (c.data_type || '').toLowerCase(), u = (c.udt_name || '').toLowerCase();
  const serial = /nextval\(/i.test(c.column_default || '');
  if (t === 'bigint') return serial ? 'BIGINT AUTO_INCREMENT' : 'BIGINT';
  if (t === 'integer' || t === 'smallint') return serial ? 'INT AUTO_INCREMENT' : (t === 'smallint' ? 'SMALLINT' : 'INT');
  if (t === 'numeric') return `DECIMAL(${c.numeric_precision || 18},${c.numeric_scale ?? 2})`;
  if (t === 'double precision' || t === 'real') return 'DOUBLE';
  if (t === 'boolean') return 'TINYINT(1)';
  if (t === 'date') return 'DATE';
  if (t.startsWith('timestamp')) return 'DATETIME';
  if (t === 'time without time zone') return 'TIME';
  if (t === 'character varying') return c.character_maximum_length ? `VARCHAR(${c.character_maximum_length})` : 'VARCHAR(255)';
  if (t === 'character') return `CHAR(${c.character_maximum_length || 1})`;
  if (t === 'jsonb' || t === 'json') return 'JSON';
  if (t === 'bytea') return 'LONGBLOB';
  if (t === 'ARRAY' || t === 'array' || u.startsWith('_')) return 'JSON';
  if (t === 'text') return 'LONGTEXT';
  return 'LONGTEXT';
}
/* A default that means the same thing on both sides; anything PostgreSQL-only is left off, since a
   column with no default simply takes NULL, which is what the application already relies on. */
function defaultOf(c, type) {
  const d = c.column_default;
  if (!d || /nextval\(/i.test(d)) return '';
  if (/^now\(\)|CURRENT_TIMESTAMP/i.test(d)) return ' DEFAULT CURRENT_TIMESTAMP';
  // today's date / the time now: an expression default in MySQL (8.0.13+, MariaDB 10.2+). Left off, a
  // NOT NULL date the application never fills in (invoice_date, txn_date…) would refuse every insert.
  if (/^CURRENT_DATE$/i.test(d.trim())) return ' DEFAULT (CURRENT_DATE)';
  if (/^CURRENT_TIME$/i.test(d.trim())) return ' DEFAULT (CURRENT_TIME)';
  if (/^(true|false)$/i.test(d)) return ` DEFAULT ${/true/i.test(d) ? 1 : 0}`;
  const lit = /^'([^']*)'/.exec(d);
  if (lit) return /LONGTEXT|JSON|LONGBLOB/.test(type) ? '' : ` DEFAULT '${lit[1].replace(/'/g, "''")}'`;
  if (/^-?\d+(\.\d+)?$/.test(d.trim())) return ` DEFAULT ${d.trim()}`;
  return '';
}

/** The MySQL statements for a manifest: every table (or only those named), then their indexes.
 *  drop: put DROP TABLE IF EXISTS in front of each (the full schema file does; the importer does not). */
export function mysqlSchema(man, { only = null, drop = true } = {}) {
  const out = [];
  out.push('SET FOREIGN_KEY_CHECKS = 0;');
  const tables = Object.keys(man.tables).filter(t => !only || only.includes(t)).sort();
  for (const t of tables) {
    const cols = man.tables[t].columns;
    const lines = cols.map(c => {
      const type = typeOf(c);
      const nn = c.is_nullable === 'NO' ? ' NOT NULL' : '';
      return `  \`${c.column_name}\` ${type}${nn}${defaultOf(c, type)}`;
    });
    // the primary key, read from the index PostgreSQL made for it
    const pk = (man.indexes || []).find(i => i.tablename === t && /_pkey$/.test(i.indexname));
    if (pk) {
      const on = /\(([^)]*)\)\s*$/.exec(pk.indexdef);
      if (on) lines.push('  PRIMARY KEY (' + on[1].split(',').map(s => '`' + s.trim().replace(/"/g, '').split(' ')[0] + '`').join(', ') + ')');
    }
    if (drop) out.push(`DROP TABLE IF EXISTS \`${t}\`;`);
    out.push(`CREATE TABLE \`${t}\` (\n${lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
  }
  
  /* Indexes. A partial index (… WHERE …) becomes a plain one: MySQL has no partial index, and an index
     only ever decides how fast a row is found, never which rows exist. An index over lower(x) becomes
     an index over x, because these tables are compared without regard to case anyway. */
  for (const i of man.indexes || []) {
    if (/_pkey$/.test(i.indexname)) continue;
    if (!man.tables[i.tablename] || !tables.includes(i.tablename)) continue;
    const m = /CREATE (UNIQUE )?INDEX \S+ ON \S+ USING \w+ \((.*?)\)(?:\s+WHERE\s+(.*))?$/i.exec(i.indexdef.replace(/\s+/g, ' '));
    if (!m) { out.push(`-- could not read: ${i.indexdef}`); continue }
    const cols = m[2].split(',').map(s => {
      let c = s.trim().replace(/"/g, '');
      const f = /^lower\(([\w.]+)(?:::\w+)?\)$/i.exec(c);      // lower(x) -> x
      if (f) c = f[1];
      c = c.replace(/::[\w ]+/g, '').replace(/\s+(ASC|DESC)$/i, '').trim();
      if (!/^\w+$/.test(c)) return null;                        // an expression MySQL cannot index
      const col = man.tables[i.tablename].columns.find(x => x.column_name === c);
      const long = col && /text|json/i.test(col.data_type || '');
      return '`' + c + '`' + (long ? '(191)' : '');
    });
    if (cols.some(c => !c)) { out.push(`-- skipped (expression index): ${i.indexname}`); continue }
    const note = m[3] ? `   -- was partial: WHERE ${m[3]}` : '';
    out.push(`CREATE ${m[1] || ''}INDEX \`${i.indexname}\` ON \`${i.tablename}\` (${cols.join(', ')});${note}`);
  }
  out.push('SET FOREIGN_KEY_CHECKS = 1;');
  return out;
}

// run by itself: node db/mysql-schema.js <exportDir>  ->  db/schema.mysql.sql
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const dir = process.argv[2];
if (!dir) { console.error('usage: node db/mysql-schema.js <exportDir>'); process.exit(1) }
const man = JSON.parse(fs.readFileSync(path.join(dir, '_manifest.json'), 'utf8'));
const out = mysqlSchema(man);
const tables = Object.keys(man.tables);
const sql = out.join('\n') + '\n';
const file = path.join('db', 'schema.mysql.sql');
fs.writeFileSync(file, sql);
console.log(`${tables.length} tables -> ${file} (${sql.split('\n').length} lines)`);
if ((man.views || []).length) console.log('views to port by hand:', man.views.map(v => v.table_name).join(', '));

}