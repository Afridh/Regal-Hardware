// Credit follow-up: the server reminds customers who owe, by itself, once a day.
//
// Settings live in the books (CFG.dues, set on the till's Credit follow-up page):
//   on, at ('10:00'), steps ([7, 30, 60] — days the oldest unpaid bill has been owed), monthly (a
//   statement on monthDay to everyone who owes), stopDays (the till stops new credit past this).
// The wording is the shop's own (CFG.tpl.dueRemind1/2/3 and statement), laid out by letter().
//
// It runs here, not on a till, because a till may be shut and two tills open at once would both
// send: what has gone out is kept in due_sent, one row per customer, per oldest bill, per step — so a
// reminder goes once for a debt, and a new one starts only when that bill is paid and another becomes
// the oldest. Every message, sent or refused, is kept in due_log for the page to show.
import { query, dbKind } from '../db.js';
import { letter } from '../lib/letter.js';

const TZ = 'Asia/Colombo';
export const DUE_DEF = { on: false, at: '10:00', steps: [7, 30, 60], monthly: true, monthDay: 1, stopDays: 0 };
// what the till has as the defaults — kept in step with CFG.tpl in frontend/index.html
export const DUE_TPL = {
  dueRemind1: 'A gentle reminder about your account.\nUnpaid bills: {count}\nOldest: {days} days\nTotal outstanding: {outstanding}\nView or pay: {link}',
  dueRemind2: 'Your account is now overdue.\nUnpaid bills: {count}\nOldest: {days} days\nTotal outstanding: {outstanding}\nPlease settle at your earliest. Details: {link}',
  dueRemind3: 'Final reminder: your account is long overdue.\nOldest bill: {days} days\nTotal outstanding: {outstanding}\nNew credit may be paused until it is settled. Details: {link}',
  statement: 'Here is your account summary.\nAccount: {customer}\nUnpaid bills: {count}\nTotal outstanding: {outstanding}\nView details: {link}',
};

let ready = null;
function ensure() {
  if (!ready) ready = query(`
    CREATE TABLE IF NOT EXISTS due_sent (cid varchar(20) NOT NULL, cycle varchar(40) NOT NULL, step varchar(12) NOT NULL,
      sent_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (cid, cycle, step));
    CREATE TABLE IF NOT EXISTS due_log (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), cid varchar(20) NOT NULL,
      name varchar(120), phone varchar(30), kind varchar(12) NOT NULL, days integer, amount numeric(14,2), ok boolean NOT NULL, note varchar(300));
    CREATE TABLE IF NOT EXISTS due_runs (day varchar(10) PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), sent integer, failed integer)`)
    .catch(e => { ready = null; throw e; });
  return ready;
}

