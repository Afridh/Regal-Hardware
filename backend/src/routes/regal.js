// API for the Regal front-end (frontend/index.html): the books document store, sign-in, SMS relay.
import { Router } from 'express';
import { staffTexts, sendStaffTexts } from '../lib/staffTexts.js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { query, withTransaction, dbKind } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { matches, demoPassword, sha, fnv } from '../services/regalHash.js';
import { injectInbox as injectShopInbox, markImported as markShopImported, pendingCount as pendingShopCount } from './shop.js';
import { injectSupplierInbox, markSupplierImported, pendingSupplierCount } from './supplier.js';
import { injectCustInbox, markCustImported, pendingCustCount } from './customer.js';
import { catchUpLogins } from '../services/portalLogins.js';
import { stopIfTooMany, wrongTry, rightTry, pinLimits, sendingCode, guardCode } from '../lib/tries.js';
import { leaveCfg, refuse as leaveRefuse, group as leaveGroup, used as leaveUsed, allow as leaveAllow, LEAVE_TYPES } from '../lib/leaveRules.js';
// everything that arrived from outside the tills — the website's orders, the suppliers', and what a
// customer said on their own page — in one go
// Each one on its own, and none of them allowed to fail the books: if an inbox cannot be read, the till
// still gets the books (and can save), and what is waiting comes in on the next read that works.
const safely = (what, fn) => async data => { try { return await fn(data); } catch (e) { console.error(`${what} failed:`, e.message); return 0; } };
const INJECT = [safely('website orders', injectShopInbox), safely('supplier inbox', injectSupplierInbox), safely('customer inbox', injectCustInbox)];
const MARK = [safely('marking website orders', markShopImported), safely('marking supplier inbox', markSupplierImported), safely('marking customer inbox', markCustImported)];
const injectInbox = async data => { let n = 0; for (const f of INJECT) n += await f(data); return n; };
const markImported = async data => { let n = 0; for (const f of MARK) n += await f(data); return n; };
const pendingCount = async () => (await pendingShopCount()) + (await pendingSupplierCount()) + (await pendingCustCount());

const r = Router();
const BOOKS_KEY = 'regal';
/* What this server can do, and when it was started. The pages change the moment the files are pulled;
   the server's own code only when the Node app is restarted. A till reads this to know which it is
   talking to, and says so when the server is behind the page (held bills, for one, need the new one). */
const SERVER = { started: new Date().toISOString(), features: ['held'] };
const HISTORY_KEEP = 500;
// What belongs to one till's screen and is never kept in the shared books. It must agree with the
// list in frontend/regal-bridge.js. Held bills are NOT on it: a bill held on one till (a phone) is picked
// up on another, so they travel with the books — this list used to throw them away on every save.
const LOCAL_KEYS = ['user', 'pos', 'view', 'terminal', 'portal', 'cportal', 'phoneOpen', 'phoneMode', 'notifOpen', 'signedOut', 'drawer', '_fromStore', 'locId', 'isDemo'];

function sign(user, sid) {
  return jwt.sign({ kind: 'regal', name: user.name, role: user.role, perms: user.perms || [], ...(sid ? { sid } : {}) }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '12h' });
}

/* ---------------------------------------------------------------- one device at a time
   Every sign-in starts a session of its own, and only a person's newest one is good: signing in on a
   second till or phone signs the first one out (it is told why, the next time it talks to the server,
   within seconds). The newest wins rather than the first, so a till left signed in, or a phone that
   was lost, never locks its owner out. A sign-in from before this existed is let go the same way. */
let sessReady = null;
function ensureSessions() {
  if (!sessReady) sessReady = query(`CREATE TABLE IF NOT EXISTS till_sessions (
    name varchar(80) PRIMARY KEY, sid varchar(40) NOT NULL, device varchar(200), ip varchar(64), seen_at timestamptz NOT NULL DEFAULT now())`).catch(e => { sessReady = null; throw e; });
  return sessReady;
}
const sessCache = new Map();                         // name -> { sid, t } — read again after a few seconds
const sessName = (n) => String(n || '').toLowerCase().trim().slice(0, 80);
async function newSession(name, req) {
  const n = sessName(name), sid = crypto.randomBytes(12).toString('hex');
  await ensureSessions();
  await query(`INSERT INTO till_sessions (name, sid, device, ip, seen_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (name) DO UPDATE SET sid = EXCLUDED.sid, device = EXCLUDED.device, ip = EXCLUDED.ip, seen_at = EXCLUDED.seen_at`,
    [n, sid, String(req.headers['user-agent'] || '').slice(0, 200), String(req.ip || '').slice(0, 64)]);
  sessCache.set(n, { sid, t: Date.now() });
  return sid;
}
async function currentSid(name) {
  const n = sessName(name), c = sessCache.get(n);
  if (c && Date.now() - c.t < 5000) return c.sid;
  await ensureSessions();
  const { rows: [r] } = await query(`SELECT sid FROM till_sessions WHERE name = $1`, [n]);
  const sid = r ? r.sid : null;
  sessCache.set(n, { sid, t: Date.now() });
  return sid;
}
/** A sign-in for this person, which ends any other they have. */
async function signIn(user, req) { return sign(user, await newSession(user.name, req)); }
export const SIGNED_ELSEWHERE = 'Signed in on another device — this one has been signed out';

/** Bearer-token guard for the books API. */
export async function regalAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'Sign in first');
    const p = jwt.verify(token, process.env.JWT_SECRET);
    if (p.kind !== 'regal') throw new HttpError(401, 'Wrong kind of token');
    if (p.isDemo && req.method !== 'GET') {
      throw new HttpError(403, 'Demo mode is trial-only and cannot modify live store data');
    }
    if (!p.isDemo) {
      const now = await currentSid(p.name).catch(() => undefined);   // the table not readable: let it through rather than lock the shop
      if (now && now !== p.sid) throw new HttpError(401, SIGNED_ELSEWHERE);
    }
    req.regalUser = p;
    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return next(new HttpError(401, 'Session expired'));
    next(e);
  }
}

// the books' key column: a plain name to PostgreSQL, a reserved word MySQL needs quoted
const KEY_COL = dbKind === 'mysql' ? '`key`' : 'key';

