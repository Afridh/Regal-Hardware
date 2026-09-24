// API for the Regal front-end (app/index.html): the books document store, sign-in, SMS relay.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { matches, demoPassword, sha } from '../services/regalHash.js';
import { injectInbox as injectShopInbox, markImported as markShopImported, pendingCount as pendingShopCount } from './shop.js';
import { injectSupplierInbox, markSupplierImported, pendingSupplierCount } from './supplier.js';
import { injectCustInbox, markCustImported, pendingCustCount } from './customer.js';
import { catchUpLogins } from '../services/portalLogins.js';
// everything that arrived from outside the tills — the website's orders, the suppliers', and what a
// customer said on their own page — in one go
const injectInbox = async data => (await injectShopInbox(data)) + (await injectSupplierInbox(data)) + (await injectCustInbox(data));
const markImported = async data => (await markShopImported(data)) + (await markSupplierImported(data)) + (await markCustImported(data));
const pendingCount = async () => (await pendingShopCount()) + (await pendingSupplierCount()) + (await pendingCustCount());

const r = Router();
const BOOKS_KEY = 'regal';
const HISTORY_KEEP = 200;
const LOCAL_KEYS = ['user', 'pos', 'view', 'terminal', 'held', 'heldBills', 'portal', 'cportal', 'phoneOpen', 'phoneMode', 'notifOpen', 'signedOut', 'drawer', '_fromStore', 'locId'];

function sign(user) {
  return jwt.sign({ kind: 'regal', name: user.name, role: user.role, perms: user.perms || [] }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '12h' });
}

/** Bearer-token guard for the books API. */
export function regalAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'Sign in first');
    const p = jwt.verify(token, process.env.JWT_SECRET);
    if (p.kind !== 'regal') throw new HttpError(401, 'Wrong kind of token');
    req.regalUser = p;
    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return next(new HttpError(401, 'Session expired'));
    next(e);
  }
}

// a fresh hosted database (Neon, Supabase…) has no tables yet: make the two the books need on first use
let booksReady = null;
export function ensureBooksTables() {
  if (!booksReady) booksReady = query(`
    CREATE TABLE IF NOT EXISTS books (key varchar(50) PRIMARY KEY, rev bigint NOT NULL DEFAULT 0, data jsonb, updated_at timestamptz DEFAULT now(), updated_by varchar(80));
    CREATE TABLE IF NOT EXISTS books_history (id bigserial PRIMARY KEY, key varchar(50) NOT NULL, rev bigint NOT NULL, data jsonb, saved_at timestamptz DEFAULT now(), saved_by varchar(80));
    CREATE INDEX IF NOT EXISTS idx_books_history ON books_history (key, rev)`).catch(e => { booksReady = null; throw e; });
  return booksReady;
}
const LEGACY_USERS = ['asaath kp', 'raslan', 'kasun', 'sampath', 'nuwan', 'chaminda', 'fathima', 'ruwan', 'dilan', 'suresh'];

export const DEFAULT_ACCOUNTS = [
  { name: 'Afridh', role: 'Super Admin', uid: 'AF', pass: 'Afridh123', perms: ['sell','discount','cancelBill','cost','profit','adjustInvoice','overLimit','belowCost','receive','products','paySupplier','reports','settings','users','approve'] },
  { name: 'Azhad', role: 'Admin', uid: 'AZ', pass: 'Azhad123', perms: ['sell','discount','cancelBill','cost','profit','adjustInvoice','overLimit','belowCost','receive','products','paySupplier','reports','settings','users','approve'] },
  { name: 'Akmal', role: 'Admin', uid: 'AK', pass: 'Akmal123', perms: ['sell','discount','cancelBill','cost','profit','adjustInvoice','overLimit','belowCost','receive','products','paySupplier','reports','settings','users','approve'] },
  { name: 'KP', role: 'KP', uid: 'KP', pass: 'KP123', perms: ['sell','discount','cancelBill','cost','profit','adjustInvoice','overLimit','belowCost','receive','products','paySupplier','approve'] },
  { name: 'Sales1', role: 'Salesman', uid: 'S1', pass: 'Sales123', perms: ['products_view', 'dashboard_view', 'attendance_view'] },
  { name: 'Sales2', role: 'Salesman', uid: 'S2', pass: 'Sales223', perms: ['products_view', 'dashboard_view', 'attendance_view'] },
  { name: 'Sales3', role: 'Salesman', uid: 'S3', pass: 'Sales323', perms: ['products_view', 'dashboard_view', 'attendance_view'] },
  { name: 'Sales4', role: 'Salesman', uid: 'S4', pass: 'Sales423', perms: ['products_view', 'dashboard_view', 'attendance_view'] }
];

