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
import { query, dbKind } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { sendViaProvider, regalAuth, mayRevealCode } from './regal.js';
import { listLogins, findLogin, addLogin, setLogin, removeLogin, checkLogin, loginLine, cleanUser, passOk, suggestUser, inviteMany, startersFor, defaultLogin, resetToDefaults,
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
    );
    CREATE TABLE IF NOT EXISTS sup_hidden (
      id          bigserial PRIMARY KEY,
      sid         integer NOT NULL,
      ref         varchar(60) NOT NULL,
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
/* What suppliers sent that no till has taken yet, with the ids of any photos. Read as two plain
   queries rather than one grouped one: a GROUP BY over the joined photos is refused by a MariaDB or
   MySQL that runs with ONLY_FULL_GROUP_BY, and when that read failed the till could not load the
   books at all — so it saved nothing, and the supplier's page showed nothing. */
const parsed = v => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}') || {}; } catch { return {}; } };
async function inboxRows(sid) {
  const { rows } = sid === undefined
    ? await query(`SELECT id, sid, kind, data, created_at FROM sup_inbox WHERE imported_at IS NULL ORDER BY id`)
    : await query(`SELECT id, sid, kind, data, created_at FROM sup_inbox WHERE sid = $1 AND imported_at IS NULL ORDER BY id DESC`, [sid]);
  if (!rows.length) return [];
  const ids = rows.map(r => Number(r.id));
  const { rows: media } = await query(`SELECT id, inbox_id FROM sup_media WHERE inbox_id = ANY($1::bigint[]) ORDER BY id`, [ids]);
  const photos = new Map();
  for (const m of media) { const k = Number(m.inbox_id); if (!photos.has(k)) photos.set(k, []); photos.get(k).push(Number(m.id)); }
  return rows.map(r => ({ id: Number(r.id), sid: Number(r.sid), kind: r.kind, data: parsed(r.data), created_at: r.created_at, photos: photos.get(Number(r.id)) || [] }));
}
export async function pendingSupplierCount() {
  await ensureSupplierTables();
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM sup_inbox WHERE imported_at IS NULL`);
  return n;
}
/** Merge what suppliers sent into a books document about to be handed to a till. */
export async function injectSupplierInbox(data) {
  if (!data || !data.S) return 0;
  await ensureSupplierTables();
  const rows = await inboxRows();
  if (!rows.length) return 0;
  const S = data.S; S.orders = S.orders || []; S.notif = S.notif || []; S.payReqs = S.payReqs || [];
  let added = 0;
  const orphans = [];                       // replies to an order the shop has since deleted
  for (const row of rows) try {
    const sup = (S.suppliers || []).find(s => s.id === row.sid);
    const name = sup ? sup.name.split(/[–(]/)[0].trim() : 'Supplier';
    if (row.kind === 'order') {
      const id = 'sp' + row.id;
      if (S.orders.some(o => o.id === id)) continue;
      const d = row.data;
      // the corrected version of an order the shop asked them to change: the old one is set aside
      const old = d.replaces ? S.orders.find(o => o.id === d.replaces && o.dir !== 'OUT' && o.sid === row.sid) : null;
      if (old) { old.status = 'revised'; old.unreadShop = false; old.events = old.events || [];
        old.events.push({ id: 'e' + row.id + 'r', actor: 'supplier', name: d.rep || name, action: 'revised', note: 'Replaced by a corrected order', at: new Date(row.created_at).getTime() }); }
      S.orders.push({ id, inboxId: row.id, dir: 'IN', sid: row.sid, rep: d.rep || 'Rep', text: d.text || '(photo only)', lines: Array.isArray(d.lines) ? d.lines : [], supNote: d.note || '', date: d.date || localDate(), status: 'pending', note: '', disc: d.disc || null,
        files: row.photos.map(photoUrl), unreadShop: true, unreadSup: false, src: 'portal', needsOwner: true, replaces: old ? old.id : null,
        events: [{ id: 'e' + row.id, actor: 'supplier', name: d.rep || name, action: old ? 'revised' : 'uploaded', note: old ? ('Corrected order' + (d.text ? ' — ' + d.text : '')) : (d.text || ''), at: new Date(row.created_at).getTime() }] });
      const offer = d.disc ? `, offering ${d.disc.kind === 'pct' ? d.disc.value + '%' : d.disc.value} off` : '';
      const what = (d.lines || []).length ? `${d.lines.length} item${d.lines.length === 1 ? '' : 's'}` : `${row.photos.length} photo${row.photos.length === 1 ? '' : 's'}`;
      S.notif.unshift({ id: 'n' + row.id.toString(36) + 's', kind: 'order', text: `${name} sent ${old ? 'a corrected order' : 'an order'} (${what})${offer} — needs the owner's approval`, view: 'orders', at: localTime(), read: false, forApprovers: true });
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
    } else if (row.kind === 'stockread') {
      // somebody read the shelves: it goes on the till's own list, so the shop can see who and when
      const d = row.data;
      S.supStockLog = S.supStockLog || [];
      if (S.supStockLog.some(x => x.inboxId === row.id)) continue;
      S.supStockLog.unshift({ inboxId: row.id, sid: row.sid, at: new Date(row.created_at).getTime(),
        date: d.date || localDate(), time: d.time || localTime(), lines: +d.lines || 0, rep: d.rep || '' });
      if (S.supStockLog.length > 800) S.supStockLog.length = 800;
      added++;
    } else if (row.kind === 'reply') {
      const d = row.data, po = S.orders.find(o => o.no === d.no && o.dir === 'OUT');
      // an order that was thrown away: nothing to attach to. It is let go, or the till would be told
      // there is something waiting for ever, and pull the books every two seconds to look for it
      if (!po) { orphans.push(row.id); continue; }
      if ((po.events || []).some(e => e.inboxId === row.id)) continue;
      po.events = po.events || [];
      po.events.push({ id: 'e' + row.id, inboxId: row.id, actor: 'supplier', name: d.rep || name, action: d.action, note: [d.note, d.invoice ? 'invoice ' + d.invoice : '', d.eta ? 'expected ' + d.eta : ''].filter(Boolean).join(' · '), at: new Date(row.created_at).getTime() });
      if (d.action === 'accepted' && po.status === 'sent') po.status = 'accepted';
      if (d.action === 'changes') po.status = 'changes';
      if (d.action === 'dispatched') { po.status = 'dispatched'; po.invoiceNo = d.invoice || po.invoiceNo; }
      // completed: the shop asked for this order, so it needs nobody's approval a second time. It goes
      // straight to "Ready to purchase", as the supplier will send it (their quantities and prices)
      if (d.action === 'completed') {
        const key = l => l.pid ? 'p' + l.pid : 'd' + String(l.desc || '').toLowerCase().trim();
        const was = new Map((po.lines || []).map(l => [key(l), l]));
        const have = new Set((S.products || []).map(p => p.id));
        po.supLines = d.lines || []; po.origLines = po.lines;
        po.lines = po.supLines.map(l => { const w = was.get(key(l)); const pid = l.pid || (w && w.pid) || null;
          return { desc: l.desc, unit: l.unit || (w && w.unit) || '', qty: l.qty, est: +l.price || (w && +w.est) || 0, pid, known: !!(pid && have.has(pid)) }; });
        po.status = 'approved'; po.invoiceNo = d.invoice || po.invoiceNo; po.needsOwner = false;
        po.completedAt = po.approvedAt = new Date(row.created_at).getTime();
      }
      po.unreadShop = true;
      S.notif.unshift({ id: 'n' + row.id.toString(36) + 'r', kind: 'order', text: `${name}: order ${po.no} ${{ accepted: 'confirmed', changes: 'needs a change', dispatched: 'is on its way', completed: 'completed — ready to purchase' }[d.action] || d.action}`, view: 'orders', at: localTime(), read: false });
      added++;
    }
  } catch (e) { console.error('supplier inbox row', row.id, 'could not be merged:', e.message); }
  S.notif = S.notif.slice(0, 60);
  if (orphans.length) await query(`UPDATE sup_inbox SET imported_at = now() WHERE imported_at IS NULL AND id = ANY($1::bigint[])`, [orphans]);
  return added;
}
/** A till has saved books that carry these — they are in the shop's hands now. */
export async function markSupplierImported(data) {
  const S = data?.S; if (!S) return 0;
  const ids = new Set();
  for (const o of (S.orders || [])) { if (o.inboxId) ids.add(o.inboxId); for (const e of (o.events || [])) if (e.inboxId) ids.add(e.inboxId); }
  for (const p of (S.payReqs || [])) if (p.inboxId) ids.add(p.inboxId);
  for (const x of (S.supStockLog || [])) if (x.inboxId) ids.add(x.inboxId);     // who read the shelves
  if (!ids.size) return 0;
  await ensureSupplierTables();
  const { rowCount } = await query(`UPDATE sup_inbox SET imported_at = now() WHERE imported_at IS NULL AND id = ANY($1::bigint[])`, [[...ids]]);
  return rowCount;
}

