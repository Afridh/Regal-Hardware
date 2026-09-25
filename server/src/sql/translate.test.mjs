// The translator is what every query in the system passes through, so it is checked on its own.
//   node src/sql/translate.test.mjs
import { toMySQL, placeholders, casts, upserts, dialect, returning } from './translate.js';

let pass = 0, fail = 0;
const is = (what, got, want) => {
  const g = typeof got === 'string' ? got.replace(/\s+/g, ' ').trim() : JSON.stringify(got);
  const w = typeof want === 'string' ? want.replace(/\s+/g, ' ').trim() : JSON.stringify(want);
  if (g === w) { pass++; return }
  fail++; console.log('FAIL ' + what + '\n  got  ' + g + '\n  want ' + w);
};

/* placeholders */
is('$1 becomes ?', placeholders('SELECT * FROM t WHERE a = $1', ['x']).sql, 'SELECT * FROM t WHERE a = ?');
is('values follow the ?s', placeholders('WHERE a=$2 AND b=$1', ['one', 'two']).params, ['two', 'one']);
is('a repeated $1 sends its value twice',
  placeholders('WHERE k=$1 AND id NOT IN (SELECT id FROM h WHERE k=$1)', ['regal']).params, ['regal', 'regal']);
is('$ inside a string is left alone', placeholders("SELECT 'costs $1 each' , a FROM t WHERE b=$1", ['z']).sql,
  "SELECT 'costs $1 each' , a FROM t WHERE b=?");
is('and its params are right', placeholders("SELECT 'a $9 b' FROM t WHERE b=$1", ['z']).params, ['z']);
is('$ inside a line comment is left alone', placeholders('SELECT a -- $5 here\nFROM t WHERE b=$1', ['z']).sql,
  'SELECT a -- $5 here\nFROM t WHERE b=?');
is('a doubled quote inside a string', placeholders("SELECT 'it''s $2' FROM t WHERE a=$1", ['z']).sql,
  "SELECT 'it''s $2' FROM t WHERE a=?");

is('plain ? keeps its values', placeholders('INSERT INTO t (a,b) VALUES (?,?)', [1, 2]).params, [1, 2]);
is('plain ? sql is untouched', placeholders('INSERT INTO t (a,b) VALUES (?,?)', [1, 2]).sql, 'INSERT INTO t (a,b) VALUES (?,?)');

/* casts */
is('count cast', casts('SELECT count(*)::int AS n FROM t'), 'SELECT CAST(count(*) AS SIGNED) AS n FROM t');
is('a column cast', casts('SELECT a::text FROM t'), 'SELECT CAST(a AS CHAR) FROM t');
is('an array cast wraps nothing', casts('WHERE id = ANY($1::bigint[])'), 'WHERE id = ANY($1)');
is('nested casts', casts('SELECT length(data::text)::bigint FROM books'),
  'SELECT CAST(length(CAST(data AS CHAR)) AS SIGNED) FROM books');

/* upserts */
is('do update', upserts('INSERT INTO t (a,b) VALUES ($1,$2) ON CONFLICT (a) DO UPDATE SET b = EXCLUDED.b'),
  'INSERT INTO t (a,b) VALUES ($1,$2) ON DUPLICATE KEY UPDATE b = VALUES(b)');
is('do nothing', upserts('INSERT INTO t (a) VALUES ($1) ON CONFLICT DO NOTHING'),
  'INSERT IGNORE INTO t (a) VALUES ($1)');
is('do nothing naming the column', upserts('INSERT INTO t (a) VALUES ($1) ON CONFLICT (a) DO NOTHING'),
  'INSERT IGNORE INTO t (a) VALUES ($1)');

/* dialect */
is('ILIKE', dialect("WHERE name ILIKE '%x%'"), "WHERE name LIKE '%x%'");
is('= ANY becomes IN', dialect('WHERE id = ANY($1)'), 'WHERE id IN ($1)');
is('FILTER', dialect('SELECT count(*) FILTER (WHERE a > 0) AS n FROM t'),
  'SELECT count(CASE WHEN a > 0 THEN 1 END) AS n FROM t');
is('jsonb_array_length', dialect("SELECT jsonb_array_length(data->'S'->'customers') FROM books"),
  "SELECT JSON_LENGTH(data->'S'->'customers') FROM books");

/* returning */
is('RETURNING is taken off', returning('INSERT INTO t (a) VALUES ($1) RETURNING *').sql, 'INSERT INTO t (a) VALUES ($1)');
is('and remembered', returning('INSERT INTO t (a) VALUES ($1) RETURNING id, name').returning, 'id, name');
is('no RETURNING, no change', returning('SELECT 1').returning, null);

/* the whole thing, on real statements from the system */
const real = toMySQL(
  `INSERT INTO books (key, rev, data, updated_at, updated_by) VALUES ($1,$2,$3,now(),$4)
     ON CONFLICT (key) DO UPDATE SET rev = EXCLUDED.rev, data = EXCLUDED.data`, ['regal', 5, '{}', 'Afridh']);
is('a real upsert', real.sql,
  'INSERT INTO books (key, rev, data, updated_at, updated_by) VALUES (?,?,?,now(),?) ON DUPLICATE KEY UPDATE rev = VALUES(rev), data = VALUES(data)');
is('with its values', real.params, ['regal', 5, '{}', 'Afridh']);

const del = toMySQL(`DELETE FROM books_history WHERE key = $1 AND id NOT IN (SELECT id FROM books_history WHERE key = $1 ORDER BY id DESC LIMIT 200)`, ['regal']);
is('a repeated parameter in a real statement', del.params, ['regal', 'regal']);

const ins = toMySQL(`INSERT INTO cust_logins (owner, username, admin_hash) VALUES ($1,$2,$3) RETURNING *`, [1, 'a', 'h']);
is('insert keeps its RETURNING aside', ins.returning, '*');
is('and loses it from the sql', ins.sql, 'INSERT INTO cust_logins (owner, username, admin_hash) VALUES (?,?,?)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
