// The MySQL side of the database layer: the same query()/withTransaction() the application has
// always called, over mysql2. Statements arrive as they were written for PostgreSQL and go through
// the translator; what comes back is shaped the way `pg` shaped it, so no caller can tell.
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMySQL, statements, ddl, ALREADY_THERE } from './translate.js';

/* ---------------------------------------------------------------- what comes back
   pg gives a boolean column back as true/false and a jsonb one as an object. MySQL keeps booleans as
   TINYINT(1) (1/0, and the code asks === false), and MariaDB keeps JSON as text. Both are put back the
   way pg had them. Which columns are JSON is read from the schema the database was made from. */
const JSON_COLS = (() => {
  const set = new Set(['books.data', 'books_history.data', 'shop_orders.data', 'sup_inbox.data', 'cust_inbox.data', 'print_helper.printers']);
  try {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/schema.mysql.sql');
    let table = '';
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = /^CREATE TABLE `(\w+)`/.exec(line); if (t) table = t[1];
      const c = /^\s*`(\w+)` JSON\b/.exec(line); if (c && table) set.add(`${table}.${c[1]}`);
    }
  } catch { /* the schema file is not deployed: the list above stands */ }
  return set;
})();
function typeCast(field, next) {
  if (field.type === 'TINY' && field.length === 1) { const v = field.string(); return v === null ? null : v !== '0'; }
  if ((field.type === 'BLOB' || field.type === 'VAR_STRING' || field.type === 'STRING') && JSON_COLS.has(`${field.orgTable}.${field.orgName}`)) {
    const v = field.string();
    if (v === null) return null;
    try { return JSON.parse(v); } catch { return v; }
  }
  return next();
}

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

const NEXT_SERIAL = /^\s*SELECT\s+next_serial\s*\(([^)]*)\)\s*(?:AS\s+`?(\w+)`?)?\s*$/i;
/** The arguments of a call, split on commas that are not inside quotes. */
function splitArgs(s) {
  const out = []; let cur = '', q = false;
  for (const ch of s) { if (ch === "'") q = !q; if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; continue } cur += ch }
  if (cur.trim()) out.push(cur.trim());
  return out;
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
    typeCast,
  });
  // `a || b` joins text in PostgreSQL and means OR in MySQL unless it is told otherwise. And the clock is
  // UTC, as the hosted PostgreSQL's is: now() and CURRENT_DATE mean the same on both, and the DATETIMEs
  // written are the ones this driver reads back (timezone 'Z' above) — on a server set to local time
  // they would otherwise come back hours out.
  pool.pool.on('connection', c => c.query("SET SESSION sql_mode = CONCAT(@@sql_mode, ',PIPES_AS_CONCAT'), time_zone = '+00:00'"));

  async function run(conn, text, params) {
    // a string holding several statements (the table set-ups) runs them one after another
    const list = statements(text);
    if (list.length > 1) { let last = { rows: [], rowCount: 0 }; for (const s of list) last = await run(conn, s, params); return last }
    const one = list[0] || '';
    if (/^(CREATE|ALTER|DO)\b/i.test(one)) {
      const sql = ddl(toMySQL(one, []).sql);
      if (!sql) return { rows: [], rowCount: 0 };
      try { await conn.query(sql) } catch (e) { if (!ALREADY_THERE.includes(e.errno)) throw e }
      return { rows: [], rowCount: 0 };
    }
    const t = toMySQL(one, params);
    const serial = NEXT_SERIAL.exec(t.sql);
    if (serial) return nextSerial(conn, serial, t.params);
    const table = (TABLE_OF.exec(t.sql) || [])[1];
    if (t.returning) return runReturning(conn, t, KEY_OF[table] || 'id');
    const [res] = await conn.query(t.sql, t.params);
    if (Array.isArray(res)) return { rows: res, rowCount: res.length };
    return { rows: [], rowCount: res.affectedRows ?? 0, insertId: res.insertId };
  }

  /* next_serial(company, location, key, prefix) is a stored function in the PostgreSQL schema: the next
     number of a series, as 'INV-000042'. Here it is the same steps. The UPDATE takes the row's lock, so
     two tills never get the same number; LAST_INSERT_ID(x) carries the number back on this connection. */
  async function nextSerial(conn, m, params) {
    let p = 0;
    const args = splitArgs(m[1]).map(a => a === '?' ? params[p++] : /^NULL$/i.test(a) ? null : a.replace(/^'|'$/g, '').replace(/''/g, "'"));
    const [company, location, key, prefix] = args;
    const loc = location ?? 0;
    const c = conn === pool ? await pool.getConnection() : conn;
    try {
      await c.query('INSERT IGNORE INTO sequences (company_id, location_id, `key`, prefix, next_no) VALUES (?,?,?,?,1)', [company, loc, key, prefix ?? `${key}-`]);
      await c.query('UPDATE sequences SET next_no = LAST_INSERT_ID(next_no + 1) WHERE company_id = ? AND location_id = ? AND `key` = ?', [company, loc, key]);
      const [[row]] = await c.query("SELECT CONCAT(prefix, LPAD(LAST_INSERT_ID() - 1, 6, '0')) AS v FROM sequences WHERE company_id = ? AND location_id = ? AND `key` = ?", [company, loc, key]);
      return { rows: [{ [m[2] || 'next_serial']: row ? row.v : null }], rowCount: 1 };
    } finally { if (c !== conn) c.release() }
  }

  const query = (text, params) => run(pool, text, params);
  // the set-up scripts in db/ (seed, reset-admin) use pg's pool.connect(): a client with query() and release()
  pool.connect = async () => {
    const c = await pool.getConnection();
    return { query: (text, params) => run(c, text, params), release: () => c.release() };
  };

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
