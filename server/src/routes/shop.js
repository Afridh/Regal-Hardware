// The public shop site (app/shop.html) — what a customer reaches at regalhw.lk.
//
// Customers never see the books.  This router reads only what the storefront needs
// (products, prices, stock, opening hours) and writes orders into its own table,
// `shop_orders`.  The tills pick those up: every books read merges the pending orders
// in (injectInbox) and a books save that contains them marks them imported
// (markImported).  So the shared books are still only ever written by a till, and an
// order can never be lost to a save conflict — it stays pending until a till has
// saved it.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { sendViaProvider, regalAuth, mayRevealCode } from './regal.js';

const r = Router();
const NO_TEXT = 'Sorry — we could not text you just now. Please ring the shop.';
const TZ = process.env.SHOP_TZ || 'Asia/Colombo';
const OTP_WINDOW_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------- tables
// shop_media holds the pictures the site shows — product photos (p:<id>), category pictures
// (c:<name>), the slides and banners on the home page (s:1…, b:1…) and the site logo.  They are
// uploaded from the till and never go into the books document, which stays small.
let ready = null;
export function ensureShopTables() {
  if (!ready) ready = query(`
    CREATE TABLE IF NOT EXISTS shop_orders (
      id          bigserial PRIMARY KEY,
      no          varchar(20) UNIQUE NOT NULL,
      phone       varchar(20) NOT NULL,
      name        varchar(120) NOT NULL,
      data        jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      imported_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS shop_orders_phone ON shop_orders (phone);
    CREATE INDEX IF NOT EXISTS shop_orders_pending ON shop_orders (imported_at) WHERE imported_at IS NULL;
    CREATE TABLE IF NOT EXISTS shop_media (
      key         varchar(80) PRIMARY KEY,
      mime        varchar(40) NOT NULL,
      data        bytea NOT NULL,
      link        varchar(300),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );`).catch(e => { ready = null; throw e; });
  return ready;
}

/** Every picture the site has, keyed, with a version stamp so browsers can cache them hard. */
async function mediaIndex() {
  await ensureShopTables();
  const { rows } = await query(`SELECT key, link, extract(epoch from updated_at)::bigint AS v FROM shop_media`);
  const m = {};
  for (const r of rows) m[r.key] = { v: r.v, link: r.link || '' };
  return m;
}

// ---------------------------------------------------------------- helpers
const digits = s => String(s || '').replace(/\D/g, '');
const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });                     // YYYY-MM-DD
const localTime = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const money = n => 'Rs ' + Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

async function books() {
  const { rows: [row] } = await query(`SELECT data FROM books WHERE key = 'regal'`);
  return row?.data || null;
}

