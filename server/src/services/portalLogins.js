// Named sign-ins for the pages outside the shop: a customer's own page and a supplier's own page.
// A building firm has a manager, an accountant and a storekeeper; a supplier has a rep and an office.
// Each gets a user name of their own.
//
// Two passwords open a sign-in: the one the shop set and the one the person has since chosen. The
// shop can therefore always get them in, and a person can still have a password nobody else knows.
// Nothing here goes into the books — passwords are hashed and stay on the shop's server.
import bcrypt from 'bcryptjs';
import { query } from '../db.js';

const ready = new Map();
/** The table for one kind of page: 'cust_logins' or 'sup_logins'. Made on first use. */
export function ensureLogins(table) {
  if (!ready.has(table)) {
    ready.set(table, query(`
      -- the customers' table was made before this one and called the column cid
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '${table}' AND column_name = 'cid')
        THEN EXECUTE 'ALTER TABLE ${table} RENAME COLUMN cid TO owner'; END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS ${table} (
        id         bigserial PRIMARY KEY,
        owner      integer NOT NULL,
        username   varchar(40) NOT NULL,
        name       varchar(80),
        role       varchar(40),
        phone      varchar(20),
        admin_hash text,
        own_hash   text,
        active     boolean NOT NULL DEFAULT true,
        last_seen  timestamptz,
        created_at timestamptz NOT NULL DEFAULT now());
      -- the password the shop set, kept readable until the person picks one of their own. The shop
      -- can reset it at any rate, so keeping it does not give away anything it could not already do,
      -- and without it nobody could read out the password the system made by itself.
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS starter varchar(40);
      CREATE UNIQUE INDEX IF NOT EXISTS ${table}_user ON ${table} (lower(username))`)
      .catch(e => { ready.delete(table); throw e; }));
  }
  return ready.get(table);
}

export const hashPass = (p) => bcrypt.hash(String(p), 10);
export const passOk = (p, h) => (h ? bcrypt.compare(String(p || ''), h).catch(() => false) : Promise.resolve(false));
// "S. Jayasinghe" would otherwise come out as s..jayasinghe — runs of dots close up, and a name
// never starts or ends on one.
export const cleanUser = (u) => String(u || '').trim().toLowerCase()
  .replace(/[^a-z0-9._-]/g, '').replace(/\.{2,}/g, '.').replace(/^[._-]+|[._-]+$/g, '');
export const digits = (s) => String(s || '').replace(/\D/g, '');
/** What the till is shown: never a hash, only whether they have set one of their own. */
export const loginLine = (l) => ({ id: Number(l.id), owner: l.owner, username: l.username, name: l.name || '',
  role: l.role || '', phone: l.phone || '', active: l.active, own: !!l.own_hash, lastSeen: l.last_seen,
  starter: l.own_hash ? '' : (l.starter || '') });