// a fresh hosted database (Neon, Supabase…) has no tables yet: make the two the books need on first use
let booksReady = null;
export function ensureBooksTables() {
  // MySQL: `key` is a reserved word there and one call runs one statement, so the same two tables are
  // made its way (as in db/schema.mysql.sql)
  if (!booksReady && dbKind === 'mysql') booksReady = (async () => {
    await query('CREATE TABLE IF NOT EXISTS `books` (`key` VARCHAR(50) NOT NULL, `rev` BIGINT NOT NULL DEFAULT 0, `data` JSON, `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP, `updated_by` VARCHAR(80), PRIMARY KEY (`key`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci');
    await query('CREATE TABLE IF NOT EXISTS `books_history` (`id` BIGINT AUTO_INCREMENT NOT NULL, `key` VARCHAR(50) NOT NULL, `rev` BIGINT NOT NULL, `data` JSON, `saved_at` DATETIME DEFAULT CURRENT_TIMESTAMP, `saved_by` VARCHAR(80), PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci');
  })().catch(e => { booksReady = null; throw e; });
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

/* One record per person. Two tills that changed the same person at once could each keep their own copy
   (the PIN added on one, "last signed in" on the other), and the staff list showed them twice — worse,
   a sign-in could find the copy without the PIN. The copies are put back together: the one in use most
   recently stands, and anything only the other one has (PIN, mobile, password, user code) is kept. */
export function oneEachUser(list) {
  const groups = new Map();
  for (const u of list) { const k = String(u?.name || '').toLowerCase().trim(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u); }
  const out = [];
  for (const [, g] of groups) {
    if (g.length === 1) { out.push(g[0]); continue; }
    const rank = (u) => [u.active === false ? 0 : 1, String(u.lastSeen || ''), u.pinHash ? 1 : 0];
    const best = g.slice().sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? 1 : -1; return 0; })[0];
    const one = { ...best };
    for (const o of g) {
      if (o === best) continue;
      if (!one.pinHash && o.pinHash) { one.pinHash = o.pinHash; one.pinLen = o.pinLen; }
      for (const k of ['phone', 'passHash', 'uid', 'no', 'salesId', 'addedAt']) if ((one[k] === undefined || one[k] === '') && o[k] !== undefined && o[k] !== '') one[k] = o[k];
    }
    out.push(one);
  }
  return out;
}

export function sanitizeUsers(users, deletedUsers = []) {
  let list = Array.isArray(users) ? users : [];
  const delList = (Array.isArray(deletedUsers) ? deletedUsers : []).map(x => String(x || '').toLowerCase().trim());
  list = list.filter(u => {
    if (!u || !u.name) return false;
    const nl = String(u.name || '').toLowerCase().trim();
    if (nl === 'demo' || nl === 'demo user') return false;
    if (LEGACY_USERS.includes(nl) && !u.addedAt) return false;       // sample staff, not a real person added in Users
    if (delList.includes(nl)) return false;
    return true;
  });

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

  return oneEachUser(list);
}

