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
      CREATE UNIQUE INDEX IF NOT EXISTS ${table}_user ON ${table} (lower(username))`)
      .catch(e => { ready.delete(table); throw e; }));
  }
  return ready.get(table);
}

export const hashPass = (p) => bcrypt.hash(String(p), 10);
export const passOk = (p, h) => (h ? bcrypt.compare(String(p || ''), h).catch(() => false) : Promise.resolve(false));
export const cleanUser = (u) => String(u || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
export const digits = (s) => String(s || '').replace(/\D/g, '');
/** What the till is shown: never a hash, only whether they have set one of their own. */
export const loginLine = (l) => ({ id: Number(l.id), owner: l.owner, username: l.username, name: l.name || '',
  role: l.role || '', phone: l.phone || '', active: l.active, own: !!l.own_hash, lastSeen: l.last_seen });

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
    `INSERT INTO ${table} (owner, username, name, role, phone, admin_hash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [owner, cleanUser(username), String(name || '').slice(0, 80), String(role || '').slice(0, 40), digits(phone), await hashPass(password)]);
  return row;
}
export async function setLogin(table, id, owner, patch) {
  await ensureLogins(table);
  const set = [], vals = [id, owner];
  const put = (col, v) => { vals.push(v); set.push(`${col} = $${vals.length}`) };
  if (patch.password !== undefined) { put('admin_hash', await hashPass(patch.password)); if (patch.clearOwn) put('own_hash', null); }
  if (patch.ownPassword !== undefined) put('own_hash', await hashPass(patch.ownPassword));
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
/** A user name made from who they are, kept short and free of anything awkward to type. */
export async function suggestUser(table, name, code) {
  const base = cleanUser(String(name || '').split(/\s+/).slice(0, 2).join('.')) || cleanUser(code) || 'account';
  let want = base.slice(0, 28), n = 1;
  while (await findLogin(table, want)) { n++; want = `${base.slice(0, 24)}${n}` }
  return want;
}
