// "User … has exceeded the 'max_user_connections' resource (current value: 1)": a pretend MySQL that, like
// regalhw.lk's host, lets each user have ONE connection at a time. Does the server share the work across the
// users the shop has made (DB_MORE_USERS), wait for room rather than fail, and let a connection go soon?
import mysql from 'mysql2/promise';

let pass = 0, fail = 0;
const ok = (c, w, x = '') => { c ? (pass++, console.log('PASS ' + w + (x ? '  ' + x : ''))) : (fail++, console.log('FAIL ' + w + (x ? '  ' + x : ''))) };
const nap = (ms) => new Promise(r => setTimeout(r, ms));
const fullErr = (u) => Object.assign(new Error(`User '${u}' has exceeded the 'max_user_connections' resource (current value: 1)`), { errno: 1226, code: 'ER_USER_LIMIT_REACHED' });

/* the host: one connection a user, counted across every copy of the app */
const open = new Map();              // user -> connections open at the host
let refusals = 0, extraBusy = null;  // extraBusy: a user held by "another copy of the app"
const made = [];
mysql.createPool = (o) => {
  made.push(o);
  const free = [], all = [];
  const core = { _freeConnections: free, _allConnections: all, on() {} };
  const connect = async () => {
    if ((open.get(o.user) || 0) >= 1 || extraBusy === o.user) { refusals++; throw fullErr(o.user); }
    open.set(o.user, (open.get(o.user) || 0) + 1);
    const c = { user: o.user,
      query: async (sql) => { await nap(/SLOW/.test(sql) ? 300 : 5); return [[{ one: 1, by: o.user }]]; },
      release() { all.splice(all.indexOf(c), 1); open.set(o.user, open.get(o.user) - 1); },   // closed straight away (idle let go)
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {} };
    all.push(c); return c;
  };
  return { pool: core, getConnection: connect, end: async () => {} };
};

process.env.DB_MORE_USERS = 'regalhwl_app2:pw2,regalhwl_app3:pw:with:colons';
const { makeMySQL } = await import('../src/sql/mysql.js');
const db = makeMySQL('mysql://regalhwl_app:pw1@localhost:3306/regalhwl_books');

ok(made.length === 3 && made.map(o => o.user).join() === 'regalhwl_app,regalhwl_app2,regalhwl_app3', 'three users to connect as', made.map(o => o.user).join(', '));
ok(made[2].password === 'pw:with:colons' && made[0].database === 'regalhwl_books', 'passwords and the database read right', made[2].password);
ok(made.every(o => o.connectionLimit === 1), 'one connection a user, as the host allows', 'connectionLimit ' + made[0].connectionLimit);
ok(made.every(o => o.idleTimeout <= 3000), 'an idle connection is let go soon', made[0].idleTimeout + 'ms');

// three slow requests at once: one on each user, none refused to the till
let t0 = Date.now(); refusals = 0;
let r = await Promise.all([1, 2, 3].map(() => db.query('SELECT SLOW 1')));
ok(r.every(x => x.rows[0].one === 1), 'three tills at once: all answered', `in ${Date.now() - t0}ms`);
ok(new Set(r.map(x => x.rows[0].by)).size === 3, 'the work was spread over the three users', r.map(x => x.rows[0].by).join(', '));

// six at once: three wait their turn, none fails
t0 = Date.now();
r = await Promise.all([1, 2, 3, 4, 5, 6].map(() => db.query('SELECT SLOW 1').catch(e => e)));
ok(r.every(x => x && x.rows), 'six at once on three connections: all answered, the rest waited', `in ${Date.now() - t0}ms`);

// a user held by another copy of the app: the request goes to another user
extraBusy = 'regalhwl_app'; refusals = 0;
r = await Promise.all([1, 2].map(() => db.query('SELECT 1')));
ok(r.every(x => x.rows[0].by !== 'regalhwl_app'), 'a user busy elsewhere is passed over', r.map(x => x.rows[0].by).join(', '));
extraBusy = null;

// transactions and the numbering of bills on a shared connection
r = await db.withTransaction(async c => (await c.query('SELECT 1')).rows[0].one).catch(e => e);
ok(r === 1, 'a transaction gets a connection of its own');

// every user full for good: gives up in the end and says why
const hold = await Promise.all(['regalhwl_app', 'regalhwl_app2', 'regalhwl_app3'].map(u => { open.set(u, 1); return u; }));
t0 = Date.now();
r = await db.query('SELECT 1').catch(e => e);
ok(r instanceof Error && r.errno === 1226, 'full for good: it gives up in the end and says why', `after ${Date.now() - t0}ms`);
hold.forEach(u => open.set(u, 0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
