// API for the Regal front-end (app/index.html): the books document store, sign-in, SMS relay.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { matches, demoPassword } from '../services/regalHash.js';
import { injectInbox, markImported, pendingCount } from './shop.js';

const r = Router();
const BOOKS_KEY = 'regal';
const HISTORY_KEEP = 200;
const LOCAL_KEYS = ['user', 'pos', 'view', 'terminal', 'held', 'portal', 'cportal', 'phoneOpen', 'phoneMode', 'notifOpen', 'signedOut', 'drawer', '_fromStore', 'locId'];

function sign(user) {
  return jwt.sign({ kind: 'regal', name: user.name, role: user.role, perms: user.perms || [] }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '12h' });
}

/** Bearer-token guard for the books API. */
export function regalAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'Sign in first');
    const p = jwt.verify(token, process.env.JWT_SECRET);
    if (p.kind !== 'regal') throw new HttpError(401, 'Wrong kind of token');
    req.regalUser = p;
    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return next(new HttpError(401, 'Session expired'));
    next(e);
  }
}

async function loadBooks(key = BOOKS_KEY) {
  const { rows: [row] } = await query(`SELECT key, rev, data, updated_at, updated_by FROM books WHERE key = $1`, [key]);
  return row || null;
}

/** Users are kept inside the books document (S.users) so the shop manages them in its own screen. */
async function usersFromBooks() {
  const row = await loadBooks();
  const users = row?.data?.S?.users;
  return Array.isArray(users) ? users : [];
}

// ---------------------------------------------------------------- sign in
r.post('/books/login', asyncHandler(async (req, res) => {
  const { user, password } = req.body || {};
  if (!user || typeof password !== 'string') throw new HttpError(400, 'Name and password required');
  const users = await usersFromBooks();
  const u = users.find(x => String(x.name).toLowerCase() === String(user).toLowerCase());
  if (users.length) {
    if (!u || u.active === false) throw new HttpError(401, 'That name cannot sign in');
    if (!matches(u, password)) throw new HttpError(401, 'That password is not right');
    return res.json({ ok: true, token: sign(u), user: { name: u.name, role: u.role, perms: u.perms || [] } });
  }
  // Bootstrap: no books saved yet.  Accept the bootstrap password or the demo convention so the first
  // browser can sign in and push the seed books up; from then on the stored users are authoritative.
  const boot = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  if (password === boot || password === demoPassword(user)) {
    return res.json({ ok: true, token: sign({ name: user, role: 'Owner', perms: [] }), user: { name: user, role: 'Owner', perms: [] }, bootstrap: true });
  }
  throw new HttpError(401, 'That password is not right');
}));

r.get('/books/me', regalAuth, (req, res) => res.json({ ok: true, user: req.regalUser }));

/** Names + roles only, for the lock screen of a browser that has never opened the books. */
r.get('/books/users', asyncHandler(async (_req, res) => {
  const users = await usersFromBooks();
  res.json({ users: users.filter(u => u.active !== false).map(u => ({ name: u.name, role: u.role, uid: u.uid || '', pin: u.pin ? true : false })) });
}));

