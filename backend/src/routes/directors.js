// The directors' report (regalhw.lk/d?k=…, services/directors.js).
//   GET  /api/directors/hello?k=                     their name, and whether their PIN is made yet
//   POST /api/directors/login  { k, code, pin, pin2? }  the first time makes the PIN; gives a sign-in for 12 hours
//   GET  /api/directors/report?k=&range=today|yesterday|week|month|lastmonth|custom&from=&to=   the figures, live
//   POST /api/directors/send   { ids?, range, mail, text }    from a till: the link by email and/or text, now
// and once a day by itself at the shop's time when "send it every evening" is on.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
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

/* ---- signing in: the link, the director's user code, and a PIN of their own ----
   The first time, the code and a new PIN (twice); after that the code and the PIN. The PIN is kept here on
   the server only (dir_pins, hashed) — never in the books every till holds. Five wrong tries lock that
   director for a quarter of an hour (kept in the table, so the host's restarts do not forgive it). A PIN
   reset in Settings (d.pinReset) or a new link ends every sign-in made before it. */
const secret = () => process.env.JWT_SECRET || 'regal';
const codeNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
let pinReady = null;
const pinTable = () => (pinReady = pinReady || query(`CREATE TABLE IF NOT EXISTS dir_pins (id varchar(40) PRIMARY KEY, hash varchar(100) NOT NULL, at bigint NOT NULL, fails int NOT NULL DEFAULT 0, lock_until bigint NOT NULL DEFAULT 0)`).catch(e => { pinReady = null; throw e; }));
async function pinOf(d) {
  await pinTable();
  const { rows: [p] } = await query(`SELECT id, hash, at, fails, lock_until FROM dir_pins WHERE id = $1`, [d.id]);
  if (p && +d.pinReset > +p.at) { await query(`DELETE FROM dir_pins WHERE id = $1`, [d.id]); return null; }   // reset from Settings since it was made
  return p || null;
}
const tokenFor = (d, p) => jwt.sign({ kind: 'dir', id: d.id, kv: String(d.key).slice(-8), pv: String(p.at) }, secret(), { expiresIn: '12h' });
async function signedIn(req, d) {
  const t = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!t) return false;
  let v; try { v = jwt.verify(t, secret()); } catch { return false; }
  if (v.kind !== 'dir' || v.id !== d.id || v.kv !== String(d.key).slice(-8)) return false;
  const p = await pinOf(d); return !!p && String(p.at) === v.pv;
}

r.get('/hello', asyncHandler(async (req, res) => {
  const data = await readBooks(); const d = byKey(data, req.query.k);
  if (!d) throw new HttpError(403, 'This link is not open — ask the shop for a new one');
  const p = await pinOf(d);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, name: String(d.name || '').trim(), shop: (data.CFG.shop || {}).name || 'Regal Hardware', hasPin: !!p });
}));

r.post('/login', asyncHandler(async (req, res) => {
  const b = req.body || {}; const data = await readBooks(); const d = byKey(data, b.k);
  if (!d) throw new HttpError(403, 'This link is not open — ask the shop for a new one');
  const p = await pinOf(d), now = Date.now();
  if (p && +p.lock_until > now) throw new HttpError(429, `Too many wrong tries — try again in ${Math.ceil((p.lock_until - now) / 60000)} minutes, or ask the shop`);
  const pin = String(b.pin || '');
  const wrong = async (msg) => {
    if (p) { const n = (+p.fails || 0) + 1, lock = n >= 5;
      await query(`UPDATE dir_pins SET fails = $1, lock_until = $2 WHERE id = $3`, [lock ? 0 : n, lock ? now + 15 * 60 * 1000 : 0, d.id]);
      if (lock) throw new HttpError(429, 'Too many wrong tries — the page is locked for 15 minutes'); }
    throw new HttpError(401, msg);
  };
  if (!d.code || codeNorm(b.code) !== codeNorm(d.code)) return wrong('That user code is not right — it is in the message from the shop');
  if (!p) {   // the first time: make the PIN
    if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, 'A PIN is 4 to 6 numbers');
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw new HttpError(400, 'Too easy to guess — not all the same number, and not 1234');
    if (pin !== String(b.pin2 || '')) throw new HttpError(400, 'The two PINs are not the same');
    const at = now;
    await query(`DELETE FROM dir_pins WHERE id = $1`, [d.id]);
    await query(`INSERT INTO dir_pins (id, hash, at, fails, lock_until) VALUES ($1, $2, $3, 0, 0)`, [d.id, await bcrypt.hash(pin, 10), at]);
    return res.json({ ok: true, made: true, token: tokenFor(d, { at }) });
  }
  if (!(await bcrypt.compare(pin, p.hash).catch(() => false))) return wrong('That PIN is not right');
  if (+p.fails) await query(`UPDATE dir_pins SET fails = 0 WHERE id = $1`, [d.id]);
  res.json({ ok: true, token: tokenFor(d, p) });
}));

/* for Settings: whose PIN is made */
r.get('/pins', regalAuth, asyncHandler(async (_req, res) => {
  const data = await readBooks(); const out = {};
  for (const d of listOf(data)) { const p = await pinOf(d); out[d.id] = p ? { at: +p.at, locked: +p.lock_until > Date.now() } : null; }
  res.json({ ok: true, pins: out });
}));

r.get('/report', asyncHandler(async (req, res) => {
  const data = await readBooks();
  const who = byKey(data, req.query.k);
  if (!who) throw new HttpError(403, 'This link is not open — ask the shop for a new one');
  if (!(await signedIn(req, who))) throw new HttpError(401, 'Sign in with your user code and PIN');
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
    const link = linkOf(base, d), rep = reportOf(data, { range }, d), row = { id: d.id, name: d.name }, made = !!(await pinOf(d).catch(() => null));
    if (mail && d.email) {
      if (!mc) row.mail = 'not sent — ' + mailWhy;
      else try { const m = mailOf(rep, link, d, made); await transport(mc.cfg).sendMail({ from: fromOf(mc.cfg, mc.shop), to: d.email, subject: m.subject, text: m.text, html: m.html }); row.mail = 'sent to ' + d.email; }
      catch (e) { row.mail = 'not sent — ' + String(e.message || e).slice(0, 120); }
    }
    if (text && d.phone) {
      if (!msg.live) row.text = 'not sent — texts are not switched on (Settings → Messages)';
      else try { await sendViaProvider(msg, d.phone, `Dear ${String(d.name || 'Director').split(' ')[0]},\n` + textOf(rep, link, d, made)); row.text = 'sent to ' + d.phone; }
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
