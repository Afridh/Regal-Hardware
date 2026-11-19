// "User … has exceeded the 'max_user_connections' resource": does the server wait and ask again,
// rather than hand the error to the till? (A pretend MySQL that is full for a moment.)
import mysql from 'mysql2/promise';

let pass = 0, fail = 0;
const ok = (c, w, x = '') => { c ? (pass++, console.log('PASS ' + w + (x ? '  ' + x : ''))) : (fail++, console.log('FAIL ' + w + (x ? '  ' + x : ''))) };
const fullErr = () => Object.assign(new Error("User 'regal' has exceeded the 'max_user_connections' resource (current value: 10)"), { errno: 1226, code: 'ER_USER_LIMIT_REACHED' });

let refuse = 0, asked = 0, opts = null;
mysql.createPool = (o) => {
  opts = o;
  const conn = { query: async () => [[{ one: 1 }]], release() {}, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {} };
  return {
    pool: { on() {} },
    query: async () => { asked++; if (refuse > 0) { refuse--; throw fullErr(); } return [[{ one: 1 }]]; },
    getConnection: async () => { asked++; if (refuse > 0) { refuse--; throw fullErr(); } return conn; },
  };
};
const { makeMySQL } = await import('../src/sql/mysql.js');
const db = makeMySQL('mysql://regal:secret@localhost:3306/regal');

ok(opts.connectionLimit <= 5, 'a small pool for shared hosting', 'connectionLimit ' + opts.connectionLimit);
ok(opts.maxIdle <= 2 && opts.idleTimeout > 0, 'idle connections are let go', `maxIdle ${opts.maxIdle}, idleTimeout ${opts.idleTimeout}ms`);

refuse = 2; asked = 0;
let r = await db.query('SELECT 1 AS one').catch(e => e);
ok(r && r.rows && r.rows[0].one === 1, 'a query waits while the database is full, then goes through', `asked ${asked} times`);

refuse = 3; asked = 0;
r = await db.withTransaction(async c => (await c.query('SELECT 1 AS one')).rows[0].one).catch(e => e);
ok(r === 1, 'a transaction waits for a connection too', `asked ${asked} times`);

refuse = 99; asked = 0;
const t0 = Date.now();
r = await db.query('SELECT 1').catch(e => e);
ok(r instanceof Error && r.errno === 1226, 'full for good: it gives up in the end and says why', `after ${Date.now() - t0}ms, ${asked} tries`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
