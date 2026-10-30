// Stock from a phone (regalhw.lk/stockup?k=…): a member of staff scans or finds an item, sees what the books
// say, and sends what is really there (a count) or what came or went (add / remove, with why).
// Nobody signs in — the link carries the person's own key, which the shop makes on the Stock take page
// (S.stockers[].key) and can change or switch off at any time. Nothing touches the stock from here: each
// entry waits in S.phoneCounts until someone on a till posts it (or turns it down) on the Stock take page,
// where the money side is booked as any stock take is.
//   GET  /api/stockup/me?k=           { who, shop, products, mine }
//   POST /api/stockup/entry  { k, pid, mode: count|add|remove, qty, reason, note, at }
import { Router } from 'express';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { booksEdit } from './regal.js';
import { readBooks } from '../services/dues.js';

const r = Router();
const TZ = 'Asia/Colombo';
const stamp = () => new Date().toLocaleString('en-CA', { timeZone: TZ, hour12: false }).replace(',', '').slice(0, 16);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const personOf = (S, k) => { const key = String(k || '').trim(); return key.length >= 12 ? (S.stockers || []).find(p => p && p.key === key && p.active !== false) : null; };
const REASONS = { add: ['Received', 'Found', 'Returned to the shelf', 'Other'], remove: ['Damaged', 'Used in the shop', 'Missing', 'Expired', 'Other'] };

r.get('/me', asyncHandler(async (req, res) => {
  const data = await readBooks(); const S = (data && data.S) || {};
  const who = personOf(S, req.query.k); if (!who) throw new HttpError(403, 'This link is not for anyone at this shop — ask the shop for yours');
  const products = (S.products || []).filter(p => p && p.active !== false && p.id > 0).map(p => ({
    id: p.id, name: p.name, code: p.code || '', num: p.num || '', short: p.short || '', barcode: p.barcode || '', barcode2: p.barcode2 || '',
    unit: p.unit || '', cat: p.cat || '', stock: +(+p.stock || 0).toFixed(3) }));
  const mine = (S.phoneCounts || []).filter(x => x.who === who.id && String(x.at).slice(0, 10) === today()).slice(-60).reverse()
    .map(x => ({ id: x.id, pid: x.pid, name: x.name, mode: x.mode, qty: x.qty, reason: x.reason || '', at: x.at, status: x.status }));
  res.json({ ok: true, who: { id: who.id, name: who.name }, shop: { name: data.CFG?.shop?.name || '' }, reasons: REASONS, products, mine });
}));

r.post('/entry', asyncHandler(async (req, res) => {
  const b = req.body || {}, mode = String(b.mode || ''), qty = +b.qty;
  if (!['count', 'add', 'remove'].includes(mode)) throw new HttpError(400, 'Count, add or remove?');
  if (!Number.isFinite(qty) || qty < 0 || (mode !== 'count' && qty <= 0) || qty > 1e6) throw new HttpError(400, 'How many?');
  const data = await readBooks(); const S = (data && data.S) || {};
  const who = personOf(S, b.k); if (!who) throw new HttpError(403, 'This link is not for anyone at this shop');
  const reason = mode === 'count' ? '' : String(b.reason || '').slice(0, 40);
  if (mode !== 'count' && !reason) throw new HttpError(400, 'Why — received, damaged…?');
  const cid = String(b.cid || '').slice(0, 40);              // the phone's own id for this entry: sent twice, kept once
  let out = null;
  await booksEdit('regal', 'phone ' + who.name, (d) => {
    const S2 = d.S; S2.phoneCounts = Array.isArray(S2.phoneCounts) ? S2.phoneCounts : [];
    if (cid && S2.phoneCounts.some(x => x.cid === cid && x.who === who.id)) { out = { dup: true }; return; }
    const p = (S2.products || []).find(x => x.id === +b.pid && x.active !== false);
    if (!p) throw new HttpError(404, 'That item is not on the list any more');
    const e = { id: 'pc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), cid, who: who.id, by: who.name, pid: p.id, name: p.name, unit: p.unit || '',
      mode, qty: +qty.toFixed(3), reason, note: String(b.note || '').slice(0, 120), book: +(+p.stock || 0).toFixed(3), at: stamp(), status: 'pending' };
    S2.phoneCounts.push(e);
    if (S2.phoneCounts.length > 3000) S2.phoneCounts = S2.phoneCounts.filter(x => x.status === 'pending').concat(S2.phoneCounts.filter(x => x.status !== 'pending').slice(-1500));
    // one note on the tills per person, kept up to date, rather than one for every item counted
    S2.notif = Array.isArray(S2.notif) ? S2.notif : [];
    const waiting = S2.phoneCounts.filter(x => x.who === who.id && x.status === 'pending').length, nid = 'nstk' + who.id;
    S2.notif = S2.notif.filter(n => n.id !== nid);
    S2.notif.unshift({ id: nid, kind: 'stock', text: `${who.name} sent ${waiting} stock entr${waiting === 1 ? 'y' : 'ies'} from the phone — to post on Stock take`, view: 'stocktake', at: stamp().slice(11), read: false, forApprovers: true });
    S2.notif = S2.notif.slice(0, 60);
    out = { id: e.id, book: e.book };
  }, { full: true });
  res.json({ ok: true, ...out });
}));

export default r;
