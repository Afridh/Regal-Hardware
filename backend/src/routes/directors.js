// The directors' report (regalhw.lk/d?k=…, services/directors.js).
//   GET  /api/directors/report?k=&range=today|yesterday|week|month|lastmonth|custom&from=&to=   the figures, live
//   POST /api/directors/send   { ids?, range, mail, text }    from a till: the link by email and/or text, now
// and once a day by itself at the shop's time when "send it every evening" is on.
import { Router } from 'express';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { query } from '../db.js';
import { regalAuth, sendViaProvider } from './regal.js';
import { readBooks } from '../services/dues.js';
import { reportOf, mailOf, textOf, todayHere } from '../services/directors.js';
import { mailCfg, transport, fromOf } from './files.js';

const r = Router();
const TZ = 'Asia/Colombo';
const hhmm = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false }).slice(0, 5);
const listOf = (data) => ((data && data.CFG && data.CFG.directors && data.CFG.directors.list) || []).filter(d => d && d.key && d.active !== false);
const byKey = (data, k) => { const key = String(k || '').trim(); return key.length >= 16 ? listOf(data).find(d => d.key === key) : null; };
const baseOf = (data, req) => {
  const dom = data?.S?.web?.settings?.domain || data?.CFG?.web?.domain || '';
  if (req) { const host = req.get('x-forwarded-host') || req.get('host'); if (host) return `${req.protocol === 'http' && !/^localhost|^127\./.test(host) ? 'https' : req.protocol}://${host}`; }
  return dom ? `https://${dom.replace(/^https?:\/\//, '').replace(/\/+$/, '')}` : 'https://regalhw.lk';
};
const linkOf = (base, d) => `${base}/d?k=${encodeURIComponent(d.key)}`;

r.get('/report', asyncHandler(async (req, res) => {
  const data = await readBooks();
  const who = byKey(data, req.query.k);
  if (!who) throw new HttpError(403, 'This link is not open — ask the shop for a new one');
  res.set('Cache-Control', 'no-store');
  res.json(reportOf(data, req.query, who));
}));

/* send each director their link: an email with the day's headline figures, and/or a text */
async function sendAll(data, base, { ids, range = 'today', mail = true, text = true } = {}) {
  const people = listOf(data).filter(d => !ids || !ids.length || ids.includes(d.id));
  if (!people.length) throw new HttpError(400, 'No directors to send to — add them in Settings → Directors\' report');
  let mc = null, mailWhy = '';
  if (mail) { try { mc = await mailCfg(); } catch (e) { mailWhy = e.message; } }
  const msg = (data.CFG && data.CFG.msg) || {};
  const out = [];
  for (const d of people) {
    const link = linkOf(base, d), rep = reportOf(data, { range }, d), row = { id: d.id, name: d.name };
    if (mail && d.email) {
      if (!mc) row.mail = 'not sent — ' + mailWhy;
      else try { const m = mailOf(rep, link); await transport(mc.cfg).sendMail({ from: fromOf(mc.cfg, mc.shop), to: d.email, subject: m.subject, text: m.text, html: m.html }); row.mail = 'sent to ' + d.email; }
      catch (e) { row.mail = 'not sent — ' + String(e.message || e).slice(0, 120); }
    }
    if (text && d.phone) {
      if (!msg.live) row.text = 'not sent — texts are not switched on (Settings → Messages)';
      else try { await sendViaProvider(msg, d.phone, `Dear ${String(d.name || 'Director').split(' ')[0]},\n` + textOf(rep, link)); row.text = 'sent to ' + d.phone; }
      catch (e) { row.text = 'not sent — ' + String(e.message || e).slice(0, 120); }
    }
    out.push(row);
  }
  return out;
}

r.post('/send', regalAuth, asyncHandler(async (req, res) => {
  const data = await readBooks();
  const b = req.body || {};
  const sent = await sendAll(data, baseOf(data, req), { ids: Array.isArray(b.ids) ? b.ids : null, range: b.range || 'today', mail: b.mail !== false, text: b.text !== false });
  res.json({ ok: true, sent });
}));

/* every evening, at the time set (or the owner's summary time), once a day — claimed in dir_runs first so a
   restart (the host restarts the app every few minutes) never sends it twice */
let ready = null;
const ensure = () => (ready = ready || query(`CREATE TABLE IF NOT EXISTS dir_runs (day varchar(10) PRIMARY KEY, at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, note varchar(300))`).catch(e => { ready = null; throw e; }));
export async function directorsTick() {
  const data = await readBooks(); if (!data) return;
  const cfg = (data.CFG && data.CFG.directors) || {};
  if (!cfg.auto || !listOf(data).length) return;
  const at = String(cfg.at || (data.CFG.bill || {}).summaryTime || '19:30');
  if (hhmm() < at) return;
  const day = todayHere();
  await ensure();
  const { rows: [had] } = await query(`SELECT day FROM dir_runs WHERE day = $1`, [day]);
  if (had) return;
  await query(`INSERT INTO dir_runs (day) VALUES ($1)`, [day]);
  try { const sent = await sendAll(data, baseOf(data, null), { range: 'today', mail: cfg.byMail !== false, text: cfg.byText !== false });
    await query(`UPDATE dir_runs SET note = $1 WHERE day = $2`, [JSON.stringify(sent).slice(0, 300), day]); }
  catch (e) { await query(`UPDATE dir_runs SET note = $1 WHERE day = $2`, [String(e.message || e).slice(0, 300), day]); }
}
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') setInterval(() => { directorsTick().catch(e => console.warn('directors report:', e.message)); }, 60 * 1000).unref?.();

export default r;