/** What the storefront may know: settings, the shop's contact line, and the sellable list. */
function catalogOf(data, pending = [], media = {}) {
  const S = data?.S || {}, CFG = data?.CFG || {};
  const w = { open: true, name: 'Regal Hardware Online', domain: 'regalhw.lk', staffPath: '/pos', hours: '', delivery: 0, freeOver: 0, minOrder: 0, payNote: '', level: 'retail', showOutOfStock: false,
    zones: [], promos: [], pays: { cod: true, counter: true, bank: false, card: false }, holdStock: true, lowAt: 5,
    tagline: '', about: '', email: '', whatsapp: '', facebook: '', instagram: '', youtube: '', color: '', featured: '', ...(S.web?.settings || {}) };
  const held = {};
  for (const o of (S.web?.orders || [])) if (o.status === 'accepted') for (const l of (o.lines || [])) held[l.pid] = (held[l.pid] || 0) + (+l.qty || 0);
  // and the ones that came in off the website and are still waiting for a till to take them
  for (const row of pending) for (const l of (row.data?.lines || [])) held[l.pid] = (held[l.pid] || 0) + (+l.qty || 0);
  const tracked = !(CFG.stock && CFG.stock.track === false);       // a shop that does not count stock sells everything it lists
  // what sold in the last 90 days, so the site can show its best sellers
  const since = new Date(Date.now() - 90 * 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
  const sold = {};
  for (const s of (S.sales || [])) if ((s.date || '') >= since) for (const l of (s.lines || [])) sold[l.pid] = (sold[l.pid] || 0) + (+l.qty || 0);
  const pic = key => media[key] ? `/api/shop/media/${encodeURIComponent(key)}?v=${media[key].v}` : '';
  // which items go online: everything not switched off, or only the ones the shop ticked
  const listed = p => w.listMode === 'selected' ? p.web === true : p.web !== false;
  const products = (S.products || []).filter(p => p.active !== false && !p.hidden && listed(p)).map(p => ({
    id: p.id, code: p.code, num: p.num || '', short: p.short || '', name: p.name, cat: p.cat || 'Other', unit: p.unit || '',
    // a product may carry a price of its own for the site; where it does, that is the price
    mrp: +p.mrp || 0, price: +(+p.webPrice > 0 ? p.webPrice : (w.level === 'wholesale' ? p.wholesale : p.retail)) || 0,
    ownPrice: +p.webPrice > 0 || undefined,
    stock: tracked ? Math.max(0, (+p.stock || 0) - (held[p.id] || 0)) : null,
    img: pic('p:' + p.id), desc: p.desc || '', warranty: +p.warrantyMonths || 0, sold: sold[p.id] || 0, featured: p.featured === true,
    // an item priced for the site does not take the counter's quantity breaks: a break set
    // for the counter could otherwise undercut the price put up for the site
    tiers: !(+p.webPrice > 0) && Array.isArray(p.tiers) && p.tiers.length ? p.tiers.map(t => ({ min: +t.min, price: +t.price, label: t.label || '' })) : undefined,
  }));
  const counts = {};
  for (const p of products) counts[p.cat] = (counts[p.cat] || 0) + 1;
  const categories = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map(c => ({ name: c, count: counts[c], img: pic('c:' + c) }));
  const strip = prefix => Object.keys(media).filter(k => k.startsWith(prefix)).sort().map(k => ({ src: pic(k), link: media[k].link || '' }));
  return {
    shop: { name: CFG.shop?.name || 'Regal Hardware', addr: CFG.shop?.addr || '', phone: CFG.shop?.phone || '', land: CFG.shop?.land || '', tags: CFG.shop?.tags || '', hours: CFG.shop?.hours || '', logo: pic('logo') || CFG.shop?.logo || '' },
    settings: { open: !!w.open, name: w.name, domain: w.domain, staffPath: w.staffPath || '/pos', hours: w.hours, delivery: +w.delivery || 0, freeOver: +w.freeOver || 0, minOrder: +w.minOrder || 0, payNote: w.payNote, showOutOfStock: !!w.showOutOfStock || !tracked, tracked,
      /* Only what a customer may see: a zone's name and what it costs, never the shop's notes.
         Codes are never listed — a code has to be typed to be worth anything. */
      zones: (Array.isArray(w.zones) ? w.zones : []).filter(z => z && z.name)
        .map(z => ({ id: String(z.id || z.name), name: String(z.name).slice(0, 60), charge: +z.charge || 0,
                     freeOver: +z.freeOver || 0, days: String(z.days || '').slice(0, 40) })),
      pays: { cod: w.pays?.cod !== false, counter: w.pays?.counter !== false,
              bank: !!w.pays?.bank, card: !!w.pays?.card },
      lowAt: Math.max(0, +w.lowAt || 0), holdStock: w.holdStock !== false,
      tagline: w.tagline, about: w.about, email: w.email, whatsapp: w.whatsapp, facebook: w.facebook, instagram: w.instagram, youtube: w.youtube, color: w.color,
      theme: (S.web?.theme && typeof S.web.theme === 'object') ? S.web.theme : {} },
    categories,
    slides: strip('s:'), banners: strip('b:'),
    products,
    pendingOnline: pending.length,
  };
}

/** Six digits from the phone and the 5-minute window — nothing to store, and the previous window still counts. */
function otpFor(phone, when = Date.now()) {
  const win = Math.floor(when / OTP_WINDOW_MS);
  const h = crypto.createHmac('sha256', process.env.JWT_SECRET || 'regal').update(digits(phone) + '|' + win).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}
const otpOk = (phone, code) => [0, 1].some(back => otpFor(phone, Date.now() - back * OTP_WINDOW_MS) === String(code || '').trim());

function signShop(phone, name) { return jwt.sign({ kind: 'shop', phone: digits(phone), name }, process.env.JWT_SECRET, { expiresIn: '30d' }); }
function shopAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'Sign in with your mobile first');
    const p = jwt.verify(token, process.env.JWT_SECRET);
    if (p.kind !== 'shop') throw new HttpError(401, 'Wrong kind of token');
    req.shopUser = p; next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return next(new HttpError(401, 'Please sign in again'));
    next(e);
  }
}
const optionalAuth = (req, _res, next) => { const h = req.headers.authorization || ''; if (!h.startsWith('Bearer ')) return next(); shopAuth(req, _res, next); };

