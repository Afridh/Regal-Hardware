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
// on a serverless host the code directory is read-only; /tmp is the only writable place
export const reportsDir = process.env.VERCEL ? '/tmp/regal-reports' : path.resolve(here, '../../../app/reports');

const fail = (res, status, error) => res.status(status).json({ ok: false, error });

/** A shift token, or the till's own sign-in — so the ERP reads the board without a second login. */
function whoami(req) {
  const t = req.headers['x-shift-token'];
  if (t) {
    try { const p = jwt.verify(t, process.env.JWT_SECRET); if (p.kind === 'shift') return p; } catch { /* fall through */ }
  }
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const p = jwt.verify(h.slice(7), process.env.JWT_SECRET);
      if (p.kind === 'regal') {
        const perms = p.perms || [];
        const owner = p.role === 'Owner' || perms.includes('payroll') || perms.includes('settings');
        return { kind: 'shift', user: p.name, role: owner ? 'owner' : 'supervisor', viaTill: true };
      }
    } catch { /* not signed in */ }
  }
  return null;
}

/* A supervisor is given the attendance without any money in it — the wages are taken out here,
   on the server, rather than merely hidden on the page. Same list as shift-api.php. */
function redactForSupervisor(state) {
  if (!state || typeof state !== 'object') return state;
  const s = { ...state };
  delete s.advances; delete s.adjustments; delete s.ledger; delete s.messages; delete s.auth;
  if (Array.isArray(s.employees)) s.employees = s.employees.map(e => {
    const c = { ...e }; ['rate', 'payType', 'otMult', 'pin'].forEach(k => delete c[k]); return c;
  });
  if (s.settings) {
    s.settings = { ...s.settings };
    ['adminPin', 'smsSecret', 'smsRelayUrl', 'latePerMin', 'workDaysPerMonth', 'ownerPhone'].forEach(k => delete s.settings[k]);
  }
  return s;
}

let photosReady = null;
function ensurePhotos() {
  if (!photosReady) photosReady = query(
    `CREATE TABLE IF NOT EXISTS shift_photos (
       id varchar(40) PRIMARY KEY, day date NOT NULL, mime varchar(40) NOT NULL,
       data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`).catch(e => { photosReady = null; throw e; });
  return photosReady;
}

const toMin = (t) => { const [h, m] = String(t).split(':'); return (+h) * 60 + (+m) };

/* The fingerprint terminal's raw punches, made into a day the same way the board's CSV import does:
   the first read is the arrival, the last the departure, and pairs in between are breaks matched to
   whichever scheduled break they are nearest. A day someone has edited by hand is left alone. */
