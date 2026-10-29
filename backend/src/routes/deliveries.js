// The driver's phone page (regalhw.lk/driver?k=…): today's stops, and what happened at each.
// A driver has no till sign-in — the page carries their own key, which the shop makes on the Deliveries
// board (S.drivers[].key) and can change at any time. Only that driver's stops are ever sent.
//   GET  /api/dlv/driver?k=                         { driver, shop, stops }
//   POST /api/dlv/driver/:id  { k, status, note, collected, receiver, photo, sign }
//        status: out (the customer is texted "on the way") | delivered | failed
// What the driver sends is written into the books (booksEdit), so every till sees it on its next pull.
import { Router } from 'express';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { booksEdit, sendViaProvider } from './regal.js';
import { readBooks } from '../services/dues.js';
import { saveBuffer } from './files.js';
import { letter } from '../lib/letter.js';

const r = Router();
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
const stamp = () => new Date().toLocaleString('en-CA', { timeZone: 'Asia/Colombo', hour12: false }).slice(0, 16).replace(',', '');
const driverOf = (S, k) => { const key = String(k || '').trim(); return key.length >= 12 ? (S.drivers || []).find(d => d && d.key === key && d.active !== false) : null; };
const stopView = (d) => ({ id: d.id, no: d.no, who: d.who, phone: d.phone, address: d.address, slot: d.slot, order: d.order || 0, status: d.status,
  cod: +d.cod || 0, note: d.note || '', items: d.items || '', bill: d.bill, collected: d.collected ?? null, at: d.doneAt || null });

r.get('/driver', asyncHandler(async (req, res) => {
  const data = await readBooks(); const S = (data && data.S) || {};
  const drv = driverOf(S, req.query.k); if (!drv) throw new HttpError(403, 'This link is not for a driver of this shop — ask the shop for yours');
  const day = today();
  const stops = (S.deliveries || []).filter(d => d.driver === drv.id && (d.date === day || (d.status === 'out' && d.date < day)) && d.status !== 'cancelled')
    .sort((a, b) => (a.order || 0) - (b.order || 0)).map(stopView);
  res.json({ ok: true, driver: { id: drv.id, name: drv.name }, shop: { name: data.CFG?.shop?.name || '', phone: data.CFG?.shop?.phone || '' }, day, stops });
}));

r.post('/driver/:id', asyncHandler(async (req, res) => {
  const b = req.body || {}, status = String(b.status || '');
  if (!['out', 'delivered', 'failed'].includes(status)) throw new HttpError(400, 'What happened?');
  const data = await readBooks(); const S = (data && data.S) || {};
  const drv = driverOf(S, b.k); if (!drv) throw new HttpError(403, 'This link is not for a driver of this shop');
  const d0 = (S.deliveries || []).find(x => x.id === req.params.id && x.driver === drv.id);
  if (!d0) throw new HttpError(404, 'That stop is not yours');
  // the proof, kept as files with the delivery (a year), only the links go in the books
  const proof = {};
  for (const k of ['photo', 'sign']) {
    const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(b[k] || ''));
    if (m) { const buf = Buffer.from(m[2], 'base64'); if (buf.length < 4e6) proof[k] = (await saveBuffer({ kind: 'dlvproof', ref: d0.no, name: `${d0.no} ${k}.${m[1].endsWith('png') ? 'png' : 'jpg'}`, mime: m[1], buf, by: drv.name, keepUntil: new Date(Date.now() + 366 * 864e5) })).url; }
  }
  await booksEdit('regal', 'driver ' + drv.name, (data2) => {
    const d = (data2.S.deliveries || []).find(x => x.id === d0.id); if (!d) return;
    d.status = status; d.events = d.events || [];
    d.events.push({ at: stamp(), by: drv.name, status, note: String(b.note || '').slice(0, 200) });
    if (status === 'delivered') { d.doneAt = stamp(); d.receiver = String(b.receiver || '').slice(0, 60); d.collected = Math.max(0, +b.collected || 0); Object.assign(d, proof.photo ? { photo: proof.photo } : {}, proof.sign ? { sign: proof.sign } : {}); }
    if (status === 'failed') { d.doneAt = stamp(); d.failWhy = String(b.note || '').slice(0, 200); }
    if (status === 'out') d.outAt = stamp();
  }, { full: true });
  // on the way: the customer is told, if the shop wants it and there is a number
  if (status === 'out' && d0.phone && data.CFG?.dlv?.sms !== false) {
    const t = data.CFG?.tpl?.dlvOut?.text || 'Your delivery {no} is on the way with {driver}.{codPart}';
    const body = t.replace('{no}', d0.no).replace('{driver}', drv.name).replace('{codPart}', +d0.cod > 0 ? `\nPlease keep Rs ${(+d0.cod).toLocaleString('en-LK', { minimumFractionDigits: 2 })} ready.` : '').replace('{shop}', data.CFG?.shop?.name || '');
    sendViaProvider(data.CFG?.msg || {}, d0.phone, letter(data.CFG, 'customer', body)).catch(() => {});
  }
  res.json({ ok: true });
}));

export default r;
