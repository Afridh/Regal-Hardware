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

/** Where the operand that ends just before position `end` begins: a bracketed group with the function
 *  name in front of it (brackets inside are balanced), a quoted string or name, or a plain word or $1. */
function operandStart(s, end) {
  let i = end - 1;
  while (i >= 0 && /\s/.test(s[i])) i--;
  if (i < 0) return -1;
  if (s[i] === ')') {
    let depth = 0;
    for (; i >= 0; i--) {
      if (s[i] === ')') depth++;
      else if (s[i] === '(') { depth--; if (!depth) break }
      else if (s[i] === "'") { i--; while (i >= 0 && s[i] !== "'") i--; }
    }
    if (i < 0) return -1;
    let j = i - 1;                                  // the function the brackets belong to, if any
    while (j >= 0 && /\w/.test(s[j])) j--;
    return j + 1;
  }
  if (s[i] === "'" || s[i] === '"' || s[i] === '`') { const q = s[i]; i--; while (i >= 0 && s[i] !== q) i--; return i; }
  while (i >= 0 && /[\w.$]/.test(s[i])) i--;
  return i + 1;
}

export function casts(sql) {
  // x::type  ->  CAST(x AS type). The operand is the whole thing just before the :: — a function call
  // with brackets inside it, a quoted string, a name or a $1 — so x::int::text nests as it should.
  let out = sql;
  for (let guard = 0; guard < 400; guard++) {
    const m = /::\s*(\w+)(\s*\[\])?/.exec(unquotedView(out));
    if (!m) break;
    const start = operandStart(out, m.index);
    if (start < 0) break;
    const operand = out.slice(start, m.index).trim();
    const t = CASTS[m[1].toLowerCase()];
    // array casts only ever wrap a list for = ANY(); a type MySQL has no use for leaves the value as it is
    const rep = m[2] || !t ? operand : `CAST(${operand} AS ${t})`;
    out = out.slice(0, start) + rep + out.slice(m.index + m[0].length);
  }
  return out;
}

/** The statement with every quoted run blanked out (same length), so a pattern can be found by its
 *  position without matching anything inside a string. */
function unquotedView(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c ? 2 : 1;
      out += c + ' '.repeat(Math.max(0, j - i - 1)) + (j < sql.length ? c : '');
      i = j; continue;
    }
    out += c;
  }
  return out;
}

/** Apply fn to the parts of the statement outside quotes only. */
function outsideQuotes(sql, fn) {
  let out = '', buf = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      out += fn(buf); buf = '';
      let j = i + 1;
      while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c ? 2 : 1;
      out += sql.slice(i, j + 1); i = j; continue;
    }
    buf += c;
  }
  return out + fn(buf);
}

/* ---------------------------------------------------------------- reserved words
   Names used here as columns or aliases that MySQL keeps for itself: `key` (books, settings,
   sequences, shop_media, and AS key in the reports) and `rank` (a window function since 8.0).
   PRIMARY KEY, UNIQUE KEY and the ON DUPLICATE KEY the upserts produce are the keyword, not a name. */
const RESERVED = ['key', 'rank'];
export function reserved(sql) {
  const re = new RegExp(String.raw`(?<!\b(?:PRIMARY|FOREIGN|UNIQUE|DUPLICATE)\s+)(?<![\w.\`])\b(${RESERVED.join('|')})\b(?![\w\`(])`, 'gi');
  return outsideQuotes(sql, part => part.replace(re, '`$1`'));
}

/* ---------------------------------------------------------------- dates
   In MySQL a date plus a number is not a date: CURRENT_DATE + 7 reads the date as the number 20260925
   and adds 7, and one date minus another is not a count of days. Both are made explicit here, before
   the casts are taken apart, while $3::date still says what it is. */