/** What is already promised to orders nobody has picked yet. A website order sits in this
   table until a till takes it in, and until then the goods are spoken for — so the last bag
   cannot be sold to a second customer while the first order is still on the counter. */
export async function heldStock() {
  await ensureShopTables();
  const { rows } = await query(`SELECT data FROM shop_orders WHERE imported_at IS NULL`);
  const held = new Map();
  for (const r of rows) for (const l of (r.data?.lines || [])) {
    const pid = +l.pid, qty = +l.qty;
    if (pid && qty > 0) held.set(pid, (held.get(pid) || 0) + qty);
  }
  return held;
}

export async function pendingOrders() {
  await ensureShopTables();
  const { rows } = await query(`SELECT id, no, phone, name, data, created_at FROM shop_orders WHERE imported_at IS NULL ORDER BY id`);
  return rows;
}

/** Merge the pending online orders into a books document about to be handed to a till. Returns how many went in. */
export async function injectInbox(data) {
  if (!data || !data.S) return 0;
  const pending = await pendingOrders();
  if (!pending.length) return 0;
  const S = data.S;
  S.web = S.web || {}; S.web.orders = S.web.orders || []; S.customers = S.customers || []; S.notif = S.notif || [];
  let added = 0;
  for (const row of pending) {
    if (S.web.orders.some(o => o.no === row.no)) continue;
    let c = S.customers.find(x => digits(x.phone) && digits(x.phone) === digits(row.phone));
    if (!c) {
      c = { id: S.customers.reduce((m, x) => Math.max(m, +x.id || 0), 0) + 1, code: 'C' + String(S.customers.length + 1).padStart(4, '0'),
        name: row.name, phone: row.phone, level: 'retail', limit: 25000, address: row.data.address || '', portal: false, lastLogin: null, points: 0, online: true };
      S.customers.push(c);
    }
    const o = { ...row.data, no: row.no, cid: c.id, status: 'placed', invoice: null, online: true };
    S.web.orders.push(o);
    S.notif.unshift({ id: 'n' + row.id.toString(36), kind: 'order', text: `${c.name} ordered ${money(o.total)} on the website`, view: 'weborders', at: o.time || localTime(), read: false });
    added++;
  }
  S.notif = S.notif.slice(0, 40);
  return added;
}

/** A till has saved books that contain these orders — they are in the shop's hands now. */
export async function markImported(data) {
  const nos = (data?.S?.web?.orders || []).map(o => o.no).filter(n => typeof n === 'string' && n.startsWith('ONL-'));
  if (!nos.length) return 0;
  await ensureShopTables();
  const { rowCount } = await query(`UPDATE shop_orders SET imported_at = now() WHERE imported_at IS NULL AND no = ANY($1::varchar[])`, [nos]);
  return rowCount;
}

