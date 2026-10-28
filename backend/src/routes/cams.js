// The shop's cameras, seen from anywhere, and what they notice. The recorder is on the shop's own
// network, which nothing outside can reach — so the camera helper on the shop PC calls OUT to here, as
// the print helper does, and nothing has to be opened on the shop's router.
//
//   Helper (device key — the same as the print helper's):
//   GET  /api/cams/jobs?key=          what is wanted now: the cameras somebody is watching, and pictures
//                                     asked for (the counter at the moment a bill was made)
//   POST /api/cams/frame?key=&ch=&shot=   one JPEG (body image/jpeg): the latest picture of that camera,
//                                     or — with shot — a picture kept with a bill
//   POST /api/cams/status?key=        { recorder, cameras:[{ch,name}] } what the helper can see
//   POST /api/cams/event?key=         { kind, ch, at, text } something the recorder raised
//
//   Till (till sign-in):
//   GET  /api/cams/status             is the helper there, and which cameras
//   GET  /api/cams/live/:ch           the latest picture of a camera, and "keep it coming" for a while
//   POST /api/cams/shot               { ch, ref, count } pictures for a bill
//   GET  /api/cams/shots/:ref         the pictures (and a credit bill's clip) kept with that bill
//
//   Kept with a bill: a cash bill's pictures for CFG.cams.cashDays (31 days); a credit bill's pictures
//   and a short clip from the recorder (CFG.cams.creditClip seconds, 30) for CFG.cams.creditDays (122).
//   Each file carries its keep_until and goes once that has passed. The clip is made by the helper from
//   the recorder's own recording a little after the bill:   POST /api/cams/clip?key=&id=  (video/mp4)
//   GET  /api/cams/events?since=      what the recorder raised
//
// A picture is only sent while somebody is looking: the helper asks every second or so what is
// wanted, and the till asks again for as long as its page is open. Nothing streams to nobody.
import express, { Router } from 'express';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { regalAuth, sendViaProvider } from './regal.js';
import { saveBuffer, ensure as ensureFiles, fileUrl } from './files.js';

const r = Router();
const WANT_MS = 15000;          // a viewer's ask holds this long; the page asks again well inside it
const FRESH_MS = 12000;         // a picture older than this is not shown as "live"
const HELPER_ALIVE_MS = 120000;

let ready = null;
function ensure() {
  if (!ready) ready = query(`
    CREATE TABLE IF NOT EXISTS cam_frames (ch varchar(20) PRIMARY KEY, jpeg bytea NOT NULL, at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS cam_wants (ch varchar(20) PRIMARY KEY, until_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS cam_jobs (id bigserial PRIMARY KEY, ch varchar(20) NOT NULL, ref varchar(40) NOT NULL, n smallint NOT NULL DEFAULT 1,
      taken smallint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS cam_events (id bigserial PRIMARY KEY, kind varchar(30) NOT NULL, ch varchar(20), text varchar(300) NOT NULL,
      at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS cam_helper (one varchar(4) PRIMARY KEY, seen_at timestamptz, info text);
    ALTER TABLE cam_jobs ADD COLUMN IF NOT EXISTS keep_days smallint;
    CREATE TABLE IF NOT EXISTS cam_clips (id bigserial PRIMARY KEY, ch varchar(20) NOT NULL, ref varchar(40) NOT NULL,
      start_at timestamptz NOT NULL, secs smallint NOT NULL, keep_days smallint NOT NULL, ready_at timestamptz NOT NULL,
      state varchar(10) NOT NULL DEFAULT 'new', taken_at timestamptz, note varchar(200), created_at timestamptz NOT NULL DEFAULT now())`)
    .catch(e => { ready = null; throw e; });
  return ready;
}
const deviceOk = (req) => {
  const key = process.env.PRINT_DEVICE_KEY || process.env.SHIFT_DEVICE_KEY || '';
  const given = String(req.query.key || req.headers['x-device-key'] || '');
  return !!key && given === key;
};
const needDevice = (req) => { if (!deviceOk(req)) throw new HttpError(403, 'Wrong device key'); };
const chOk = (v) => { const c = String(v || ''); if (!/^\d{1,5}$/.test(c)) throw new HttpError(400, 'Which camera?'); return c; };
async function seen(info) {
  await query(`INSERT INTO cam_helper (one, seen_at, info) VALUES ('x', now(), $1)
     ON CONFLICT (one) DO UPDATE SET seen_at = now(), info = COALESCE(EXCLUDED.info, cam_helper.info)`, [info ? JSON.stringify(info) : null]);
}