export function sanitizeUsers(users, deletedUsers = []) {
  let list = Array.isArray(users) ? users : [];
  const delList = (Array.isArray(deletedUsers) ? deletedUsers : []).map(x => String(x || '').toLowerCase().trim());
  list = list.filter(u => u && !LEGACY_USERS.includes(String(u.name || '').toLowerCase().trim()) && !delList.includes(String(u.name || '').toLowerCase().trim()));

  // Only seed DEFAULT_ACCOUNTS if the user list is completely empty (first time initialization)
  if (list.length === 0) {
    for (const acc of DEFAULT_ACCOUNTS) {
      const accLower = acc.name.toLowerCase().trim();
      if (delList.includes(accLower)) continue;
      list.push({
        name: acc.name,
        role: acc.role,
        uid: acc.uid,
        salesId: acc.role === 'Salesman' ? acc.uid : undefined,
        pin: '',
        passHash: sha(acc.pass),
        perms: [...acc.perms],
        active: true
      });
    }
  } else {
    // If users already exist, NEVER overwrite user roles or resurrect deleted/renamed accounts.
    // Just ensure existing accounts have passHash if unset.
    for (const u of list) {
      if (!u.passHash) {
        const def = DEFAULT_ACCOUNTS.find(a => a.name.toLowerCase() === String(u.name || '').toLowerCase().trim());
        if (def) u.passHash = sha(def.pass);
      }
      if (u.role === 'Salesman' && !u.salesId && /^S\d+$/i.test(u.uid)) {
        u.salesId = u.uid.toUpperCase();
      }
    }
  }

  return list;
}

async function loadBooks(key = BOOKS_KEY) {
  await ensureBooksTables();
  const { rows: [row] } = await query(`SELECT key, rev, data, updated_at, updated_by FROM books WHERE key = $1`, [key]);
  if (row?.data?.S) {
    const deletedUsers = row.data.S.deletedUsers || [];
    row.data.S.users = sanitizeUsers(row.data.S.users, deletedUsers);
    // who is signed in belongs to the till, not to the shared books: a till that has nobody
    // signed in picks its own (see applyKept in the app), so nothing is put here.
    delete row.data.S.user;
  }
  return row || null;
}

/** Users are kept inside the books document (S.users) so the shop manages them in its own screen. */
async function usersFromBooks() {
  const row = await loadBooks();
  const users = row?.data?.S?.users;
  const deletedUsers = row?.data?.S?.deletedUsers || [];
  return sanitizeUsers(users, deletedUsers);
}

