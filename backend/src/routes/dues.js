// Credit follow-up, for the till's page (signed-in tills only; sending by hand is the owner's or an admin's):
//   GET  /api/dues            what has gone out, the last runs, and who would be reminded today
//   POST /api/dues/run        send today's reminders now (the time of day is not waited for)
//   POST /api/dues/one        { cid } remind one customer now, at the step they are at
import { Router } from 'express';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { regalAuth, sendViaProvider } from './regal.js';
import { readBooks, duePlan, dueSend, dueLog, dueTick, dueList, dueCfg } from '../services/dues.js';

const r = Router();
const boss = (req) => { const role = String(req.regalUser?.role || '').toLowerCase();
  if (!['owner', 'super admin', 'admin'].includes(role)) throw new HttpError(403, 'Only the owner or an admin sends reminders by hand'); };

r.get('/', regalAuth, asyncHandler(async (req, res) => {
  const data = await readBooks(); if (!data) return res.json({ ok: true, log: [], runs: [], plan: [], cfg: dueCfg({}) });
  const [log, plan] = await Promise.all([dueLog(req.query.limit), duePlan(data)]);
  res.json({ ok: true, ...log, plan: plan.map(p => ({ cid: p.cid, name: p.name, kind: p.kind, days: p.days, owed: p.owed })), cfg: dueCfg(data.CFG) });
}));

r.post('/run', regalAuth, asyncHandler(async (req, res) => {
  boss(req);
  const data = await readBooks(); if (!data) throw new HttpError(400, 'No books yet');
  const plan = await duePlan(data, { force: req.body?.statements ? 'statement' : false });
  res.json({ ok: true, planned: plan.length, ...(await dueSend(data, plan, sendViaProvider)) });
}));

r.post('/one', regalAuth, asyncHandler(async (req, res) => {
  boss(req);
  const data = await readBooks(); if (!data) throw new HttpError(400, 'No books yet');
  const cid = String(req.body?.cid || '');
  const c = dueList(data).find(x => x.cid === cid);
  if (!c) throw new HttpError(404, 'They owe nothing just now');
  if (!c.phone) throw new HttpError(400, `No mobile number for ${c.name}`);
  // by hand: the step they are at, sent again even if it went before (the shop asked for it)
  const st = (dueCfg(data.CFG).steps || [7, 30, 60]).map(Number).sort((a, b) => a - b);
  let step = 1; st.forEach((d, i) => { if (c.days >= d) step = i + 1; });
  const out = await dueSend(data, [{ ...c, kind: 'remind' + step, step, cycle: c.oldestNo + '·hand' + Date.now(), key: 's' + step }], sendViaProvider);
  if (!out.sent) throw new HttpError(502, 'It did not go — see the log on the page for why');
  res.json({ ok: true, ...out });
}));

/* the daily run, on the server's clock (not on serverless hosting, where nothing stays running) */
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') setInterval(() => { dueTick(sendViaProvider).catch(e => console.warn('credit follow-up:', e.message)); }, 60 * 1000).unref?.();

export default r;