async function loadBooks(key = BOOKS_KEY) {
  await ensureBooksTables();
  const { rows: [row] } = await query(`SELECT key, rev, data, updated_at, updated_by FROM books WHERE key = $1`, [key]);
  if (row?.data?.S) {
    const deletedUsers = row.data.S.deletedUsers || [];
    row.data.S.users = sanitizeUsers(row.data.S.users, deletedUsers);
    if (Array.isArray(row.data.S.employees)) {
      row.data.S.employees = row.data.S.employees.filter(e => {
        const n = String(e?.name || '').toLowerCase().trim();
        return n !== 'demo' && n !== 'demo user';
      });
    }
    if (row.data.S.shift?.days) {
      Object.keys(row.data.S.shift.days).forEach(d => {
        Object.keys(row.data.S.shift.days[d] || {}).forEach(k => {
          if (String(k).toLowerCase().includes('demo')) delete row.data.S.shift.days[d][k];
        });
      });
    }
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
/* A till in use keeps its sign-in: it asks for a fresh one well before the old one runs out. A sign-in
   lasted twelve hours and then simply stopped, and a till left open from one day to the next went on
   working with nothing reaching the server — the orders it sent, the bills it made — and nothing
   coming in from the suppliers. Only a sign-in that is still good can be renewed. */
r.post('/books/refresh', regalAuth, asyncHandler(async (req, res) => {
  const p = req.regalUser;
  if (p.isDemo) throw new HttpError(403, 'Demo sign-ins are not renewed');
  res.json({ ok: true, token: sign({ name: p.name, role: p.role, perms: p.perms || [] }, p.sid) });
}));

r.post('/books/login', asyncHandler(async (req, res) => {
  const { user, password } = req.body || {};
  if (!user || typeof password !== 'string') throw new HttpError(400, 'Name and password required');
  if (String(user).toLowerCase() === 'demo') {
    if (password !== 'demo123') throw new HttpError(401, 'Demo password is demo123');
    const demoUser = {
      name: 'Demo User',
      role: 'Demo Admin',
      perms: ['sell','discount','cancelBill','cost','profit','adjustInvoice','overLimit','belowCost','receive','products','paySupplier','reports','settings','users','approve']
    };
    return res.json({
      ok: true,
      token: jwt.sign({ kind: 'regal', name: 'Demo User', role: 'Demo Admin', perms: demoUser.perms, isDemo: true }, process.env.JWT_SECRET, { expiresIn: '12h' }),
      user: demoUser,
      isDemo: true
    });
  }
  const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const isAdmin = String(user).toLowerCase() === 'admin';
  const row = await loadBooks();
  // The setup ways in (admin + the seed password, or any name + its demo password, as Owner) are for a
  // shop that has no books yet. Once the books are there only a real user's own password opens them:
  // otherwise anyone who typed "name" / "name123" was the owner of a live shop. A locked-out shop is
  // recovered with `npm run reset:admin`, which writes a real admin user.
  const fresh = !row;
  const users = sanitizeUsers(row?.data?.S?.users, row?.data?.S?.deletedUsers || []);
  const u = users.find(x => String(x.name).toLowerCase() === String(user).toLowerCase());

  if (u) {
    if (u.active === false || u.canLogin === false) throw new HttpError(401, 'That name cannot sign in');
    const passLimits = [['till:' + String(user).toLowerCase(), 8], ['tillip:' + req.ip, 40]];
    stopIfTooMany(passLimits);
    const defAcc = DEFAULT_ACCOUNTS.find(a => a.name.toLowerCase() === String(user).toLowerCase());
    const isDefPass = defAcc && (!u.passHash || u.passHash === sha(defAcc.pass) || u.passHash === fnv(defAcc.pass)) && password === defAcc.pass;
    if (matches(u, password) || isDefPass || (fresh && isAdmin && password === adminPass)) {
      if (!u.passHash && defAcc) u.passHash = sha(defAcc.pass);
      rightTry('till:' + String(user).toLowerCase());
      return res.json({ ok: true, token: await signIn(u, req), user: { name: u.name, role: u.role, perms: u.perms || [] } });
    }
    wrongTry(passLimits);
    throw new HttpError(401, 'That password is not right');
  }

  if (fresh && isAdmin && password === adminPass) {
    const adminUser = { name: 'admin', role: 'Owner', perms: ['sell','discount','cancelBill','cost','profit','adjustInvoice','overLimit','belowCost','receive','products','paySupplier','reports','settings','users','approve'] };
    return res.json({ ok: true, token: await signIn(adminUser, req), user: { name: adminUser.name, role: 'Owner', perms: adminUser.perms || [] } });
  }

  if (fresh && (password === adminPass || password === demoPassword(user))) {
    return res.json({ ok: true, token: await signIn({ name: user, role: 'Owner', perms: [] }, req), user: { name: user, role: 'Owner', perms: [] }, bootstrap: true });
  }
  throw new HttpError(401, 'That password is not right');
}));

r.get('/books/me', regalAuth, (req, res) => res.json({ ok: true, user: req.regalUser }));

/** Names + roles only, for the lock screen of a browser that has never opened the books. */
r.get('/books/users', asyncHandler(async (_req, res) => {
  const users = await usersFromBooks();
  res.json({ users: users.filter(u => u.active !== false && u.canLogin !== false).map(u => ({ name: u.name, role: u.role, uid: u.uid || 'AD', pin: !!(u.pinHash || u.pin) })) });
}));

/* ---------------------------------------------------------------- user code + PIN (the lock screen)
   A member of staff types their short user code (AF, S1 …), is welcomed by name, and keys a 4–6 digit
   PIN. The PIN is kept as a hash in the books (pinHash, the same way as passwords, with "pin:" in
   front so it never equals a password's), and wrong ones are counted per code and per address. */
const pinUser = async (code) => {
  const c = String(code || '').trim().toLowerCase();
  if (!c || c.length > 12) return null;
  return (await usersFromBooks()).find(u => u.active !== false && u.canLogin !== false && String(u.uid || '').toLowerCase() === c) || null;
};
const pinOk = (u, pin) => !!u?.pinHash && (u.pinHash === sha('pin:' + pin) || u.pinHash === fnv('pin:' + pin));

/** Whose code is this — the name and role for the welcome, and how many digits their PIN has. */
r.post('/books/pin-who', asyncHandler(async (req, res) => {
  stopIfTooMany([['pinwho:' + req.ip, 60]]);
  const u = await pinUser(req.body?.code);
  if (!u) { wrongTry([['pinwho:' + req.ip, 60]]); throw new HttpError(404, 'There is no one with that user code'); }
  const { phone } = await staffPhone(u);
  res.json({ ok: true, name: u.name, role: u.role, uid: u.uid, pinLen: u.pinHash ? (+u.pinLen || 4) : 0, phone: phone ? maskPhone(phone) : null });
}));

r.post('/books/pin-login', asyncHandler(async (req, res) => {
  const code = String(req.body?.code || '').trim(), pin = String(req.body?.pin || '').replace(/\D/g, '');
  const limits = pinLimits(code, req.ip);
  stopIfTooMany(limits);
  const u = await pinUser(code);
  if (!u || !pinOk(u, pin)) { wrongTry(limits); throw new HttpError(401, u && !u.pinHash ? 'No PIN is set for you yet — sign in with your password' : 'That PIN is not right'); }
  rightTry('pin:' + code.toLowerCase()); rightTry('pinday:' + code.toLowerCase());
  res.json({ ok: true, token: await signIn(u, req), user: { name: u.name, role: u.role, perms: u.perms || [] } });
}));

/* ---------------------------------------------------------------- an admin says yes, at someone else's till
   A line under cost, a second person going on a break: an admin puts in their PIN or password at the till
   (or the shift clock) in front of them. This only checks it — no sign-in is made, so the admin's own
   till stays signed in and the till they typed it on stays the cashier's. Asked from a signed-in till or
   shift clock only; wrong tries are counted as at the lock screen. */
r.post('/books/verify', asyncHandler(async (req, res) => {
  const h = req.headers.authorization || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
  let p = null; try { p = jwt.verify(t, process.env.JWT_SECRET) } catch { p = null }
  if (!p || !['regal', 'shift-admin'].includes(p.kind)) throw new HttpError(401, 'Sign in first');
  const who = String(req.body?.user || req.body?.code || '').trim(), secret = String(req.body?.secret ?? '');
  if (!who || !secret) throw new HttpError(400, 'Which admin, and their PIN or password?');
  const limits = [['verify:' + who.toLowerCase(), 8], ['verifyip:' + req.ip, 40]];
  stopIfTooMany(limits);
  const users = await usersFromBooks();
  const u = users.find(x => x.active !== false && x.canLogin !== false && (String(x.name).toLowerCase() === who.toLowerCase() || String(x.uid || '').toLowerCase() === who.toLowerCase()));
  const defAcc = u && DEFAULT_ACCOUNTS.find(a => a.name.toLowerCase() === String(u.name).toLowerCase());
  const good = !!u && ((/^\d{4,6}$/.test(secret) && pinOk(u, secret)) || matches(u, secret)
    || (defAcc && (!u.passHash || u.passHash === sha(defAcc.pass) || u.passHash === fnv(defAcc.pass)) && secret === defAcc.pass));
  // 400, not 401: a wrong PIN is the admin's, and must not sign the till it was typed on out
  if (!good) { wrongTry(limits); throw new HttpError(400, 'That PIN or password is not right'); }
  rightTry('verify:' + who.toLowerCase());
  res.json({ ok: true, name: u.name, role: u.role, perms: u.perms || [], admin: isShiftAdmin(u.role) || (u.perms || []).includes('approve') });
}));

/* ---------------------------------------------------------------- user code + a texted code
   For anyone without a PIN to hand: the code goes to the mobile on their user (or on their staff card),
   checked like every other texted code — six digits, a few minutes, wrong ones counted. */
const staffPhone = async (u) => {
  const row = await loadBooks(), S = row?.data?.S || {};
  const nm = String(u.name || '').toLowerCase().trim();
  const e = (S.employees || []).find(x => String(x.userName || '').toLowerCase().trim() === nm || String(x.name || '').toLowerCase().trim() === nm);
  const ph = String(u.phone || e?.phone || '').replace(/\D/g, '');
  return { phone: /^0\d{9}$/.test(ph) ? ph : (/^94\d{9}$/.test(ph) ? '0' + ph.slice(2) : ''), CFG: row?.data?.CFG || {} };
};
const TILL_OTP_MS = 5 * 60 * 1000;
function tillOtp(phone, when = Date.now()) {
  const h = crypto.createHmac('sha256', process.env.JWT_SECRET || 'regal').update('till|' + phone + '|' + Math.floor(when / TILL_OTP_MS)).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}
const tillOtpOk = (phone, code) => [0, 1].some(back => tillOtp(phone, Date.now() - back * TILL_OTP_MS) === String(code || '').trim());
const maskPhone = (p) => String(p).replace(/^(\d{3})\d{4}(\d{3})$/, '$1••••$2');

r.post('/books/otp-send', asyncHandler(async (req, res) => {
  const u = await pinUser(req.body?.code);
  if (!u) throw new HttpError(404, 'There is no one with that user code');
  const { phone, CFG } = await staffPhone(u);
  if (!phone) throw new HttpError(400, 'There is no mobile on your user — ask the owner to add it, or use your PIN or password');
  sendingCode(phone, req.ip);
  const code = tillOtp(phone);
  const shop = String(CFG.shop?.name || 'Regal Hardware').replace(/^REGAL HARDWARE$/, 'Regal Hardware');
  let sent = false;
  if (CFG.msg?.apiUrl && CFG.msg?.apiKey) {
    const where = req.body?.for === 'shift' ? 'open the shift clock' : 'sign in to the till';
    try { await sendViaProvider(CFG.msg, phone, `Dear ${String(u.name).split(' ')[0]},\nYour code to ${where} is ${code}.\nIt works for 5 minutes. Please do not share it.\n\n${shop}`); sent = true; }
    catch (e) { console.error('till otp sms failed', e.message); }
  }
  res.json({ ok: true, sent, phone: maskPhone(phone), ...(!sent && mayRevealCode(req) ? { code } : {}),
    ...(sent ? {} : { note: 'The text could not go out — use your PIN or password, or ask the owner to check Settings → Messages' }) });
}));

r.post('/books/otp-login', asyncHandler(async (req, res) => {
  const u = await pinUser(req.body?.code);
  if (!u) throw new HttpError(404, 'There is no one with that user code');
  const { phone } = await staffPhone(u);
  if (!phone) throw new HttpError(400, 'There is no mobile on your user');
  guardCode(phone, req.ip, () => tillOtpOk(phone, req.body?.otp));
  res.json({ ok: true, token: await signIn(u, req), user: { name: u.name, role: u.role, perms: u.perms || [] } });
}));

// ---------------------------------------------------------------- books document
// Online orders from the public site wait in their own table until a till has saved them into the
// books: a read hands them over (inbox), a save that contains them marks them done (see shop.js).
/** A stamp that changes whenever the app's files change, so an open till knows a newer version is on the server. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend');
export function appBuild() {
  try { return String(Math.max(...['index.html', 'regal-bridge.js', 'regal-ext.js'].map(f => Math.floor(fs.statSync(path.join(appDir, f)).mtimeMs)))); }
  catch { return process.env.VERCEL_GIT_COMMIT_SHA || 'static'; }
}

// polled every few seconds by every till and phone: read the revision only, never the whole books document
r.get('/books/:key/rev', asyncHandler(async (req, res) => {
  await ensureBooksTables();
  const { rows: [row] } = await query(`SELECT rev, updated_at, updated_by FROM books WHERE ${KEY_COL} = $1`, [req.params.key]);
  // the waiting-orders count is extra: if those tables cannot be read, the revision still goes out,
  // or every till and the shift page would stop seeing changes
  let inbox = 0;
  if (req.params.key === BOOKS_KEY) {
    try { inbox = await pendingCount(); } catch (e) { console.error('pending orders count failed:', e.message); }
  }
  res.json({ rev: row ? Number(row.rev) : 0, updated_at: row?.updated_at || null, updated_by: row?.updated_by || null, inbox, build: appBuild(),
    server: SERVER });
}));

r.get('/books/:key', regalAuth, asyncHandler(async (req, res) => {
  const row = await loadBooks(req.params.key);
  if (!row || !row.data) return res.json({ rev: 0, data: null });
  const inbox = req.params.key === BOOKS_KEY ? await injectInbox(row.data) : 0;
  res.json({ rev: Number(row.rev), data: row.data, updated_at: row.updated_at, updated_by: row.updated_by, inbox });
}));

// ---------------------------------------------------------------- the shift page (/shift)
// Opened by an admin (Super Admin / Admin / Owner) with their till login. Its sign-in lasts 30 days, so a
// phone left at the door as the punch clock does not ask every morning; it can read the staff and the
// attendance and write punches, nothing else.
const SHIFT_ADMIN_ROLES = ['super admin', 'superadmin', 'admin', 'owner'];
const isShiftAdmin = role => SHIFT_ADMIN_ROLES.includes(String(role || '').toLowerCase().trim());

function shiftAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'An admin has to sign in on this device');
    const p = jwt.verify(token, process.env.JWT_SECRET);
    // the shift page's own sign-in, or an admin's till sign-in
    if ((p.kind !== 'shift-admin' && p.kind !== 'regal') || !isShiftAdmin(p.role)) throw new HttpError(403, 'Only an admin can open the shift page');
    req.shiftUser = p;
    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return next(new HttpError(401, 'Sign in again'));
    next(e);
  }
}

r.post('/books/shift-login', asyncHandler(async (req, res) => {
  const { user, password } = req.body || {};
  if (!user || typeof password !== 'string') throw new HttpError(400, 'Name and password required');
  const users = await usersFromBooks();
  const u = users.find(x => String(x.name).toLowerCase() === String(user).toLowerCase().trim());
  if (!u || u.active === false || u.canLogin === false) throw new HttpError(401, 'That name cannot sign in');
  const defAcc = DEFAULT_ACCOUNTS.find(a => a.name.toLowerCase() === String(u.name).toLowerCase());
  const isDefPass = defAcc && (!u.passHash || u.passHash === sha(defAcc.pass) || u.passHash === fnv(defAcc.pass)) && password === defAcc.pass;
  if (!matches(u, password) && !isDefPass) throw new HttpError(401, 'That password is not right');
  if (!isShiftAdmin(u.role)) throw new HttpError(403, 'Only a Super Admin or Admin can open the shift page');
  const token = jwt.sign({ kind: 'shift-admin', name: u.name, role: u.role }, process.env.JWT_SECRET, { expiresIn: process.env.SHIFT_JWT_EXPIRES || '30d' });
  res.json({ ok: true, token, user: { name: u.name, role: u.role } });
}));

/* The shift page signs in the till's way too: the user code, then the PIN or a code texted to the mobile on
   their user. It is the shift page's own 30-day sign-in, not a till one, so an admin opening the shift clock
   on the door phone is not signed out of their till (one device at a time is for the till). Admins only. */
const shiftToken = (u) => jwt.sign({ kind: 'shift-admin', name: u.name, role: u.role }, process.env.JWT_SECRET, { expiresIn: process.env.SHIFT_JWT_EXPIRES || '30d' });
const SHIFT_ONLY = 'Only the owner or an admin can open the shift clock';

r.post('/books/shift-pin', asyncHandler(async (req, res) => {
  const code = String(req.body?.code || '').trim(), pin = String(req.body?.pin || '').replace(/\D/g, '');
  const limits = pinLimits(code, req.ip);
  stopIfTooMany(limits);
  const u = await pinUser(code);
  if (!u || !pinOk(u, pin)) { wrongTry(limits); throw new HttpError(401, u && !u.pinHash ? 'No PIN is set for you yet — use a texted code or your password' : 'That PIN is not right'); }
  rightTry('pin:' + code.toLowerCase()); rightTry('pinday:' + code.toLowerCase());
  if (!isShiftAdmin(u.role)) throw new HttpError(403, SHIFT_ONLY);
  res.json({ ok: true, token: shiftToken(u), user: { name: u.name, role: u.role, uid: u.uid } });
}));

r.post('/books/shift-otp', asyncHandler(async (req, res) => {
  const u = await pinUser(req.body?.code);
  if (!u) throw new HttpError(404, 'There is no one with that user code');
  const { phone } = await staffPhone(u);
  if (!phone) throw new HttpError(400, 'There is no mobile on your user');
  guardCode(phone, req.ip, () => tillOtpOk(phone, req.body?.otp));
  if (!isShiftAdmin(u.role)) throw new HttpError(403, SHIFT_ONLY);
  res.json({ ok: true, token: shiftToken(u), user: { name: u.name, role: u.role, uid: u.uid } });
}));

// PostgreSQL gives JSON back as objects; MySQL may give it back as text (MariaDB always does, its
// JSON is text underneath)
const asJson = v => typeof v === 'string' ? (v ? JSON.parse(v) : null) : (v ?? null);

/** The people on the board are the shop's users, as the till's syncUsersAndStaff makes them: a staff
 *  record is kept only while a user of that name exists, and a user with no record yet gets the id the
 *  till will give them (the next one up, in user order) — so a punch here lands on the same card there. */
export function staffForUsers(users, employees, deleted, days) {
  const gone = (Array.isArray(deleted) ? deleted : []).map(x => String(x || '').toLowerCase().trim());
  const low = x => String(x || '').toLowerCase().trim();
  const us = sanitizeUsers(Array.isArray(users) ? users.map(u => ({ ...u })) : [], gone).filter(u => u && u.name);
  // as the till's syncUsersAndStaff: everyone on the staff list stays — having no till login is not a reason
  // to drop somebody — except a removed person, the demo, and the old sample names nobody added in Users
  const staff = (Array.isArray(employees) ? employees : [])
    .filter(e => e && e.name && !gone.includes(low(e.name)) && !['demo', 'demo user'].includes(low(e.name))
      && !(LEGACY_USERS.includes(low(e.name)) && !us.some(u => low(u.name) === low(e.name))))
    .map(e => ({ ...e }));
  const today = new Date().toISOString().slice(0, 10);
  us.forEach((u, i) => {
    if (u.active === false) return;
    const n = low(u.name);
    const e = staff.find(x => low(x.name) === n || low(x.userName) === n);
    if (e) {
      Object.assign(e, { name: u.name, position: u.role, userName: u.name, active: true });
      if (!e.code) e.code = u.uid || ('E' + String(e.id || (i + 1)).padStart(3, '0'));
      return;
    }
    // as the till's nextEmpId: a number that has punches (a removed person's) is never given out again
    let id = staff.reduce((m, x) => Math.max(m, +x.id || 0), 0);
    Object.values(days || {}).forEach(d => Object.keys(d || {}).forEach(k => { if (/^\d+$/.test(k)) id = Math.max(id, +k); }));
    id += 1;
    staff.push({ id, code: u.uid || ('E' + String(id).padStart(3, '0')), name: u.name, position: u.role, userName: u.name,
      basis: 'monthly', rate: 0, otMult: 1.5, days: 26, ot: 0, advance: 0, phone: '', card: '', deviceId: '', joined: today, active: true });
  });
  // a user switched off in Users is off the board too
  staff.forEach(e => { const u = us.find(x => low(x.name) === low(e.name)); if (u && u.active === false) e.active = false; });
  return staff;
}

/** What the shift page is shown: the staff as the till keeps them — their details, but not wages or PINs —
 *  how each one can prove it is them (a PIN, a mobile), the recent days, the leave on the calendar with its
 *  rules, and the salary asks still waiting. */
const lowName = x => String(x || '').toLowerCase().trim();
const maskTail = p => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(0, 3) + '•••' + d.slice(-3) : ''; };
const userOf = (users, e) => (Array.isArray(users) ? users : []).find(u => u && lowName(u.name) === lowName(e.userName || e.name)) || null;
const empPhone = (u, e) => { const p = String((u && u.phone) || (e && e.phone) || '').replace(/\D/g, ''); return /^0\d{9}$/.test(p) ? p : /^94\d{9}$/.test(p) ? '0' + p.slice(2) : ''; };
const slToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
function shiftView(rev, employees, shift, deleted, users, leaves, lcfg, approvals) {
  const c = leaveCfg({ leave: lcfg || {} });
  const staff = staffForUsers(users, employees, deleted, (shift || {}).days)
    .map(({ rate, payType, otMult, pin, advance, basis, days, ot, phone, ...rest }) => {
      const u = userOf(users, rest), ph = empPhone(u, { phone });
      return { ...rest, phoneMasked: maskTail(ph), hasPhone: !!ph, pinLen: u && u.pinHash ? (+u.pinLen || 4) : 0, group: leaveGroup(c, rest.name), uid: u ? u.uid || '' : '' };
    });
  const s = shift || {};
  // a punch clock shows today and the days just gone; the full history stays in the books
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const recent = Object.fromEntries(Object.entries(s.days || {}).filter(([d]) => d >= since));
  const from = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10);
  const lv = (Array.isArray(leaves) ? leaves : []).filter(l => l && l.to >= from && l.status !== 'cancelled')
    .map(({ id, who, from, to, type, half, status, reason, by }) => ({ id, who, from, to, type, half, status, reason, by }));
  const asks = (Array.isArray(approvals) ? approvals : []).filter(a => a && a.kind === 'salaryAsk').slice(0, 60)
    .map(a => ({ id: a.id, status: a.status, at: a.at, note: a.note || '', ...(a.data || {}) }));
  return { ok: true, rev: Number(rev), employees: staff, today: slToday(),
    shift: { settings: s.settings || {}, holidays: s.holidays || [], openDays: s.openDays || [], days: recent },
    leave: { list: lv, cfg: { perEmp: c.perEmp, perDir: c.perDir, poya: c.poya, dayAsk: c.dayAsk, sepGroups: c.sepGroups, groups: c.groups, poyaDays: c.poyaDays } },
    salaryAsks: asks };
}

