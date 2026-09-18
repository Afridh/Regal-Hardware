// Node implementation of the Shift Board's `shift-api.php` contract, so the embedded attendance
// board (inside app/index.html) shares one set of punches across every PC instead of localStorage.
//   GET  /shift-api.php?action=state            -> { ok, rev, role, state }
//   POST /shift-api.php?action=login            { user, password } -> { ok, token, user, role }
//   POST /shift-api.php?action=state            { baseRev, state } -> { ok, rev } | { ok:false, conflict, rev, state }
//   POST /shift-api.php?action=day              { date, empId, rec|null, sentDay } -> { ok, rev }
//   POST /shift-api.php?action=sms              { to, message, sender } -> { ok } | { ok:false, error }
//   POST /shift-api.php?action=report           { date, html } -> { ok, url }
//   POST /shift-api.php?action=password         { current, new, user } -> { ok }
//   POST /shift-api.php?action=logout
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { query, withTransaction } from '../db.js';
import { asyncHandler } from '../lib/errors.js';
import { sendViaProvider } from './regal.js';

const r = Router();
const KEY = 'shiftboard';
const here = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.resolve(here, '../../../app/reports');

const fail = (res, status, error) => res.status(status).json({ ok: false, error });

function whoami(req) {
  const t = req.headers['x-shift-token'];
  if (!t) return null;
  try { const p = jwt.verify(t, process.env.JWT_SECRET); return p.kind === 'shift' ? p : null; } catch { return null; }
}

async function current() {
  const { rows: [row] } = await query(`SELECT rev, data FROM books WHERE key = $1`, [KEY]);
  return { rev: row ? Number(row.rev) : 0, state: row?.data || null };
}

async function save(client, state, by) {
  const { rows: [cur] } = await client.query(`SELECT rev FROM books WHERE key = $1 FOR UPDATE`, [KEY]);
  const next = (cur ? Number(cur.rev) : 0) + 1;
  await client.query(
    `INSERT INTO books (key, rev, data, updated_at, updated_by) VALUES ($1,$2,$3,now(),$4)
     ON CONFLICT (key) DO UPDATE SET rev = EXCLUDED.rev, data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [KEY, next, JSON.stringify(state), by]);
  return next;
}

r.all('/shift-api.php', asyncHandler(async (req, res) => {
  const action = String(req.query.action || '');
  const body = req.body || {};

  if (action === 'login') {
    const { user, password } = body;
    const { rows: [u] } = await query(`SELECT * FROM shift_users WHERE lower(username) = lower($1)`, [String(user || '')]);
    if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) return fail(res, 401, 'Wrong username or password');
    const token = jwt.sign({ kind: 'shift', user: u.username, role: u.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    return res.json({ ok: true, token, user: u.username, role: u.role });
  }

  const me = whoami(req);
  if (!me) return fail(res, 401, 'Not signed in');

  if (action === 'logout') return res.json({ ok: true });

  if (action === 'state' && req.method === 'GET') {
    const { rev, state } = await current();
    return res.json({ ok: true, rev, role: me.role, state });
  }

  if (action === 'state' && req.method === 'POST') {
    if (me.role !== 'owner') return fail(res, 403, 'Only the owner can save the whole board');
    const out = await withTransaction(async client => {
      const { rows: [cur] } = await client.query(`SELECT rev, data FROM books WHERE key = $1 FOR UPDATE`, [KEY]);
      const curRev = cur ? Number(cur.rev) : 0;
      if (cur && body.baseRev !== undefined && Number(body.baseRev) !== curRev) return { conflict: true, rev: curRev, state: cur.data };
      return { conflict: false, rev: await save(client, body.state || {}, me.user) };
    });
    if (out.conflict) return res.json({ ok: false, conflict: true, rev: out.rev, state: out.state });
    return res.json({ ok: true, rev: out.rev });
  }

  if (action === 'day') {
    const { date, empId, rec, sentDay } = body;
    if (!date || !empId) return fail(res, 400, 'date and empId required');
    const rev = await withTransaction(async client => {
      const { rows: [cur] } = await client.query(`SELECT data FROM books WHERE key = $1 FOR UPDATE`, [KEY]);
      const state = cur?.data || { v: 1, settings: {}, employees: [], days: {}, ledger: [], holidays: [], messages: [], sentDays: {} };
      state.days = state.days || {};
      if (rec === null || rec === undefined) {
        if (state.days[date]) { delete state.days[date][empId]; if (!Object.keys(state.days[date]).length) delete state.days[date]; }
      } else {
        state.days[date] = state.days[date] || {};
        state.days[date][empId] = rec;
      }
      if (sentDay) { state.sentDays = state.sentDays || {}; state.sentDays[date] = true; }
      state.updatedAt = new Date().toISOString();
      return save(client, state, me.user);
    });
    return res.json({ ok: true, rev });
  }

  if (action === 'sms') {
    if (me.role !== 'owner') return fail(res, 403, 'Only the owner can send messages');
    const { rows: [regal] } = await query(`SELECT data FROM books WHERE key = 'regal'`);
    const cfg = { ...(regal?.data?.CFG?.msg || {}) };
    if (body.sender) cfg.sender = body.sender;
    if (!cfg.live) return fail(res, 400, 'Sending is switched off in Settings → Messaging');
    try { await sendViaProvider(cfg, body.to, body.message); return res.json({ ok: true }); }
    catch (e) { return fail(res, 502, e.message); }
  }

  if (action === 'report') {
    const { date, html } = body;
    if (!date || !html) return fail(res, 400, 'date and html required');
    fs.mkdirSync(reportsDir, { recursive: true });
    const name = `day-${String(date).replace(/[^0-9-]/g, '')}-${randomBytes(4).toString('hex')}.html`;
    fs.writeFileSync(path.join(reportsDir, name), String(html), 'utf8');
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    return res.json({ ok: true, url: `${base}/reports/${name}` });
  }

  if (action === 'password') {
    const target = (me.role === 'owner' && body.user === 'supervisor') ? 'supervisor' : me.user;
    const { rows: [u] } = await query(`SELECT * FROM shift_users WHERE username = $1`, [target]);
    if (!u) return fail(res, 404, 'No such login');
    if (target === me.user && !(await bcrypt.compare(String(body.current || ''), u.password_hash))) return fail(res, 400, 'Current password is wrong');
    if (!body.new || String(body.new).length < 6) return fail(res, 400, 'Use at least 6 characters');
    await query(`UPDATE shift_users SET password_hash = $2 WHERE username = $1`, [target, await bcrypt.hash(String(body.new), 10)]);
    return res.json({ ok: true });
  }

  return fail(res, 400, 'Unknown action');
}));

export default r;
