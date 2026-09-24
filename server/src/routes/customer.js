// The customer's own page (app/my.html, at /my/<their code>) — what the shop texts them a link to.
// They sign in with the mobile the shop has on file, and can see what they owe, bill by bill, and
// tell the shop they have paid. Nothing here writes the books: a message lands in cust_inbox and the
// next till to read the books gets it as a notice on their account.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { sendViaProvider, regalAuth } from './regal.js';
import { ensureLogins, inviteMany, startersFor, suggestUser, addLogin, setLogin, removeLogin, listLogins, findLogin, cleanUser, loginLine,
         askForLogin, myRequests, waitingRequests, waitingCount, acceptRequest, rejectRequest } from '../services/portalLogins.js';

const LOGINS = 'cust_logins';

const r = Router();
const TZ = process.env.SHOP_TZ || 'Asia/Colombo';
const OTP_WINDOW_MS = 5 * 60 * 1000;
const digits = s => String(s || '').replace(/\D/g, '');
const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const secret = () => process.env.JWT_SECRET || 'regal';
const norm = s => String(s || '').trim().toLowerCase();

let ready = null;
export function ensureCustTables() {
  // the sign-ins table is the shared one (it also renames the column this file first used, cid → owner)
  if (!ready) ready = ensureLogins(LOGINS).then(() => query(`
    CREATE TABLE IF NOT EXISTS cust_inbox (
      id          bigserial PRIMARY KEY,
      cid         integer NOT NULL,
      kind        varchar(12) NOT NULL,
      data        jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      imported_at timestamptz);
    CREATE INDEX IF NOT EXISTS cust_inbox_pending ON cust_inbox (imported_at) WHERE imported_at IS NULL`))
    .catch(e => { ready = null; throw e; });
  return ready;
}
const hash = (p) => bcrypt.hash(String(p), 10);
const hashOk = async (p, h) => !!h && bcrypt.compare(String(p || ''), h).catch(() => false);

async function books() {
  const { rows: [row] } = await query(`SELECT data FROM books WHERE key = 'regal'`);
  return row?.data || null;
}
/* who the page is for: the code in the address, and the mobile they type must be the one on file */
const byCode = (S, code) => (S.customers || []).find(c => c.id !== 1 && norm(c.code) === norm(code) && c.active !== false);
const byPhone = (S, phone) => (S.customers || []).filter(c => c.id !== 1 && digits(c.phone) === phone && c.active !== false);

function otpFor(phone, when = Date.now()) {
  const win = Math.floor(when / OTP_WINDOW_MS);
  const h = crypto.createHmac('sha256', secret()).update('cust|' + digits(phone) + '|' + win).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}
const otpOk = (phone, code) => [0, 1].some(back => otpFor(phone, Date.now() - back * OTP_WINDOW_MS) === String(code || '').trim());
const mask = p => digits(p).replace(/^(\d{3})\d{4}(\d{3})$/, '$1••••$2');

function custAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'Sign in with your mobile first');
    const p = jwt.verify(token, secret());
    if (p.kind !== 'cust') throw new HttpError(401, 'Wrong kind of token');
    req.cust = p; next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return next(new HttpError(401, 'Please sign in again'));
    next(e);
  }
}

/* what a till has to pick up: the customer saying they have paid */
export async function pendingCustCount() {
  await ensureCustTables();
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM cust_inbox WHERE imported_at IS NULL`);
  return n;
}
export async function injectCustInbox(data) {
  const S = data?.S; if (!S) return 0;
  await ensureCustTables();
  const { rows } = await query(`SELECT id, cid, kind, data, created_at FROM cust_inbox WHERE imported_at IS NULL ORDER BY id`);
  if (!rows.length) return 0;
  S.notices = S.notices || [];
  let added = 0;
  for (const row of rows) {
    if (S.notices.some(n => n.inboxId === Number(row.id))) continue;
    S.notices.push({ id: 'n' + row.id, inboxId: Number(row.id), kind: 'customer', cid: row.cid, status: 'open',
      date: new Date(row.created_at).toLocaleDateString('en-CA', { timeZone: TZ }), ...row.data });
    added++;
  }
  return added;
}
export async function markCustImported(data) {
  const S = data?.S; if (!S) return 0;
  const ids = (S.notices || []).map(n => n.inboxId).filter(Boolean);
  if (!ids.length) return 0;
  await ensureCustTables();
  const { rowCount } = await query(`UPDATE cust_inbox SET imported_at = now() WHERE imported_at IS NULL AND id = ANY($1::bigint[])`, [ids]);
  return rowCount;
}

// ---------------------------------------------------------------- the page opens
/** Who this page is for, before anyone signs in: just the name and a masked mobile. */
r.get('/who/:code', asyncHandler(async (req, res) => {
  const data = await books();
  const c = byCode(data?.S || {}, req.params.code);
  if (!c) throw new HttpError(404, 'That page does not belong to anyone');
  await ensureCustTables();
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM cust_logins WHERE owner = $1 AND active`, [c.id]);
  res.json({ ok: true, name: c.name, phone: c.phone ? mask(c.phone) : null, logins: n,
    open: c.portal !== false, shop: { name: data?.CFG?.shop?.name || 'Regal Hardware', phone: data?.CFG?.shop?.phone || '', addr: data?.CFG?.shop?.addr || '' } });
}));