r.get('/books/:key/shift', shiftAuth, asyncHandler(async (req, res) => {
  await ensureBooksTables();
  const empty = { ok: true, rev: 0, employees: [], shift: { days: {}, settings: {}, holidays: [] } };
  if (dbKind === 'mysql') {
    // MySQL has no #> path reach-in: the document is read and the parts taken out here
    const { rows: [row] } = await query('SELECT rev, data FROM books WHERE `key` = ?', [req.params.key]);
    const all = asJson(row?.data), S = all?.S;
    return res.json(row ? shiftView(row.rev, S?.employees, S?.shift, S?.deletedUsers, S?.users, S?.leaves, all?.CFG?.leave, S?.approvals) : empty);
  }
  const { rows: [row] } = await query(
    `SELECT rev, data#>'{S,employees}' AS employees, data#>'{S,shift}' AS shift, data#>'{S,deletedUsers}' AS deleted,
            data#>'{S,users}' AS users, data#>'{S,leaves}' AS leaves, data#>'{CFG,leave}' AS lcfg, data#>'{S,approvals}' AS approvals
       FROM books WHERE key = $1`, [req.params.key]);
  res.json(row ? shiftView(row.rev, row.employees, row.shift, row.deleted, row.users, row.leaves, row.lcfg, row.approvals) : empty);
}));