/* ---------------------------------------------------------------- the helper */
r.get('/jobs', asyncHandler(async (req, res) => {
  needDevice(req); await ensure(); await seen(null);
  const { rows: wants } = await query(`SELECT ch FROM cam_wants WHERE until_at > now()`);
  const { rows: jobs } = await query(`SELECT id, ch, ref, n, taken FROM cam_jobs WHERE taken < n ORDER BY id LIMIT 10`);
  // a job left over for long (the helper was off) is let go rather than taken at the wrong moment
  await query(`DELETE FROM cam_jobs WHERE taken >= n OR created_at < $1`, [new Date(Date.now() - 120000)]);
  const cfg = await camCfg();
  await tidy();
  // clips whose moment the recorder now has (or one handed out ten minutes ago and never brought back);
  // after a week the recorder may have nothing left of it, so those are let go
  const now = Date.now();
  const { rows: clips } = await query(`SELECT id, ch, ref, start_at, secs FROM cam_clips
     WHERE created_at > $1 AND ((state = 'new' AND ready_at <= $2) OR (state = 'taking' AND taken_at < $3)) ORDER BY id LIMIT 2`,
    [new Date(now - 7 * 864e5), new Date(now), new Date(now - 600000)]);
  for (const c of clips) await query(`UPDATE cam_clips SET state = 'taking', taken_at = $1 WHERE id = $2`, [new Date(now), c.id]);
  res.json({ ok: true, watch: wants.map(w => w.ch), shots: jobs.map(j => ({ id: Number(j.id), ch: j.ch, ref: j.ref, left: j.n - j.taken })),
    clips: clips.map(c => ({ id: Number(c.id), ch: c.ch, ref: c.ref, start: new Date(c.start_at).toISOString(), secs: +c.secs })),
    alerts: cfg.alerts !== false });
}));

r.post('/frame', express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '3mb' }), asyncHandler(async (req, res) => {
  needDevice(req); await ensure();
  const ch = chOk(req.query.ch), buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 200 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(400, 'Not a JPEG');
  const shot = +req.query.shot || 0;
  if (shot) {
    const { rows: [j] } = await query(`SELECT id, ref, n, taken, keep_days FROM cam_jobs WHERE id = $1`, [shot]);
    if (j && j.taken < j.n) {
      await saveBuffer({ kind: 'billcam', ref: j.ref, name: `${j.ref} camera ${ch} ${j.taken + 1}.jpg`, mime: 'image/jpeg', buf, by: 'camera',
        keepUntil: new Date(Date.now() + (+j.keep_days || CASH_DAYS) * 864e5) });
      await query(`UPDATE cam_jobs SET taken = taken + 1 WHERE id = $1`, [shot]);
    }
  } else {
    await query(`INSERT INTO cam_frames (ch, jpeg, at) VALUES ($1, $2, now()) ON CONFLICT (ch) DO UPDATE SET jpeg = EXCLUDED.jpeg, at = EXCLUDED.at`, [ch, buf]);
  }
  res.json({ ok: true });
}));

/* A credit bill's clip, from the helper: the MP4 it made from the recorder's recording — or, with fail,
   why it could not (the recorder had nothing then, say). */
r.post('/clip', express.raw({ type: ['video/mp4', 'application/octet-stream'], limit: '12mb' }), asyncHandler(async (req, res) => {
  needDevice(req); await ensure();
  const { rows: [c] } = await query(`SELECT id, ch, ref, keep_days FROM cam_clips WHERE id = $1`, [+req.query.id || 0]);
  if (!c) throw new HttpError(404, 'No such clip');
  if (req.query.fail) {
    await query(`UPDATE cam_clips SET state = 'failed', note = $1 WHERE id = $2`, [String(req.query.fail).slice(0, 200), c.id]);
    return res.json({ ok: true });
  }
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 1000) throw new HttpError(400, 'Not a clip');
  await saveBuffer({ kind: 'billclip', ref: c.ref, name: `${c.ref} camera ${c.ch}.mp4`, mime: 'video/mp4', buf, by: 'camera',
    keepUntil: new Date(Date.now() + (+c.keep_days || CREDIT_DAYS) * 864e5) });
  await query(`UPDATE cam_clips SET state = 'done' WHERE id = $1`, [c.id]);
  res.json({ ok: true });
}));

r.post('/status', asyncHandler(async (req, res) => {
  needDevice(req); await ensure();
  const b = req.body || {};
  await seen({ recorder: b.recorder || null, cameras: Array.isArray(b.cameras) ? b.cameras.slice(0, 64) : [], terminals: b.terminals || null, at: Date.now() });
  res.json({ ok: true });
}));