const UNITS = { day: 'DAY', hour: 'HOUR', minute: 'MINUTE', second: 'SECOND', month: 'MONTH', year: 'YEAR', week: 'WEEK' };
const unitOf = u => UNITS[String(u).toLowerCase().replace(/s$/, '')];
export function dates(sql) {
  let out = sql;
  // INTERVAL '30 days'  ->  INTERVAL 30 DAY
  out = out.replace(/\bINTERVAL\s+'\s*(\d+)\s*([a-z]+)\s*'/gi, (m, n, u) => unitOf(u) ? `INTERVAL ${n} ${unitOf(u)}` : m);
  // x ± ($1 || ' hours')::interval  ->  DATE_ADD/DATE_SUB(x, INTERVAL ? HOUR)   (milliseconds as microseconds)
  const X = String.raw`(now\(\)|CURRENT_DATE|CURRENT_TIMESTAMP|\$\d+(?:::\w+)?|[a-z_][\w.]*)`;
  out = out.replace(new RegExp(X + String.raw`\s*([-+])\s*\(\s*(\$\d+)\s*\|\|\s*'\s*([a-z]+)\s*'\s*\)\s*::\s*interval`, 'gi'), (m, x, op, p, u) => {
    const fn = op === '-' ? 'DATE_SUB' : 'DATE_ADD';
    if (/^milliseconds?$/i.test(u)) return `${fn}(${x}, INTERVAL (${p} * 1000) MICROSECOND)`;
    return unitOf(u) ? `${fn}(${x}, INTERVAL ${p} ${unitOf(u)})` : m;
  });
  // CURRENT_DATE + 7, $3::date - 30, current_date - $1::int  ->  DATE_ADD/DATE_SUB(…, INTERVAL n DAY)
  out = out.replace(/(\bCURRENT_DATE\b|\$\d+::date\b)\s*([-+])\s*(\d+(?![\d.:])|\$\d+::int(?:eger)?\b)/gi,
    (m, x, op, n) => `${op === '-' ? 'DATE_SUB' : 'DATE_ADD'}(${x}, INTERVAL ${n.replace(/::\w+$/, '')} DAY)`);
  // date - date is a number of days in PostgreSQL
  out = out.replace(/\bCURRENT_DATE\s*-\s*([a-z_]\w*\.[a-z_]\w*|[a-z_]\w*_date)\b/gi, 'DATEDIFF(CURRENT_DATE, $1)');
  out = out.replace(/\b([a-z_]\w*\.[a-z_]\w*date|[a-z_]\w*_date)\s*-\s*CURRENT_DATE\b/gi, 'DATEDIFF($1, CURRENT_DATE)');
  // seconds between now and then; seconds since 1970; and back
  out = out.replace(/\bEXTRACT\s*\(\s*EPOCH\s+FROM\s+\(\s*now\(\)\s*-\s*([\w.]+)\s*\)\s*\)/gi, 'TIMESTAMPDIFF(SECOND, $1, NOW())');
  out = out.replace(/\bEXTRACT\s*\(\s*EPOCH\s+FROM\s+([\w.]+)\s*\)/gi, 'UNIX_TIMESTAMP($1)');
  out = out.replace(/\bto_timestamp\s*\(/gi, 'FROM_UNIXTIME(');
  // the first of the month
  out = out.replace(/\bdate_trunc\s*\(\s*'month'\s*,\s*([\w.$:]+)\s*\)/gi, "DATE_FORMAT($1, '%Y-%m-01')");
  // to_char(date, 'YYYY-MM')  ->  DATE_FORMAT(date, '%Y-%m')
  out = out.replace(/\bto_char\s*\(\s*([\w.$:]+)\s*,\s*'([^']*)'\s*\)/gi, (m, x, f) => `DATE_FORMAT(${x}, '${dateFormat(f)}')`);
  return out;
}
/** A PostgreSQL to_char picture as a MySQL DATE_FORMAT one. "Quoted" text is kept as it is. */
export function dateFormat(f) {
  const T = [['IYYY', '%x'], ['YYYY', '%Y'], ['HH24', '%H'], ['IW', '%v'], ['MM', '%m'], ['DD', '%d'], ['MI', '%i'], ['SS', '%s']];
  let out = '';
  for (let i = 0; i < f.length;) {
    if (f[i] === '"') { const j = f.indexOf('"', i + 1); out += f.slice(i + 1, j < 0 ? f.length : j); i = j < 0 ? f.length : j + 1; continue }
    const t = T.find(([p]) => f.startsWith(p, i));
    if (t) { out += t[1]; i += t[0].length; continue }
    out += f[i] === '%' ? '%%' : f[i]; i++;
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
  // string_agg(x, ', ')  ->  GROUP_CONCAT(x SEPARATOR ', ')   (a second argument to GROUP_CONCAT is more text to join)
  out = out.replace(/\bstring_agg\(\s*([^,()]+?)\s*,\s*('[^']*')\s*\)/gi, 'GROUP_CONCAT($1 SEPARATOR $2)');
  out = out.replace(/\bstring_agg\(/gi, 'GROUP_CONCAT(');
  out = out.replace(/\bcoalesce\(/gi, 'COALESCE(');
  // bool_or / bool_and over a condition: the largest / smallest of its 1s and 0s
  out = out.replace(/\bbool_or\s*\(/gi, 'MAX(').replace(/\bbool_and\s*\(/gi, 'MIN(');
  // count(*) FILTER (WHERE x)  ->  count(CASE WHEN x THEN 1 END)
  out = out.replace(/\b(count|sum|avg|min|max)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*FILTER\s*\(\s*WHERE\s+([^()]*(?:\([^()]*\)[^()]*)*)\)/gi,
    (m, fn, arg, cond) => {
      const d = /^\s*DISTINCT\s+/i.exec(arg);              // count(DISTINCT x) FILTER …  ->  count(DISTINCT CASE WHEN … THEN x END)
      const val = arg.trim() === '*' ? '1' : d ? arg.slice(d[0].length) : arg;
      return `${fn}(${d ? 'DISTINCT ' : ''}CASE WHEN ${cond} THEN ${val} END)`;
    });
  // a IS NOT DISTINCT FROM b: equal, or both null
  out = out.replace(/\bIS\s+NOT\s+DISTINCT\s+FROM\b/gi, '<=>');
  out = out.replace(/([\w.]+|\$\d+(?:::\w+)?)\s+IS\s+DISTINCT\s+FROM\s+([\w.]+|\$\d+(?:::\w+)?)/gi, 'NOT ($1 <=> $2)');
  // x = ANY($1)  ->  x IN (?)   (again after the casts, for x = ANY($1::bigint[]))
  out = out.replace(/=\s*ANY\s*\(\s*(\?|\$\d+)\s*\)/gi, 'IN ($1)');
  // MySQL puts nulls first going up and last going down; say which is wanted
  out = out.replace(/([\w.]+)(\s+(?:ASC|DESC))?\s+NULLS\s+LAST\b/gi, '$1 IS NULL, $1$2');
  out = out.replace(/([\w.]+)(\s+(?:ASC|DESC))?\s+NULLS\s+FIRST\b/gi, '$1 IS NOT NULL, $1$2');
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

/* ---------------------------------------------------------------- comments and several statements
   Comments go first: one can hold a ; or a ' ("paid at the counter; later …", "the shop's …") that
   would otherwise split a statement or open a string. A $$ … $$ block is kept whole. */
export function stripComments(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c ? 2 : 1;
      out += sql.slice(i, j + 1); i = j; continue;
    }
    if (c === '$' && sql[i + 1] === '$') { const j = sql.indexOf('$$', i + 2); const k = j < 0 ? sql.length : j + 2; out += sql.slice(i, k); i = k - 1; continue }
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; out += '\n'; continue }
    if (c === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i + 2); i = j < 0 ? sql.length : j + 1; out += ' '; continue }
    out += c;
  }
  return out;
}
/** One string holding several statements (the table set-ups do this), as a list. */
export function statements(sql) {
  const s = stripComments(sql), out = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < s.length && !(s[j] === c && s[j + 1] !== c)) j += s[j] === c ? 2 : 1;
      cur += s.slice(i, j + 1); i = j; continue;
    }
    if (c === '$' && s[i + 1] === '$') { const j = s.indexOf('$$', i + 2); const k = j < 0 ? s.length : j + 2; cur += s.slice(i, k); i = k - 1; continue }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* ---------------------------------------------------------------- setting tables up
   The routes make their own tables on first use, in PostgreSQL's words. The same tables in MySQL's:
   the types it has, no partial or expression indexes (an index only ever decides how fast a row is
   found, never which rows exist; these tables compare text without regard to case anyway), and no
   IF NOT EXISTS where MySQL has none — the caller is told which errors mean "already there".
   Returns null for a statement MySQL has no use for. */
export const ALREADY_THERE = [1050, 1060, 1061];   // table exists · column exists · index exists
export function ddl(sql) {
  let s = sql.trim();
  // a PostgreSQL-only block (a one-off rename of an old column), and a column widened in place:
  // a table made on MySQL is made at its final shape
  if (/^DO\s+\$\$/i.test(s)) return null;
  if (/^ALTER\s+TABLE\s+\S+\s+ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i.test(s)) return null;
  s = s.replace(/^(ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN)\s+IF\s+NOT\s+EXISTS\b/i, '$1');
  const idx = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s+ON\s+(\S+)\s*(?:USING\s+\w+\s*)?\(([\s\S]*)\)\s*(?:WHERE[\s\S]*)?$/i.exec(s);
  if (idx) {
    const cols = idx[4].replace(/\b(?:lower|upper)\s*\(\s*([\w.]+)\s*\)/gi, '$1');
    return `CREATE ${idx[1] || ''}INDEX ${idx[2]} ON ${idx[3]} (${cols})`;
  }
  if (/^CREATE\s+TABLE/i.test(s)) {
    s = s.replace(/\bbigserial\b/gi, 'BIGINT AUTO_INCREMENT').replace(/\bserial\b/gi, 'INT AUTO_INCREMENT')
      .replace(/\bbytea\b/gi, 'LONGBLOB').replace(/\btimestamptz\b/gi, 'DATETIME').replace(/\bjsonb\b/gi, 'JSON')
      .replace(/\bDEFAULT\s+now\(\)/gi, 'DEFAULT CURRENT_TIMESTAMP').replace(/\bboolean\b/gi, 'TINYINT(1)')
      // PostgreSQL's text has no size; MySQL's TEXT stops at 64 KB, short of a bill sent to print
      .replace(/\btext\b/gi, 'LONGTEXT');
    if (!/\bENGINE\s*=/i.test(s)) s += ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci';
  }
  return s;
}

/** Everything above, in the order they have to happen. */
export function toMySQL(sql, params = []) {
  const r = returning(stripComments(sql));
  let out = upserts(r.sql);
  out = dates(out);                  // before the casts: $3::date still says it is a date
  out = dialect(out);
  out = casts(out);
  // x = ANY($1::bigint[])  ->  x IN (?)   (mysql2 spreads an array given to one ?). After the casts,
  // which take the array type off.
  out = out.replace(/=\s*ANY\s*\(\s*(\?|\$\d+)\s*\)/gi, 'IN ($1)');
  out = reserved(out);
  const p = placeholders(out, params);
  return { sql: p.sql, params: p.params, returning: r.returning };
}
