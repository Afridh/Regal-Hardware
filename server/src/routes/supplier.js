// The supplier's own page (app/supplier.html, at /supplier) — a rep signs in with the mobile the
// shop has on file for the supplier and can:
//   - see the orders the shop sent them (POs), accept, ask for a change, or mark them dispatched
//   - upload an order they took by hand (photos of the sheet + a note), which waits for the
//     owner's approval in the till
// Like the shop site, nothing here touches the books directly: everything lands in sup_inbox and
// the next till that reads the books gets it merged in (injectSupplierInbox); a books save that
// carries it marks it imported.  Photos stay on the server (sup_media), the books only hold links.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { sendViaProvider, regalAuth, mayRevealCode } from './regal.js';
import { listLogins, findLogin, addLogin, setLogin, removeLogin, checkLogin, loginLine, cleanUser, passOk, suggestUser, inviteMany, startersFor,
         askForLogin, myRequests, waitingRequests, waitingCount, acceptRequest, rejectRequest } from '../services/portalLogins.js';

const r = Router();
const NO_TEXT = 'Sorry — we could not text you just now. Please ring the shop.';
const TZ = process.env.SHOP_TZ || 'Asia/Colombo';
const OTP_WINDOW_MS = 5 * 60 * 1000;
const digits = s => String(s || '').replace(/\D/g, '');
const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const localTime = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const secret = () => process.env.JWT_SECRET || 'regal';

let ready = null;
export function ensureSupplierTables() {
  if (!ready) ready = query(`
    CREATE TABLE IF NOT EXISTS sup_inbox (
      id          bigserial PRIMARY KEY,
      sid         integer NOT NULL,
      kind        varchar(12) NOT NULL,
      data        jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      imported_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS sup_inbox_pending ON sup_inbox (imported_at) WHERE imported_at IS NULL;
    CREATE TABLE IF NOT EXISTS sup_media (
      id          bigserial PRIMARY KEY,
      inbox_id    bigint NOT NULL,
      mime        varchar(40) NOT NULL,
      data        bytea NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );`).catch(e => { ready = null; throw e; });
  return ready;
}

async function books() {
  const { rows: [row] } = await query(`SELECT data FROM books WHERE key = 'regal'`);
  return row?.data || null;
}
const supplierByPhone = (S, phone) => (S.suppliers || []).find(s => digits(s.phone) && digits(s.phone) === phone && s.active !== false);

function otpFor(phone, when = Date.now()) {
  const win = Math.floor(when / OTP_WINDOW_MS);
  const h = crypto.createHmac('sha256', secret()).update('sup|' + digits(phone) + '|' + win).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}
const otpOk = (phone, code) => [0, 1].some(back => otpFor(phone, Date.now() - back * OTP_WINDOW_MS) === String(code || '').trim());
/** A photo link the till can show in an <img> without a header: the id plus a signature. */
const photoKey = id => crypto.createHmac('sha256', secret()).update('photo|' + id).digest('hex').slice(0, 20);
export const photoUrl = id => `/api/sup/photo/${id}?k=${photoKey(id)}`;

function supAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'Sign in with your mobile first');
    const p = jwt.verify(token, secret());
    if (p.kind !== 'sup') throw new HttpError(401, 'Wrong kind of token');
    req.sup = p; next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return next(new HttpError(401, 'Please sign in again'));
    next(e);
  }
}

