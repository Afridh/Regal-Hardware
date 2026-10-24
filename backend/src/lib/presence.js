// Who is in the system right now. Two ways a till is marked as here:
//   - its own "still here" every 30 seconds (with the till, page and app), from routes/presence.js
//   - any signed-in call at all (the books are polled every few seconds), from regalAuth — so a till that
//     has not been reloaded since the badge came in still shows, the moment its person signs in.
// Somebody not heard from for two minutes has gone.
import { query } from '../db.js';

export const GONE_AFTER = 120000;
let ready = null;
export const ensurePresence = () => (ready = ready || query(`CREATE TABLE IF NOT EXISTS presence (
    id varchar(120) PRIMARY KEY, who varchar(80) NOT NULL, role varchar(40), till varchar(20), page varchar(40),
    app varchar(20), since bigint NOT NULL, seen bigint NOT NULL)`)
  .catch(e => { ready = null; throw e; }));
const cut = (v, n) => String(v == null ? '' : v).slice(0, n);

// a signed-in call: keep their rows fresh, or put them on the list (at most once every 20 seconds each)
const lastTouch = new Map();
export function touchPresence(u) {
  if (!u || !u.name || u.isDemo) return;
  const who = cut(u.name, 80), now = Date.now();
  if (now - (lastTouch.get(who) || 0) < 20000) return;
  lastTouch.set(who, now);
  (async () => {
    await ensurePresence();
    const { rows } = await query(`SELECT id, seen FROM presence WHERE who = $1`, [who]);
    const live = rows.filter(x => now - Number(x.seen) < GONE_AFTER);
    if (live.length) await query(`UPDATE presence SET seen = $1, role = $2 WHERE who = $3 AND seen >= $4`, [now, cut(u.role, 40), who, now - GONE_AFTER]);
    else await query(`INSERT INTO presence (id, who, role, till, page, app, since, seen) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, since = EXCLUDED.since, seen = EXCLUDED.seen`,
      [who + '|', who, cut(u.role, 40), '', '', '', now, now]);
  })().catch(e => { lastTouch.delete(who); console.error('presence', e.message); });
}
export const forgetTouch = (who) => lastTouch.delete(String(who || ''));