export async function listLogins(table, owner) {
  await ensureLogins(table);
  const { rows } = await query(`SELECT * FROM ${table} WHERE owner = $1 ORDER BY id`, [owner]);
  return rows;
}
export async function findLogin(table, username) {
  await ensureLogins(table);
  const { rows: [l] } = await query(`SELECT * FROM ${table} WHERE lower(username) = $1`, [cleanUser(username)]);
  return l || null;
}
export async function addLogin(table, owner, { username, password, name, role, phone }) {
  await ensureLogins(table);
  const { rows: [row] } = await query(
    `INSERT INTO ${table} (owner, username, name, role, phone, admin_hash, starter) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [owner, cleanUser(username), String(name || '').slice(0, 80), String(role || '').slice(0, 40), digits(phone), await hashPass(password), String(password).slice(0, 40)]);
  return row;
}
export async function setLogin(table, id, owner, patch) {
  await ensureLogins(table);
  const set = [], vals = [id, owner];
  const put = (col, v) => { vals.push(v); set.push(`${col} = $${vals.length}`) };
  if (patch.password !== undefined) { put('admin_hash', await hashPass(patch.password)); put('starter', String(patch.password).slice(0, 40)); if (patch.clearOwn) put('own_hash', null); }
  if (patch.ownPassword !== undefined) { put('own_hash', await hashPass(patch.ownPassword)); put('starter', null); }
  if (patch.name !== undefined) put('name', String(patch.name).slice(0, 80));
  if (patch.role !== undefined) put('role', String(patch.role).slice(0, 40));
  if (patch.phone !== undefined) put('phone', digits(patch.phone));
  if (patch.active !== undefined) put('active', !!patch.active);
  if (!set.length) return null;
  const { rows: [row] } = await query(`UPDATE ${table} SET ${set.join(', ')} WHERE id = $1 AND owner = $2 RETURNING *`, vals);
  return row || null;
}
export async function removeLogin(table, id, owner) {
  await ensureLogins(table);
  await query(`DELETE FROM ${table} WHERE id = $1 AND owner = $2`, [id, owner]);
}
/** Either password opens it. Returns the row, or null. */
export async function checkLogin(table, username, password) {
  const l = await findLogin(table, username);
  await new Promise(r => setTimeout(r, 250));                 // slow down guessing
  if (!l || !l.active) return null;
  if (!(await passOk(password, l.own_hash)) && !(await passOk(password, l.admin_hash))) return null;
  await query(`UPDATE ${table} SET last_seen = now() WHERE id = $1`, [l.id]);
  return l;
}
/** Everyone who has no sign-in yet gets one: the whole ledger in a single pass. */
export async function inviteMany(table, people) {
  await ensureLogins(table);
  const { rows: had } = await query(`SELECT owner FROM ${table}`);
  const has = new Set(had.map(r => r.owner));
  const { rows: names } = await query(`SELECT lower(username) AS u FROM ${table}`);
  const taken = new Set(names.map(r => r.u));
  const made = [];
  for (const p of people) {
    if (has.has(p.id)) continue;
    const base = (cleanUser(String(p.name || '').split(/\s+/).slice(0, 2).join('.')) || cleanUser(p.code) || 'account').slice(0, 26);
    let username = base, n = 1;
    while (taken.has(username)) { n++; username = `${base.slice(0, 22)}${n}` }
    taken.add(username);
    const password = 'reg' + Math.random().toString(36).slice(2, 8);
    const row = await addLogin(table, p.id, { username, password, name: p.contact || p.name, role: '', phone: p.phone });
    made.push({ owner: p.id, name: p.name, phone: p.phone || '', username, password, id: Number(row.id) });
  }
  return made;
}

/** Everyone still on the password the shop gave them — the list to read out, print or text. */
export async function startersFor(table) {
  await ensureLogins(table);
  const { rows } = await query(
    `SELECT id, owner, username, name, phone, starter FROM ${table}
      WHERE starter IS NOT NULL AND own_hash IS NULL AND active ORDER BY owner, id`);
  return rows.map(r => ({ id: Number(r.id), owner: r.owner, username: r.username,
    name: r.name || '', phone: r.phone || '', password: r.starter }));
}

let catching = false;
/** After a save: anyone newly on the books gets their sign-in, so nobody has to be invited by hand. */
export async function catchUpLogins(data) {
  if (catching) return { cust: 0, sup: 0 };
  catching = true;
  try {
    const S = data?.S || {};
    const cust = await inviteMany('cust_logins', (S.customers || []).filter(c => c.id !== 1 && c.active !== false));
    const sup = await inviteMany('sup_logins', (S.suppliers || []).filter(s => s.active !== false));
    return { cust: cust.length, sup: sup.length };
  } finally { catching = false }
}

/** A user name made from who they are, kept short and free of anything awkward to type. */
export async function suggestUser(table, name, code) {
  const base = cleanUser(String(name || '').split(/\s+/).slice(0, 2).join('.')) || cleanUser(code) || 'account';
  let want = base.slice(0, 28), n = 1;
  while (await findLogin(table, want)) { n++; want = `${base.slice(0, 24)}${n}` }
  return want;
}
