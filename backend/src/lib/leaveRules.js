// The leave rules the till keeps (People → Leave, Settings → Leave), checked the same way on the server
// for a request made at the shift clock: how many may be off on one day, the days a month for each group,
// and the Poya day — counted in the month's days, on top of them, or a working day.
export const LV_DEF = { perEmp: 4, perDir: 0, poya: 'within', dayAsk: 1, dayApprove: 2, sepGroups: true, groups: {}, poyaDays: {} };
export const LEAVE_TYPES = [['annual', 'Annual'], ['casual', 'Casual'], ['sick', 'Sick'], ['other', 'Other']];

export function leaveCfg(CFG) {
  const c = { ...LV_DEF, ...((CFG && CFG.leave) || {}) };
  c.groups = c.groups || {}; c.poyaDays = c.poyaDays || {};
  return c;
}
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export function days(from, to) {
  const out = []; const d = new Date(from + 'T00:00:00Z'), e = new Date(to + 'T00:00:00Z');
  while (d <= e && out.length < 62) { out.push(ymd(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
/* the full moon (Meeus), in Sri Lanka time — the same sums as the till */
const _fm = {};
export function fullMoons(year) {
  if (_fm[year]) return _fm[year];
  const r = Math.PI / 180, out = []; let k = Math.floor((year - 2000) * 12.3685) - 2;
  for (let i = 0; i < 16; i++, k++) {
    const kk = k + 0.5, T = kk / 1236.85, sn = Math.sin;
    let jde = 2451550.09766 + 29.530588861 * kk + 0.00015437 * T * T - 0.00000015 * T * T * T;
    const E = 1 - 0.002516 * T - 0.0000074 * T * T, M = (2.5534 + 29.1053567 * kk) * r, Mp = (201.5643 + 385.81693528 * kk + 0.0107582 * T * T) * r,
      F = (160.7108 + 390.67050284 * kk - 0.0016118 * T * T) * r, Om = (124.7746 - 1.56375588 * kk + 0.0020672 * T * T) * r;
    jde += -0.40614 * sn(Mp) + 0.17302 * E * sn(M) + 0.01614 * sn(2 * Mp) + 0.01043 * sn(2 * F) + 0.00734 * E * sn(Mp - M) - 0.00515 * E * sn(Mp + M) + 0.00209 * E * E * sn(2 * M)
      - 0.00111 * sn(Mp - 2 * F) - 0.00057 * sn(Mp + 2 * F) + 0.00056 * E * sn(2 * Mp + M) - 0.00042 * sn(3 * Mp) + 0.00042 * E * sn(M + 2 * F) + 0.00038 * E * sn(M - 2 * F) - 0.00024 * E * sn(2 * Mp - M) - 0.00017 * sn(Om);
    const s = new Date((jde - 2440587.5) * 864e5 + 5.5 * 36e5).toISOString().slice(0, 10);
    if (s.startsWith(String(year)) && !out.includes(s)) out.push(s);
  }
  return (_fm[year] = out.sort());
}
export const poyas = (c, year) => { const own = c.poyaDays[String(year)]; return Array.isArray(own) && own.length ? own : fullMoons(+year); };
export const poyaOff = (c, day) => c.poya !== 'working' && poyas(c, day.slice(0, 4)).includes(day);
export const group = (c, name) => c.groups[String(name || '').toLowerCase().trim()] === 'director' ? 'director' : 'employee';
export const allow = (c, who) => Math.max(0, +(group(c, who) === 'director' ? c.perDir : c.perEmp) || 0);
const live = (leaves) => (Array.isArray(leaves) ? leaves : []).filter(l => l && (l.status === 'pending' || l.status === 'approved'));

export function used(c, leaves, who, ym) {
  let n = 0;
  for (const l of live(leaves)) { if (l.who !== who) continue; for (const d of days(l.from, l.to)) if (d.startsWith(ym) && !poyaOff(c, d)) n += l.half ? 0.5 : 1; }
  if (c.poya === 'within') n += poyas(c, ym.slice(0, 4)).filter(d => d.startsWith(ym)).length;
  return n;
}
const nice = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthName = ym => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Why this leave cannot be asked for, or null. Staff asking: the day limit is dayAsk. */
export function refuse(c, leaves, who, from, to, half, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return 'Pick the first and last day';
  if (from < today) return 'That day has gone';
  if (days(from, to).length > 31) return 'That is more than a month — ask the owner';
  const work = days(from, to).filter(d => !poyaOff(c, d));
  if (!work.length) return 'That is a Poya day — everyone is off already';
  const g = group(c, who), sep = c.sepGroups !== false, limit = Math.max(1, +c.dayAsk || 1);
  for (const d of work) {
    const others = live(leaves).filter(l => l.who !== who && l.from <= d && l.to >= d && (!sep || group(c, l.who) === g));
    if (others.length >= limit) return `${others.map(l => l.who).join(' and ')} ${others.length === 1 ? 'is' : 'are'} already off on ${nice(d)} — ${limit === 1 ? 'one person' : limit + ' people'} a day`;
  }
  if (live(leaves).some(l => l.who === who && !(to < l.from || from > l.to))) return 'You already have leave on one of those days';
  const cap = allow(c, who);
  if (cap) {
    const add = {}; for (const d of work) add[d.slice(0, 7)] = (add[d.slice(0, 7)] || 0) + (half ? 0.5 : 1);
    for (const [ym, n] of Object.entries(add)) { const u = used(c, leaves, who, ym); if (u + n > cap) return `${monthName(ym)}: ${u} of ${cap} days already used${c.poya === 'within' ? ' (the Poya day counts as one)' : ''} — this would make ${u + n}. Ask the owner.`; }
  }
  return null;
}
