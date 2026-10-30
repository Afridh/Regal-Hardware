// The customer's own page (frontend/my.html, at /my/<their code>) — what the shop texts them a link to.
// They sign in with the mobile the shop has on file, and can see what they owe, bill by bill, and
// tell the shop they have paid. Nothing here writes the books: a message lands in cust_inbox and the
// next till to read the books gets it as a notice on their account.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { sendViaProvider, regalAuth, mayRevealCode } from './regal.js';
import { letter } from '../lib/letter.js';
import { guardCode, guardPassword, sendingCode } from '../lib/tries.js';
import { ensureLogins, inviteMany, startersFor, suggestUser, addLogin, setLogin, removeLogin, listLogins, findLogin, cleanUser, loginLine,
         askForLogin, myRequests, waitingRequests, waitingCount, acceptRequest, rejectRequest } from '../services/portalLogins.js';

const LOGINS = 'cust_logins';

const r = Router();
// a number in the address that is not a number is a page that is not there, not a server fault
// (the bill link /b/:id is a text key, so only the admin routes' ids are checked)
const numOnly = (req, _res, next, v) => (!req.path.startsWith('/admin/') || /^\d+$/.test(String(v)) ? next() : next(new HttpError(404, 'Not found')));
r.param('id', numOnly); r.param('cid', numOnly);
const NO_TEXT = 'Sorry — we could not text you just now. Please ring the shop.';
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
    CREATE INDEX IF NOT EXISTS cust_inbox_pending ON cust_inbox (imported_at) WHERE imported_at IS NULL;
    -- the bill as the till drew it, kept against the link it was texted with, so the customer opens
    -- the same paper the shop printed rather than a second drawing of it that could drift
    CREATE TABLE IF NOT EXISTS bill_views (
      id         varchar(40) PRIMARY KEY,
      no         varchar(40),
      format     varchar(8) NOT NULL DEFAULT 'a5',
      html       text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now())`))
    .catch(e => { ready = null; throw e; });
  return ready;
}
const hash = (p) => bcrypt.hash(String(p), 10);
const hashOk = async (p, h) => !!h && bcrypt.compare(String(p || ''), h).catch(() => false);

async function books() {
  const { rows: [row] } = await query(`SELECT data FROM books WHERE key = 'regal'`);
  return row?.data || null;
}
/* who the page is for: the code in the address, and the mobile they type must be the one on file.
   The address is the account code and a random key the till keeps on the customer (cus-11-000005.k3x9q2ab):
   the codes run in order, so the code alone would let anyone count through the accounts. */
const splitLink = (v) => { const m = /^(.*)\.([a-z0-9]{6,})$/i.exec(String(v || '').trim()); return m ? { code: m[1], key: m[2].toLowerCase() } : { code: String(v || '').trim(), key: '' }; };
const byCode = (S, code) => { const k = splitLink(code).code; return (S.customers || []).find(c => c.id !== 1 && norm(c.code) === norm(k) && c.active !== false); };
const keyOk = (c, v) => { const key = splitLink(v).key, want = String(c?.pkey || '').toLowerCase();
  return !!(key && want && key.length === want.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(want))); };
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
  S.approvals = S.approvals || []; S.notif = S.notif || [];
  for (const row of rows) {
    if (row.kind === 'askopen' || row.kind === 'asknew') {
      // asked from their own page: to open it, or for an account — the owner says yes or no in Approvals
      if (S.approvals.some(a => a.custInbox === Number(row.id))) continue;
      const d = row.data || {}, c = row.kind === 'askopen' ? (S.customers || []).find(x => x.id === row.cid) : null;
      const who = (c && c.name) || d.name || 'A customer';
      S.approvals.unshift({ id: 'apc' + row.id, custInbox: Number(row.id), kind: row.kind === 'askopen' ? 'custPortal' : 'custNew',
        title: row.kind === 'askopen' ? `${who} asks to open their page on the site` : `${d.name} asks for an account on the site`,
        detail: [d.phone, d.note].filter(Boolean).join(' · '), data: row.kind === 'askopen' ? { cid: row.cid, on: true } : { name: d.name, phone: d.phone, note: d.note || '' },
        by: who + ' (from the site)', at: new Date(row.created_at).toLocaleString('en-CA', { timeZone: TZ, hour12: false }).replace(',', '').slice(0, 16), status: 'pending' });
      S.notif.unshift({ id: 'nca' + row.id, kind: 'approval', text: row.kind === 'askopen' ? `${who} asks to open their page on the site` : `${d.name} (${d.phone}) asks for an account on the site`, view: 'approvals', at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }), read: false, forApprovers: true });
      added++; continue;
    }
    if (row.kind === 'feedback') {
      S.feedback = S.feedback || [];
      if (S.feedback.some(x => x.inboxId === Number(row.id))) continue;
      const d = row.data || {}, inv = (S.sales || []).find(s => s.no === d.no);
      const c = (S.customers || []).find(x => x.id === row.cid);
      const fb = { id: 'fb' + row.id, inboxId: Number(row.id), no: d.no, cid: row.cid || null, who: (c && c.id !== 1 && c.name) || 'Walk-in customer',
        stars: d.stars, tags: d.tags || [], note: d.note || '', by: inv && inv.by || '', total: inv ? inv.total : 0,
        at: new Date(row.created_at).toLocaleString('en-CA', { timeZone: TZ, hour12: false }).replace(',', '').slice(0, 16) };
      S.feedback.unshift(fb); if (S.feedback.length > 2000) S.feedback.length = 2000;
      if (inv) inv.feedback = { stars: fb.stars, tags: fb.tags, note: fb.note, at: fb.at };
      S.notif.unshift({ id: 'nfb' + row.id, kind: d.stars <= 2 ? 'warn' : 'info', text: `${'★'.repeat(d.stars)}${'☆'.repeat(5 - d.stars)} from ${fb.who} on bill ${d.no}${fb.note ? ' — “' + fb.note.slice(0, 60) + '”' : ''}`,
        view: 'feedback', at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }), read: false });
      added++; continue;
    }
    if (S.notices.some(n => n.inboxId === Number(row.id))) continue;
    S.notices.push({ id: 'n' + row.id, inboxId: Number(row.id), kind: 'customer', cid: row.cid, status: 'open',
      date: new Date(row.created_at).toLocaleDateString('en-CA', { timeZone: TZ }), ...row.data });
    added++;
  }
  return added;
}
export async function markCustImported(data) {
  const S = data?.S; if (!S) return 0;
  const ids = (S.notices || []).map(n => n.inboxId).filter(Boolean)
    .concat((S.approvals || []).map(a => a.custInbox).filter(Boolean))
    .concat((S.feedback || []).map(x => x.inboxId).filter(Boolean));
  if (!ids.length) return 0;
  await ensureCustTables();
  const { rowCount } = await query(`UPDATE cust_inbox SET imported_at = now() WHERE imported_at IS NULL AND id = ANY($1::bigint[])`, [ids]);
  return rowCount;
}

// ---------------------------------------------------------------- the page opens
/** Who this page is for, before anyone signs in: just the name and a masked mobile — and only when the
    address carries that customer's key. Without it (an old link, or a number changed by hand) the page
    is the plain sign-in, and says nothing about whether such an account exists. */
r.get('/who/:code', asyncHandler(async (req, res) => {
  const data = await books();
  const c = byCode(data?.S || {}, req.params.code);
  if (!c || !keyOk(c, req.params.code)) return res.json({ ok: true, plain: true, name: null, phone: null, logins: 0, open: true,
    shop: { name: data?.CFG?.shop?.name || 'Regal Hardware', phone: data?.CFG?.shop?.phone || '', addr: data?.CFG?.shop?.addr || '' } });
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
  const l = await guardPassword(user, req.ip, async () => {
    const { rows: [x] } = await query(`SELECT * FROM cust_logins WHERE lower(username) = $1`, [user]);
    await new Promise(r2 => setTimeout(r2, 250));                     // slow down guessing
    return x && x.active && ((await hashOk(pass, x.own_hash)) || (await hashOk(pass, x.admin_hash))) ? x : null;
  });
  if (!l) throw new HttpError(401, 'That name and password do not match');
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
  sendingCode(phone, req.ip);
  const code = otpFor(phone);
  const cfg = data?.CFG?.msg;
  if (cfg?.live && cfg.apiUrl && cfg.apiKey) {
    try { await sendViaProvider(cfg, phone, letter(data?.CFG, 'customer', `Your code to set a new password is ${code}.\nIt works for 5 minutes. Please do not share it.`));
      return res.json({ ok: true, sent: true, phone: mask(phone) }); }
    catch (e) { console.error('cust forgot sms failed', e.message); }
  }
  res.json({ ok: true, sent: false, phone: mask(phone), ...(mayRevealCode(req) ? { code } : { note: NO_TEXT }) });
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
  guardCode(phone, req.ip, () => otpOk(phone, req.body?.code));
  await query(`UPDATE cust_logins SET own_hash = $2, starter = NULL WHERE id = $1`, [l.id, await hash(pass)]);
  res.json({ ok: true });
}));

/* A customer who opened their own link (code and key) is not asked anything: the code goes to the mobile
   the shop has for them. The key is only in links texted to that mobile, and the code still has to come
   back from it, so a link passed on does not let anybody else in. */
const viaLink = (S, link) => { const c = link ? byCode(S, link) : null; return c && keyOk(c, link) && /^0\d{9}$/.test(digits(c.phone)) ? c : null; };

r.post('/otp', asyncHandler(async (req, res) => {
  const data = await books();
  const S = data?.S || {};
  const own = !req.body?.phone ? viaLink(S, req.body?.link) : null;
  const phone = own ? digits(own.phone) : digits(req.body?.phone);
  if (!/^0\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a mobile like 0771234567');
  const list = byPhone(S, phone);
  const c = own || (req.body?.code ? list.find(x => norm(x.code) === norm(splitLink(req.body.code).code)) || byCode(S, req.body.code) : list[0]);
  if (!c || digits(c.phone) !== phone) throw new HttpError(404, 'That mobile is not the one the shop has for this account');
  if (c.portal === false) throw new HttpError(403, 'The shop has not opened this page for you yet — give them a ring');
  sendingCode(phone, req.ip);
  const code = otpFor(phone);
  const cfg = data?.CFG?.msg;
  if (cfg?.live && cfg.apiUrl && cfg.apiKey) {
    try { await sendViaProvider(cfg, phone, letter(data?.CFG, 'customer', `Your sign-in code is ${code}.\nIt works for 5 minutes. Please do not share it.`)); return res.json({ ok: true, sent: true, phone: own ? mask(phone) : undefined }); }
    catch (e) { console.error('cust otp sms failed', e.message); }
  }
  res.json({ ok: true, sent: false, phone: own ? mask(phone) : undefined, ...(mayRevealCode(req) ? { code } : { note: NO_TEXT }) });
}));

r.post('/login', asyncHandler(async (req, res) => {
  const data = await books();
  const S = data?.S || {};
  const own = !req.body?.phone ? viaLink(S, req.body?.link) : null;
  const phone = own ? digits(own.phone) : digits(req.body?.phone);
  guardCode(phone, req.ip, () => otpOk(phone, req.body?.code));
  const list = byPhone(S, phone);
  const c = own || (req.body?.acc ? list.find(x => norm(x.code) === norm(splitLink(req.body.acc).code)) || list[0] : list[0]);
  if (!c) throw new HttpError(404, 'That mobile is not on file');
  if (c.portal === false) throw new HttpError(403, 'The shop has not opened this page for you yet — give them a ring');
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
    .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 300)
    .map(p => ({ no: p.no, date: p.date, amount: p.amount, method: p.method, ref: p.ref || '', against: p.against || [], advance: +p.advance || 0 }));
  /* The statement: every entry on their account, as the shop's own ledger has it — bills, payments,
     returns, anything taken off — with what they owed after each. What they owe is the account and,
     less, anything they paid ahead (held as their credit). */
  const stmt = [];
  for (const j of (S.journal || [])) {
    let d = 0;
    for (const l of (j.lines || [])) if (l.party && l.party.type === 'C' && l.party.id === c.id && (l.ac === '1100' || l.ac === '2050')) d += (+l.dr || 0) - (+l.cr || 0);
    if (Math.abs(d) < 0.005) continue;
    const desc = String(j.desc || '');
    const kind = /^Sale |^Owing on bill/i.test(desc) ? 'bill' : /^Return /.test(desc) ? 'return' : /^Receipt /.test(desc) ? 'payment' : /bounced/i.test(desc) ? 'bounced' : 'other';
    stmt.push({ date: j.date, ref: j.ref || '', kind, what: { bill: 'Bill', return: 'Goods returned', payment: 'Payment received', bounced: 'Cheque returned' }[kind] || desc, amount: +d.toFixed(2) });
  }
  stmt.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let run = 0; for (const x of stmt) { run = +(run + x.amount).toFixed(2); x.balance = run; }
  // every bill, newest first, and what came back
  const allBills = mine.filter(s => +s.total > 0).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.no).localeCompare(String(a.no))).slice(0, 500)
    .map(s => ({ no: s.no, date: s.date, total: s.total, paid: s.paid, balance: s.balance, type: s.type, lines: (s.lines || []).length,
      returned: mine.some(r => r.returnOf === s.no) }));
  const returns = mine.filter(s => +s.total < 0).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 200)
    .map(s => ({ no: s.no, date: s.date, of: s.returnOf || null, amount: +(-s.total).toFixed(2), why: s.returnWhy || '',
      how: s.toAccount ? 'account' : 'cash', items: (s.lines || []).filter(l => l.qty < 0).map(l => ({ name: l.name || ((S.products || []).find(p => p.id === l.pid) || {}).name || 'Item', qty: -l.qty })) }));
  const recent = mine.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10)
    .map(s => ({ no: s.no, date: s.date, total: s.total, balance: s.balance }));
  await ensureCustTables();
  const { rows: said } = await query(`SELECT id, data, created_at FROM cust_inbox WHERE cid = $1 AND imported_at IS NULL ORDER BY id DESC`, [c.id]);
  res.json({ ok: true,
    who: req.cust.user || null,
    customer: { name: c.name, code: c.code, phone: c.phone || '', limit: c.limit || 0, level: c.level || 'retail', points: c.points || 0 },
    owed, limit: c.limit || 0,
    ageing: { d0: band(-1, 30), d30: band(30, 60), d60: band(60, 90), d90: band(90, null) },
    open, pays, recent, statement: stmt, bills: allBills, returns,
    saidPaid: said.map(s => ({ id: Number(s.id), ...s.data, at: s.created_at })),
    shop: { name: CFG.shop?.name || 'Regal Hardware', phone: CFG.shop?.phone || '', land: CFG.shop?.land || '', addr: CFG.shop?.addr || '', hours: CFG.shop?.hours || '' },
    today: localDate() });
}));

/** The till stores the bill as it printed it, against the link id it was texted with. */
r.post('/admin/billview', regalAuth, asyncHandler(async (req, res) => {
  const id = String(req.body?.id || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const html = String(req.body?.html || '');
  const format = req.body?.format === 'r80' ? 'r80' : 'a5';
  if (id.length < 6) throw new HttpError(400, 'Which bill link is this for?');
  if (html.length < 40 || html.length > 400000) throw new HttpError(400, 'That does not look like a bill');
  await ensureCustTables();
  await query(`INSERT INTO bill_views (id, no, format, html) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET no = EXCLUDED.no, format = EXCLUDED.format, html = EXCLUDED.html, created_at = now()`,
    [id, String(req.body?.no || '').slice(0, 40), format, html]);
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- the e-bill link
   Every bill carries a link the shop can text: regalhw.lk/b/<id>, where the id is random and long
   enough that it cannot be guessed or counted through. Opening it needs no sign-in — whoever has the
   link was given it — so it shows the bill and nothing else about the account. */
r.get('/b/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (id.length < 6) throw new HttpError(404, 'That link is not a bill');
  const data = await books();
  const S = data?.S || {}, CFG = data?.CFG || {};
  const inv = (S.sales || []).find(x => String(x.link || '').toLowerCase().endsWith('/' + id));
  if (!inv) throw new HttpError(404, 'That bill is not here — the link may be old, or mistyped');
  // the paper the till drew, if it sent it over: that is what the customer should see
  const { rows: [view] } = await query(`SELECT format, html FROM bill_views WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
  const prod = (pid) => (S.products || []).find(x => x.id === pid) || {};
  const cust = (S.customers || []).find(c => c.id === inv.customerId);
  const sh = CFG.shop || {};
  const logo = /^(data:image\/|https?:\/\/|\/)/.test(String(sh.logo || '')) ? sh.logo : '/regal-logo.png';
  // an MRP is only worth showing when the price is under it (a line sold above it says nothing)
  const lineMrp = (l) => { const m = +prod(l.pid).mrp || 0; return m > +l.price + 0.005 && l.qty > 0 ? m : 0; };
  const saved = (inv.lines || []).reduce((a, l) => a + (lineMrp(l) ? (lineMrp(l) - l.price) * l.qty : 0) + (l.qty > 0 ? (+l.disc || 0) : 0), 0) + (+inv.billDisc || 0);
  const fb = inv.feedback || await fbWaiting(id);
  res.json({ ok: true, bill: {
    no: inv.no, date: inv.date, time: inv.time || '', type: inv.type,
    sub: inv.sub, billDisc: inv.billDisc || 0, total: inv.total, paid: inv.paid, balance: inv.balance,
    by: inv.by || '',
    customer: cust && cust.id !== 1 ? { name: cust.name, code: cust.code } : null,
    lines: (inv.lines || []).map(l => {
      const p = prod(l.pid);
      return { name: l.name || p.name || 'Item', code: p.code || '', unit: p.unit || '',
        qty: l.qty, price: l.price, disc: l.disc || 0, mrp: lineMrp(l),
        amount: +(l.qty * l.price - (l.disc || 0)).toFixed(2), returned: l.qty < 0 };
    }),
    pays: (inv.pays || []).map(x => ({ method: x.method, amount: x.amount })),
    paper: view?.format || (inv.paper === 'r80' ? 'r80' : 'a5'),
    html: view?.html || null,
    saved: +saved.toFixed(2),
    feedback: fb ? { stars: fb.stars, tags: fb.tags || [], note: fb.note || '' } : null,
    shop: { name: sh.name || 'Regal Hardware', phone: sh.phone || '', land: sh.land || '', addr: sh.addr || '', web: sh.web || '',
      logo, sinhala: sh.sinhala || '', near: sh.near || '', tags: sh.tags || '', line1: sh.line1 || '', email: sh.email || '' },
  } });
}));

