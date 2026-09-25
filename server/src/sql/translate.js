// PostgreSQL SQL written for `pg`, turned into the MySQL the same statement means.
//
// The application keeps its own SQL exactly as it was: query() still takes $1, $2 and still hands
// back { rows, rowCount }. Everything that differs between the two databases is dealt with here, in
// one place, where it can be read and tested on its own.
//
// What is NOT done here is anything that would change what a statement means. Where the two
// databases genuinely disagree — a partial index, a JSON operator — the statement is rewritten to
// the MySQL that does the same job, and where MySQL cannot do the job at all the caller is told.

/* ---------------------------------------------------------------- placeholders
   pg numbers its parameters and lets one be used twice; MySQL has positional ?. The values are put
   in the order the ?s come out, so $1 used twice sends its value twice. Anything inside a quoted
   string or a comment is left alone. */
export function placeholders(sql, params = []) {
  let out = '', order = [], i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {                 // a quoted run passes through whole
      const q = c; let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\') { j += 2; continue }
        if (sql[j] === q) { if (sql[j + 1] === q) { j += 2; continue } break }
        j++;
      }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '-' && sql[i + 1] === '-') { const j = sql.indexOf('\n', i); const k = j < 0 ? sql.length : j; out += sql.slice(i, k); i = k; continue }
    if (c === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i); const k = j < 0 ? sql.length : j + 2; out += sql.slice(i, k); i = k; continue }
    if (c === '$' && /[0-9]/.test(sql[i + 1] || '')) {
      let j = i + 1; while (/[0-9]/.test(sql[j] || '')) j++;
      order.push(+sql.slice(i + 1, j) - 1); out += '?'; i = j; continue;
    }
    out += c; i++;
  }
  // a statement written with plain ? keeps the values it was given: there is nothing to reorder
  if (!order.length) return { sql: out, params };
  return { sql: out, params: order.map(n => params[n]) };
}

/* ---------------------------------------------------------------- casts
   ::int, ::text, ::bigint[] … pg's shorthand. Most are there to tell pg what to do with a string and
   mean nothing to MySQL; the ones that matter become CAST(). */
const CASTS = { int: 'SIGNED', int4: 'SIGNED', integer: 'SIGNED', bigint: 'SIGNED', int8: 'SIGNED',
  smallint: 'SIGNED', numeric: 'DECIMAL(18,4)', decimal: 'DECIMAL(18,4)', float: 'DECIMAL(18,4)',
  float8: 'DECIMAL(18,4)', real: 'DECIMAL(18,4)', text: 'CHAR', varchar: 'CHAR', date: 'DATE',
  timestamptz: 'DATETIME', timestamp: 'DATETIME', boolean: 'SIGNED', bool: 'SIGNED', jsonb: 'JSON', json: 'JSON' };

export function casts(sql) {
  // x::type  ->  CAST(x AS type). Only the operand immediately before the :: is taken: a bracketed
  // group, a quoted name, a function call, or a plain word.
  let out = sql, guard = 0;
  while (/::\s*[a-zA-Z]/.test(out) && guard++ < 200) {
    out = out.replace(/((?:\w+\s*)?\([^()]*\)|"[^"]*"|'[^']*'|[\w.]+)\s*::\s*(\w+)(\[\])?/, (m, operand, type, arr) => {
      const t = CASTS[type.toLowerCase()];
      if (arr) return operand;                      // array casts only ever wrap a list for = ANY()
      if (!t) return operand;                       // a type MySQL has no use for: the value stands
      return `CAST(${operand} AS ${t})`;
    });
  }
  return out;
}

/* ---------------------------------------------------------------- upserts
   INSERT … ON CONFLICT (cols) DO UPDATE SET a = EXCLUDED.a  ->  … ON DUPLICATE KEY UPDATE a = VALUES(a)
   INSERT … ON CONFLICT [(cols)] DO NOTHING                  ->  INSERT IGNORE …
   MySQL fires on any unique key rather than the named one. Every use here names the table's own
   primary or unique key, so the two pick the same row. */
export function upserts(sql) {
  let out = sql.replace(/\bON\s+CONFLICT\s*(?:\([^)]*\)|ON\s+CONSTRAINT\s+\w+)?\s*DO\s+NOTHING/gi, '');
  if (out !== sql) out = out.replace(/^(\s*)INSERT\s+INTO\b/i, '$1INSERT IGNORE INTO');
  out = out.replace(/\bON\s+CONFLICT\s*(?:\([^)]*\)|ON\s+CONSTRAINT\s+\w+)\s*DO\s+UPDATE\s+SET\b/gi, 'ON DUPLICATE KEY UPDATE');
  out = out.replace(/\bEXCLUDED\.(\w+)/gi, 'VALUES($1)');
  return out;
}

/* ---------------------------------------------------------------- the rest of the dialect */
export function dialect(sql) {
  let out = sql;
  out = out.replace(/\bILIKE\b/gi, 'LIKE');                     // MySQL's default collation ignores case
  out = out.replace(/\bcurrent_database\(\)/gi, 'DATABASE()');
  out = out.replace(/\bstring_agg\(/gi, 'GROUP_CONCAT(');
  out = out.replace(/\bcoalesce\(/gi, 'COALESCE(');
  // count(*) FILTER (WHERE x)  ->  count(CASE WHEN x THEN 1 END)
  out = out.replace(/\b(count|sum|avg|min|max)\s*\(([^()]*)\)\s*FILTER\s*\(\s*WHERE\s+([^()]*(?:\([^()]*\)[^()]*)*)\)/gi,
    (m, fn, arg, cond) => `${fn}(CASE WHEN ${cond} THEN ${arg.trim() === '*' ? '1' : arg} END)`);
  // x = ANY($1)  ->  x IN (?)   (mysql2 expands an array given to a single ?)
  out = out.replace(/=\s*ANY\s*\(\s*(\?|\$\d+)\s*\)/gi, 'IN ($1)');
  // JSON reach-in: pg's -> and ->> both exist in MySQL with the same meaning for text keys.
  out = out.replace(/\bjsonb_array_length\(/gi, 'JSON_LENGTH(');
  out = out.replace(/\bjsonb_build_object\(/gi, 'JSON_OBJECT(');
  out = out.replace(/\bto_jsonb\(|\bto_json\(/gi, 'CAST(');
  return out;
}

/* ---------------------------------------------------------------- RETURNING
   MySQL has none. The clause is taken off and described, so the caller can fetch the same rows back
   itself once the write has happened. */
export function returning(sql) {
  const m = /\bRETURNING\s+([\s\S]+?)\s*$/i.exec(sql.trim().replace(/;\s*$/, ''));
  if (!m) return { sql, returning: null };
  return { sql: sql.trim().replace(/;\s*$/, '').slice(0, m.index).trim(), returning: m[1].trim() };
}

/** Everything above, in the order they have to happen. */
export function toMySQL(sql, params = []) {
  const r = returning(sql);
  let out = upserts(r.sql);
  out = dialect(out);
  out = casts(out);
  const p = placeholders(out, params);
  return { sql: p.sql, params: p.params, returning: r.returning };
}