// ---------------------------------------------------------------- books ↔ inbox
export async function pendingSupplierCount() {
  await ensureSupplierTables();
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM sup_inbox WHERE imported_at IS NULL`);
  return n;
}
/** Merge what suppliers sent into a books document about to be handed to a till. */
export async function injectSupplierInbox(data) {
  if (!data || !data.S) return 0;
  await ensureSupplierTables();
  const { rows } = await query(`SELECT i.id, i.sid, i.kind, i.data, i.created_at, coalesce(array_agg(m.id ORDER BY m.id) FILTER (WHERE m.id IS NOT NULL), '{}') AS photos
                                FROM sup_inbox i LEFT JOIN sup_media m ON m.inbox_id = i.id WHERE i.imported_at IS NULL GROUP BY i.id ORDER BY i.id`);
  if (!rows.length) return 0;
  const S = data.S; S.orders = S.orders || []; S.notif = S.notif || []; S.payReqs = S.payReqs || [];
  let added = 0;
  for (const row of rows) {
    const sup = (S.suppliers || []).find(s => s.id === row.sid);
    const name = sup ? sup.name.split(/[–(]/)[0].trim() : 'Supplier';
    if (row.kind === 'order') {
      const id = 'sp' + row.id;
      if (S.orders.some(o => o.id === id)) continue;
      const d = row.data;
      S.orders.push({ id, inboxId: row.id, dir: 'IN', sid: row.sid, rep: d.rep || 'Rep', text: d.text || '(photo only)', date: d.date || localDate(), status: 'pending', note: '',
        files: row.photos.map(photoUrl), unreadShop: true, unreadSup: false, src: 'portal', needsOwner: true,
        events: [{ id: 'e' + row.id, actor: 'supplier', name: d.rep || name, action: 'uploaded', note: d.text || '', at: new Date(row.created_at).getTime() }] });
      S.notif.unshift({ id: 'n' + row.id.toString(36) + 's', kind: 'order', text: `${name} sent an order (${row.photos.length} photo${row.photos.length === 1 ? '' : 's'}) — needs the owner's approval`, view: 'orders', at: localTime(), read: false, forApprovers: true });
      added++;
    } else if (row.kind === 'payreq') {
      const id = 'pr' + row.id;
      if (S.payReqs.some(x => x.id === id)) continue;
      const d = row.data;
      S.payReqs.push({ id, inboxId: row.id, sid: row.sid, rep: d.rep || 'Rep', date: d.date || localDate(),
        lines: d.lines || [], total: +d.total || 0, note: d.note || '', status: 'sent', unreadShop: true,
        events: [{ actor: 'supplier', name: d.rep || name, action: 'asked', note: d.note || '', at: new Date(row.created_at).getTime() }] });
      S.notif.unshift({ id: 'n' + row.id.toString(36) + 'p', kind: 'info',
        text: `${name} is asking to be paid — ${(d.lines || []).length} bill${(d.lines || []).length === 1 ? '' : 's'}`,
        view: 'payreqs', at: localTime(), read: false, forApprovers: true });
      added++;
    } else if (row.kind === 'reply') {
      const d = row.data, po = S.orders.find(o => o.no === d.no && o.dir === 'OUT');
      if (!po) { continue; }                                        // an order that was thrown away: nothing to attach to
      if ((po.events || []).some(e => e.inboxId === row.id)) continue;
      po.events = po.events || [];
      po.events.push({ id: 'e' + row.id, inboxId: row.id, actor: 'supplier', name: d.rep || name, action: d.action, note: [d.note, d.invoice ? 'invoice ' + d.invoice : '', d.eta ? 'expected ' + d.eta : ''].filter(Boolean).join(' · '), at: new Date(row.created_at).getTime() });
      if (d.action === 'accepted' && po.status === 'sent') po.status = 'accepted';
      if (d.action === 'changes') po.status = 'changes';
      if (d.action === 'dispatched') { po.status = 'dispatched'; po.invoiceNo = d.invoice || po.invoiceNo; }
      po.unreadShop = true;
      S.notif.unshift({ id: 'n' + row.id.toString(36) + 'r', kind: 'order', text: `${name}: order ${po.no} ${{ accepted: 'confirmed', changes: 'needs a change', dispatched: 'is on its way' }[d.action] || d.action}`, view: 'orders', at: localTime(), read: false });
      added++;
    }
  }
  S.notif = S.notif.slice(0, 60);
  return added;
}
/** A till has saved books that carry these — they are in the shop's hands now. */
export async function markSupplierImported(data) {
  const S = data?.S; if (!S) return 0;
  const ids = new Set();
  for (const o of (S.orders || [])) { if (o.inboxId) ids.add(o.inboxId); for (const e of (o.events || [])) if (e.inboxId) ids.add(e.inboxId); }
  for (const p of (S.payReqs || [])) if (p.inboxId) ids.add(p.inboxId);
  if (!ids.size) return 0;
  await ensureSupplierTables();
  const { rowCount } = await query(`UPDATE sup_inbox SET imported_at = now() WHERE imported_at IS NULL AND id = ANY($1::bigint[])`, [[...ids]]);
  return rowCount;
}