/* What the customer thought of it: one rating a bill, from the same link. It waits in cust_inbox like
   everything else they send, and the next till to read the books puts it on the bill and tells the shop. */
async function fbWaiting(link) {     // by the bill's own link: a bill number can come round again, its link cannot
  await ensureCustTables();
  const { rows } = await query(`SELECT data FROM cust_inbox WHERE kind = 'feedback' ORDER BY id DESC LIMIT 500`);
  const row = rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)).find(d => d && d.link === link);
  return row || null;
}
const FB_TAGS = ['Friendly staff', 'Quick service', 'Good prices', 'Good quality', 'Found everything', 'Helpful advice', 'Slow service', 'Out of stock', 'Price too high', 'Wrong item'];
r.post('/b/:id/feedback', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (id.length < 6) throw new HttpError(404, 'That link is not a bill');
  const stars = Math.round(+req.body?.stars || 0);
  if (!(stars >= 1 && stars <= 5)) throw new HttpError(400, 'Tap the stars to rate your visit');
  const S = (await books())?.S || {};
  const inv = (S.sales || []).find(x => String(x.link || '').toLowerCase().endsWith('/' + id));
  if (!inv) throw new HttpError(404, 'That bill is not here — the link may be old, or mistyped');
  if (inv.feedback || await fbWaiting(id)) return res.json({ ok: true, already: true });
  const tags = (Array.isArray(req.body?.tags) ? req.body.tags : []).filter(x => FB_TAGS.includes(x)).slice(0, 6);
  const note = String(req.body?.note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  await query(`INSERT INTO cust_inbox (cid, kind, data) VALUES ($1, 'feedback', $2)`, [inv.customerId || 0, JSON.stringify({ no: inv.no, link: id, stars, tags, note })]);
  res.json({ ok: true });
}));