// ---------------------------------------------------------------- books document
// Online orders from the public site wait in their own table until a till has saved them into the
// books: a read hands them over (inbox), a save that contains them marks them done (see shop.js).
/** A stamp that changes whenever the app's files change, so an open till knows a newer version is on the server. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../app');
export function appBuild() {
  try { return String(Math.max(...['index.html', 'regal-bridge.js', 'regal-ext.js'].map(f => Math.floor(fs.statSync(path.join(appDir, f)).mtimeMs)))); }
  catch { return process.env.VERCEL_GIT_COMMIT_SHA || 'static'; }
}

r.get('/books/:key/rev', regalAuth, asyncHandler(async (req, res) => {
  const row = await loadBooks(req.params.key);
  const inbox = req.params.key === BOOKS_KEY ? await pendingCount() : 0;
  res.json({ rev: row ? Number(row.rev) : 0, updated_at: row?.updated_at || null, updated_by: row?.updated_by || null, inbox, build: appBuild() });
}));

r.get('/books/:key', regalAuth, asyncHandler(async (req, res) => {
  const row = await loadBooks(req.params.key);
  if (!row || !row.data) return res.json({ rev: 0, data: null });
  const inbox = req.params.key === BOOKS_KEY ? await injectInbox(row.data) : 0;
  res.json({ rev: Number(row.rev), data: row.data, updated_at: row.updated_at, updated_by: row.updated_by, inbox });
}));

/** Save.  body: { data, rev }  — rev is the revision the client loaded; a mismatch returns 409 with the newer copy. */
r.put('/books/:key', regalAuth, asyncHandler(async (req, res) => {
  const { data, rev } = req.body || {};
  if (!data || typeof data !== 'object') throw new HttpError(400, 'No data');
  const key = req.params.key;
  // per-till screen state never belongs in the shared books (the bridge strips these too)
  if (data.S && typeof data.S === 'object') for (const k of LOCAL_KEYS) delete data.S[k];
  const out = await withTransaction(async client => {
    const { rows: [cur] } = await client.query(`SELECT rev, data FROM books WHERE key = $1 FOR UPDATE`, [key]);
    const curRev = cur ? Number(cur.rev) : 0;
    if (cur && rev !== undefined && rev !== null && Number(rev) !== curRev) {
      return { conflict: true, rev: curRev, data: cur.data };
    }
    const next = curRev + 1;
    await client.query(
      `INSERT INTO books (key, rev, data, updated_at, updated_by) VALUES ($1,$2,$3,now(),$4)
       ON CONFLICT (key) DO UPDATE SET rev = EXCLUDED.rev, data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, next, JSON.stringify(data), req.regalUser.name]);
    await client.query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ($1,$2,$3,$4)`, [key, next, JSON.stringify(data), req.regalUser.name]);
    await client.query(`DELETE FROM books_history WHERE key = $1 AND id NOT IN (SELECT id FROM books_history WHERE key = $1 ORDER BY id DESC LIMIT ${HISTORY_KEEP})`, [key]);
    return { conflict: false, rev: next };
  });
  if (out.conflict) {
    const inbox = key === BOOKS_KEY ? await injectInbox(out.data) : 0;
    return res.status(409).json({ error: 'Someone else saved first', rev: out.rev, data: out.data, inbox });
  }
  if (key === BOOKS_KEY) await markImported(data);
  res.json({ ok: true, rev: out.rev });
}));

r.delete('/books/:key', regalAuth, asyncHandler(async (req, res) => {
  if (req.regalUser.role !== 'Owner') throw new HttpError(403, 'Only the owner can clear the books');
  await query(`DELETE FROM books WHERE key = $1`, [req.params.key]);
  res.json({ ok: true });
}));

r.get('/books/:key/history', regalAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT id, rev, saved_at, saved_by FROM books_history WHERE key = $1 ORDER BY id DESC LIMIT 50`, [req.params.key]);
  res.json(rows);
}));

r.post('/books/:key/restore/:rev', regalAuth, asyncHandler(async (req, res) => {
  if (req.regalUser.role !== 'Owner') throw new HttpError(403, 'Only the owner can restore');
  const { rows: [h] } = await query(`SELECT data FROM books_history WHERE key = $1 AND rev = $2`, [req.params.key, req.params.rev]);
  if (!h) throw new HttpError(404, 'No such revision');
  const { rows: [cur] } = await query(`SELECT rev FROM books WHERE key = $1`, [req.params.key]);
  const next = (cur ? Number(cur.rev) : 0) + 1;
  await query(`UPDATE books SET rev = $2, data = $3, updated_at = now(), updated_by = $4 WHERE key = $1`, [req.params.key, next, JSON.stringify(h.data), req.regalUser.name]);
  res.json({ ok: true, rev: next });
}));

// ---------------------------------------------------------------- SMS relay (keeps the provider call off the browser)
export async function sendViaProvider(cfg, to, message) {
  if (!cfg || !cfg.apiUrl || !cfg.apiKey) throw new HttpError(400, 'SMS provider is not set up (Settings → Messaging)');
  const contact = String(to).replace(/[^\d+]/g, '').replace(/^0/, '94');
  const body = cfg.provider === 'smslenz.lk'
    ? { user_id: cfg.userId || '', api_key: cfg.apiKey, sender_id: cfg.sender, contact, message }
    : { to: contact, from: cfg.sender, text: message, key: cfg.apiKey };
  const resp = await fetch(cfg.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await resp.text();
  if (!resp.ok) throw new HttpError(502, `Provider ${resp.status}: ${text.slice(0, 200)}`);
  return text;
}

r.post('/sms/send', regalAuth, asyncHandler(async (req, res) => {
  const { to, message } = req.body || {};
  if (!to || !message) throw new HttpError(400, 'to and message required');
  const row = await loadBooks();
  const cfg = row?.data?.CFG?.msg;
  if (!cfg?.live) return res.json({ ok: false, status: 'Queued (sending is off in Settings → Messaging)' });
  try {
    const out = await sendViaProvider(cfg, to, message);
    res.json({ ok: true, status: 'Sent', response: out.slice(0, 200) });
  } catch (e) {
    res.json({ ok: false, status: 'Failed — ' + e.message });
  }
}));

export default r;
