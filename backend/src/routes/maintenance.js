// The maintenance switch. Anybody may ask whether it is on (the "back shortly" page asks every few
// seconds, to reload itself when it goes off); only a Super Admin, Owner or Admin may flip it.
import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { regalAuth } from './regal.js';
import { mxState, mxSave, mxPublic, mxPass } from '../lib/maintenance.js';

const r = Router();
const MAY = ['super admin', 'superadmin', 'owner', 'admin'];
const mayFlip = (req, _res, next) => MAY.includes(String(req.regalUser?.role || '').toLowerCase().trim())
  ? next() : next(new HttpError(403, 'Only the owner or an Admin can switch maintenance mode'));

r.get('/', (req, res) => { const s = mxState(); res.set('Cache-Control', 'no-store'); res.json({ ...mxPublic(s), pass: mxPass(req, s) }); });

// the owner's view: with the pass key, for the preview link and this browser's cookie
r.get('/admin', regalAuth, mayFlip, (_req, res) => { const s = mxState(); res.json({ ...mxPublic(s), by: s.by, key: s.key || mxSave({}).key }); });

r.post('/', regalAuth, mayFlip, asyncHandler(async (req, res) => {
  const b = req.body || {};
  // only what was sent changes: { intro } alone picks how the page opens without flipping the switch
  const patch = { by: req.regalUser.name };
  for (const k of ['on', 'scope', 'msg', 'until', 'intro']) if (k in b) patch[k] = k === 'on' ? !!b.on : b[k];
  const s = mxSave(patch);
  // the browser that switched it on keeps working
  if (s.on) res.cookie('regal_mx', s.key, { path: '/', sameSite: 'lax', secure: req.secure, maxAge: 30 * 86400e3 });
  res.json({ ...mxPublic(s), by: s.by, key: s.key });
}));

export default r;