export async function pendingCount() {
  await ensureShopTables();
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM shop_orders WHERE imported_at IS NULL`);
  return n;
}

// ---------------------------------------------------------------- public API
r.get('/catalog', asyncHandler(async (_req, res) => {
  const data = await books();
  if (!data) return res.json({ shop: { name: 'Regal Hardware' }, settings: { open: false, name: 'Regal Hardware Online', hours: 'The shop has not opened its books yet.' }, categories: [], products: [], slides: [], banners: [] });
  res.set('Cache-Control', 'no-store');
  res.json(catalogOf(data, await pendingOrders(), await mediaIndex()));
}));

// ---------------------------------------------------------------- pictures
const MEDIA_KEY = /^(p:\d+|c:.{1,60}|s:[1-9]|b:[1-9]|logo)$/;

/** Just the keys that have a picture — the till asks once instead of trying every product's photo. */
r.get('/media', asyncHandler(async (_req, res) => {
  const m = await mediaIndex();
  res.set('Cache-Control', 'no-store');
  res.json({ keys: Object.keys(m) });
}));

/** A picture, cached for a year — the catalogue changes the ?v= when it is replaced. */
r.get('/media/:key', asyncHandler(async (req, res) => {
  await ensureShopTables();
  const { rows: [row] } = await query(`SELECT mime, data FROM shop_media WHERE key = $1`, [req.params.key]);
  if (!row) return res.status(404).end();
  res.set('Content-Type', row.mime);
  res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.send(row.data);
}));

/** Staff put a picture up from the till: { dataUrl: 'data:image/jpeg;base64,…', link? }. */
r.post('/media/:key', regalAuth, asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (!MEDIA_KEY.test(key)) throw new HttpError(400, 'Not a picture the site uses');
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl || ''));
  if (!m) throw new HttpError(400, 'Send a JPEG, PNG or WebP picture');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1.5e6) throw new HttpError(400, 'The picture is too big — keep it under 1.5 MB');
  const link = String(req.body?.link || '').slice(0, 300);
  await ensureShopTables();
  await query(`INSERT INTO shop_media (key, mime, data, link, updated_at) VALUES ($1, $2, $3, $4, now())
               ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, link = EXCLUDED.link, updated_at = now()`, [key, m[1], buf, link]);
  res.json({ ok: true, key, bytes: buf.length });
}));

r.delete('/media/:key', regalAuth, asyncHandler(async (req, res) => {
  await ensureShopTables();
  const { rowCount } = await query(`DELETE FROM shop_media WHERE key = $1`, [req.params.key]);
  res.json({ ok: true, removed: rowCount });
}));

/** Where an order is, for someone who has the order number and the mobile it was placed with. */
r.post('/track', asyncHandler(async (req, res) => {
  const no = String(req.body?.no || '').trim().toUpperCase();
  const phone = digits(req.body?.phone);
  if (!no || !phone) throw new HttpError(400, 'Enter the order number and the mobile it was placed with');
  await ensureShopTables();
  const { rows: [row] } = await query(`SELECT no, data FROM shop_orders WHERE no = $1 AND phone = $2`, [no, phone]);
  if (!row) throw new HttpError(404, 'No order with that number for that mobile');
  const data = await books();
  const b = (data?.S?.web?.orders || []).find(o => o.no === row.no);
  res.json({ ok: true, order: { no: row.no, date: row.data.date, time: row.data.time, lines: row.data.lines, total: row.data.total, del: row.data.del, deliver: row.data.deliver, status: b?.status || 'placed', invoice: b?.invoice || null, reason: b?.note || '', events: b?.events || row.data.events || [] } });
}));

/** Step 1 of signing in: a code by SMS. If SMS is not set up, the code comes back in the reply so the site still works. */
r.post('/otp', asyncHandler(async (req, res) => {
  const phone = digits(req.body?.phone);
  if (!/^0\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a mobile like 0771234567');
  const code = otpFor(phone);
  const data = await books();
  const cfg = data?.CFG?.msg;
  const name = data?.S?.web?.settings?.name || 'Regal Hardware';
  if (cfg?.live && cfg.apiUrl && cfg.apiKey) {
    try { await sendViaProvider(cfg, phone, `${name}: your sign-in code is ${code}. It works for 5 minutes.`); return res.json({ ok: true, sent: true }); }
    catch (e) { console.error('shop otp sms failed', e.message); }
  }
  // the code only comes back on a shop's own machine with no gateway — never on the live site
  res.json({ ok: true, sent: false, ...(mayRevealCode() ? { code } : { note: NO_TEXT }) });
}));

/** Step 2: the code, plus a name if we have not met this customer before. */
r.post('/login', asyncHandler(async (req, res) => {
  const phone = digits(req.body?.phone);
  if (!otpOk(phone, req.body?.code)) throw new HttpError(401, 'That code is not right, or it has expired');
  const data = await books();
  const known = (data?.S?.customers || []).find(x => digits(x.phone) === phone);
  const name = (known?.name || String(req.body?.name || '').trim()).slice(0, 120);
  if (!name) return res.json({ ok: false, needName: true });
  res.json({ ok: true, token: signShop(phone, name), name, phone, known: !!known });
}));

r.get('/me', shopAuth, asyncHandler(async (req, res) => {
  const { phone, name } = req.shopUser;
  const data = await books();
  const S = data?.S || {};
  const c = (S.customers || []).find(x => digits(x.phone) === phone);
  const inBooks = new Map((S.web?.orders || []).map(o => [o.no, o]));
  await ensureShopTables();
  const { rows } = await query(`SELECT no, data, created_at, imported_at FROM shop_orders WHERE phone = $1 ORDER BY id DESC LIMIT 50`, [phone]);
  const orders = rows.map(row => { const b = inBooks.get(row.no); return { no: row.no, date: row.data.date, time: row.data.time, lines: row.data.lines, total: row.data.total, del: row.data.del, deliver: row.data.deliver, address: row.data.address || '', note: row.data.note, status: b?.status || 'placed', invoice: b?.invoice || null, reason: b?.note || '', events: b?.events || row.data.events || [] }; });
  // orders the shop keyed for this customer at the counter show too
  for (const o of (S.web?.orders || [])) if (c && o.cid === c.id && !rows.some(x => x.no === o.no)) orders.push({ no: o.no, date: o.date, time: o.time, lines: o.lines, total: o.total, del: o.del, deliver: o.deliver, note: o.note, status: o.status, invoice: o.invoice || null });
  const owing = c ? (S.sales || []).filter(s => s.customerId === c.id).reduce((a, s) => a + (+s.balance || 0), 0) : 0;
  const bills = c ? (S.sales || []).filter(s => s.customerId === c.id).length : 0;
  const spent = round2(orders.filter(o => !['rejected', 'cancelled'].includes(o.status)).reduce((a, o) => a + (+o.total || 0), 0));
  res.json({ ok: true, name: c?.name || name, phone, known: !!c, owing: round2(owing), bills, points: c?.points || 0, address: c?.address || '', spent, orders });
}));

/** What a discount code is worth on this basket, or why it is worth nothing. Checked here and
    nowhere else: a code typed into a page the customer controls proves nothing. */
/** How many orders have carried a code. Counted from the orders themselves, so it can never
   drift from the truth and is not lost when a till writes the books over the top. */
export async function promoUsed(code) {
  await ensureShopTables();
  const { rows: [r] } = await query(
    `SELECT count(*)::int AS n FROM shop_orders WHERE upper(data->>'code') = upper($1)`, [String(code || '')]);
  return r ? r.n : 0;
}

function promoOn(data, code, goods, used = 0) {
  const list = Array.isArray(data?.S?.web?.settings?.promos) ? data.S.web.settings.promos : [];
  const c = String(code || '').trim().toUpperCase();
  if (!c) return { off: 0 };
  const p = list.find(x => String(x.code || '').trim().toUpperCase() === c);
  if (!p) return { off: 0, why: 'There is no such code' };
  if (p.off) return { off: 0, why: 'That code has been switched off' };
  const today = localDate();
  if (p.from && today < p.from) return { off: 0, why: 'That code is not in use yet' };
  if (p.until && today > p.until) return { off: 0, why: 'That code has run out of time' };
  if (+p.limit > 0 && used >= +p.limit) return { off: 0, why: 'That code has been used up' };
  if (goods < (+p.minOrder || 0)) return { off: 0, why: `That code needs an order of ${money(+p.minOrder)}` };
  const off = p.kind === 'pct'
    ? round2(goods * Math.min(100, Math.max(0, +p.value || 0)) / 100)
    : round2(Math.min(goods, Math.max(0, +p.value || 0)));
  return { off, code: String(p.code).toUpperCase(), kind: p.kind, value: +p.value || 0 };
}

/** What a basket comes to: the goods, the delivery for the zone chosen, and any code. */
r.post('/quote', optionalAuth, asyncHandler(async (req, res) => {
  const data = await books();
  if (!data) throw new HttpError(503, 'The shop has not opened its books yet');
  const cat = catalogOf(data);
  const byId = new Map(cat.products.map(p => [p.id, p]));
  let goods = 0;
  for (const l of (req.body?.lines || [])) {
    const p = byId.get(+l.pid), qty = +l.qty;
    if (p && qty > 0) goods += qty * p.price;
  }
  goods = round2(goods);
  const deliver = !!req.body?.deliver;
  const zone = cat.settings.zones.find(z => z.id === String(req.body?.zone || '')) || null;
  const del = !deliver ? 0
    : zone ? ((zone.freeOver && goods >= zone.freeOver) ? 0 : zone.charge)
           : ((cat.settings.freeOver && goods >= cat.settings.freeOver) ? 0 : cat.settings.delivery);
  const promo = promoOn(data, req.body?.code, goods, await promoUsed(req.body?.code));
  res.json({ ok: true, goods, del, off: promo.off || 0, why: promo.why || '',
    code: promo.code || '', total: round2(Math.max(0, goods - (promo.off || 0)) + del),
    minOrder: cat.settings.minOrder, under: goods < cat.settings.minOrder });
}));

r.post('/order', shopAuth, asyncHandler(async (req, res) => {
  const { phone, name } = req.shopUser;
  const data = await books();
  if (!data) throw new HttpError(503, 'The shop has not opened its books yet');
  const cat = catalogOf(data);
  if (!cat.settings.open) throw new HttpError(400, 'The shop is not taking online orders just now');
  const byId = new Map(cat.products.map(p => [p.id, p]));
  const lines = [];
  for (const l of (req.body?.lines || [])) {
    const p = byId.get(+l.pid); const qty = +l.qty;
    if (!p || !(qty > 0)) continue;
    lines.push({ pid: p.id, qty, price: p.price, name: p.name, unit: p.unit });
  }
  if (!lines.length) throw new HttpError(400, 'The basket is empty');
  const goods = round2(lines.reduce((a, l) => a + l.qty * l.price, 0));
  if (goods < cat.settings.minOrder) throw new HttpError(400, `Smallest online order is ${money(cat.settings.minOrder)}`);
  const deliver = !!req.body?.deliver;
  const zone = cat.settings.zones.find(z => z.id === String(req.body?.zone || '')) || null;
  const del = !deliver ? 0
    : zone ? ((zone.freeOver && goods >= zone.freeOver) ? 0 : zone.charge)
           : ((cat.settings.freeOver && goods >= cat.settings.freeOver) ? 0 : cat.settings.delivery);

  /* An order for goods the shop has not got is not an order, it is a disappointed customer and a
     telephone call. What is already promised to other orders counts as gone, so the last bag
     cannot be sold twice while the first order is still being picked. */
  const held = await heldStock();
  const short = lines.filter(l => {
    const p = byId.get(l.pid);
    if (p.stock === null) return false;                      // not a tracked line
    return p.stock - (held.get(l.pid) || 0) < l.qty;
  }).map(l => ({ name: l.name, want: l.qty, have: Math.max(0, round2(byId.get(l.pid).stock - (held.get(l.pid) || 0))) }));
  if (short.length && cat.settings.holdStock)
    throw new HttpError(409, short.length === 1
      ? `We have only ${short[0].have} of ${short[0].name} left — please change the quantity`
      : `Some of these are short: ${short.map(s => `${s.name} (${s.have} left)`).join(', ')}`);
  const address = String(req.body?.address || '').trim().slice(0, 300);
  const note = String(req.body?.note || '').trim().slice(0, 300);
  const pay = { cod: 'cash on delivery', counter: 'pays at the counter', bank: 'bank transfer', card: 'card online' }[req.body?.pay] || '';
  const promo = promoOn(data, req.body?.code, goods, await promoUsed(req.body?.code));
  await ensureShopTables();
  const { rows: [{ id }] } = await query(`INSERT INTO shop_orders (no, phone, name, data) VALUES ('pending', $1, $2, '{}') RETURNING id`, [phone, name]);
  const no = 'ONL-' + String(id).padStart(5, '0');
  const order = {
    date: localDate(), time: localTime(),
    lines: lines.map(l => ({ pid: l.pid, qty: l.qty, price: l.price })),
    del, goods, off: promo.off || 0, code: promo.code || '',
    zone: zone ? zone.name : '', total: round2(Math.max(0, goods - (promo.off || 0)) + del),
    deliver, address, pay: req.body?.pay || '',
    note: [address, zone ? 'to ' + zone.name : '', pay, promo.code ? 'code ' + promo.code : '', note].filter(Boolean).join(' · '),
    events: [{ by: name, at: localTime(), what: 'Order placed on the website' }],
  };
  await query(`UPDATE shop_orders SET no = $2, data = $3 WHERE id = $1`, [id, no, JSON.stringify(order)]);
  /* A code that has been spent is counted here, where the order is made, and not on the page
     that offered it. The count goes up with the order or not at all. */
  if (promo.code) {
    const list = data.S?.web?.settings?.promos;
    const row = Array.isArray(list) ? list.find(x => String(x.code || '').toUpperCase() === promo.code) : null;
    if (row) { row.used = (+row.used || 0) + 1; row.last = localDate();
      await query(`INSERT INTO shop_inbox (kind, data) VALUES ('promo', $1)`,
        [JSON.stringify({ code: promo.code, no, off: promo.off, at: localDate() })]).catch(() => {}); }
  }
  const cfg = data.CFG?.msg;
  if (cfg?.live && cfg.apiUrl && cfg.apiKey) sendViaProvider(cfg, phone, `${cat.settings.name}: we have your order ${no} for ${money(order.total)}. We will confirm shortly.`).catch(e => console.error('shop order sms failed', e.message));
  res.json({ ok: true, no, total: order.total, goods, del: order.del, off: order.off, code: order.code, short });
}));

/** The little helper on the site: prices, stock, hours, and — signed in — where an order is or what is owed. */
r.post('/ask', optionalAuth, asyncHandler(async (req, res) => {
  const q = String(req.body?.q || '').toLowerCase().trim();
  if (!q) return res.json({ answer: 'Ask me something — a price, whether we have it, delivery, or where your order is.' });
  const data = await books();
  const cat = data ? catalogOf(data) : { products: [], settings: {}, shop: {} };
  const phone = cat.shop.phone ? ' Call the shop on ' + cat.shop.phone + '.' : '';
  const me = req.shopUser;
  const words = q.split(/[^a-z0-9]+/).filter(w => w.length > 3);
  const hit = cat.products.find(p => words.some(w => p.name.toLowerCase().split(/\s+/).includes(w)))
    || cat.products.find(p => words.some(w => p.name.toLowerCase().includes(w)));
  if (/where|track/.test(q) && /order/.test(q)) {
    if (!me) return res.json({ answer: 'Sign in with your mobile and I can tell you where your order is.' });
    await ensureShopTables();
    const { rows: [row] } = await query(`SELECT no, data FROM shop_orders WHERE phone = $1 ORDER BY id DESC LIMIT 1`, [me.phone]);
    if (!row) return res.json({ answer: 'You have no orders with us yet.' });
    const b = (data?.S?.web?.orders || []).find(o => o.no === row.no);
    const st = b?.status || 'placed';
    const words2 = { placed: 'the shop has it and will confirm shortly', accepted: 'being picked at the shop', picking: 'being picked at the shop', ready: row.data.deliver ? 'ready — the lorry will bring it' : 'ready to collect at the counter', despatched: 'on the way to you', done: 'delivered', collected: 'collected', rejected: 'the shop could not take it' + (b?.note ? ' — ' + b.note : ''), cancelled: 'cancelled' };
    return res.json({ answer: `Your order ${row.no} of ${row.data.date}: ${words2[st] || st}.` });
  }
  if (/owe|balance|outstanding|account/.test(q)) {
    if (!me) return res.json({ answer: 'Sign in with your mobile and I can tell you your balance.' });
    const S = data?.S || {}; const c = (S.customers || []).find(x => digits(x.phone) === me.phone);
    const owing = c ? (S.sales || []).filter(s => s.customerId === c.id).reduce((a, s) => a + (+s.balance || 0), 0) : 0;
    return res.json({ answer: owing > 0 ? `You owe ${money(owing)}.` : 'Your account is clear — nothing owing.' });
  }
  if (/deliver/.test(q)) return res.json({ answer: `Delivery in town is ${money(cat.settings.delivery)}, free over ${money(cat.settings.freeOver)}. ${cat.settings.payNote || ''}`.trim() });
  if (/open|hours|time|close/.test(q)) return res.json({ answer: `${cat.settings.hours || 'See the foot of the page for hours.'}${phone}` });
  if (hit) {
    if (hit.stock === null) return res.json({ answer: `${hit.name} is ${money(hit.price)} per ${hit.unit}${hit.mrp > hit.price ? ` (MRP ${money(hit.mrp)})` : ''}. Order it on the site, or call the shop to check it is on the shelf.` });
    if (/stock|have|available|got/.test(q)) return res.json({ answer: hit.stock > 0 ? `Yes — ${hit.name} is ${money(hit.price)} per ${hit.unit}, ${hit.stock} in stock.` : `${hit.name} is out of stock at the moment.${phone}` });
    return res.json({ answer: `${hit.name} is ${money(hit.price)} per ${hit.unit}${hit.mrp > hit.price ? ` (MRP ${money(hit.mrp)}, you save ${money(hit.mrp - hit.price)})` : ''}. ${hit.stock > 0 ? hit.stock + ' in stock.' : 'Out of stock just now.'}` });
  }
  res.json({ answer: `I could not find that in our list. Try the item name as it is printed on the shelf.${phone}` });
}));

export default r;
