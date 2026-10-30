// The customer's screen at the counter — a tablet showing regalhw.lk/count1 (count2 …).
// The till sends what is on its bill whenever it changes; the tablet asks, and with ?wait=1 the server holds
// the question until the bill changes (or 20 s pass) — so it is up to date at once, yet asks ~3 times a minute.
// (It used to ask every 0.9 s, all day, from the shop's one address: part of what the hosting firewall blocked
// as a bot on 30 Oct 2026.)
//   POST /api/display/:screen   { data }          the till, signed in       -> { ok, rev }
//   GET  /api/display/:screen?since=<rev>         the tablet, no sign-in    -> { ok, rev, data } | { ok, rev, same: true }
// Only what the customer standing there should see is ever sent: the lines, the total, the saving, the
// change, and the customer's first name. Kept in the database, so every copy of the server answers alike.
import { Router } from 'express';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { regalAuth } from './regal.js';
import { EventEmitter } from 'node:events';

const bus = new EventEmitter(); bus.setMaxListeners(200);   // a screen's question is answered the moment its till sends

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
  bus.emit('s:' + screen);
  res.json({ ok: true, rev });
}));

r.get('/:screen', asyncHandler(async (req, res) => {
  const screen = screenOf(req), since = Number(req.query.since || 0);
  await ensure();
  res.set('Cache-Control', 'no-store');
  const read = async () => (await query(`SELECT data, rev FROM display_screens WHERE screen = $1`, [screen])).rows[0];
  let row = await read();
  // nothing new and the tablet will wait: hold the answer until the till sends (this copy of the server hears it
  // at once; another copy is caught by a look every 3 s) or 20 s pass, or the tablet goes
  if (req.query.wait && since && row && Number(row.rev) === since) {
    await new Promise(done => { let over = false;
      const fin = () => { if (over) return; over = true; clearTimeout(t); clearInterval(iv); bus.off('s:' + screen, fin); done(); };
      const t = setTimeout(fin, 20000);
      const iv = setInterval(() => read().then(x => { if (x && Number(x.rev) !== since) fin(); }, () => {}), 3000);
      bus.on('s:' + screen, fin); req.on('close', fin); });
    if (res.writableEnded || req.destroyed) return;
    row = await read();
  }
  if (!row) return res.json({ ok: true, rev: 0, data: null });
  const rev = Number(row.rev);
  if (since && since === rev) return res.json({ ok: true, rev, same: true });
  res.json({ ok: true, rev, data: JSON.parse(row.data) });
}));

export default r;