const isSuperRole = r => ['super admin', 'superadmin', 'owner'].includes(String(r || '').toLowerCase());

/** One punch on MySQL: the document is locked, the one record changed in it, and it is written back.
 *  No history row, as on PostgreSQL. */
async function shiftPunchMySQL(key, date, id, r0, by, role) {
  return withTransaction(async client => {
    const { rows: [cur] } = await client.query('SELECT rev, data FROM books WHERE `key` = ? FOR UPDATE', [key]);
    if (!cur) throw new HttpError(404, 'The books are not on the server yet — open the shop system once first');
    const data = asJson(cur.data) || {};
    const had = data.S?.shift?.days?.[date]?.[id];
    if (had && r0 && Number(had.updatedAt || 0) > Number(r0.updatedAt || 0)) return { stale: true, rev: Number(cur.rev), rec: had };
    if (had?.status === 'absent' && r0?.status !== 'absent' && !isSuperRole(role)) return { stale: true, rev: Number(cur.rev), rec: had };   // only the Super Admin lifts an absence
    const next = Number(cur.rev) + 1;
    data.S = data.S || {};
    data.S.shift = data.S.shift || {};
    const days = data.S.shift.days = data.S.shift.days || {};
    if (r0) (days[date] = days[date] || {})[id] = { ...r0, _srv: next };   // stamped as on PostgreSQL, for the till's merge
    else if (days[date]) { delete days[date][id]; if (!Object.keys(days[date]).length) delete days[date]; }
    await client.query('UPDATE books SET data = ?, rev = ?, updated_at = NOW(), updated_by = ? WHERE `key` = ?',
      [JSON.stringify(data), next, by, key]);
    return { stale: false, rev: next, data, had };
  });
}

