// Who is in the system right now — the Super Admin sees them at the top of the till.
// Every signed-in till says "still here" about every 30 seconds:
//   POST /api/presence   { till, view, app, gone? }   -> { ok, online?: [...] }
// The list comes back only to the Super Admin / Owner. Somebody not heard from for two minutes has gone.
// Kept in the database, so every copy of the server answers alike.
import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../lib/errors.js';
import { regalAuth } from './regal.js';

const r = Router();
const GONE_AFTER = 120000;
let ready = null;
const ensure = () => (ready = ready || query(`CREATE TABLE IF NOT EXISTS presence (
    id varchar(120) PRIMARY KEY, who varchar(80) NOT NULL, role varchar(40), till varchar(20), page varchar(40),
    app varchar(20), since bigint NOT NULL, seen bigint NOT NULL)`)
  .catch(e => { ready = null; throw e; }));
const cut = (v, n) => String(v == null ? '' : v).slice(0, n);
const boss = (role) => ['super admin', 'superadmin', 'owner'].includes(String(role || '').toLowerCase());

r.post('/', regalAuth, asyncHandler(async (req, res) => {
  const u = req.regalUser, b = req.body || {};
  if (u.isDemo) return res.json({ ok: true });
  await ensure();
  const till = cut(b.till, 20), id = cut(u.name, 80) + '|' + till, now = Date.now();
  if (b.gone) await query(`DELETE FROM presence WHERE id = $1`, [id]);
  else {
    const { rows: [old] } = await query(`SELECT since, seen FROM presence WHERE id = $1`, [id]);
    const since = old && now - Number(old.seen) < GONE_AFTER ? Number(old.since) : now;
    await query(`INSERT INTO presence (id, who, role, till, page, app, since, seen) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, page = EXCLUDED.page, app = EXCLUDED.app, since = EXCLUDED.since, seen = EXCLUDED.seen`,
      [id, cut(u.name, 80), cut(u.role, 40), till, cut(b.view, 40), cut(b.app, 20), since, now]);
  }
  if (!boss(u.role)) return res.json({ ok: true });
  await query(`DELETE FROM presence WHERE seen < $1`, [now - 24 * 3600000]);   // yesterday's leftovers
  const { rows } = await query(`SELECT who, role, till, page, app, since, seen FROM presence WHERE seen >= $1 ORDER BY who`, [now - GONE_AFTER]);
  res.json({ ok: true, now, online: rows.map(x => ({ ...x, since: Number(x.since), seen: Number(x.seen) })) });
}));

export default r;