function dayFromPunches(times, state, existing) {
  const sorted = [...times].sort();
  const clean = [];
  for (const t of sorted) {                                   // a second read within two minutes is the same punch
    if (!clean.length || toMin(t) - toMin(clean[clean.length - 1]) >= 2) clean.push(t);
  }
  if (!clean.length) return null;
  if (existing && existing.src !== 'device') return null;     // hand-written records are never overwritten
  const rec = { status: 'work', in: clean[0], out: clean.length > 1 ? clean[clean.length - 1] : null,
                breaks: [], src: 'device', note: 'From the fingerprint machine' };
  if (clean.length > 3) {
    const defs = ((state.settings || {}).breaks || []).filter(b => b.start).map(b => ({ id: String(b.id), at: toMin(b.start) }));
    const mid = clean.slice(1, -1), used = [];
    for (let i = 0; i + 1 < mid.length; i += 2) {
      const at = toMin(mid[i]);
      let id = 'other-' + at, best = 46;
      for (const d of defs) {
        if (used.includes(d.id)) continue;
        const gap = Math.abs(at - d.at);
        if (gap < best) { best = gap; id = d.id }
      }
      if (!id.startsWith('other-')) used.push(id);
      rec.breaks.push({ id, start: mid[i], end: mid[i + 1] });
    }
  }
  return rec;
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
    const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
    let u = null;
    try {
      const { rows } = await query(`SELECT * FROM shift_users WHERE lower(username) = lower($1)`, [String(user || '')]);
      u = rows[0] || null;
    } catch {}

    if (String(user || '').toLowerCase() === 'admin') {
      if (String(password || '') === adminPass || (u && await bcrypt.compare(String(password || ''), u.password_hash))) {
        const token = jwt.sign({ kind: 'shift', user: 'admin', role: 'owner' }, process.env.JWT_SECRET, { expiresIn: '30d' });
        return res.json({ ok: true, token, user: 'admin', role: 'owner' });
      }
    }
    if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) return fail(res, 401, 'Wrong username or password');
    const token = jwt.sign({ kind: 'shift', user: u.username, role: u.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    return res.json({ ok: true, token, user: u.username, role: u.role });
  }

  /* The fingerprint machine on the shop PC: its own key, so that PC never holds a password.
     It may post punches and nothing else — it cannot read wages or settings. */
  if (action === 'punches') {
    const key = process.env.SHIFT_DEVICE_KEY || '';
    if (!key || String(body.key || '') !== key) return fail(res, 403, 'Wrong device key');
    const date = String(body.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 400, 'Bad date');
    const events = Array.isArray(body.events) ? body.events : [];
    if (!events.length) return res.json({ ok: true, written: 0, skipped: 0, unmatched: [] });

    const out = await withTransaction(async client => {
      const { rows: [cur] } = await client.query(`SELECT rev, data FROM books WHERE key = $1 FOR UPDATE`, [KEY]);
      const state = cur?.data;
      if (!state || !Array.isArray(state.employees) || !state.employees.length)
        return { error: 'Nobody is on the board yet — open Attendance once and add the staff' };
      state.days = state.days || {};

      const byDevice = {};
      for (const e of state.employees) {
        if (e.deviceId) byDevice[String(e.deviceId).trim().toUpperCase()] = e.id;
        if (e.barcode) byDevice[String(e.barcode).trim().toUpperCase()] = e.id;
      }
      const grouped = {}, unmatched = new Set();
      for (const ev of events) {
        const id = String(ev.id || '').trim().toUpperCase();
        let tm = String(ev.time || '').trim();
        if (/^\d:\d\d$/.test(tm)) tm = '0' + tm;
        if (!id || !/^([01]\d|2[0-3]):[0-5]\d$/.test(tm)) continue;
        if (!byDevice[id]) { unmatched.add(id); continue }
        (grouped[byDevice[id]] = grouped[byDevice[id]] || []).push(tm);
      }
      let written = 0, skipped = 0;
      for (const [empId, times] of Object.entries(grouped)) {
        const rec = dayFromPunches(times, state, (state.days[date] || {})[empId]);
        if (!rec) { skipped++; continue }
        state.days[date] = state.days[date] || {};
        state.days[date][empId] = rec;
        written++;
      }
      if (written) { state.updatedAt = new Date().toISOString(); await save(client, state, 'fingerprint'); }
      return { written, skipped, unmatched: [...unmatched] };
    });
    if (out.error) return fail(res, 409, out.error);
    return res.json({ ok: true, ...out });
  }

  const me = whoami(req);
  if (!me) return fail(res, 401, 'Not signed in');

  if (action === 'logout') return res.json({ ok: true });

  if (action === 'state' && req.method === 'GET') {
    const { rev, state } = await current();
    return res.json({ ok: true, rev, role: me.role, user: me.user, state: me.role === 'owner' ? state : redactForSupervisor(state) });
  }

  /* A snapshot taken as someone clocked in or out. Kept out of the shared state so the records
     stay small, and in the database so it works on a hosted server as well as the shop PC. */
  if (action === 'photo' && req.method === 'POST') {
    const date = String(body.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 400, 'Bad date');
    const m = /^data:(image\/jpeg|image\/png);base64,/.exec(String(body.data || ''));
    if (!m) return fail(res, 400, 'Expected a JPEG or PNG');
    const raw = Buffer.from(String(body.data).slice(String(body.data).indexOf(',') + 1), 'base64');
    if (raw.length < 200) return fail(res, 400, 'That image did not decode');
    if (raw.length > 400000) return fail(res, 400, 'That image is too big');
    await ensurePhotos();
    const id = `${date.slice(0, 7)}-${randomBytes(8).toString('hex')}`;
    await query(`INSERT INTO shift_photos (id, day, mime, data) VALUES ($1,$2,$3,$4)`, [id, date, m[1], raw]);
    await query(`DELETE FROM shift_photos WHERE day < current_date - $1::int`, [Number(process.env.SHIFT_PHOTO_DAYS || 120)]);
    return res.json({ ok: true, id });
  }

  if (action === 'photo' && req.method === 'GET') {
    const id = String(req.query.id || '');
    if (!/^\d{4}-\d{2}-[0-9a-f]{16}$/.test(id)) return fail(res, 400, 'Bad photo id');
    await ensurePhotos();
    const { rows: [p] } = await query(`SELECT mime, data FROM shift_photos WHERE id = $1`, [id]);
    if (!p) return fail(res, 404, 'No such photo');
    return res.json({ ok: true, data: `data:${p.mime};base64,${p.data.toString('base64')}` });
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