// ---------------------------------------------------------------- the portal API
r.post('/otp', asyncHandler(async (req, res) => {
  const phone = digits(req.body?.phone);
  if (!/^0\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a mobile like 0771234567');
  const data = await books();
  const sup = supplierByPhone(data?.S || {}, phone);
  if (!sup) throw new HttpError(404, 'That mobile is not on file for any supplier — ask the shop to add it to your account');
  const code = otpFor(phone);
  const cfg = data?.CFG?.msg;
  if (cfg?.live && cfg.apiUrl && cfg.apiKey) {
    try { await sendViaProvider(cfg, phone, `${data?.CFG?.shop?.name || 'Regal Hardware'}: your supplier sign-in code is ${code}. It works for 5 minutes.`); return res.json({ ok: true, sent: true, name: sup.name }); }
    catch (e) { console.error('sup otp sms failed', e.message); }
  }
  res.json({ ok: true, sent: false, name: sup.name, ...(mayRevealCode() ? { code } : { note: NO_TEXT }) });
}));

r.post('/login', asyncHandler(async (req, res) => {
  const phone = digits(req.body?.phone);
  if (!otpOk(phone, req.body?.code)) throw new HttpError(401, 'That code is not right, or it has expired');
  const data = await books();
  const sup = supplierByPhone(data?.S || {}, phone);
  if (!sup) throw new HttpError(404, 'That mobile is not on file for any supplier');
  const rep = String(req.body?.rep || '').trim().slice(0, 60);
  res.json({ ok: true, token: jwt.sign({ kind: 'sup', sid: sup.id, phone, rep }, secret(), { expiresIn: '30d' }), supplier: sup.name, sid: sup.id, rep });
}));

/* ---------------------------------------------------------------- signing in by name
   A supplier's rep and their office each get a user name of their own. Either password opens it:
   the one the shop set and the one the person has since chosen. */
const LOGINS = 'sup_logins';
r.post('/signin', asyncHandler(async (req, res) => {
  const l = await checkLogin(LOGINS, req.body?.user, req.body?.password);
  if (!l) throw new HttpError(401, 'That name and password do not match');
  const data = await books();
  const sup = (data?.S?.suppliers || []).find(s => s.id === l.owner);
  if (!sup) throw new HttpError(404, 'That supplier is no longer on file');
  if (sup.enabled === false) throw new HttpError(403, 'The shop has closed this page — give them a ring');
  const rep = l.name || l.username;
  res.json({ ok: true, token: jwt.sign({ kind: 'sup', sid: sup.id, lid: Number(l.id), phone: digits(l.phone || sup.phone), rep }, secret(), { expiresIn: '30d' }),
    supplier: sup.name, sid: sup.id, rep });
}));

r.post('/forgot', asyncHandler(async (req, res) => {
  const l = await findLogin(LOGINS, req.body?.user);
  if (!l || !l.active) throw new HttpError(404, 'There is no sign-in by that name');
  const data = await books();
  const sup = (data?.S?.suppliers || []).find(s => s.id === l.owner);
  const phone = digits(l.phone || sup?.phone);
  if (!/^0\d{9}$/.test(phone)) throw new HttpError(400, 'There is no mobile on that sign-in — ring the shop');
  const code = otpFor(phone);
  const cfg = data?.CFG?.msg;
  if (cfg?.live && cfg.apiUrl && cfg.apiKey) {
    try { await sendViaProvider(cfg, phone, `${data?.CFG?.shop?.name || 'Regal Hardware'}: your code to set a new password is ${code}. It works for 5 minutes.`);
      return res.json({ ok: true, sent: true, phone: phone.replace(/^(\d{3})\d{4}(\d{3})$/, '$1••••$2') }); }
    catch (e) { console.error('sup forgot sms failed', e.message); }
  }
  res.json({ ok: true, sent: false, phone, ...(mayRevealCode() ? { code } : { note: NO_TEXT }) });
}));

r.post('/reset', asyncHandler(async (req, res) => {
  const l = await findLogin(LOGINS, req.body?.user);
  if (!l || !l.active) throw new HttpError(404, 'There is no sign-in by that name');
  const pass = String(req.body?.password || '');
  if (pass.length < 6) throw new HttpError(400, 'A password needs at least six characters');
  const data = await books();
  const sup = (data?.S?.suppliers || []).find(s => s.id === l.owner);
  if (!otpOk(digits(l.phone || sup?.phone), req.body?.code)) throw new HttpError(401, 'That code is not right, or it has expired');
  await setLogin(LOGINS, Number(l.id), l.owner, { ownPassword: pass });
  res.json({ ok: true });
}));

r.post('/password', supAuth, asyncHandler(async (req, res) => {
  if (!req.sup.lid) throw new HttpError(400, 'This page was opened with a code, not a sign-in');
  const pass = String(req.body?.password || '');
  if (pass.length < 6) throw new HttpError(400, 'A password needs at least six characters');
  const rows = await listLogins(LOGINS, req.sup.sid);
  const l = rows.find(x => Number(x.id) === req.sup.lid);
  if (!l) throw new HttpError(404, 'That sign-in is no longer there');
  if (!(await passOk(String(req.body?.current || ''), l.own_hash)) && !(await passOk(String(req.body?.current || ''), l.admin_hash)))
    throw new HttpError(401, 'The password you have now is not right');
  await setLogin(LOGINS, Number(l.id), l.owner, { ownPassword: pass });
  res.json({ ok: true });
}));

/* the shop's side: who may sign in for this supplier */
/* Someone else at the supplier needs to get in. It waits for the shop. */
r.post('/team', supAuth, asyncHandler(async (req, res) => {
  const out = await askForLogin('S', req.sup.sid, { askedBy: req.sup.user || req.sup.rep || '', name: req.body?.name,
    role: req.body?.role, phone: req.body?.phone, note: req.body?.note });
  res.json({ ok: true, ...out });
}));
r.get('/team', supAuth, asyncHandler(async (req, res) => {
  res.json({ ok: true, requests: await myRequests('S', req.sup.sid) });
}));

/* ---- the shop's side of those asks ---- */
r.get('/admin/team', regalAuth, asyncHandler(async (req, res) => {
  const sid = req.query.sid ? Number(req.query.sid) : undefined;
  res.json({ ok: true, waiting: await waitingRequests('S', sid), count: await waitingCount('S') });
}));
r.post('/admin/team/:id/accept', regalAuth, asyncHandler(async (req, res) => {
  const made = await acceptRequest('sup_logins', 'S', Number(req.params.id), req.regalUser?.name);
  let sent = null;
  if (made.request.phone) {
    const data = await books();
    const shop = data?.CFG?.shop?.name || 'Regal Hardware';
    try {
      sent = await sendViaProvider(data?.CFG?.msg, made.request.phone,
        `${shop}: your sign-in for regalhw.lk/supplier — user ${made.username}, password ${made.password}`);
    } catch (e) { sent = { ok: false, status: e.message } }
  }
  res.json({ ok: true, login: loginLine(made.login), username: made.username, password: made.password, sent });
}));
r.post('/admin/team/:id/reject', regalAuth, asyncHandler(async (req, res) => {
  await rejectRequest('S', Number(req.params.id), req.regalUser?.name, req.body?.reason);
  res.json({ ok: true });
}));

r.get('/admin/logins/:sid', regalAuth, asyncHandler(async (req, res) => {
  res.json({ ok: true, logins: (await listLogins(LOGINS, +req.params.sid)).map(loginLine) });
}));
r.post('/admin/logins/:sid', regalAuth, asyncHandler(async (req, res) => {
  const sid = +req.params.sid;
  const username = cleanUser(req.body?.username), password = String(req.body?.password || '');
  if (username.length < 3) throw new HttpError(400, 'A user name needs at least three letters or figures');
  if (password.length < 6) throw new HttpError(400, 'A password needs at least six characters');
  const data = await books();
  if (!(data?.S?.suppliers || []).some(s => s.id === sid)) throw new HttpError(404, 'No such supplier');
  if (await findLogin(LOGINS, username)) throw new HttpError(409, `“${username}” is already in use`);
  res.json({ ok: true, login: loginLine(await addLogin(LOGINS, sid, { ...req.body, username, password })) });
}));
r.post('/admin/logins/:sid/:id', regalAuth, asyncHandler(async (req, res) => {
  const row = await setLogin(LOGINS, +req.params.id, +req.params.sid, req.body || {});
  if (!row) throw new HttpError(404, 'No such sign-in');
  res.json({ ok: true, login: loginLine(row) });
}));
r.delete('/admin/logins/:sid/:id', regalAuth, asyncHandler(async (req, res) => {
  await removeLogin(LOGINS, +req.params.id, +req.params.sid);
  res.json({ ok: true });
}));
/** One for everybody: any supplier with no sign-in gets one, and the whole list comes back with it —
    everyone still on the password the shop gave, so it can be read out, saved or texted. */
r.post('/admin/invite-all', regalAuth, asyncHandler(async (req, res) => {
  const data = await books();
  const people = (data?.S?.suppliers || []).filter(s => s.active !== false);
  const made = await inviteMany(LOGINS, people);
  const byId = new Map(people.map(s => [s.id, s]));
  const logins = (await startersFor(LOGINS)).filter(l => byId.has(l.owner))
    .map(l => ({ ...l, who: byId.get(l.owner).name, phone: l.phone || byId.get(l.owner).phone || '' }));
  res.json({ ok: true, made: made.length, of: people.length, logins });
}));

/** The shop switching the page on: make a sign-in if there is none, and hand back what to text. */
r.post('/admin/invite/:sid', regalAuth, asyncHandler(async (req, res) => {
  const sid = +req.params.sid;
  const data = await books();
  const sup = (data?.S?.suppliers || []).find(s => s.id === sid);
  if (!sup) throw new HttpError(404, 'No such supplier');
  const have = await listLogins(LOGINS, sid);
  if (have.length) return res.json({ ok: true, made: false, logins: have.map(loginLine) });
  const username = await suggestUser(LOGINS, sup.contact || sup.name, sup.code);
  const password = 'reg' + Math.random().toString(36).slice(2, 8);
  const row = await addLogin(LOGINS, sid, { username, password, name: sup.contact || '', role: 'rep', phone: sup.phone });
  res.json({ ok: true, made: true, username, password, login: loginLine(row) });
}));

/** Everything this supplier can see: the shop's orders to them, and what they have sent. */
r.get('/me', supAuth, asyncHandler(async (req, res) => {
  const data = await books();
  const S = data?.S || {}, CFG = data?.CFG || {};
  const sup = (S.suppliers || []).find(s => s.id === req.sup.sid);
  if (!sup) throw new HttpError(404, 'Supplier no longer on file');
  await ensureSupplierTables();
  const { rows: pending } = await query(`SELECT i.id, i.kind, i.data, i.created_at, count(m.id)::int AS photos FROM sup_inbox i LEFT JOIN sup_media m ON m.inbox_id = i.id WHERE i.sid = $1 AND i.imported_at IS NULL GROUP BY i.id ORDER BY i.id DESC`, [sup.id]);
  const pendingReplies = pending.filter(p => p.kind === 'reply');
  const pos = (S.orders || []).filter(o => o.dir === 'OUT' && o.sid === sup.id).map(o => {
    const mine = pendingReplies.filter(p => p.data.no === o.no).map(p => ({ action: p.data.action, note: p.data.note, invoice: p.data.invoice, at: new Date(p.created_at).getTime(), pending: true }));
    const last = mine[0];
    return { no: o.no, date: o.date, want: o.want, note: o.note, by: o.by, status: last ? (last.action === 'accepted' ? 'accepted' : last.action) : o.status, invoiceNo: o.invoiceNo || (last && last.invoice) || '',
      lines: (o.lines || []).map(l => ({ desc: l.desc, unit: l.unit, qty: l.qty, known: !!l.known })),
      events: (o.events || []).map(e => ({ who: e.actor === 'shop' ? (CFG.shop?.name || 'The shop') : e.name, action: e.action, note: e.note, at: e.at })).concat(mine.map(m => ({ who: req.sup.rep || 'You', action: m.action, note: m.note, at: m.at, pending: true }))) };
  }).sort((a, b) => b.no.localeCompare(a.no));
  const sent = (S.orders || []).filter(o => o.dir !== 'OUT' && o.sid === sup.id).map(o => ({ id: o.id, date: o.date, rep: o.rep, text: o.text, status: o.status, note: o.note, photos: (o.files || []).length, grn: o.grn || null,
      events: (o.events || []).map(e => ({ who: e.actor === 'shop' ? (CFG.shop?.name || 'The shop') : e.name, action: e.action, note: e.note, at: e.at })) }))
    .concat(pending.filter(p => p.kind === 'order').map(p => ({ id: 'pending' + p.id, date: p.data.date, rep: p.data.rep, text: p.data.text, status: 'pending', note: '', photos: p.photos, events: [{ who: p.data.rep || 'You', action: 'uploaded', note: p.data.text, at: new Date(p.created_at).getTime() }], waiting: true })))
    .sort((a, b) => (b.events[0]?.at || 0) - (a.events[0]?.at || 0));
  // what the shop owes them, from the journal, like the till does
  let dr = 0, cr = 0;
  for (const j of (S.journal || [])) for (const l of (j.lines || [])) if (l.ac === '2100' && l.party && l.party.type === 'S' && l.party.id === sup.id) { dr += l.dr; cr += l.cr; }
  // the bills that make up that figure, so a request can name the ones it is for
  const bills = !sup.showAccount ? [] : (S.purchases || [])
    .filter(p => p.supplierId === sup.id && (p.total - (+p.paid || 0)) > 0.005)
    .map(p => ({ no: p.no, supInv: p.supInv || '', date: p.date, total: +p.total || 0,
                 paid: +p.paid || 0, owing: Math.round((p.total - (+p.paid || 0)) * 100) / 100 }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // their own payment requests: the ones the shop has, and the one still on its way
  const mine = (S.payReqs || []).filter(x => x.sid === sup.id).map(x => ({
    id: x.id, date: x.date, total: x.total, note: x.note, status: x.status, lines: x.lines,
    events: (x.events || []).map(e => ({ who: e.actor === 'shop' ? (CFG.shop?.name || 'The shop') : e.name, action: e.action, note: e.note, at: e.at })),
    pay: x.pay || null }));
  const waiting = pending.filter(p => p.kind === 'payreq').map(p => ({
    id: 'pending' + p.id, date: p.data.date, total: p.data.total, note: p.data.note, lines: p.data.lines,
    status: 'sent', waiting: true,
    events: [{ who: p.data.rep || 'You', action: 'asked', note: p.data.note || '', at: new Date(p.created_at).getTime() }] }));
  const payReqs = waiting.concat(mine).sort((a, b) => (b.events[0]?.at || 0) - (a.events[0]?.at || 0));

  res.json({ ok: true, supplier: { name: sup.name, contact: sup.contact || '', phone: sup.phone || '', terms: sup.days || 0, owed: Math.round((cr - dr) * 100) / 100, showAccount: !!sup.showAccount },
    bills, payReqs,
    shop: { name: CFG.shop?.name || 'Regal Hardware', phone: CFG.shop?.phone || '', addr: CFG.shop?.addr || '' }, rep: req.sup.rep || '', pos, sent });
}));

/** An order the rep took by hand: photos of the sheet, a note.  Waits for the owner in the till. */
r.post('/order', supAuth, asyncHandler(async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  const rep = String(req.body?.rep || req.sup.rep || '').trim().slice(0, 60);
  const photos = Array.isArray(req.body?.photos) ? req.body.photos.slice(0, 6) : [];
  if (!text && !photos.length) throw new HttpError(400, 'Attach a photo of the order or type it');
  const bufs = [];
  for (const p of photos) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(p || ''));
    if (!m) throw new HttpError(400, 'Photos must be JPEG, PNG or WebP');
    const b = Buffer.from(m[2], 'base64');
    if (b.length > 2.5e6) throw new HttpError(400, 'A photo is too big — keep each under 2.5 MB');
    bufs.push([m[1], b]);
  }
  await ensureSupplierTables();
  const { rows: [{ id }] } = await query(`INSERT INTO sup_inbox (sid, kind, data) VALUES ($1, 'order', $2) RETURNING id`, [req.sup.sid, JSON.stringify({ text, rep, date: localDate(), time: localTime() })]);
  for (const [mime, b] of bufs) await query(`INSERT INTO sup_media (inbox_id, mime, data) VALUES ($1, $2, $3)`, [id, mime, b]);
  res.json({ ok: true, id, photos: bufs.length });
}));