/** body: { date, empId, rec } — rec null clears the day. A record older than the one on the server is refused (409). */
r.post('/books/:key/shift', shiftAuth, asyncHandler(async (req, res) => {
  const { date, empId, rec } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new HttpError(400, 'Bad date');
  if (empId === undefined || empId === null || empId === '') throw new HttpError(400, 'empId required');
  const key = req.params.key, id = String(empId);
  const r0 = rec && typeof rec === 'object' ? { ...rec, by: req.shiftUser.name } : null;
  await ensureBooksTables();
  const out = dbKind === 'mysql' ? await shiftPunchMySQL(key, date, id, r0, req.shiftUser.name, req.shiftUser.role) : await withTransaction(async client => {
    const { rows: [cur] } = await client.query(
      `SELECT rev, data#>ARRAY['S','shift','days',$2::text,$3::text] AS rec FROM books WHERE key = $1 FOR UPDATE`, [key, date, id]);
    if (!cur) throw new HttpError(404, 'The books are not on the server yet — open the shop system once first');
    if (cur.rec && r0 && Number(cur.rec.updatedAt || 0) > Number(r0.updatedAt || 0)) return { stale: true, rev: Number(cur.rev), rec: cur.rec };
    if (cur.rec?.status === 'absent' && r0?.status !== 'absent' && !isSuperRole(req.shiftUser.role)) return { stale: true, rev: Number(cur.rev), rec: cur.rec };   // only the Super Admin lifts an absence
    const prev = cur.rec;
    // written in place, stamped with the revision it made (_srv) so a till's save can lay it over its own;
    // the whole document is never read out, rewritten or copied into the history for a punch
    const { rows: [u] } = r0
      ? await client.query(
          `UPDATE books SET data = jsonb_set(
              jsonb_set(jsonb_set(data, '{S,shift}', COALESCE(data#>'{S,shift}', '{}'::jsonb), true),
                        '{S,shift,days}', COALESCE(data#>'{S,shift,days}', '{}'::jsonb), true),
              ARRAY['S','shift','days',$2::text],
              COALESCE(data#>ARRAY['S','shift','days',$2::text], '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb || jsonb_build_object('_srv', rev + 1)), true),
             rev = rev + 1, updated_at = now(), updated_by = $5
           WHERE key = $1 RETURNING rev`, [key, date, id, JSON.stringify(r0), req.shiftUser.name])
      : await client.query(
          `UPDATE books SET data = data #- ARRAY['S','shift','days',$2::text,$3::text], rev = rev + 1, updated_at = now(), updated_by = $4
           WHERE key = $1 RETURNING rev`, [key, date, id, req.shiftUser.name]);
    return { stale: false, rev: Number(u.rev), prev };
  });
  if (out.stale) return res.status(409).json({ error: 'A newer punch is already on the server', rev: out.rev, rec: out.rec });
  res.json({ ok: true, rev: out.rev });
  // the person is told about their own day: in, out, late back from a break (lib/staffTexts.js)
  try {
    let data = out.data, had = out.had;
    if (!data && r0) { const { rows: [b] } = await query('SELECT data FROM books WHERE key = $1', [key]); data = asJson(b && b.data); had = out.prev; }
    if (data && r0) sendStaffTexts(data, staffTexts(data, date, id, had, r0), sendViaProvider);
  } catch (e) { console.warn('staff texts:', e.message); }
}));

/* ---------------------------------------------------------------- asking, at the shift clock
   A member of staff asks for leave, or for their salary or an advance, at the shift clock. They prove it is
   them with their own PIN, or a code texted to the mobile on their user or staff card — the admin signed in
   on the device is not enough, or anyone at the door could ask in someone else's name. A leave is checked
   against the same rules as at the till; then the ask goes into the books as the till would make it — on
   the calendar, in Approvals, and on the approvers' bell — and the owner says yes or no at the till. */
