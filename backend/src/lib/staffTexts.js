// Texts to a member of staff about their own day, sent the moment the punch reaches the server — from
// the shift clock (regalhw.lk/shift), the fingerprint machine or the till's attendance board alike:
//   checked in        "you checked in at 8:02 am" (and how late, past the start and the grace)
//   checked out       "you checked out at 6:05 pm. Worked 9 h 10 min today."
//   late from a break "you were back from Lunch at 1:42 pm, 12 min late (30 min allowed, took 42)"
// Only for today, so correcting an old day sends nothing. Each can be switched off in Settings →
// Attendance (CFG.msg.staffIn / staffOut / staffBreakLate), and nothing goes when sending is off.
import { letter } from './letter.js';

const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const nice = (t) => { const m = toMin(t), h = Math.floor(m / 60) % 24, mm = String(m % 60).padStart(2, '0'); return `${h % 12 || 12}:${mm} ${h < 12 ? 'am' : 'pm'}`; };
const dur = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; };
export const shopToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });

/* the mobile for a member of staff: their staff card, or the user they sign in as */
function phoneOf(S, e) {
  const raw = e.phone || (S.users || []).find(u => u && (u.name === e.userName || u.name === e.name))?.phone || '';
  let d = String(raw).replace(/\D/g, ''); if (d.startsWith('94') && d.length === 11) d = '0' + d.slice(2);
  return /^07\d{8}$/.test(d) ? d : '';
}

/** What this punch should tell the person — compares the day as it was (prev) with the day now (next). */
export function staffTexts(data, date, empId, prev, next) {
  const S = data?.S || {}, CFG = data?.CFG || {}, msg = CFG.msg || {};
  if (!next || date !== shopToday() || !msg.live) return [];
  const e = (S.employees || []).find(x => x && String(x.id) === String(empId));
  if (!e || e.active === false) return [];
  const to = phoneOf(S, e); if (!to) return [];
  const set = (S.shift && S.shift.settings) || {}, first = String(e.name || '').split(' ')[0];
  const out = [];
  if (msg.staffIn !== false && next.in && !(prev && prev.in)) {
    const late = toMin(next.in) - toMin(set.startTime || '08:00') - (+set.graceMin || 0);
    out.push(`${first}, you checked in at ${nice(next.in)}.${late > 0 ? ` That is ${dur(late)} late.` : ''}`);
  }
  if (msg.staffBreakLate !== false) {
    for (const b of (next.breaks || [])) {
      if (!b || !b.end) continue;
      const was = (prev && prev.breaks || []).find(x => x && (x.id === b.id) && x.start === b.start);
      if (was && was.end) continue;                                    // ended before: already told
      const def = (set.breaks || []).find(x => x && x.id === b.id);
      if (!def) continue;
      const allow = (+def.mins || Math.max(0, toMin(def.end) - toMin(def.start))) + (+def.extra || 0);
      const took = toMin(b.end) - toMin(b.start);
      if (allow && took > allow) out.push(`${first}, you were back from ${b.name || def.name} at ${nice(b.end)}, ${dur(took - allow)} late (${allow} min allowed, you took ${took}).`);
    }
  }
  if (msg.staffOut !== false && next.out && !(prev && prev.out) && next.in) {
    const brk = (next.breaks || []).reduce((a, b) => a + (b && b.end && b.start ? Math.max(0, toMin(b.end) - toMin(b.start)) : 0), 0);
    out.push(`${first}, you checked out at ${nice(next.out)}. Worked ${dur(toMin(next.out) - toMin(next.in) - brk)} today.`);
  }
  return out.map(body => ({ to, body: letter(CFG, 'staff', body), name: e.name }));
}

/** Everyone on a break right now who has gone past what it allows and has not been warned for this break. */
export function breakOverTexts(data, nowMs = Date.now()) {
  const S = data?.S || {}, CFG = data?.CFG || {}, msg = CFG.msg || {};
  if (!msg.live || msg.staffBreakOver === false) return [];
  const date = shopToday(), day = (S.shift && S.shift.days && S.shift.days[date]) || {};
  const set = (S.shift && S.shift.settings) || {};
  const nowM = (() => { const p = new Date(nowMs).toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo', hour12: false }).split(':'); return (+p[0]) * 60 + (+p[1]); })();
  const out = [];
  for (const [empId, r] of Object.entries(day)) {
    if (!r || !r.in || r.out) continue;
    const b = (r.breaks || []).find(x => x && !x.end); if (!b || b.warnedAt) continue;
    const def = (set.breaks || []).find(x => x && x.id === b.id);
    const allow = def ? (+def.mins || Math.max(0, toMin(def.end) - toMin(def.start))) + (+def.extra || 0) : 0;
    if (!allow) continue;
    const away = b.startAt ? Math.floor((nowMs - Number(b.startAt)) / 60000) : nowM - toMin(b.start);
    if (away <= allow) continue;
    const e = (S.employees || []).find(x => x && String(x.id) === String(empId)); if (!e || e.active === false) continue;
    const to = phoneOf(S, e); if (!to) continue;
    const first = String(e.name || '').split(' ')[0], what = b.name || (def && def.name) || 'break';
    out.push({ to, empId: String(empId), date, start: b.start, name: e.name,
      body: letter(CFG, 'staff', `${first}, your ${what} break time is over — ${allow} min allowed, you have been away ${away} min. Please come back now.`) });
  }
  return out;
}

/** Send them, one after another, without holding up the punch. */
export function sendStaffTexts(data, list, send) {
  if (!list || !list.length) return;
  const cfg = { ...((data && data.CFG && data.CFG.msg) || {}) };
  (async () => { for (const t of list) { try { await send(cfg, t.to, t.body); } catch (e) { console.warn('staff text to', t.name, 'not sent:', e.message); } } })();
}
