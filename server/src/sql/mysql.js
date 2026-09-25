// The MySQL side of the database layer: the same query()/withTransaction() the application has
// always called, over mysql2. Statements arrive as they were written for PostgreSQL and go through
// the translator; what comes back is shaped the way `pg` shaped it, so no caller can tell.
import mysql from 'mysql2/promise';
import { toMySQL } from './translate.js';

/* ---------------------------------------------------------------- RETURNING
   MySQL cannot hand rows back from a write, so the rows are fetched around it: an INSERT by the id
   it was given, an UPDATE or DELETE by the ids that matched before it ran. */
const TABLE_OF = /^\s*(?:INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM)\s+`?([\w]+)`?/i;
const VERB_OF = /^\s*(INSERT|UPDATE|DELETE)/i;
/** Where the WHERE begins, ignoring any inside brackets or quotes. */
function whereOf(sql) {
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '`' || c === '"') { const q = c; i++; while (i < sql.length && sql[i] !== q) i += sql[i] === '\\' ? 2 : 1; continue }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (!depth && /\s/.test(c) && /^\s+where\s/i.test(sql.slice(i, i + 8))) return i + sql.slice(i).search(/where/i);
  }
  return -1;
}
const countQ = (s) => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '`' || c === '"') { const q = c; i++; while (i < s.length && s[i] !== q) i += s[i] === '\\' ? 2 : 1; continue }
    if (c === '?') n++;
  }
  return n;
};

async function runReturning(conn, t, key) {
  const table = (TABLE_OF.exec(t.sql) || [])[1];
  const verb = (VERB_OF.exec(t.sql) || [])[1].toUpperCase();
  const cols = t.returning === '*' ? '*' : t.returning;
  if (!table) throw new Error('cannot work out the table for RETURNING: ' + t.sql.slice(0, 80));

  if (verb === 'INSERT') {
    const [res] = await conn.query(t.sql, t.params);
    if (!res.insertId) return { rows: [], rowCount: res.affectedRows || 0 };
    const [rows] = await conn.query(`SELECT ${cols} FROM \`${table}\` WHERE \`${key}\` = ?`, [res.insertId]);
    return { rows, rowCount: rows.length };
  }
  // UPDATE / DELETE: find what it is about to touch, using that statement's own WHERE
  const w = whereOf(t.sql);
  const where = w < 0 ? '' : t.sql.slice(w);
  const whereParams = w < 0 ? [] : t.params.slice(countQ(t.sql.slice(0, w)));
  const [before] = await conn.query(`SELECT \`${key}\` FROM \`${table}\` ${where}`, whereParams);
  const ids = before.map(r => r[key]);
  if (verb === 'DELETE') {
    const [rows] = ids.length ? await conn.query(`SELECT ${cols} FROM \`${table}\` WHERE \`${key}\` IN (?)`, [ids]) : [[]];
    const [res] = await conn.query(t.sql, t.params);
    return { rows, rowCount: res.affectedRows };
  }
  const [res] = await conn.query(t.sql, t.params);
  const [rows] = ids.length ? await conn.query(`SELECT ${cols} FROM \`${table}\` WHERE \`${key}\` IN (?)`, [ids]) : [[]];
  return { rows, rowCount: res.affectedRows };
}

/** Tables whose own key is not called id. */
const KEY_OF = { books: 'key', settings: 'key', sms_settings: 'id', wa_status: 'id', print_helper: 'key' };

export function makeMySQL(url) {
  const u = new URL(url);
  const pool = mysql.createPool({
    host: u.hostname, port: +u.port || 3306,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    waitForConnections: true, connectionLimit: process.env.VERCEL ? 3 : 10,
    // match what `pg` handed back, so no caller sees a different shape
    decimalNumbers: true,          // NUMERIC as a number, as the pg type parser did
    supportBigNumbers: true, bigNumberStrings: false,
    dateStrings: ['DATE'],         // DATE as 'YYYY-MM-DD'; DATETIME stays a Date
    charset: 'utf8mb4_general_ci',
    multipleStatements: false,
    timezone: 'Z',
  });

  async function run(conn, text, params) {
    const t = toMySQL(text, params);
    const table = (TABLE_OF.exec(t.sql) || [])[1];
    if (t.returning) return runReturning(conn, t, KEY_OF[table] || 'id');
    const [res] = await conn.query(t.sql, t.params);
    if (Array.isArray(res)) return { rows: res, rowCount: res.length };
    return { rows: [], rowCount: res.affectedRows ?? 0, insertId: res.insertId };
  }

  const query = (text, params) => run(pool, text, params);

  async function withTransaction(fn) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // the client handed to fn speaks the same query() the rest of the system does
      const result = await fn({ query: (text, params) => run(conn, text, params) });
      await conn.commit();
      return result;
    } catch (e) {
      try { await conn.rollback() } catch { /* the connection is going back anyway */ }
      throw e;
    } finally { conn.release() }
  }

  return { pool, query, withTransaction };
}
