// Every SQL statement in the server, put through the same translation the live site (MySQL) uses, and
// checked for anything PostgreSQL-only that the translation leaves behind — those would only fail on
// regalhw.lk, never in the tests here (which run on PostgreSQL).
//   node backend/tools/check-mysql-sql.mjs        (V=1 prints every statement)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMySQL, ddl } from '../src/sql/translate.js';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name) && !/sql[\\/](translate|mysql)\.js$/.test(p)) files.push(p) } })(src);

// what MySQL / MariaDB would refuse (or read differently) if it were still there after translation
const PG = [
  [/::\s*\w/, 'a ::cast'], [/\bRETURNING\b/i, 'RETURNING'], [/\bON\s+CONFLICT\b/i, 'ON CONFLICT'], [/\bILIKE\b/i, 'ILIKE'],
  [/\bjsonb?_\w+\(/i, 'a json(b)_ function'], [/\bDISTINCT\s+ON\b/i, 'DISTINCT ON'], [/\bFILTER\s*\(\s*WHERE/i, 'FILTER (WHERE'],
  [/=\s*ANY\s*\(/i, '= ANY('], [/\barray_agg\(/i, 'array_agg'], [/\bgenerate_series\(/i, 'generate_series'], [/\bto_char\(/i, 'to_char'],
  [/\bdate_trunc\(/i, 'date_trunc'], [/\bEXTRACT\s*\(\s*EPOCH/i, 'EXTRACT(EPOCH'], [/\bLATERAL\b/i, 'LATERAL'], [/\bage\(/i, 'age()'],
  [/\$\d+/, 'a $n placeholder left'], [/->>?\s*'[A-Za-z_]\w*'\s*->/, 'a chained -> (MySQL needs one path)'], [/\bINTERVAL\s+'/i, "INTERVAL '…' (pg form)"],
  [/\bstring_agg\(/i, 'string_agg'], [/\bbool_(or|and)\(/i, 'bool_or/and'], [/\bIS\s+(NOT\s+)?DISTINCT\s+FROM\b/i, 'IS DISTINCT FROM'],
  [/\bNULLS\s+(FIRST|LAST)\b/i, 'NULLS FIRST/LAST'], [/\bSERIAL\b|\bBIGSERIAL\b/, 'SERIAL'], [/\bnow\(\)\s*[-+]\s*'/i, "now() - '…'"],
  [/\bcurrent_setting\(|\bpg_\w+\(/i, 'a pg_ function'], [/\bregexp_replace\(.*'g'\)/i, "regexp_replace(…,'g')"], [/~\*?\s*'/, 'a ~ regex match'],
  [/\bsplit_part\(/i, 'split_part'], [/\bunnest\(/i, 'unnest'], [/\bWITH\s+RECURSIVE\b/i, '(ok on MySQL 8 / MariaDB 10.2+) WITH RECURSIVE'],
  [/"\w+"\s*(=|,|\)|\s+AS\b)/, 'a "double-quoted" name'], [/\bTRUNCATE\b.*\bRESTART\b/i, 'TRUNCATE … RESTART'], [/\bFOR\s+UPDATE\s+SKIP\b/i, '(MySQL 8 only) SKIP LOCKED'],
];
const looksSQL = s => /^\s*(--[^\n]*\n\s*)*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DO)\b/i.test(s);

let n = 0, pgOnly = 0; const issues = [];
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  // template literals and quoted strings handed to a query(…) call
  for (const m of t.matchAll(/\bquery\(\s*(`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g)) {
    let s = m[1].slice(1, -1);
    if (m[1][0] === '`') s = s.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' 1 ');   // an interpolated piece: a stand-in
    if (!looksSQL(s)) continue;
    // the PostgreSQL side of a `dbKind === 'mysql' ? … : …` (or an if that returned the MySQL answer already)
    if (/dbKind\s*===\s*'mysql'/.test(t.slice(Math.max(0, m.index - 2500), m.index))) { pgOnly++; continue }
    n++;
    const line = t.slice(0, m.index).split('\n').length, where = `${path.relative(src, f)}:${line}`;
    let out;
    try { out = /^\s*(CREATE|ALTER|DO)\b/i.test(s) ? ddl(toMySQL(s, []).sql) || '' : toMySQL(s, []).sql }
    catch (e) { issues.push({ where, what: 'translation threw: ' + e.message, sql: s.trim().slice(0, 200) }); continue }
    for (const [re, what] of PG) if (re.test(out) && !what.startsWith('(')) issues.push({ where, what, sql: out.replace(/\s+/g, ' ').trim().slice(0, 260) });
    if (process.env.V) console.log(where + '\n  ' + out.replace(/\s+/g, ' ').trim());
  }
}
console.log(`${n} statements in ${files.length} files (and ${pgOnly} on the PostgreSQL side of a MySQL branch, not checked)`);
for (const i of issues) console.log(`FAIL ${i.where}  ${i.what}\n     ${i.sql}`);
console.log(`\n${n - new Set(issues.map(i => i.where)).size} passed, ${new Set(issues.map(i => i.where)).size} failed`);