/* ---------------------------------------------------------------- signing in by name
   A big customer's people each have a name to sign in with. Either password opens it: the one the
   shop set for them, or the one they have since chosen for themselves. */
r.post('/signin', asyncHandler(async (req, res) => {
  const user = cleanUser(req.body?.user), pass = String(req.body?.password || '');
  if (!user || !pass) throw new HttpError(400, 'Your user name and password, please');
  await ensureCustTables();
  const { rows: [l] } = await query(`SELECT * FROM cust_logins WHERE lower(username) = $1`, [user]);
  await new Promise(r2 => setTimeout(r2, 250));                       // slow down guessing
  if (!l || !l.active) throw new HttpError(401, 'That name and password do not match');
  if (!(await hashOk(pass, l.own_hash)) && !(await hashOk(pass, l.admin_hash))) throw new HttpError(401, 'That name and password do not match');
  const data = await books();
  const c = (data?.S?.customers || []).find(x => x.id === l.owner);
  if (!c) throw new HttpError(404, 'That account is no longer on file');
  if (c.portal === false) throw new HttpError(403, 'The shop has closed this page — give them a ring');
  await query(`UPDATE cust_logins SET last_seen = now() WHERE id = $1`, [l.id]);
  res.json({ ok: true, token: jwt.sign({ kind: 'cust', cid: l.owner, lid: Number(l.id), user: l.username }, secret(), { expiresIn: '30d' }),
    name: c.name, code: c.code, who: l.name || l.username });
}));

/** Forgotten: a code goes to the number kept against that sign-in (or the account's). */
r.post('/forgot', asyncHandler(async (req, res) => {
  const user = cleanUser(req.body?.user);
  await ensureCustTables();
  const { rows: [l] } = await query(`SELECT * FROM cust_logins WHERE lower(username) = $1 AND active`, [user]);
  if (!l) throw new HttpError(404, 'There is no sign-in by that name');
  const data = await books();
  const c = (data?.S?.customers || []).find(x => x.id === l.owner);
  const phone = digits(l.phone || c?.phone);
  if (!/^0\d{9}$/.test(phone)) throw new HttpError(400, 'There is no mobile on that sign-in — ring the shop and they will set it');
  const code = otpFor(phone);
  const cfg = data?.CFG?.msg;
  if (cfg?.live && cfg.apiUrl && cfg.apiKey) {
    try { await sendViaProvider(cfg, phone, `${data?.CFG?.shop?.name || 'Regal Hardware'}: your code to set a new password is ${code}. It works for 5 minutes.`);
      return res.json({ ok: true, sent: true, phone: mask(phone) }); }
    catch (e) { console.error('cust forgot sms failed', e.message); }
  }
  res.json({ ok: true, sent: false, code, phone: mask(phone) });
}));

/** The code from that text, and the password they want from now on. The shop's one still works. */
r.post('/reset', asyncHandler(async (req, res) => {
  const user = cleanUser(req.body?.user), pass = String(req.body?.password || '');
  if (pass.length < 6) throw new HttpError(400, 'A password needs at least six characters');
  await ensureCustTables();
  const { rows: [l] } = await query(`SELECT * FROM cust_logins WHERE lower(username) = $1 AND active`, [user]);
  if (!l) throw new HttpError(404, 'There is no sign-in by that name');
  const data = await books();
  const c = (data?.S?.customers || []).find(x => x.id === l.owner);
  const phone = digits(l.phone || c?.phone);
  if (!otpOk(phone, req.body?.code)) throw new HttpError(401, 'That code is not right, or it has expired');
  await query(`UPDATE cust_logins SET own_hash = $2, starter = NULL WHERE id = $1`, [l.id, await hash(pass)]);
  res.json({ ok: true });
}));