async function booksEdit(key, by, fn) {
  return withTransaction(async client => {
    const { rows: [cur] } = await client.query(dbKind === 'mysql' ? 'SELECT rev, data FROM books WHERE `key` = ? FOR UPDATE' : 'SELECT rev, data FROM books WHERE key = $1 FOR UPDATE', [key]);
    if (!cur) throw new HttpError(404, 'The books are not on the server yet — open the shop system once first');
    const data = asJson(cur.data) || {};
    data.S = data.S || {};
    const out = await fn(data);
    const next = Number(cur.rev) + 1;
    await client.query(dbKind === 'mysql' ? 'UPDATE books SET data = ?, rev = ?, updated_at = NOW(), updated_by = ? WHERE `key` = ?' : 'UPDATE books SET data = $1, rev = $2, updated_at = now(), updated_by = $3 WHERE key = $4',
      [JSON.stringify(data), next, by, key]);
    return { rev: next, out };
  });
}
async function staffAndUser(key, empId) {
  const row = await loadBooks(key), data = asJson(row?.data) || {}, S = data.S || {};
  const e = (S.employees || []).find(x => String(x.id) === String(empId));
  if (!e) throw new HttpError(404, 'That person is not on the staff list');
  const u = userOf(S.users, e);
  return { e, u, phone: empPhone(u, e), CFG: data.CFG || {}, S };
}
const stamp = () => { const d = new Date(); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' }); };
const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/** A code to the person's own mobile, to send an ask. */
r.post('/books/:key/shift-code', shiftAuth, asyncHandler(async (req, res) => {
  const { e, phone, CFG } = await staffAndUser(req.params.key, req.body?.empId);
  if (!phone) throw new HttpError(400, `There is no mobile on ${e.name}'s card — use their PIN, or add the mobile at the till`);
  sendingCode(phone, req.ip);
  const code = tillOtp(phone);
  let sent = false;
  if (CFG.msg?.apiUrl && CFG.msg?.apiKey) {
    try { await sendViaProvider(CFG.msg, phone, `Dear ${String(e.name).split(' ')[0]},\nYour code to send your request to the shop is ${code}.\nIt works for 5 minutes. Please do not share it.`); sent = true; }
    catch (err) { console.error('shift ask sms failed', err.message); }
  }
  res.json({ ok: true, sent, phone: maskPhone(phone), ...(!sent && mayRevealCode(req) ? { code } : {}), ...(sent ? {} : { note: 'The text could not go out — use the PIN instead' }) });
}));

r.post('/books/:key/shift-ask', shiftAuth, asyncHandler(async (req, res) => {
  const b = req.body || {}, key = req.params.key;
  const { e, u, phone } = await staffAndUser(key, b.empId);
  // it has to be them
  let how = '';
  if (b.pin) {
    const code = 'ask:' + String(e.id);
    const limits = pinLimits(code, req.ip); stopIfTooMany(limits);
    if (!u || !pinOk(u, String(b.pin).replace(/\D/g, ''))) { wrongTry(limits); throw new HttpError(400, 'That PIN is not right'); }   // 400: the device stays signed in
    rightTry('pin:' + code); how = 'PIN';
  } else if (b.otp) {
    if (!phone) throw new HttpError(400, 'There is no mobile on their card');
    guardCode(phone, req.ip, () => tillOtpOk(phone, b.otp)); how = 'texted code';
  } else if (!(u && u.pinHash) && !phone) {
    how = 'no PIN or mobile on file — asked with ' + req.shiftUser.name + ' signed in';
  } else throw new HttpError(400, 'Their PIN, or the code we texted them, please');

  const who = e.name, at = stamp(), today = slToday();
  if (b.kind === 'leave') {
    const from = String(b.from || ''), to = String(b.to || b.from || ''), half = !!b.half && from === to;
    const type = LEAVE_TYPES.some(t => t[0] === b.type) ? b.type : 'annual', reason = String(b.reason || '').trim().slice(0, 160);
    const out = await booksEdit(key, req.shiftUser.name, (data) => {
      const S = data.S, c = leaveCfg(data.CFG);
      S.leaves = Array.isArray(S.leaves) ? S.leaves : [];
      const no = leaveRefuse(c, S.leaves, who, from, to, half, today);
      if (no) throw new HttpError(400, no);
      const g = leaveGroup(c, who);
      const l = { id: rid('lv'), who, from, to, type, half, reason, status: 'pending', by: who + ' (shift clock)', at, group: g, src: 'shift', how };
      const label = `${who}: ${(LEAVE_TYPES.find(t => t[0] === type) || [0, ''])[1].toLowerCase()} leave ${from === to ? 'on ' + from : from + ' to ' + to}${half ? ' (half day)' : ''}`;
      const a = { id: rid('ap'), kind: 'leave', title: label, detail: [reason, g === 'director' ? 'Director' : 'Employee', 'asked at the shift clock (' + how + ')'].filter(Boolean).join(' · '), data: { id: l.id }, by: who, at, status: 'pending' };
      l.apId = a.id;
      S.leaves.push(l);
      S.approvals = [a].concat(Array.isArray(S.approvals) ? S.approvals : []).slice(0, 300);
      S.notif = [{ id: rid('n'), kind: 'approval', text: `${who} asks: ${label}`, view: 'approvals', at: at.slice(11), read: false, forApprovers: true }].concat(Array.isArray(S.notif) ? S.notif : []).slice(0, 60);
      const cap = leaveAllow(c, who);
      return { leave: l, left: cap ? Math.max(0, cap - leaveUsed(c, S.leaves, who, from.slice(0, 7))) : null };
    });
    return res.json({ ok: true, rev: out.rev, ...out.out });
  }
  if (b.kind === 'salary') {
    const amount = Math.round((+b.amount || 0) * 100) / 100, type = b.type === 'salary' ? 'salary' : 'advance', note = String(b.note || '').trim().slice(0, 160);
    if (!(amount > 0) || amount > 10000000) throw new HttpError(400, 'How much?');
    const out = await booksEdit(key, req.shiftUser.name, (data) => {
      const S = data.S;
      if ((S.approvals || []).some(a => a && a.kind === 'salaryAsk' && a.status === 'pending' && String((a.data || {}).empId) === String(e.id)))
        throw new HttpError(400, 'There is already a request waiting for the owner — one at a time');
      const money = 'Rs ' + amount.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const title = `${who} asks for ${type === 'advance' ? 'an advance' : 'their salary'} of ${money}`;
      const a = { id: rid('ap'), kind: 'salaryAsk', title, detail: [note, 'asked at the shift clock (' + how + ')'].filter(Boolean).join(' · '),
        data: { empId: e.id, who, amount, type, note, how }, by: who, at, status: 'pending' };
      S.approvals = [a].concat(Array.isArray(S.approvals) ? S.approvals : []).slice(0, 300);
      S.notif = [{ id: rid('n'), kind: 'approval', text: `${title}`, view: 'approvals', at: at.slice(11), read: false, forApprovers: true }].concat(Array.isArray(S.notif) ? S.notif : []).slice(0, 60);
      return { ask: { id: a.id, status: 'pending', at, ...a.data } };
    });
    return res.json({ ok: true, rev: out.rev, ...out.out });
  }
  throw new HttpError(400, 'Leave or salary?');
}));

/** Punches the shift page wrote after revision `since` (each carries the revision it made, _srv) are laid
 *  over a till's save, unless the till holds a later version of the same record. Returns what was taken. */
function mergeShiftDays(data, cur, since) {
  const taken = {};
  const theirs = cur?.S?.shift?.days;
  if (!theirs || !data?.S) return taken;
  data.S.shift = data.S.shift || {};
  const mine = data.S.shift.days = data.S.shift.days || {};
  for (const [ds, recs] of Object.entries(theirs)) {
    for (const [id, rec] of Object.entries(recs || {})) {
      if (!rec || Number(rec._srv || 0) <= since) continue;
      const have = (mine[ds] || {})[id];
      if (!have || Number(rec.updatedAt || 0) >= Number(have.updatedAt || 0)) (mine[ds] = mine[ds] || {})[id] = (taken[ds] = taken[ds] || {})[id] = rec;
    }
  }
  return taken;
}

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
    if (Array.isArray(data.S.employees)) {
      data.S.employees = data.S.employees.filter(e => {
        const n = String(e?.name || '').toLowerCase().trim();
        return n !== 'demo' && n !== 'demo user';
      });
    }
    if (data.S.shift?.days) {
      Object.keys(data.S.shift.days).forEach(d => {
        Object.keys(data.S.shift.days[d] || {}).forEach(k => {
          if (String(k).toLowerCase().includes('demo')) delete data.S.shift.days[d][k];
        });
      });
    }
  }
  const out = await withTransaction(async client => {
    const { rows: [cur] } = await client.query(`SELECT rev, data FROM books WHERE key = $1 FOR UPDATE`, [key]);
    const curRev = cur ? Number(cur.rev) : 0;
    // Guard: never let a till write sample/empty data over a real catalogue — the "demo wiped the shop"
    // failure. A save that cuts the product list down to a fraction of what is there is refused and the
    // real books handed back, unless an owner's explicit wipe token (a deliberate fresh start) rides with it.
    const curProducts = Array.isArray(cur?.data?.S?.products) ? cur.data.S.products.length : 0;
    const newProducts = Array.isArray(data.S?.products) ? data.S.products.length : 0;
    const wipeOk = data._allowWipe && (Date.now() - Number(data._allowWipe) < 120000);
    if (curProducts >= 50 && newProducts < Math.max(1, Math.floor(curProducts * 0.4)) && !wipeOk) {
      return { blocked: true, rev: curRev, data: cur.data, curProducts, newProducts };
    }
    delete data._allowWipe;
    let merged = null;

    if (cur && rev !== undefined && rev !== null && Number(rev) !== curRev) {
      // _fullRev is the revision of the last whole-document save. If the till loaded that one or later,
      // everything since has been punches from the shift page: keep this save and lay those punches over it.
      const full = cur.data && cur.data._fullRev;
      if (full === undefined || full === null || Number(rev) < Number(full)) return { conflict: true, rev: curRev, data: cur.data };
      merged = mergeShiftDays(data, cur.data, Number(rev));
    }
    const next = curRev + 1;
    data._fullRev = next;
    await client.query(
      `INSERT INTO books (key, rev, data, updated_at, updated_by) VALUES ($1,$2,$3,now(),$4)
       ON CONFLICT (key) DO UPDATE SET rev = EXCLUDED.rev, data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, next, JSON.stringify(data), req.regalUser.name]);
    await client.query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ($1,$2,$3,$4)`, [key, next, JSON.stringify(data), req.regalUser.name]);
    // everything older than the HISTORY_KEEP-th newest copy goes (written so MySQL takes it too: it has no
    // LIMIT inside IN (…), and the extra SELECT around the LIMIT is what lets it read the table it deletes from)
    await client.query(`DELETE FROM books_history WHERE key = $1 AND id < (SELECT id FROM (SELECT id FROM books_history WHERE key = $1 ORDER BY id DESC LIMIT 1 OFFSET ${HISTORY_KEEP - 1}) t)`, [key]);
    return { conflict: false, rev: next, merged };
  });
  if (out.blocked) {
    console.error(`[books guard] blocked a save by ${req.regalUser.name}: products ${out.curProducts} -> ${out.newProducts} (looks like sample data over the real shop)`);
    const inbox = key === BOOKS_KEY ? await injectInbox(out.data) : 0;
    return res.status(409).json({ error: 'Save blocked to protect the shop — it would have replaced the full product list with sample data. The real books have been reloaded on this till.', rev: out.rev, data: out.data, inbox, blocked: true });
  }
  if (out.conflict) {

    const inbox = key === BOOKS_KEY ? await injectInbox(out.data) : 0;
    return res.status(409).json({ error: 'Someone else saved first', rev: out.rev, data: out.data, inbox });
  }
  if (key === BOOKS_KEY) await markImported(data);
  // punches laid over this save go back with the answer, so the till holds them before it saves again
  res.json({ ok: true, rev: out.rev, ...(out.merged && Object.keys(out.merged).length ? { shiftDays: out.merged } : {}) });
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
  const sql = dbKind === 'mysql'
    ? `SELECT id, rev, saved_at, saved_by, JSON_LENGTH(data, '$.S.products') AS products, JSON_LENGTH(data, '$.S.customers') AS customers, JSON_LENGTH(data, '$.S.sales') AS sales FROM books_history WHERE ${KEY_COL} = $1 ORDER BY id DESC LIMIT 50`
    : `SELECT id, rev, saved_at, saved_by, jsonb_array_length(data->'S'->'products') AS products, jsonb_array_length(data->'S'->'customers') AS customers, jsonb_array_length(data->'S'->'sales') AS sales FROM books_history WHERE ${KEY_COL} = $1 ORDER BY id DESC LIMIT 50`;
  const { rows } = await query(sql, [req.params.key]);
  res.json(rows);
}));