export async function readBooks() {
  const { rows: [b] } = await query(dbKind === 'mysql' ? 'SELECT data FROM books WHERE `key` = ?' : 'SELECT data FROM books WHERE key = $1', ['regal']);
  const d = b && b.data; return typeof d === 'string' ? JSON.parse(d) : d || null;
}
export const dueCfg = (CFG) => ({ ...DUE_DEF, ...((CFG && CFG.dues) || {}) });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const hhmm = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false }).slice(0, 5);
const daysSince = (ymd) => Math.floor((Date.parse(today()) - Date.parse(String(ymd).slice(0, 10))) / 864e5);
const money = (n) => 'Rs ' + (+n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
const steps = (cfg) => [...new Set((Array.isArray(cfg.steps) ? cfg.steps : DUE_DEF.steps).map(n => Math.round(+n)).filter(n => n > 0))].sort((a, b) => a - b).slice(0, 3);

/* who owes, and for how long: unpaid bills per customer, oldest first */
export function dueList(data) {
  const S = (data && data.S) || {}, by = new Map();
  for (const s of S.sales || []) {
    if (!s || !s.customerId || s.customerId === 1 || !(+s.balance > 0.005)) continue;
    const v = by.get(s.customerId) || { owed: 0, count: 0, oldest: null };
    v.owed += +s.balance; v.count++;
    if (!v.oldest || String(s.date) < String(v.oldest.date) || (s.date === v.oldest.date && String(s.no) < String(v.oldest.no))) v.oldest = s;
    by.set(s.customerId, v);
  }
  const host = String((data.CFG && data.CFG.shop && data.CFG.shop.site) || 'regalhw.lk').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return (S.customers || []).filter(c => c && c.id !== 1 && c.active !== false && by.has(c.id)).map(c => {
    const v = by.get(c.id);
    return { cid: String(c.id), name: c.name, phone: c.phone || '', noRemind: !!c.noRemind, owed: +v.owed.toFixed(2), count: v.count,
      days: daysSince(v.oldest.date), oldestNo: String(v.oldest.no), link: c.pkey ? `${host}/my/${c.code}.${c.pkey}`.toLowerCase() : `${host}/my` };
  });
}

/* what would go out today — each customer's highest step reached and not yet sent for this debt, and
   (on the statement day) a statement for everyone who owes and has not had this month's */
export async function duePlan(data, { force = false } = {}) {
  await ensure();
  const cfg = dueCfg(data.CFG), st = steps(cfg), list = dueList(data), plan = [];
  const { rows: sent } = await query(`SELECT cid, cycle, step FROM due_sent`);
  const had = new Set(sent.map(r => `${r.cid}|${r.cycle}|${r.step}`));
  const month = today().slice(0, 7), isDay = +today().slice(8, 10) === Math.min(28, Math.max(1, +cfg.monthDay || 1));
  for (const c of list) {
    if (!c.phone || c.noRemind) continue;
    let step = 0; st.forEach((d, i) => { if (c.days >= d) step = i + 1; });
    if (step && !had.has(`${c.cid}|${c.oldestNo}|s${step}`)) { plan.push({ ...c, kind: 'remind' + step, step, cycle: c.oldestNo, key: 's' + step }); continue; }
    if (cfg.monthly && (isDay || force === 'statement') && !had.has(`${c.cid}|M${month}|stmt`)) plan.push({ ...c, kind: 'statement', cycle: 'M' + month, key: 'stmt' });
  }
  return plan;
}

/* send what the plan says, one at a time; every message is logged, and only a sent one is marked */
export async function dueSend(data, plan, send) {
  await ensure();
  let ok = 0, bad = 0;
  for (const p of plan.slice(0, 300)) {
    const key = p.kind === 'statement' ? 'statement' : 'dueRemind' + p.step;
    const tpl = (data.CFG && data.CFG.tpl && data.CFG.tpl[key] && data.CFG.tpl[key].text) || DUE_TPL[key];
    const shop = (data.CFG && data.CFG.shop && data.CFG.shop.name) || '';
    const body = letter(data.CFG, 'customer', fill(tpl, { shop, customer: p.name, count: p.count, days: p.days, outstanding: money(p.owed), link: p.link }));
    try {
      await send((data.CFG && data.CFG.msg) || {}, p.phone, body);
      await query(`INSERT INTO due_sent (cid, cycle, step) VALUES ($1, $2, $3)`, [p.cid, p.cycle, p.key]).catch(() => {});
      await query(`INSERT INTO due_log (cid, name, phone, kind, days, amount, ok) VALUES ($1,$2,$3,$4,$5,$6,true)`, [p.cid, p.name, p.phone, p.kind, p.days, p.owed]);
      ok++;
    } catch (e) {
      await query(`INSERT INTO due_log (cid, name, phone, kind, days, amount, ok, note) VALUES ($1,$2,$3,$4,$5,$6,false,$7)`,
        [p.cid, p.name, p.phone, p.kind, p.days, p.owed, String(e.message || e).slice(0, 300)]).catch(() => {});
      bad++;
    }
  }
  return { sent: ok, failed: bad };
}

/* once a minute: after the shop's time, once a day, if switched on */
export async function dueTick(send) {
  const data = await readBooks(); if (!data) return;
  const cfg = dueCfg(data.CFG); if (!cfg.on) return;
  const now = hhmm(); if (now < String(cfg.at || '10:00') || now >= '19:00') return;
  await ensure();
  const day = today();
  const { rows: [ran] } = await query(`SELECT day FROM due_runs WHERE day = $1`, [day]);
  if (ran) return;
  await query(`INSERT INTO due_runs (day, sent, failed) VALUES ($1, 0, 0)`, [day]);   // claimed before anything goes, so a restart cannot send twice
  const r = await dueSend(data, await duePlan(data), send);
  await query(`UPDATE due_runs SET sent = $1, failed = $2 WHERE day = $3`, [r.sent, r.failed, day]);
}

export async function dueLog(limit = 200) {
  await ensure();
  const { rows } = await query(`SELECT id, at, cid, name, phone, kind, days, amount, ok, note FROM due_log ORDER BY id DESC LIMIT ${Math.max(1, Math.min(1000, +limit || 200))}`);
  const { rows: runs } = await query(`SELECT day, at, sent, failed FROM due_runs ORDER BY day DESC LIMIT 14`);
  const { rows: sent } = await query(`SELECT cid, cycle, step, sent_at FROM due_sent`);
  return { log: rows.map(r => ({ ...r, id: Number(r.id), amount: +r.amount, days: r.days == null ? null : +r.days })), runs, sent };
}
