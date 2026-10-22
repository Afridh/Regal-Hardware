// The customer's screen at the counter — a tablet showing regalhw.lk/count1 (count2 …).
// The till sends what is on its bill whenever it changes; the tablet asks for it about once a second.
//   POST /api/display/:screen   { data }          the till, signed in       -> { ok, rev }
//   GET  /api/display/:screen?since=<rev>         the tablet, no sign-in    -> { ok, rev, data } | { ok, rev, same: true }
// Only what the customer standing there should see is ever sent: the lines, the total, the saving, the
// change, and the customer's first name. Kept in the database, so every copy of the server answers alike.
import { Router } from 'express';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { regalAuth } from './regal.js';

const r = Router();
let ready = null;
const ensure = () => (ready = ready || query(`CREATE TABLE IF NOT EXISTS display_screens (
    screen varchar(20) PRIMARY KEY, data text NOT NULL, rev bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
  .catch(e => { ready = null; throw e; }));
const screenOf = (req) => { const s = String(req.params.screen || '').trim().toLowerCase(); if (!/^[a-z0-9-]{1,20}$/.test(s)) throw new HttpError(400, 'Bad screen'); return s; };

r.post('/:screen', regalAuth, asyncHandler(async (req, res) => {
  const screen = screenOf(req), data = req.body && req.body.data;
  if (!data || typeof data !== 'object') throw new HttpError(400, 'Nothing to show');
  const text = JSON.stringify(data); if (text.length > 200000) throw new HttpError(413, 'Too much for the screen');
  await ensure();
  const rev = Date.now();
  await query(`INSERT INTO display_screens (screen, data, rev, updated_at) VALUES ($1, $2, $3, now())
               ON CONFLICT (screen) DO UPDATE SET data = EXCLUDED.data, rev = EXCLUDED.rev, updated_at = now()`, [screen, text, rev]);
  res.json({ ok: true, rev });
}));

r.get('/:screen', asyncHandler(async (req, res) => {
  const screen = screenOf(req), since = Number(req.query.since || 0);
  await ensure();
  res.set('Cache-Control', 'no-store');
  const { rows: [row] } = await query(`SELECT data, rev FROM display_screens WHERE screen = $1`, [screen]);
  if (!row) return res.json({ ok: true, rev: 0, data: null });
  const rev = Number(row.rev);
  if (since && since === rev) return res.json({ ok: true, rev, same: true });
  res.json({ ok: true, rev, data: JSON.parse(row.data) });
}));

export default r;