r.post('/otp', asyncHandler(async (req, res) => {
  const phone = digits(req.body?.phone);
  if (!/^0\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a mobile like 0771234567');
  const data = await books();
  const S = data?.S || {};
  const list = byPhone(S, phone);
  const c = req.body?.code ? list.find(x => norm(x.code) === norm(req.body.code)) || byCode(S, req.body.code) : list[0];
  if (!c || digits(c.phone) !== phone) throw new HttpError(404, 'That mobile is not the one the shop has for this account');
  if (c.portal === false) throw new HttpError(403, 'The shop has not opened this page for you yet — give them a ring');
  const code = otpFor(phone);
  const cfg = data?.CFG?.msg;
  if (cfg?.live && cfg.apiUrl && cfg.apiKey) {
    try { await sendViaProvider(cfg, phone, `${data?.CFG?.shop?.name || 'Regal Hardware'}: your sign-in code is ${code}. It works for 5 minutes.`); return res.json({ ok: true, sent: true, name: c.name }); }
    catch (e) { console.error('cust otp sms failed', e.message); }
  }
  res.json({ ok: true, sent: false, code, name: c.name });        // no gateway set up: shown on the screen instead
}));

r.post('/login', asyncHandler(async (req, res) => {
  const phone = digits(req.body?.phone);
  if (!otpOk(phone, req.body?.code)) throw new HttpError(401, 'That code is not right, or it has expired');
  const data = await books();
  const S = data?.S || {};
  const list = byPhone(S, phone);
  const c = req.body?.acc ? list.find(x => norm(x.code) === norm(req.body.acc)) || list[0] : list[0];
  if (!c) throw new HttpError(404, 'That mobile is not on file');
  res.json({ ok: true, token: jwt.sign({ kind: 'cust', cid: c.id, phone }, secret(), { expiresIn: '30d' }), name: c.name, code: c.code });
}));

/* ---------------------------------------------------------------- what they owe */
const daysBetween = (d) => Math.max(0, Math.round((Date.now() - new Date(d + 'T00:00:00').getTime()) / 864e5));
r.get('/me', custAuth, asyncHandler(async (req, res) => {
  const data = await books();
  const S = data?.S || {}, CFG = data?.CFG || {};
  const c = (S.customers || []).find(x => x.id === req.cust.cid);
  if (!c) throw new HttpError(404, 'That account is no longer on file');
  const mine = (S.sales || []).filter(s => s.customerId === c.id);
  const open = mine.filter(s => s.balance > 0.005)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(s => ({ no: s.no, date: s.date, total: s.total, paid: s.paid, balance: s.balance, days: daysBetween(s.date),
      lines: (s.lines || []).length }));
  const owed = +open.reduce((a, s) => a + s.balance, 0).toFixed(2);
  const band = (lo, hi) => +open.filter(s => s.days > lo && (hi === null || s.days <= hi)).reduce((a, s) => a + s.balance, 0).toFixed(2);
  const pays = (S.payments || []).filter(p => p.dir === 'IN' && p.customerId === c.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10)
    .map(p => ({ no: p.no, date: p.date, amount: p.amount, method: p.method, ref: p.ref || '' }));
  const recent = mine.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10)
    .map(s => ({ no: s.no, date: s.date, total: s.total, balance: s.balance }));
  await ensureCustTables();
  const { rows: said } = await query(`SELECT id, data, created_at FROM cust_inbox WHERE cid = $1 AND imported_at IS NULL ORDER BY id DESC`, [c.id]);
  res.json({ ok: true,
    who: req.cust.user || null,
    customer: { name: c.name, code: c.code, phone: c.phone || '', limit: c.limit || 0, level: c.level || 'retail', points: c.points || 0 },
    owed, limit: c.limit || 0,
    ageing: { d0: band(-1, 30), d30: band(30, 60), d60: band(60, 90), d90: band(90, null) },
    open, pays, recent,
    saidPaid: said.map(s => ({ id: Number(s.id), ...s.data, at: s.created_at })),
    shop: { name: CFG.shop?.name || 'Regal Hardware', phone: CFG.shop?.phone || '', land: CFG.shop?.land || '', addr: CFG.shop?.addr || '', hours: CFG.shop?.hours || '' },
    today: localDate() });
}));