/**
 * "Please pay me for these." The supplier ticks the bills they want settled and may say a
 * different figure for any of them — a credit note they have raised, a short delivery, a price
 * agreed after the invoice was cut. Nothing here changes a bill or moves any money: it is a
 * request, and it waits in the inbox until a till pulls it in, exactly like an order does.
 */
r.post('/payreq', supAuth, asyncHandler(async (req, res) => {
  const data = await books();
  const S = data?.S || {};
  const sup = (S.suppliers || []).find(s => s.id === req.sup.sid);
  if (!sup) throw new HttpError(404, 'Supplier no longer on file');
  if (!sup.showAccount) throw new HttpError(403, 'The shop has not opened your account page yet — ask them to switch it on');
  const wanted = Array.isArray(req.body?.lines) ? req.body.lines.slice(0, 80) : [];
  if (!wanted.length) throw new HttpError(400, 'Tick at least one bill');
  const open = (S.purchases || []).filter(p => p.supplierId === sup.id && (p.total - (+p.paid || 0)) > 0.005);
  const lines = [];
  for (const w of wanted) {
    const p = open.find(x => x.no === String(w?.no || ''));
    if (!p) continue;                                   // not theirs, already settled, or made up
    if (lines.some(l => l.no === p.no)) continue;       // the same bill twice
    const owing = Math.round((p.total - (+p.paid || 0)) * 100) / 100;
    const asked = w.claim === undefined || w.claim === null || w.claim === '' ? owing : +w.claim;
    if (!Number.isFinite(asked) || asked < 0) throw new HttpError(400, 'An amount must be a number, and not below nothing');
    lines.push({ no: p.no, supInv: p.supInv || '', date: p.date, billed: +p.total || 0, owing,
                 claim: Math.round(asked * 100) / 100, note: String(w.note || '').trim().slice(0, 200) });
  }
  if (!lines.length) throw new HttpError(400, 'None of those bills are still open');
  const total = Math.round(lines.reduce((a, l) => a + l.claim, 0) * 100) / 100;
  if (total <= 0) throw new HttpError(400, 'The request adds up to nothing');
  await ensureSupplierTables();
  const { rows: [{ id }] } = await query(`INSERT INTO sup_inbox (sid, kind, data) VALUES ($1, 'payreq', $2) RETURNING id`,
    [req.sup.sid, JSON.stringify({ lines, total, note: String(req.body?.note || '').trim().slice(0, 1000),
      rep: String(req.body?.rep || req.sup.rep || '').trim().slice(0, 60), date: localDate(), time: localTime() })]);
  res.json({ ok: true, id, lines: lines.length, total });
}));