// ---------------------------------------------------------------- sign in
r.post('/books/login', asyncHandler(async (req, res) => {
  const { user, password } = req.body || {};
  if (!user || typeof password !== 'string') throw new HttpError(400, 'Name and password required');
  const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const isAdmin = String(user).toLowerCase() === 'admin';
  const users = await usersFromBooks();
  const u = users.find(x => String(x.name).toLowerCase() === String(user).toLowerCase());

  if (u) {
    if (u.active === false) throw new HttpError(401, 'That name cannot sign in');
    const defAcc = DEFAULT_ACCOUNTS.find(a => a.name.toLowerCase() === String(user).toLowerCase());
    const isDefPass = defAcc && (!u.passHash || u.passHash === sha(defAcc.pass) || u.passHash === fnv(defAcc.pass)) && password === defAcc.pass;
    if (matches(u, password) || isDefPass || (isAdmin && password === adminPass)) {
      if (!u.passHash && defAcc) u.passHash = sha(defAcc.pass);
      return res.json({ ok: true, token: sign(u), user: { name: u.name, role: u.role, perms: u.perms || [] } });
    }
    throw new HttpError(401, 'That password is not right');
  }

  if (isAdmin && password === adminPass) {
    const adminUser = { name: 'admin', role: 'Owner', perms: ['sell','discount','cancelBill','cost','profit','adjustInvoice','overLimit','belowCost','receive','products','paySupplier','reports','settings','users','approve'] };
    return res.json({ ok: true, token: sign(adminUser), user: { name: adminUser.name, role: 'Owner', perms: adminUser.perms || [] } });
  }

  if (password === adminPass || password === demoPassword(user)) {
    return res.json({ ok: true, token: sign({ name: user, role: 'Owner', perms: [] }), user: { name: user, role: 'Owner', perms: [] }, bootstrap: true });
  }
  throw new HttpError(401, 'That password is not right');
}));

r.get('/books/me', regalAuth, (req, res) => res.json({ ok: true, user: req.regalUser }));

/** Names + roles only, for the lock screen of a browser that has never opened the books. */
r.get('/books/users', asyncHandler(async (_req, res) => {
  const users = await usersFromBooks();
  res.json({ users: users.filter(u => u.active !== false).map(u => ({ name: u.name, role: u.role, uid: u.uid || 'AD', pin: u.pin ? true : false })) });
}));

// ---------------------------------------------------------------- books document
// Online orders from the public site wait in their own table until a till has saved them into the
// books: a read hands them over (inbox), a save that contains them marks them done (see shop.js).
/** A stamp that changes whenever the app's files change, so an open till knows a newer version is on the server. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../app');
export function appBuild() {
  try { return String(Math.max(...['index.html', 'regal-bridge.js', 'regal-ext.js'].map(f => Math.floor(fs.statSync(path.join(appDir, f)).mtimeMs)))); }
  catch { return process.env.VERCEL_GIT_COMMIT_SHA || 'static'; }
}

r.get('/books/:key/rev', regalAuth, asyncHandler(async (req, res) => {
  const row = await loadBooks(req.params.key);
  const inbox = req.params.key === BOOKS_KEY ? await pendingCount() : 0;
  res.json({ rev: row ? Number(row.rev) : 0, updated_at: row?.updated_at || null, updated_by: row?.updated_by || null, inbox, build: appBuild() });
}));

r.get('/books/:key', regalAuth, asyncHandler(async (req, res) => {
  const row = await loadBooks(req.params.key);
  if (!row || !row.data) return res.json({ rev: 0, data: null });
  const inbox = req.params.key === BOOKS_KEY ? await injectInbox(row.data) : 0;
  res.json({ rev: Number(row.rev), data: row.data, updated_at: row.updated_at, updated_by: row.updated_by, inbox });
}));

/** Save.  body: { data, rev }  — rev is the revision the client loaded; a mismatch returns 409 with the newer copy. */
r.put('/books/:key', regalAuth, asyncHandler(async (req, res) => {
  const { data, rev } = req.body || {};
  if (!data || typeof data !== 'object') throw new HttpError(400, 'No data');
  const key = req.params.key;
  await ensureBooksTables();
  if (data.S && typeof data.S === 'object') {
    for (const k of LOCAL_KEYS) delete data.S[k];
    const deletedUsers = data.S.deletedUsers || [];
    if (data.S.users) data.S.users = sanitizeUsers(data.S.users, deletedUsers);
  }
  const out = await withTransaction(async client => {
    const { rows: [cur] } = await client.query(`SELECT rev, data FROM books WHERE key = $1 FOR UPDATE`, [key]);
    const curRev = cur ? Number(cur.rev) : 0;
    if (cur && rev !== undefined && rev !== null && Number(rev) !== curRev) {
      return { conflict: true, rev: curRev, data: cur.data };
    }
    const next = curRev + 1;
    await client.query(
      `INSERT INTO books (key, rev, data, updated_at, updated_by) VALUES ($1,$2,$3,now(),$4)
       ON CONFLICT (key) DO UPDATE SET rev = EXCLUDED.rev, data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, next, JSON.stringify(data), req.regalUser.name]);
    await client.query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ($1,$2,$3,$4)`, [key, next, JSON.stringify(data), req.regalUser.name]);
    await client.query(`DELETE FROM books_history WHERE key = $1 AND id NOT IN (SELECT id FROM books_history WHERE key = $1 ORDER BY id DESC LIMIT ${HISTORY_KEEP})`, [key]);
    return { conflict: false, rev: next };
  });
  if (out.conflict) {
    const inbox = key === BOOKS_KEY ? await injectInbox(out.data) : 0;
    return res.status(409).json({ error: 'Someone else saved first', rev: out.rev, data: out.data, inbox });
  }
  if (key === BOOKS_KEY) await markImported(data);
  res.json({ ok: true, rev: out.rev });
  // everyone on the books has a sign-in of their own: a customer added at the till gets one straight
  // away. It is nothing the save has to wait for, and it makes no text — the shop sends that.
  if (key === BOOKS_KEY) catchUpLogins(data).catch(e => console.error('sign-ins catch-up failed', e.message));
}));