/** Their own password, changed from inside. The one the shop set goes on working. */
r.post('/password', custAuth, asyncHandler(async (req, res) => {
  if (!req.cust.lid) throw new HttpError(400, 'This page was opened with a code, not a sign-in');
  const pass = String(req.body?.password || '');
  if (pass.length < 6) throw new HttpError(400, 'A password needs at least six characters');
  await ensureCustTables();
  const { rows: [l] } = await query(`SELECT * FROM cust_logins WHERE id = $1`, [req.cust.lid]);
  if (!l) throw new HttpError(404, 'That sign-in is no longer there');
  const cur = String(req.body?.current || '');
  if (!(await hashOk(cur, l.own_hash)) && !(await hashOk(cur, l.admin_hash))) throw new HttpError(401, 'The password you have now is not right');
  await query(`UPDATE cust_logins SET own_hash = $2, starter = NULL WHERE id = $1`, [l.id, await hash(pass)]);
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- the shop's side
   Who may sign in for a customer, from the till. The shop sets a password and can set a new one at
   any time; it never sees the one the person chose, and never needs to. */
const lineOf = l => ({ ...loginLine(l), cid: l.owner });

/* Someone else at the firm needs to get in. It waits for the shop — nothing is made yet. */
r.post('/team', custAuth, asyncHandler(async (req, res) => {
  const out = await askForLogin('C', req.cust.cid, { askedBy: req.cust.user || '', name: req.body?.name,
    role: req.body?.role, phone: req.body?.phone, note: req.body?.note });
  res.json({ ok: true, ...out });
}));
/* What they have asked for, so their own page can show it still waiting. */
r.get('/team', custAuth, asyncHandler(async (req, res) => {
  res.json({ ok: true, requests: await myRequests('C', req.cust.cid) });
}));

/* ---- the shop's side of those asks ---- */
r.get('/admin/team', regalAuth, asyncHandler(async (req, res) => {
  const cid = req.query.cid ? Number(req.query.cid) : undefined;
  res.json({ ok: true, waiting: await waitingRequests('C', cid), count: await waitingCount('C') });
}));
r.post('/admin/team/:id/accept', regalAuth, asyncHandler(async (req, res) => {
  const made = await acceptRequest('cust_logins', 'C', Number(req.params.id), req.regalUser?.name);
  // the sign-in only exists now, and this is the first anybody hears of it
  let sent = null;
  if (made.request.phone) {
    const data = await books();
    const shop = data?.CFG?.shop?.name || 'Regal Hardware';
    const c = (data?.S?.customers || []).find(x => x.id === made.request.owner);
    const link = 'regalhw.lk/my/' + String(c?.code || '').toLowerCase();
    try {
      sent = await sendViaProvider(data?.CFG?.msg,  made.request.phone,
        `${shop}: your sign-in for ${link} — user ${made.username}, password ${made.password}`);
    } catch (e) { sent = { ok: false, status: e.message } }
  }
  res.json({ ok: true, login: loginLine(made.login), username: made.username, password: made.password, sent });
}));
r.post('/admin/team/:id/reject', regalAuth, asyncHandler(async (req, res) => {
  await rejectRequest('C', Number(req.params.id), req.regalUser?.name, req.body?.reason);
  res.json({ ok: true });
}));

r.get('/admin/logins/:cid', regalAuth, asyncHandler(async (req, res) => {
  const rows = await listLogins(LOGINS, +req.params.cid);
  res.json({ ok: true, logins: rows.map(lineOf) });
}));

r.post('/admin/logins/:cid', regalAuth, asyncHandler(async (req, res) => {
  const cid = +req.params.cid;
  const username = cleanUser(req.body?.username);
  const pass = String(req.body?.password || '');
  if (username.length < 3) throw new HttpError(400, 'A user name needs at least three letters or figures');
  if (pass.length < 6) throw new HttpError(400, 'A password needs at least six characters');
  const data = await books();
  if (!(data?.S?.customers || []).some(c => c.id === cid)) throw new HttpError(404, 'No such customer');
  if (await findLogin(LOGINS, username)) throw new HttpError(409, `“${username}” is already in use`);
  const row = await addLogin(LOGINS, cid, { username, password: pass, name: req.body?.name, role: req.body?.role, phone: req.body?.phone });
  res.json({ ok: true, login: lineOf(row) });
}));

r.post('/admin/logins/:cid/:id', regalAuth, asyncHandler(async (req, res) => {
  if (req.body?.password !== undefined && String(req.body.password).length < 6)
    throw new HttpError(400, 'A password needs at least six characters');
  const row = await setLogin(LOGINS, +req.params.id, +req.params.cid, req.body || {});
  if (!row) throw new HttpError(404, 'No such sign-in, or nothing to change');
  res.json({ ok: true, login: lineOf(row) });
}));

r.delete('/admin/logins/:cid/:id', regalAuth, asyncHandler(async (req, res) => {
  await removeLogin(LOGINS, +req.params.id, +req.params.cid);
  res.json({ ok: true });
}));

/** One for everybody: any customer with no sign-in gets one, and the whole list comes back with it —
    everyone still on the password the shop gave, so it can be read out, saved or texted. */
r.post('/admin/invite-all', regalAuth, asyncHandler(async (req, res) => {
  const data = await books();
  const people = (data?.S?.customers || []).filter(c => c.id !== 1 && c.active !== false);
  const made = await inviteMany(LOGINS, people);
  const byId = new Map(people.map(c => [c.id, c]));
  const logins = (await startersFor(LOGINS)).filter(l => byId.has(l.owner))
    .map(l => ({ ...l, who: byId.get(l.owner).name, phone: l.phone || byId.get(l.owner).phone || '' }));
  res.json({ ok: true, made: made.length, of: people.length, logins });
}));

/** The shop switching the page on: make a sign-in if there is none, and hand back what to text. */
r.post('/admin/invite/:cid', regalAuth, asyncHandler(async (req, res) => {
  const cid = +req.params.cid;
  const data = await books();
  const c = (data?.S?.customers || []).find(x => x.id === cid);
  if (!c) throw new HttpError(404, 'No such customer');
  await ensureCustTables();
  const { rows: have } = await query(`SELECT * FROM cust_logins WHERE owner = $1 ORDER BY id`, [cid]);
  if (have.length) return res.json({ ok: true, made: false, logins: have.map(lineOf) });
  // a name made from theirs, and a password to hand over; they can change it once they are in
  const username = await suggestUser(LOGINS, c.name, c.code);
  const password = 'reg' + Math.random().toString(36).slice(2, 8);
  const row = await addLogin(LOGINS, cid, { username, password, name: c.contact || c.name, role: '', phone: c.phone });
  res.json({ ok: true, made: true, username, password, login: lineOf(row) });
}));

/* ---------------------------------------------------------------- "I have paid this" */
r.post('/paid', custAuth, asyncHandler(async (req, res) => {
  const amount = +req.body?.amount || 0;
  if (!(amount > 0)) throw new HttpError(400, 'How much was paid?');
  const method = ['CASH', 'BANK', 'CHEQUE'].includes(String(req.body?.method || '').toUpperCase()) ? String(req.body.method).toUpperCase() : 'BANK';
  await ensureCustTables();
  const data = await books();
  const c = (data?.S?.customers || []).find(x => x.id === req.cust.cid);
  const { rows: [row] } = await query(
    `INSERT INTO cust_inbox (cid, kind, data) VALUES ($1,'paid',$2) RETURNING id`,
    [req.cust.cid, JSON.stringify({ amount, method, ref: String(req.body?.ref || '').slice(0, 60), note: String(req.body?.note || '').slice(0, 200), against: Array.isArray(req.body?.against) ? req.body.against.slice(0, 20) : [] })]);
  // tell the shop at once as well, if texting is set up
  const cfg = data?.CFG?.msg;
  if (cfg?.live && cfg.apiUrl && cfg.apiKey && data?.CFG?.shop?.owner) {
    try { await sendViaProvider(cfg, data.CFG.shop.owner, `${c?.name || 'A customer'} says they paid ${amount.toFixed(2)} by ${method.toLowerCase()}. It is waiting on their account.`); } catch { /* the notice is enough */ }
  }
  res.json({ ok: true, id: Number(row.id) });
}));

export default r;