/* What the recorder raised. Kept for the tills to show; an alarm while the shop is shut is texted to
   the owner as well, if the shop asked for that — at most one text in ten minutes, so a moth in front of
   a camera at night does not run up a bill. */
const ALARM_KINDS = { VMD: 'Movement', linedetection: 'Someone crossed a line', fielddetection: 'Someone entered a watched area',
  tamperdetection: 'A camera was covered or moved', shelteralarm: 'A camera was covered', videoloss: 'A camera lost its picture',
  diskfull: 'The recorder\'s disk is full', diskerror: 'The recorder\'s disk has a fault', IO: 'An alarm input went off', illaccess: 'Somebody tried to sign in to the recorder' };
let lastText = 0;
async function camCfg() {
  try { const { rows: [row] } = await query(`SELECT data FROM books WHERE key = 'regal'`); const d = typeof row?.data === 'string' ? JSON.parse(row.data) : row?.data;
    return { ...(d?.CFG?.cams || {}), _shop: d?.CFG?.shop || {}, _msg: d?.CFG?.msg || {}, _cfg: d?.CFG || {} }; } catch { return {}; }
}
const minutes = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? +m[1] * 60 + +m[2] : null; };
function shut(cfg, when = new Date()) {
  const open = minutes(cfg.open || '07:30'), close = minutes(cfg.close || '19:30');
  const now = minutes(new Date(when).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: process.env.SHOP_TZ || 'Asia/Colombo' }));
  return open == null || close == null ? false : (open < close ? (now < open || now >= close) : (now >= close && now < open));
}
r.post('/event', asyncHandler(async (req, res) => {
  needDevice(req); await ensure();
  const b = req.body || {};
  const kind = String(b.kind || '').slice(0, 30); if (!kind) throw new HttpError(400, 'kind');
  const ch = b.ch != null ? String(b.ch).slice(0, 20) : null;
  const text = String(b.text || ALARM_KINDS[kind] || kind).slice(0, 300);
  await query(`INSERT INTO cam_events (kind, ch, text) VALUES ($1, $2, $3)`, [kind, ch, text]);
  await query(`DELETE FROM cam_events WHERE at < $1`, [new Date(Date.now() - 30 * 864e5)]);
  const cfg = await camCfg();
  const after = shut(cfg);
  const serious = !['VMD'].includes(kind) || after;        // movement in opening hours is just customers
  if (serious && cfg.smsOwner === true && (after || kind !== 'VMD') && Date.now() - lastText > 10 * 60 * 1000 && cfg._shop.owner && cfg._msg.apiUrl && cfg._msg.apiKey) {
    lastText = Date.now();
    const name = (cfg.names || {})[ch] || (ch ? 'camera ' + ch : 'the recorder');
    sendViaProvider(cfg._msg, String(cfg._shop.owner).split(/[,;\s]+/)[0],
      `Dear Owner,\nCamera alert${after ? ' (the shop is shut)' : ''}.\nWhat: ${text}\nWhere: ${name}\nTime: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: process.env.SHOP_TZ || 'Asia/Colombo' })}\nOpen the till's Cameras page to look.`)
      .catch(e => console.error('camera alert text failed', e.message));
  }
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- the till */
r.get('/status', regalAuth, asyncHandler(async (_req, res) => {
  await ensure();
  const { rows: [h] } = await query(`SELECT seen_at, info FROM cam_helper WHERE one = 'x'`);
  const ago = h?.seen_at ? Date.now() - new Date(h.seen_at).getTime() : null;
  let info = {}; try { info = JSON.parse(h?.info || '{}') || {}; } catch {}
  res.json({ ok: true, alive: ago != null && ago < HELPER_ALIVE_MS, ago, recorder: info.recorder || null, cameras: info.cameras || [], terminals: info.terminals || null });
}));

r.get('/live/:ch', regalAuth, asyncHandler(async (req, res) => {
  await ensure();
  const ch = chOk(req.params.ch);
  await query(`INSERT INTO cam_wants (ch, until_at) VALUES ($1, $2) ON CONFLICT (ch) DO UPDATE SET until_at = EXCLUDED.until_at`, [ch, new Date(Date.now() + WANT_MS)]);
  const { rows: [f] } = await query(`SELECT jpeg, at FROM cam_frames WHERE ch = $1`, [ch]);
  if (!f) return res.status(204).end();
  const age = Date.now() - new Date(f.at).getTime();
  res.set('Cache-Control', 'no-store'); res.set('X-Frame-Age', String(age)); res.set('Access-Control-Expose-Headers', 'X-Frame-Age');
  res.type('image/jpeg').send(Buffer.from(f.jpeg));
}));

/* Pictures for a bill, asked for by the till the moment it is made: { ch, ref, count, credit, at }.
   A credit bill also gets a clip — from half its length before the bill to half after — made once the
   recorder can play it back, about a quarter of an hour later. */
r.post('/shot', regalAuth, asyncHandler(async (req, res) => {
  await ensure();
  const ch = chOk(req.body?.ch), ref = String(req.body?.ref || '').slice(0, 40), n = Math.max(1, Math.min(5, +req.body?.count || 3));
  if (!ref) throw new HttpError(400, 'Which bill?');
  const cfg = await camCfg(), credit = !!req.body?.credit;
  const days = keepDays(cfg, credit);
  await query(`INSERT INTO cam_jobs (ch, ref, n, keep_days) VALUES ($1, $2, $3, $4)`, [ch, ref, n, days]);
  const secs = credit ? clipSecs(cfg) : 0;
  if (secs) {
    const at = Math.min(Date.now(), +req.body?.at || Date.now());
    await query(`INSERT INTO cam_clips (ch, ref, start_at, secs, keep_days, ready_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [ch, ref, new Date(at - secs * 500), secs, days, new Date(at + secs * 500 + RECORDER_LAG)]);
  }
  res.json({ ok: true, keepDays: days, clip: secs });
}));
const CASH_DAYS = 31, CREDIT_DAYS = 122;
// the recorder only plays back a moment some ten minutes after it (it writes its recording in pieces)
const RECORDER_LAG = 12 * 60000;
const keepDays = (cfg, credit) => Math.max(1, Math.min(366, Math.round(+(credit ? cfg.creditDays : cfg.cashDays) || (credit ? CREDIT_DAYS : CASH_DAYS))));
const clipSecs = (cfg) => { const v = cfg.creditClip === undefined || cfg.creditClip === '' ? 30 : +cfg.creditClip; return Math.max(0, Math.min(120, Math.round(v || 0))); };
/* What has had its time goes: once an hour, files past their keep_until — and pictures from before
   keep_until existed, after the longest keep (a credit bill's). */
let tidied = 0;
async function tidy() {
  if (Date.now() - tidied < 3600e3) return; tidied = Date.now();
  try {
    await ensureFiles();
    await query(`DELETE FROM files WHERE keep_until IS NOT NULL AND keep_until < $1`, [new Date()]);
    await query(`DELETE FROM files WHERE kind = 'billcam' AND keep_until IS NULL AND created_at < $1`, [new Date(Date.now() - CREDIT_DAYS * 864e5)]);
    await query(`DELETE FROM cam_clips WHERE created_at < $1`, [new Date(Date.now() - 8 * 864e5)]);
  } catch (e) { tidied = 0; }
}

r.get('/shots/:ref', regalAuth, asyncHandler(async (req, res) => {
  await ensureFiles();
  await ensure();
  const ref = String(req.params.ref).slice(0, 40);
  const { rows } = await query(`SELECT id, kind, name, created_at, keep_until FROM files WHERE kind IN ('billcam', 'billclip') AND ref = $1 ORDER BY id`, [ref]);
  const { rows: [pend] } = await query(`SELECT state, ready_at, note FROM cam_clips WHERE ref = $1 ORDER BY id DESC LIMIT 1`, [ref]);
  const one = x => ({ id: Number(x.id), url: fileUrl(x.id), name: x.name, at: x.created_at, until: x.keep_until });
  res.json({ ok: true, shots: rows.filter(x => x.kind === 'billcam').map(one), clips: rows.filter(x => x.kind === 'billclip').map(one),
    clip: pend ? { state: pend.state, ready: pend.ready_at, note: pend.note || '' } : null });
}));

r.get('/events', regalAuth, asyncHandler(async (req, res) => {
  await ensure();
  const since = +req.query.since || 0;
  const { rows } = await query(`SELECT id, kind, ch, text, at FROM cam_events WHERE id > $1 ORDER BY id DESC LIMIT 100`, [since]);
  const cfg = await camCfg();
  res.json({ ok: true, events: rows.map(e => ({ id: Number(e.id), kind: e.kind, ch: e.ch, text: e.text, at: e.at, shut: shut(cfg, e.at) })) });
}));

export default r;