r.delete('/books/:key', regalAuth, asyncHandler(async (req, res) => {
  if (req.regalUser.role !== 'Owner') throw new HttpError(403, 'Only the owner can clear the books');
  await query(`DELETE FROM books WHERE key = $1`, [req.params.key]);
  res.json({ ok: true });
}));

r.get('/books/:key/history', regalAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT id, rev, saved_at, saved_by FROM books_history WHERE key = $1 ORDER BY id DESC LIMIT 50`, [req.params.key]);
  res.json(rows);
}));

r.post('/books/:key/restore/:rev', regalAuth, asyncHandler(async (req, res) => {
  if (req.regalUser.role !== 'Owner') throw new HttpError(403, 'Only the owner can restore');
  const { rows: [h] } = await query(`SELECT data FROM books_history WHERE key = $1 AND rev = $2`, [req.params.key, req.params.rev]);
  if (!h) throw new HttpError(404, 'No such revision');
  const { rows: [cur] } = await query(`SELECT rev FROM books WHERE key = $1`, [req.params.key]);
  const next = (cur ? Number(cur.rev) : 0) + 1;
  await query(`UPDATE books SET rev = $2, data = $3, updated_at = now(), updated_by = $4 WHERE key = $1`, [req.params.key, next, JSON.stringify(h.data), req.regalUser.name]);
  res.json({ ok: true, rev: next });
}));

// ---------------------------------------------------------------- SMS relay (keeps the provider call off the browser)
/** Sri Lankan mobile as the gateways want it: 94XXXXXXXXX. */
export function intlPhone(to) {
  let d = String(to || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '94' + d.slice(1);
  if (d.length === 9) d = '94' + d;
  return d;
}
/** Only these numbers get texts while the shop is trying the system out (Settings → Messaging → test mode). */
export function heldByTestMode(cfg, to) {
  const list = String(cfg?.testOnly || '').split(/[,\s;]+/).map(intlPhone).filter(Boolean);
  return list.length ? !list.includes(intlPhone(to)) : false;
}
export async function sendViaProvider(cfg, to, message) {
  if (!cfg || !cfg.apiUrl || !cfg.apiKey) throw new HttpError(400, 'SMS provider is not set up (Settings → Messaging)');
  if (heldByTestMode(cfg, to)) throw new HttpError(400, `Held — test mode: texts only go to ${cfg.testOnly}`);
  const contact = intlPhone(to);
  if (!/^94\d{9}$/.test(contact)) throw new HttpError(400, `Not a Sri Lankan mobile: ${to}`);
  const isLenz = /smslenz/i.test(cfg.provider || '') || /smslenz/i.test(cfg.apiUrl);
  let url = String(cfg.apiUrl).trim().replace(/\/+$/, '');
  if (isLenz && !/send-sms$/i.test(url)) url += '/send-sms';                 // the base URL alone was given
  const fields = isLenz
    ? { user_id: cfg.userId || '', api_key: cfg.apiKey, sender_id: cfg.sender, contact, message }
    : { to: contact, from: cfg.sender, text: message, key: cfg.apiKey };
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout((+cfg.timeout || 30) * 1000) });
  const text = await resp.text();
  if (!resp.ok) throw new HttpError(502, `Provider ${resp.status}: ${text.slice(0, 200)}`);
  let j = null; try { j = JSON.parse(text); } catch {}
  if (j && (j.status === 'error' || j.success === false || /fail|error|invalid/i.test(String(j.status || j.message || '')))) throw new HttpError(502, 'Provider: ' + (j.message || j.error || text.slice(0, 200)));
  return text;
}

r.post('/sms/send', regalAuth, asyncHandler(async (req, res) => {
  const { to, message } = req.body || {};
  if (!to || !message) throw new HttpError(400, 'to and message required');
  const row = await loadBooks();
  const cfg = row?.data?.CFG?.msg;
  if (!cfg?.live && !req.body.test) return res.json({ ok: false, status: 'Queued (sending is off in Settings → Messaging)' });
  if (heldByTestMode(cfg, to)) return res.json({ ok: false, held: true, status: `Held — test mode, only ${cfg.testOnly} gets texts` });
  try {
    const out = await sendViaProvider(cfg, to, message);
    res.json({ ok: true, status: 'Sent', response: out.slice(0, 200) });
  } catch (e) {
    res.json({ ok: false, status: 'Failed — ' + e.message });
  }
}));

// ---------------------------------------------------------------- WhatsApp (Meta Business Cloud API)
// The till's WhatsApp buttons open a chat on the PC unless Settings → Messaging chooses the Cloud API;
// then the message comes here and goes out through Meta with the token kept on the server.
const GRAPH = 'https://graph.facebook.com/v20.0';
async function graph(cfg, path, opts = {}) {
  const resp = await fetch(GRAPH + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.waToken, ...(opts.headers || {}) }, signal: AbortSignal.timeout((+cfg.timeout || 30) * 1000) });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok || j.error) throw new HttpError(502, 'WhatsApp: ' + (j.error?.message || ('HTTP ' + resp.status)) + (j.error?.error_user_msg ? ' — ' + j.error.error_user_msg : ''));
  return j;
}
/**
 * Free text, or an approved template ({ name, lang, params:[…] }).  Free text only reaches a customer
 * who has messaged the shop in the last 24 hours; everything else — a bill after a sale, a statement —
 * has to be a template Meta has approved (Settings → Messaging → WhatsApp → Templates).
 */
export async function sendViaWhatsApp(cfg, to, message, template) {
  if (!cfg?.waPhoneId || !cfg?.waToken) throw new HttpError(400, 'WhatsApp Cloud API is not set up (Settings → Messaging → WhatsApp)');
  if (heldByTestMode(cfg, to)) throw new HttpError(400, `Held — test mode: messages only go to ${cfg.testOnly}`);
  const contact = intlPhone(to);
  if (!/^94\d{9}$/.test(contact)) throw new HttpError(400, `Not a Sri Lankan mobile: ${to}`);
  const body = template && template.name
    ? { messaging_product: 'whatsapp', to: contact, type: 'template', template: { name: template.name, language: { code: template.lang || 'en' },
        components: (template.params || []).length ? [{ type: 'body', parameters: template.params.map(p => ({ type: 'text', text: String(p ?? '') })) }] : [] } }
    : { messaging_product: 'whatsapp', to: contact, type: 'text', text: { preview_url: true, body: message } };
  const j = await graph(cfg, `/${encodeURIComponent(cfg.waPhoneId)}/messages`, { method: 'POST', body: JSON.stringify(body) });
  return j.messages?.[0]?.id || 'ok';
}

r.post('/wa/send', regalAuth, asyncHandler(async (req, res) => {
  const { to, message, template } = req.body || {};
  if (!to || (!message && !template?.name)) throw new HttpError(400, 'to and a message or template required');
  const row = await loadBooks();
  const cfg = row?.data?.CFG?.msg;
  if (heldByTestMode(cfg, to)) return res.json({ ok: false, held: true, status: `Held — test mode, only ${cfg.testOnly} gets messages` });
  try {
    const id = await sendViaWhatsApp(cfg, to, message, template);
    res.json({ ok: true, status: 'Sent on WhatsApp' + (template?.name ? ' (template ' + template.name + ')' : ''), id });
  } catch (e) {
    res.json({ ok: false, status: 'Failed — ' + e.message, error: e.message });
  }
}));

/** Is the token + phone number ID good?  Shows what Meta knows about the number. */
r.get('/wa/status', regalAuth, asyncHandler(async (_req, res) => {
  const cfg = (await loadBooks())?.data?.CFG?.msg;
  if (!cfg?.waPhoneId || !cfg?.waToken) throw new HttpError(400, 'Phone number ID and token are needed first');
  const j = await graph(cfg, `/${encodeURIComponent(cfg.waPhoneId)}?fields=verified_name,display_phone_number,quality_rating,code_verification_status,name_status,messaging_limit_tier`);
  res.json({ ok: true, number: j });
}));

/** The WhatsApp Business Account the token belongs to (from the token itself), unless one is set. */
async function wabaId(cfg) {
  if (cfg.waWabaId) return String(cfg.waWabaId).trim();
  const j = await graph(cfg, `/debug_token?input_token=${encodeURIComponent(cfg.waToken)}`);
  const scopes = j.data?.granular_scopes || [];
  const s = scopes.find(x => x.scope === 'whatsapp_business_management' || x.scope === 'whatsapp_business_messaging');
  const id = s?.target_ids?.[0];
  if (!id) throw new HttpError(400, 'Could not work out the WhatsApp Business Account ID from the token — paste it in Settings (WhatsApp Manager → Business settings → WhatsApp accounts)');
  return id;
}

/** Every template on the account, with its approval state — the till maps them onto its messages. */
r.get('/wa/templates', regalAuth, asyncHandler(async (_req, res) => {
  const cfg = (await loadBooks())?.data?.CFG?.msg;
  if (!cfg?.waToken) throw new HttpError(400, 'Token is needed first');
  const id = await wabaId(cfg);
  const j = await graph(cfg, `/${encodeURIComponent(id)}/message_templates?fields=name,status,language,category,components&limit=200`);
  const templates = (j.data || []).map(t => ({ name: t.name, status: t.status, lang: t.language, category: t.category,
    body: (t.components || []).find(c => c.type === 'BODY')?.text || '', params: ((t.components || []).find(c => c.type === 'BODY')?.text || '').match(/\{\{\d+\}\}/g)?.length || 0 }));
  res.json({ ok: true, wabaId: id, templates });
}));

/** Create the shop's standard templates on the account in one go (they then wait for Meta's approval). */
r.post('/wa/templates/create', regalAuth, asyncHandler(async (req, res) => {
  const cfg = (await loadBooks())?.data?.CFG?.msg;
  if (!cfg?.waToken) throw new HttpError(400, 'Token is needed first');
  const id = await wabaId(cfg);
  const wanted = Array.isArray(req.body?.templates) ? req.body.templates : [];
  const out = [];
  for (const t of wanted) {
    try {
      const j = await graph(cfg, `/${encodeURIComponent(id)}/message_templates`, { method: 'POST', body: JSON.stringify({ name: t.name, language: t.lang || 'en', category: t.category || 'UTILITY',
        components: [{ type: 'BODY', text: t.body, example: { body_text: [t.example || []] } }] }) });
      out.push({ name: t.name, ok: true, status: j.status || 'PENDING' });
    } catch (e) { out.push({ name: t.name, ok: false, error: e.message }); }
  }
  res.json({ ok: true, results: out });
}));

// ---------------------------------------------------------------- incoming WhatsApp (webhook)
// Meta calls this when a customer writes to the shop's number (and with delivery/read receipts).
// Replies are kept in wa_inbox so the Messages page shows them and staff can answer within the
// 24-hour window when free text is allowed.  Set the same verify token here and in Meta.
let waReady = null;
function ensureWaTable() {
  if (!waReady) waReady = query(`CREATE TABLE IF NOT EXISTS wa_inbox (
    id bigserial PRIMARY KEY, wa_id varchar(80) UNIQUE, from_no varchar(20) NOT NULL, name varchar(120), body text, kind varchar(20) NOT NULL DEFAULT 'text',
    at timestamptz NOT NULL DEFAULT now(), read_at timestamptz);
    CREATE TABLE IF NOT EXISTS wa_status (msg_id varchar(80) PRIMARY KEY, status varchar(20), at timestamptz NOT NULL DEFAULT now())`).catch(e => { waReady = null; throw e; });
  return waReady;
}
r.get('/wa/webhook', asyncHandler(async (req, res) => {
  const cfg = (await loadBooks())?.data?.CFG?.msg;
  const expect = cfg?.waVerifyToken || process.env.WA_VERIFY_TOKEN || '';
  if (req.query['hub.mode'] === 'subscribe' && expect && req.query['hub.verify_token'] === expect) return res.status(200).send(req.query['hub.challenge']);
  res.status(403).send('verify token does not match');
}));
r.post('/wa/webhook', asyncHandler(async (req, res) => {
  res.sendStatus(200);                                          // Meta wants a quick 200; the work happens after
  try {
    await ensureWaTable();
    for (const entry of (req.body?.entry || [])) for (const ch of (entry.changes || [])) {
      const v = ch.value || {};
      const names = {}; for (const c of (v.contacts || [])) names[c.wa_id] = c.profile?.name || '';
      for (const m of (v.messages || [])) {
        const body = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) : `[${m.type}]`;
        await query(`INSERT INTO wa_inbox (wa_id, from_no, name, body, kind, at) VALUES ($1,$2,$3,$4,$5,to_timestamp($6)) ON CONFLICT (wa_id) DO NOTHING`,
          [m.id, m.from, names[m.from] || '', body || '', m.type || 'text', +m.timestamp || Date.now() / 1000]);
      }
      for (const s of (v.statuses || [])) await query(`INSERT INTO wa_status (msg_id, status, at) VALUES ($1,$2,now()) ON CONFLICT (msg_id) DO UPDATE SET status = EXCLUDED.status, at = now()`, [s.id, s.status]);
    }
  } catch (e) { console.error('wa webhook', e.message); }
}));
/** What customers have written, newest first, plus delivery states for what the till sent. */
r.get('/wa/inbox', regalAuth, asyncHandler(async (req, res) => {
  await ensureWaTable();
  const { rows } = await query(`SELECT id, from_no, name, body, kind, at, read_at FROM wa_inbox ORDER BY at DESC LIMIT 200`);
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200);
  const st = ids.length ? (await query(`SELECT msg_id, status FROM wa_status WHERE msg_id = ANY($1::varchar[])`, [ids])).rows : [];
  res.json({ ok: true, inbox: rows, statuses: Object.fromEntries(st.map(r => [r.msg_id, r.status])), unread: rows.filter(r => !r.read_at).length });
}));
r.post('/wa/inbox/read', regalAuth, asyncHandler(async (_req, res) => {
  await ensureWaTable();
  await query(`UPDATE wa_inbox SET read_at = now() WHERE read_at IS NULL`);
  res.json({ ok: true });
}));

/* ================== FACEBOOK AND INSTAGRAM ==================
   The same Meta Graph API the WhatsApp Cloud API already goes through, with a token of
   its own: a Page access token that also reaches the Instagram business account linked
   to that Page. Nothing is kept here — the token lives in the books under CFG.social,
   the way the WhatsApp one lives under CFG.msg.

   Instagram will not take a picture as an upload. It fetches one from a public address,
   so a post's picture is put in shop_media first (which is served without a sign-in) and
   Instagram is handed that address. Publishing there is two steps: make the container,
   then publish it. Facebook takes the picture by address in one step, and takes a post
   with no picture at all — Instagram never will. */
const socialCfg = (books) => (books?.data?.CFG?.social) || {};

async function fbGraph(cfg, path, opts = {}) {
  if (!cfg?.fbToken) throw new HttpError(400, 'No Facebook Page token yet (Social → Connect)');
  const resp = await fetch(GRAPH + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.fbToken, ...(opts.headers || {}) },
    signal: AbortSignal.timeout((+cfg.timeout || 30) * 1000),
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok || j.error) {
    throw new HttpError(502, 'Meta: ' + (j.error?.message || ('HTTP ' + resp.status)) +
      (j.error?.error_user_msg ? ' — ' + j.error.error_user_msg : ''));
  }
  return j;
}

/** What the token can actually reach: the Page, and the Instagram account joined to it. */
r.get('/social/status', regalAuth, asyncHandler(async (_req, res) => {
  const cfg = socialCfg(await loadBooks());
  if (!cfg.fbToken) return res.json({ ok: false, error: 'No Page token set yet' });
  const out = { ok: true };
  const pageId = String(cfg.fbPageId || '').trim();
  if (!pageId) return res.json({ ok: false, error: 'No Page ID set yet' });
  const page = await fbGraph(cfg, `/${encodeURIComponent(pageId)}?fields=name,username,fan_count,link,instagram_business_account{id,username,followers_count,profile_picture_url}`);
  out.page = { id: pageId, name: page.name, username: page.username, likes: page.fan_count, link: page.link };
  const ig = page.instagram_business_account;
  out.instagram = ig ? { id: ig.id, username: ig.username, followers: ig.followers_count } : null;
  res.json(out);
}));

/** Put a post out. { text, imageUrl?, channels: ['fb','ig'] } — one result per channel. */
r.post('/social/post', regalAuth, asyncHandler(async (req, res) => {
  const { text, imageUrl, channels } = req.body || {};
  const want = Array.isArray(channels) ? channels : [];
  if (!want.length) throw new HttpError(400, 'Pick at least one place to post');
  if (!String(text || '').trim() && !imageUrl) throw new HttpError(400, 'A post needs words or a picture');
  const cfg = socialCfg(await loadBooks());
  const results = {};

  if (want.includes('fb')) {
    const pageId = String(cfg.fbPageId || '').trim();
    try {
      if (!pageId) throw new HttpError(400, 'No Page ID set (Social → Connect)');
      const j = imageUrl
        ? await fbGraph(cfg, `/${encodeURIComponent(pageId)}/photos`, { method: 'POST', body: JSON.stringify({ url: imageUrl, caption: text || '' }) })
        : await fbGraph(cfg, `/${encodeURIComponent(pageId)}/feed`, { method: 'POST', body: JSON.stringify({ message: text || '' }) });
      results.fb = { ok: true, id: j.post_id || j.id, status: 'Posted to the Page' };
    } catch (e) { results.fb = { ok: false, status: 'Failed — ' + e.message }; }
  }

  if (want.includes('ig')) {
    const igId = String(cfg.igUserId || '').trim();
    try {
      if (!igId) throw new HttpError(400, 'No Instagram account linked (Social → Connect)');
      if (!imageUrl) throw new HttpError(400, 'Instagram will not take a post without a picture');
      // step one: the container
      const made = await fbGraph(cfg, `/${encodeURIComponent(igId)}/media`, {
        method: 'POST', body: JSON.stringify({ image_url: imageUrl, caption: text || '' }),
      });
      // step two: publish it
      const out = await fbGraph(cfg, `/${encodeURIComponent(igId)}/media_publish`, {
        method: 'POST', body: JSON.stringify({ creation_id: made.id }),
      });
      results.ig = { ok: true, id: out.id, status: 'Posted to Instagram' };
    } catch (e) { results.ig = { ok: false, status: 'Failed — ' + e.message }; }
  }

  res.json({ ok: Object.values(results).some(x => x.ok), results });
}));

export default r;