/** One bill of theirs, line by line. Only ever their own — the account on the token decides. */
r.get('/bill/:no', custAuth, asyncHandler(async (req, res) => {
  const data = await books();
  const S = data?.S || {}, CFG = data?.CFG || {};
  const inv = (S.sales || []).find(s => String(s.no) === String(req.params.no) && s.customerId === req.cust.cid);
  if (!inv) throw new HttpError(404, 'That bill is not on this account');
  const name = (pid) => (S.products || []).find(p => p.id === pid);
  res.json({ ok: true, bill: {
    no: inv.no, date: inv.date, time: inv.time || '', type: inv.type,
    sub: inv.sub, billDisc: inv.billDisc || 0, total: inv.total, paid: inv.paid, balance: inv.balance,
    by: inv.by || '', salesman: inv.salesman || '',
    lines: (inv.lines || []).map(l => {
      const p = name(l.pid) || {};
      return { name: l.name || p.name || 'Item', code: p.code || '', unit: p.unit || '',
        qty: l.qty, price: l.price, disc: l.disc || 0,
        amount: +(l.qty * l.price - (l.disc || 0)).toFixed(2), returned: l.qty < 0 };
    }),
    pays: (inv.pays || []).map(x => ({ method: x.method, amount: x.amount, ref: x.ref || '' })),
    shop: { name: CFG.shop?.name || 'Regal Hardware', phone: CFG.shop?.phone || '', addr: CFG.shop?.addr || '' },
  } });
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
    const link = ('regalhw.lk/my/' + String(c?.code || '') + (c?.pkey ? '.' + c.pkey : '')).toLowerCase();
    try {
      sent = await sendViaProvider(data?.CFG?.msg,  made.request.phone, letter(data?.CFG, 'customer',
        `Your sign-in for ${c?.name || shop} is ready.\n\nLink: ${link}\nUser name: ${made.username}\nPassword: ${made.password}\n\nPlease change the password once you are in.`));
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
/* ---------------------------------------------------------------- asking the shop
   Someone whose page is not open yet, or who has no account at all, asks from the page. A code goes to
   the mobile first, so an ask is always from the person who has that phone; then the ask waits for the
   owner in Approvals. Saying yes opens the page — or makes the customer — and texts them how to sign in. */
r.post('/ask-code', asyncHandler(async (req, res) => {
  const phone = digits(req.body?.phone);
  if (!/^0\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a mobile like 0771234567');
  sendingCode(phone, req.ip);
  const data = await books();
  const code = otpFor(phone), cfg = data?.CFG?.msg;
  if (cfg?.live && cfg.apiUrl && cfg.apiKey) {
    try { await sendViaProvider(cfg, phone, letter(data?.CFG, 'customer', `Your code to send your request to the shop is ${code}.\nIt works for 5 minutes. Please do not share it.`)); return res.json({ ok: true, sent: true }); }
    catch (e) { console.error('cust ask sms failed', e.message); }
  }
  res.json({ ok: true, sent: false, ...(mayRevealCode(req) ? { code } : { note: NO_TEXT }) });
}));
r.post('/ask', asyncHandler(async (req, res) => {
  const phone = digits(req.body?.phone);
  guardCode(phone, req.ip, () => otpOk(phone, req.body?.code));
  const data = await books(), S = data?.S || {};
  const c = byPhone(S, phone)[0];
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 80), note = String(req.body?.note || '').trim().slice(0, 200);
  if (c && c.portal !== false) throw new HttpError(400, 'Your page is already open — sign in with your mobile');
  if (!c && name.length < 2) throw new HttpError(400, 'Your name, or your business name, please');
  await ensureCustTables();
  const kind = c ? 'askopen' : 'asknew';
  // one ask at a time from a mobile
  const { rows: open } = await query(`SELECT id, data FROM cust_inbox WHERE imported_at IS NULL AND kind IN ('askopen','asknew')`);
  if (open.some(r => digits((typeof r.data === 'string' ? JSON.parse(r.data) : r.data).phone) === phone)) return res.json({ ok: true, already: true });
  await query(`INSERT INTO cust_inbox (cid, kind, data) VALUES ($1, $2, $3)`, [c ? c.id : 0, kind, JSON.stringify({ phone, name: name || (c && c.name) || '', note })]);
  res.json({ ok: true, kind, name: c ? c.name : name });
}));

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