/* A quick health read for the owner: how big the shop is now, when it last saved, and how many backup
   copies are kept — the status page polls this. */
r.get('/shop-status', regalAuth, asyncHandler(async (req, res) => {
  const key = BOOKS_KEY;
  const { rows: [b] } = await query(`SELECT rev, updated_at, updated_by FROM books WHERE ${KEY_COL} = $1`, [key]);
  const row = await loadBooks(key); const S = (row && row.data && row.data.S) || {};
  const n = a => Array.isArray(a) ? a.length : 0;
  const { rows: [h] } = await query(`SELECT rev, saved_at, saved_by FROM books_history WHERE ${KEY_COL} = $1 ORDER BY id DESC LIMIT 1`, [key]);
  const { rows: [hc] } = await query(`SELECT COUNT(*) AS c FROM books_history WHERE ${KEY_COL} = $1`, [key]);
  res.json({ ok: true, rev: Number(b ? b.rev : 0), updated_at: b && b.updated_at, updated_by: b && b.updated_by,
    counts: { products: n(S.products), customers: n(S.customers), suppliers: n(S.suppliers), sales: n(S.sales) },
    history: { kept: hc ? Number(hc.c) : null, newest: h ? { rev: Number(h.rev), at: h.saved_at, by: h.saved_by } : null } });
}));

r.post('/books/:key/restore/:rev', regalAuth, asyncHandler(async (req, res) => {
  if (req.regalUser.role !== 'Owner') throw new HttpError(403, 'Only the owner can restore');
  const { rows: [h] } = await query(`SELECT data FROM books_history WHERE key = $1 AND rev = $2`, [req.params.key, req.params.rev]);
  if (!h) throw new HttpError(404, 'No such revision');
  const { rows: [cur] } = await query(`SELECT rev FROM books WHERE key = $1`, [req.params.key]);
  const next = (cur ? Number(cur.rev) : 0) + 1;
  if (h.data && typeof h.data === 'object') h.data._fullRev = next;          // a restore is a whole-document save
  await query(`UPDATE books SET rev = $2, data = $3, updated_at = now(), updated_by = $4 WHERE key = $1`, [req.params.key, next, JSON.stringify(h.data), req.regalUser.name]);
  res.json({ ok: true, rev: next });
}));

// ---------------------------------------------------------------- SMS relay (keeps the provider call off the browser)
/** Sri Lankan mobile as the gateways want it: 94XXXXXXXXX. */
/* Both of these live in lib/phone.js now, so the outbox worker and this file cannot drift
   apart on the one question that matters: may this message go out at all. Re-exported
   because half the routes already import them from here. */
export { intlPhone, heldByTestMode } from '../lib/phone.js';
import { intlPhone, heldByTestMode } from '../lib/phone.js';   // and used right here, in sendViaProvider
/* Whether a sign-in code may be shown on the screen instead of texted.
   Only on a shop's own machine that has no way to text at all — never on the live site. Anyone can
   type anyone's mobile into the sign-in box, so handing the code straight back there would let a
   stranger read a customer's account. If the text cannot go, nobody gets in and they ring the shop. */
/* With no text gateway a sign-in code can be shown on the page — for trying the system out on the
   shop's own PC only. It needs SHOW_CODES=1 when the server is started, and the request must come
   from the same machine; the live site never shows one, whatever it is set to. */
export function mayRevealCode(req) {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.SHOW_CODES !== '1') return false;
  const ip = String(req?.socket?.remoteAddress || '');
  return !req?.headers?.['x-forwarded-for'] && /^(::1|127\.|::ffff:127\.)/.test(ip);
}

/** Only these numbers get texts while the shop is trying the system out (Settings → Messaging → test mode). */
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
  let j = null; try { j = JSON.parse(text); } catch {}
  /* Say what the gateway said, in its own words. It used to come back as
     "Provider 400: {"success":false,"message":"Invalid sender ID"}", which is the answer
     buried in its own punctuation — and that one answer is nearly always the same thing:
     the sender name in Settings is not one this account is allowed to send under. */
  const said = (j && (j.message || j.error)) ? String(j.message || j.error) : text.slice(0, 200);
  const hint = /sender/i.test(said)
    ? ' — the sender name in Settings → Messaging is not one this account may send under. The one in the provider\'s own example is usually a demo, not yours.'
    : '';
  if (!resp.ok) throw new HttpError(502, `The gateway refused it: ${said}${hint}`);
  if (j && (j.status === 'error' || j.success === false || /fail|error|invalid/i.test(String(j.status || j.message || '')))) throw new HttpError(502, `The gateway refused it: ${said}${hint}`);
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
