// Who is in the system right now — the Super Admin sees them at the top of the till.
// Every signed-in till says "still here" about every 30 seconds:
//   POST /api/presence   { till, view, app, gone? }   -> { ok, online?: [...] }
// The list comes back only to the Super Admin / Owner. Any other signed-in call marks them here too
// (lib/presence.js), so a till that has not been reloaded still shows. Kept in the database, so every
// copy of the server answers alike.
import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../lib/errors.js';
import { ensurePresence, forgetTouch, GONE_AFTER } from '../lib/presence.js';
import { regalAuth } from './regal.js';

const r = Router();
const cut = (v, n) => String(v == null ? '' : v).slice(0, n);
const boss = (role) => ['super admin', 'superadmin', 'owner'].includes(String(role || '').toLowerCase());

r.post('/', regalAuth, asyncHandler(async (req, res) => {
  const u = req.regalUser, b = req.body || {};
  if (u.isDemo) return res.json({ ok: true });
  await ensurePresence();
  const who = cut(u.name, 80), till = cut(b.till, 20), id = who + '|' + till, now = Date.now();
  if (b.gone) { await query(`DELETE FROM presence WHERE who = $1 AND (till = $2 OR till = '')`, [who, till]); forgetTouch(who); }
  else {
    const { rows: [old] } = await query(`SELECT since, seen FROM presence WHERE id = $1`, [id]);
    const { rows: [bare] } = await query(`SELECT since, seen FROM presence WHERE id = $1`, [who + '|']);
    const was = [old, bare].filter(x => x && now - Number(x.seen) < GONE_AFTER).map(x => Number(x.since));
    const since = was.length ? Math.min(...was) : now;
    await query(`INSERT INTO presence (id, who, role, till, page, app, since, seen) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, page = EXCLUDED.page, app = EXCLUDED.app, since = EXCLUDED.since, seen = EXCLUDED.seen`,
      [id, who, cut(u.role, 40), till, cut(b.view, 40), cut(b.app, 20), since, now]);
    if (till) await query(`DELETE FROM presence WHERE id = $1`, [who + '|']);   // the till is known now: one row for it
  }
  if (!boss(u.role)) return res.json({ ok: true });
  await query(`DELETE FROM presence WHERE seen < $1`, [now - 24 * 3600000]);   // yesterday's leftovers
  const { rows } = await query(`SELECT who, role, till, page, app, since, seen FROM presence WHERE seen >= $1 ORDER BY who`, [now - GONE_AFTER]);
  res.json({ ok: true, now, online: rows.map(x => ({ ...x, since: Number(x.since), seen: Number(x.seen) })) });
}));

export default r;
