// The customer's own page (app/my.html, at /my/<their code>) — what the shop texts them a link to.
// They sign in with the mobile the shop has on file, and can see what they owe, bill by bill, and
// tell the shop they have paid. Nothing here writes the books: a message lands in cust_inbox and the
// next till to read the books gets it as a notice on their account.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { sendViaProvider } from './regal.js';

const r = Router();
const TZ = process.env.SHOP_TZ || 'Asia/Colombo';
const OTP_WINDOW_MS = 5 * 60 * 1000;
const digits = s => String(s || '').replace(/\D/g, '');
const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const secret = () => process.env.JWT_SECRET || 'regal';
const norm = s => String(s || '').trim().toLowerCase();

let ready = null;
export function ensureCustTables() {
  if (!ready) ready = query(`
    CREATE TABLE IF NOT EXISTS cust_inbox (
      id          bigserial PRIMARY KEY,
      cid         integer NOT NULL,
      kind        varchar(12) NOT NULL,
      data        jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      imported_at timestamptz);
    CREATE INDEX IF NOT EXISTS cust_inbox_pending ON cust_inbox (imported_at) WHERE imported_at IS NULL`)
    .catch(e => { ready = null; throw e; });
  return ready;
}

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
  res.json({ ok: true, name: c.name, phone: c.phone ? mask(c.phone) : null,
    open: c.portal !== false, shop: { name: data?.CFG?.shop?.name || 'Regal Hardware', phone: data?.CFG?.shop?.phone || '', addr: data?.CFG?.shop?.addr || '' } });
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
    customer: { name: c.name, code: c.code, phone: c.phone || '', limit: c.limit || 0, level: c.level || 'retail', points: c.points || 0 },
    owed, limit: c.limit || 0,
    ageing: { d0: band(-1, 30), d30: band(30, 60), d60: band(60, 90), d90: band(90, null) },
    open, pays, recent,
    saidPaid: said.map(s => ({ id: Number(s.id), ...s.data, at: s.created_at })),
    shop: { name: CFG.shop?.name || 'Regal Hardware', phone: CFG.shop?.phone || '', land: CFG.shop?.land || '', addr: CFG.shop?.addr || '', hours: CFG.shop?.hours || '' },
    today: localDate() });
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