/* Supplier test mode (Settings → Messaging, the till's supSms()): while it is on, every text meant for a
   supplier goes to the shop's test number instead, saying who it was for. The till's default is on with
   that number, so books saved before the setting existed count as on. Every text from this file to a
   supplier goes through here. */
function supTestTo(cfg) {
  const on = cfg?.supTestOn ?? true;
  const to = String(cfg?.supTestTo ?? '0769442270').trim();
  return on && to ? to : null;
}
function supSend(cfg, phone, text) {
  const t = supTestTo(cfg);
  return t ? sendViaProvider(cfg, t, `[TEST · for ${phone}] ${text}`) : sendViaProvider(cfg, phone, text);
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
    try { await supSend(cfg, phone, `${data?.CFG?.shop?.name || 'Regal Hardware'}: your supplier sign-in code is ${code}. It works for 5 minutes.`); return res.json({ ok: true, sent: true, name: sup.name }); }
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
    try { await supSend(cfg, phone, `${data?.CFG?.shop?.name || 'Regal Hardware'}: your code to set a new password is ${code}. It works for 5 minutes.`);
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

/* The person signed in changes their own user name. Another sign-in's name is not taken. */
r.post('/username', supAuth, asyncHandler(async (req, res) => {
  if (!req.sup.lid) throw new HttpError(400, 'This page was opened with a code, not a sign-in');
  const want = cleanUser(req.body?.username);
  if (want.length < 3) throw new HttpError(400, 'A user name needs at least three letters or figures');
  const rows = await listLogins(LOGINS, req.sup.sid);
  const l = rows.find(x => Number(x.id) === req.sup.lid);
  if (!l) throw new HttpError(404, 'That sign-in is no longer there');
  if (!(await passOk(String(req.body?.current || ''), l.own_hash)) && !(await passOk(String(req.body?.current || ''), l.admin_hash)))
    throw new HttpError(401, 'The password you have now is not right');
  const other = await findLogin(LOGINS, want);
  if (other && Number(other.id) !== Number(l.id)) throw new HttpError(409, `“${want}” is already in use — try another`);
  await setLogin(LOGINS, Number(l.id), l.owner, { username: want });
  res.json({ ok: true, username: want });
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
      sent = await supSend(data?.CFG?.msg, made.request.phone,
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
  const made = await inviteMany(LOGINS, people, { defaults: true });
  const byId = new Map(people.map(s => [s.id, s]));
  // the supplier's own sign-in (their first, or the one marked rep) is named for their rep, or the firm;
  // any other — a branch user — for the person it belongs to
  const first = new Map();
  for (const l of await listLogins(LOGINS)) if (!first.has(l.owner) || Number(l.id) < first.get(l.owner)) first.set(l.owner, Number(l.id));
  const reset = await resetToDefaults(LOGINS, l => {
    const sup = byId.get(l.owner); if (!sup) return null;
    const main = l.role === 'rep' || first.get(l.owner) === Number(l.id) || !l.name;
    return main ? (String(sup.contact || '').trim() || l.name || sup.name) : l.name;
  });
  const logins = (await startersFor(LOGINS)).filter(l => byId.has(l.owner))
    .map(l => ({ ...l, who: byId.get(l.owner).name, phone: l.phone || byId.get(l.owner).phone || '' }));
  res.json({ ok: true, made: made.length, reset, of: people.length, logins });
}));

/** The shop switching the page on: make a sign-in if there is none, and hand back what to text. */
r.post('/admin/invite/:sid', regalAuth, asyncHandler(async (req, res) => {
  const sid = +req.params.sid;
  const data = await books();
  const sup = (data?.S?.suppliers || []).find(s => s.id === sid);
  if (!sup) throw new HttpError(404, 'No such supplier');
  const have = await listLogins(LOGINS, sid);
  if (have.length) return res.json({ ok: true, made: false, logins: have.map(loginLine) });
  const { username, password } = await defaultLogin(LOGINS, sup.contact || sup.name, sup.code);
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
  const pending = (await inboxRows(sup.id)).map(p => ({ ...p, photos: p.photos.length }));
  const hidden = new Set((await query(`SELECT ref FROM sup_hidden WHERE sid = $1`, [sup.id])).rows.map(r => r.ref));
  const pendingReplies = pending.filter(p => p.kind === 'reply');
  const pos = (S.orders || []).filter(o => o.dir === 'OUT' && o.sid === sup.id).map(o => {
    const mine = pendingReplies.filter(p => p.data.no === o.no).map(p => ({ action: p.data.action, note: p.data.note, invoice: p.data.invoice, lines: p.data.lines || null, at: new Date(p.created_at).getTime(), pending: true }));
    const last = mine[0];
    return { no: o.no, date: o.date, want: o.want, note: o.note, by: o.by, status: last ? ({ accepted: 'accepted', completed: 'approved' }[last.action] || last.action) : o.status, invoiceNo: o.invoiceNo || (last && last.invoice) || '',
      lines: (o.lines || []).map(l => ({ desc: l.desc, unit: l.unit, qty: l.qty, known: !!l.known, pid: l.pid || null })),
      supLines: (last && last.lines) || o.supLines || null, grn: o.grn || null, approvedAt: o.approvedAt || null,
      events: (o.events || []).map(e => ({ who: e.actor === 'shop' ? (CFG.shop?.name || 'The shop') : e.name, action: e.action, note: e.note, at: e.at })).concat(mine.map(m => ({ who: req.sup.rep || 'You', action: m.action, note: m.note, at: m.at, pending: true }))) };
  }).filter(o => !hidden.has('po:' + o.no)).sort((a, b) => b.no.localeCompare(a.no));
  // an order already replaced by a corrected one still on its way to the shop is not shown twice
  const replaced = new Set(pending.filter(p => p.kind === 'order' && p.data.replaces).map(p => p.data.replaces));
  const sent = (S.orders || []).filter(o => o.dir !== 'OUT' && o.sid === sup.id && !hidden.has('in:' + o.id) && !replaced.has(o.id)).map(o => ({ id: o.id, date: o.date, rep: o.rep, text: o.text, lines: o.lines || [], supNote: o.supNote || '', status: o.status, note: o.note, photos: (o.files || []).length, grn: o.grn || null, disc: o.disc || null, replaces: o.replaces || null,
      events: (o.events || []).map(e => ({ who: e.actor === 'shop' ? (CFG.shop?.name || 'The shop') : e.name, action: e.action, note: e.note, at: e.at })) }))
    .concat(pending.filter(p => p.kind === 'order').map(p => ({ id: 'pending' + p.id, replaces: p.data.replaces || null, date: p.data.date, rep: p.data.rep, text: p.data.text, lines: p.data.lines || [], supNote: p.data.note || '', status: 'pending', note: '', photos: p.photos, disc: p.data.disc || null, events: [{ who: p.data.rep || 'You', action: 'uploaded', note: p.data.text, at: new Date(p.created_at).getTime() }], waiting: true })))
    .sort((a, b) => (b.events[0]?.at || 0) - (a.events[0]?.at || 0));
  // what the shop owes them, from the journal, like the till does
  let dr = 0, cr = 0;
  for (const j of (S.journal || [])) for (const l of (j.lines || [])) if (l.ac === '2100' && l.party && l.party.type === 'S' && l.party.id === sup.id) { dr += l.dr; cr += l.cr; }
  // the bills that make up that figure, so a request can name the ones it is for
  const terms = +sup.days || 0;
  const ageOf = d => Math.max(0, Math.floor((Date.parse(localDate()) - Date.parse(d)) / 864e5));
  const bills = (S.purchases || [])
    .filter(p => p.supplierId === sup.id && (p.total - (+p.paid || 0)) > 0.005)
    .map(p => ({ no: p.no, supInv: p.supInv || '', date: p.date, total: +p.total || 0,
                 paid: +p.paid || 0, owing: Math.round((p.total - (+p.paid || 0)) * 100) / 100,
                 days: ageOf(p.date), terms, due: terms ? terms - ageOf(p.date) : null }))
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

  /* What of theirs came in broken. The value was taken off what the shop owes them the moment it
     was raised, so it is already inside the "owed" figure above — a rep who cannot see why the
     figure moved rings the counter, and this is the answer without the phone call. */
  const damages = (S.damages || []).filter(d => d.sid === sup.id && d.status !== 'credited' && d.status !== 'replaced')
    .map(d => ({ no: d.no, date: d.date, item: ((S.products || []).find(p => p.id === d.pid) || {}).name || 'an item',
                 qty: +d.qty || 0, value: +d.value || 0, reason: d.reason || '', status: d.status }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const damageValue = Math.round(damages.reduce((a, d) => a + d.value, 0) * 100) / 100;

  const me = req.sup.lid ? (await listLogins(LOGINS, sup.id)).find(x => Number(x.id) === req.sup.lid) : null;
  res.json({ ok: true, supplier: { name: sup.name, contact: sup.contact || '', phone: sup.phone || '', terms: sup.days || 0, owed: Math.round((cr - dr) * 100) / 100, showAccount: true },
    login: me ? { username: me.username, name: me.name || '', role: me.role || '', own: !!me.own_hash } : null,
    bills, payReqs, damages, damageValue,
    // when the shop's door onto their stock closes; the page shows the tab only while it is open
    stockUntil: +sup.stockUntil || 0,
    shop: { name: CFG.shop?.name || 'Regal Hardware', phone: CFG.shop?.phone || '', addr: CFG.shop?.addr || '' }, rep: req.sup.rep || '', pos, sent });
}));

/* What the shop is holding of their own lines. The shop opens this for a day at a time and it shuts
   by itself; the date is checked here and not only on the till, so an old page left open on a phone
   stops working when the day is up. Only their own lines are ever sent — another supplier's stock is
   not theirs to see — and no cost, no margin and no takings go with it, only what is on the shelf.
   Every read is written to the supplier's inbox so the shop can see afterwards who looked and when. */
r.get('/stock', supAuth, asyncHandler(async (req, res) => {
  const data = await books();
  const S = data?.S || {};
  const sup = (S.suppliers || []).find(s => s.id === req.sup.sid);
  if (!sup) throw new HttpError(404, 'Supplier no longer on file');
  const until = +sup.stockUntil || 0;
  if (!until || Date.now() >= until)
    throw new HttpError(403, 'The shop has not opened this for you, or the day is up — ask them to open it again');
  /* Theirs by the tag the shop set, or by having delivered it. Nothing else is ever sent:
     another supplier's stock is none of their business, and the figures would tell them what
     the shop buys elsewhere. */
  const theirs = new Set();
  for (const p of (S.products || [])) if (p.supplierId === sup.id) theirs.add(p.id);
  for (const pu of (S.purchases || [])) if (pu.supplierId === sup.id)
    for (const l of (pu.lines || [])) if (l.pid) theirs.add(l.pid);
  const mine = (S.products || []).filter(p => theirs.has(p.id) && p.active !== false);
  const lines = mine.map(p => ({
    pid: p.id, code: p.code || '', name: p.name || '', unit: p.unit || '',
    stock: Math.round((+p.stock || 0) * 1000) / 1000,
    min: +p.min || 0,
    low: (+p.stock || 0) <= (+p.min || 0),
  })).sort((a, b) => (a.low === b.low ? String(a.name).localeCompare(String(b.name)) : a.low ? -1 : 1));
  await ensureSupplierTables();
  await query(`INSERT INTO sup_inbox (sid, kind, data) VALUES ($1, 'stockread', $2)`,
    [sup.id, JSON.stringify({ lines: lines.length, rep: String(req.sup.rep || '').trim().slice(0, 60),
      date: localDate(), time: localTime() })]);
  res.json({ ok: true, until, lines,
    low: lines.filter(l => l.low).length,
    shop: { name: data?.CFG?.shop?.name || 'Regal Hardware' } });
}));

/** The items that are theirs (tagged to them, or that they have delivered): what an order is keyed from.
    Names, codes and units only — what the shop holds and pays is not theirs to see. */
r.get('/products', supAuth, asyncHandler(async (req, res) => {
  const data = await books();
  const S = data?.S || {};
  const theirs = new Set();
  for (const p of (S.products || [])) if (p.supplierId === req.sup.sid) theirs.add(p.id);
  for (const pu of (S.purchases || [])) if (pu.supplierId === req.sup.sid)
    for (const l of (pu.lines || [])) if (l.pid) theirs.add(l.pid);
  const items = (S.products || []).filter(p => theirs.has(p.id) && p.active !== false)
    .map(p => ({ pid: p.id, code: p.code || '', name: p.name || '', unit: p.unit || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ ok: true, items });
}));
/* An order line from the supplier's side: one of their items, or something typed in. */
function orderLines(raw, items) {
  const lines = [];
  for (const l of (Array.isArray(raw) ? raw.slice(0, 120) : [])) {
    const desc = String(l?.desc || '').trim().slice(0, 140);
    const qty = Math.round((+l?.qty || 0) * 1000) / 1000;
    if (!desc || !(qty > 0)) continue;
    const known = l?.pid ? items.find(p => p.id === +l.pid) : null;
    const price = +l?.price > 0 ? Math.round(+l.price * 100) / 100 : 0;
    lines.push({ desc: known ? known.name : desc, pid: known ? known.id : null, code: known ? (known.code || '') : '',
      unit: String(l?.unit || (known && known.unit) || '').trim().slice(0, 16), qty, price });
  }
  return lines;
}

/** An order the rep took by hand: photos of the sheet, a note.  Waits for the owner in the till. */
r.post('/order', supAuth, asyncHandler(async (req, res) => {
  const lines = orderLines(req.body?.lines, (await books())?.S?.products || []);
  const typed = String(req.body?.text || '').trim().slice(0, 2000);
  // the lines are written out too, for anywhere that reads the order as text
  const text = [lines.map(l => `${l.desc} — ${l.qty} ${l.unit}${l.price ? ' at ' + l.price : ''}`.trim()).join('\n'), typed].filter(Boolean).join('\n\n');
  const rep = String(req.body?.rep || req.sup.rep || '').trim().slice(0, 60);
  const photos = Array.isArray(req.body?.photos) ? req.body.photos.slice(0, 6) : [];
  /* A rep will often write "and I can do 5% on the cement" on the sheet. Taken as a figure it
     reaches the owner as a figure, and can be held against the invoice when the goods come. */
  const dRaw = req.body?.disc || null;
  const disc = dRaw && +dRaw.value > 0
    ? { kind: dRaw.kind === 'pct' ? 'pct' : 'amt', value: Math.round(+dRaw.value * 100) / 100,
        note: String(dRaw.note || '').trim().slice(0, 120) }
    : null;
  if (disc && disc.kind === 'pct' && disc.value > 100) throw new HttpError(400, 'A discount cannot be more than a hundred per cent');
  if (!text && !photos.length) throw new HttpError(400, 'Put at least one item on the order');
  const bufs = [];
  for (const p of photos) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(p || ''));
    if (!m) throw new HttpError(400, 'Photos must be JPEG, PNG or WebP');
    const b = Buffer.from(m[2], 'base64');
    if (b.length > 2.5e6) throw new HttpError(400, 'A photo is too big — keep each under 2.5 MB');
    bufs.push([m[1], b]);
  }
  await ensureSupplierTables();
  // the corrected version of one the shop asked them to change: only one of theirs, and only then
  let replaces = null;
  if (req.body?.replaces) {
    const old = ((await books())?.S?.orders || []).find(o => o.id === String(req.body.replaces) && o.dir !== 'OUT' && o.sid === req.sup.sid);
    if (!old || old.status !== 'adjusted') throw new HttpError(400, 'That order is not waiting for your changes any more');
    if ((await inboxRows(req.sup.sid)).some(p => p.kind === 'order' && p.data.replaces === old.id)) throw new HttpError(400, 'The corrected order is already on its way to the shop');
    replaces = old.id;
  }
  const { rows: [{ id }] } = await query(`INSERT INTO sup_inbox (sid, kind, data) VALUES ($1, 'order', $2) RETURNING id`, [req.sup.sid, JSON.stringify({ text, note: typed, lines, rep, disc, replaces, date: localDate(), time: localTime() })]);
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

/** Clear away an order that is finished with: one the shop cancelled, or one of theirs the shop turned
    down. It goes from the supplier's page only — the shop's books keep it. */
r.post('/hide', supAuth, asyncHandler(async (req, res) => {
  const ref = String(req.body?.ref || '');
  const S = (await books())?.S || {};
  const [kind, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
  const o = kind === 'po' ? (S.orders || []).find(x => x.dir === 'OUT' && x.no === id && x.sid === req.sup.sid)
    : kind === 'in' ? (S.orders || []).find(x => x.dir !== 'OUT' && x.id === id && x.sid === req.sup.sid) : null;
  if (!o) throw new HttpError(404, 'No such order of yours');
  if (!['cancelled', 'rejected', 'revised'].includes(o.status)) throw new HttpError(400, 'Only a cancelled or turned-down order can be deleted');
  await ensureSupplierTables();
  await query(`INSERT INTO sup_hidden (sid, ref) VALUES ($1, $2)`, [req.sup.sid, ref]);
  res.json({ ok: true });
}));

/** The supplier's answer to an order the shop sent: accepted / changes / dispatched (+ invoice no). */
r.post('/po/:no/respond', supAuth, asyncHandler(async (req, res) => {
  const action = String(req.body?.action || '');
  if (!['accepted', 'changes', 'dispatched', 'completed'].includes(action)) throw new HttpError(400, 'action must be accepted, changes, dispatched or completed');
  const data = await books();
  const po = (data?.S?.orders || []).find(o => o.dir === 'OUT' && o.no === req.params.no && o.sid === req.sup.sid);
  if (!po) throw new HttpError(404, 'No such order for you');
  if (['received', 'cancelled', 'approved'].includes(po.status)) throw new HttpError(400, 'That order is closed');
  if (po.status === 'completed' && action === 'completed') throw new HttpError(400, 'You have completed this one — it is with the shop');
  const note = String(req.body?.note || '').trim().slice(0, 500), invoice = String(req.body?.invoice || '').trim().slice(0, 60), eta = String(req.body?.eta || '').trim().slice(0, 40);
  if (action === 'changes' && !note) throw new HttpError(400, 'Say what needs to change');
  // completing: the lines as they will be supplied — as sent, or changed (a quantity, a price, a line dropped)
  let lines = null;
  if (action === 'completed') {
    lines = orderLines(req.body?.lines, data?.S?.products || []);
    if (!lines.length) throw new HttpError(400, 'Nothing is left on the order — ask the shop to cancel it instead');
  }
  await ensureSupplierTables();
  const { rows: [{ id }] } = await query(`INSERT INTO sup_inbox (sid, kind, data) VALUES ($1, 'reply', $2) RETURNING id`, [req.sup.sid, JSON.stringify({ no: po.no, action, note, invoice, eta, lines, rep: req.sup.rep || '' })]);
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