/** The supplier's answer to an order the shop sent: accepted / changes / dispatched (+ invoice no). */
r.post('/po/:no/respond', supAuth, asyncHandler(async (req, res) => {
  const action = String(req.body?.action || '');
  if (!['accepted', 'changes', 'dispatched'].includes(action)) throw new HttpError(400, 'action must be accepted, changes or dispatched');
  const data = await books();
  const po = (data?.S?.orders || []).find(o => o.dir === 'OUT' && o.no === req.params.no && o.sid === req.sup.sid);
  if (!po) throw new HttpError(404, 'No such order for you');
  if (['received', 'cancelled'].includes(po.status)) throw new HttpError(400, 'That order is closed');
  const note = String(req.body?.note || '').trim().slice(0, 500), invoice = String(req.body?.invoice || '').trim().slice(0, 60), eta = String(req.body?.eta || '').trim().slice(0, 40);
  if (action === 'changes' && !note) throw new HttpError(400, 'Say what needs to change');
  await ensureSupplierTables();
  const { rows: [{ id }] } = await query(`INSERT INTO sup_inbox (sid, kind, data) VALUES ($1, 'reply', $2) RETURNING id`, [req.sup.sid, JSON.stringify({ no: po.no, action, note, invoice, eta, rep: req.sup.rep || '' })]);
  res.json({ ok: true, id });
}));

/** A photo, by its signed link (the till shows these in the order card). */
r.get('/photo/:id', asyncHandler(async (req, res) => {
  const id = String(+req.params.id || 0);
  if (!id || req.query.k !== photoKey(id)) return res.status(404).end();
  await ensureSupplierTables();
  const { rows: [row] } = await query(`SELECT mime, data FROM sup_media WHERE id = $1`, [id]);
  if (!row) return res.status(404).end();
  res.set('Content-Type', row.mime); res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(row.data);
}));

export default r;
