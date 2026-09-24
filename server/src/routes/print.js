// The shop's printers live on one PC. A bill made anywhere — a phone at the counter, a second till,
// the site on the internet — is left here as a job, and the print helper on that PC takes it and
// prints it. The helper only ever calls out, so nothing has to be opened to it from outside.
//
//   POST /api/print            { format, no, html, copies? }   the till leaves a job      (till sign-in)
//   GET  /api/print/next?key=  …                               the helper takes the next  (device key)
//   POST /api/print/:id/done   { ok, error, printer }          the helper says how it went(device key)
//   GET  /api/print/queue      …                               what is waiting and what happened (till sign-in)
//   GET  /api/print/status     …                               whether the helper is listening   (till sign-in)
import { Router } from 'express';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { regalAuth } from './regal.js';

const r = Router();
const KEEP_HOURS = 48;                      // jobs are kept this long so the owner can see what printed
const TAKE_BACK_MS = 90 * 1000;             // a job a helper took but never finished goes back in the queue

let ready = null;
function ensureTable() {
  if (!ready) ready = query(`
    CREATE TABLE IF NOT EXISTS print_jobs (
      id bigserial PRIMARY KEY,
      format varchar(10) NOT NULL,
      no varchar(40),
      copies smallint NOT NULL DEFAULT 1,
      html text NOT NULL,
      by_user varchar(80),
      from_till varchar(20),
      status varchar(10) NOT NULL DEFAULT 'waiting',
      printer varchar(120),
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      taken_at timestamptz,
      done_at timestamptz);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs (status, id);
    CREATE TABLE IF NOT EXISTS print_helper (
      one boolean PRIMARY KEY DEFAULT true, seen_at timestamptz, printers jsonb)`)
    .catch(e => { ready = null; throw e; });
  return ready;
}
/* When the helper last asked for work, kept in the database so it is the same answer from every
   copy of the server — a hosted site runs more than one. */
const HELPER_ALIVE_S = 300;
async function helperSeen(printers) {
  await query(`INSERT INTO print_helper (one, seen_at, printers) VALUES (true, now(), $1)
               ON CONFLICT (one) DO UPDATE SET seen_at = now(), printers = COALESCE(EXCLUDED.printers, print_helper.printers)`,
    [printers ? JSON.stringify(printers) : null]);
}
async function helperState() {
  const { rows: [h] } = await query(`SELECT seen_at, printers, EXTRACT(EPOCH FROM (now() - seen_at))::int AS ago FROM print_helper WHERE one`);
  return { alive: !!h && h.ago <= HELPER_ALIVE_S, ago: h ? h.ago : null, printers: h ? h.printers : null };
}

const deviceOk = (req) => {
  const key = process.env.PRINT_DEVICE_KEY || process.env.SHIFT_DEVICE_KEY || '';
  const given = String(req.query.key || (req.body && req.body.key) || req.headers['x-print-key'] || '');
  return !!key && given === key;
};

/* ---------------------------------------------------------------- the till leaves a job */
r.post('/', regalAuth, asyncHandler(async (req, res) => {
  const { format, no, html, copies } = req.body || {};
  if (!['r80', 'a5'].includes(String(format))) throw new HttpError(400, 'format must be r80 or a5');
  if (!html || typeof html !== 'string') throw new HttpError(400, 'nothing to print');
  if (html.length > 8e6) throw new HttpError(413, 'that bill is too big to send');
  await ensureTable();
  // a queue nobody collects is worse than no queue: if that PC is not listening, say so and let the till print here
  const h = await helperState();
  if (!h.alive && req.body.force !== true) throw new HttpError(503, h.ago == null
    ? 'The shop printer has never asked for work — start the print helper on the PC the printers are on'
    : `The shop printer was last heard from ${Math.round(h.ago / 60)} minutes ago`);
  const { rows: [row] } = await query(
    `INSERT INTO print_jobs (format, no, copies, html, by_user, from_till) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
    [format, String(no || '').slice(0, 40), Math.max(1, Math.min(5, +copies || 1)), html, req.regalUser.name, String(req.body.till || '').slice(0, 20)]);
  await query(`DELETE FROM print_jobs WHERE created_at < now() - ($1 || ' hours')::interval`, [KEEP_HOURS]).catch(() => {});
  res.json({ ok: true, id: Number(row.id), at: row.created_at });
}));

/* ---------------------------------------------------------------- the helper takes the next one */
r.get('/next', asyncHandler(async (req, res) => {
  if (!deviceOk(req)) throw new HttpError(403, 'Wrong device key');
  await ensureTable();
  // every ask is the helper saying it is there, and what it can print on
  let printers = null; if (req.query.printers) { try { printers = JSON.parse(String(req.query.printers)) } catch { /* only for the screen */ } }
  await helperSeen(printers);
  // anything a helper took but never finished (it was closed mid-job) comes back
  await query(`UPDATE print_jobs SET status = 'waiting', taken_at = NULL
               WHERE status = 'taken' AND taken_at < now() - ($1 || ' milliseconds')::interval`, [TAKE_BACK_MS]);
  const { rows: [job] } = await query(
    `UPDATE print_jobs SET status = 'taken', taken_at = now()
      WHERE id = (SELECT id FROM print_jobs WHERE status = 'waiting' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, format, no, copies, html, by_user, from_till`);
  if (!job) return res.json({ ok: true, job: null });
  res.json({ ok: true, job: { id: Number(job.id), format: job.format, no: job.no, copies: job.copies, html: job.html, by: job.by_user, till: job.from_till } });
}));

/* ---------------------------------------------------------------- and says how it went */
r.post('/:id/done', asyncHandler(async (req, res) => {
  if (!deviceOk(req)) throw new HttpError(403, 'Wrong device key');
  await ensureTable();
  const ok = req.body && req.body.ok !== false;
  await query(`UPDATE print_jobs SET status = $2, printer = $3, error = $4, done_at = now() WHERE id = $1`,
    [+req.params.id, ok ? 'printed' : 'failed', String((req.body && req.body.printer) || '').slice(0, 120), ok ? null : String((req.body && req.body.error) || '').slice(0, 400)]);
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- what is waiting, what printed */
r.get('/queue', regalAuth, asyncHandler(async (_req, res) => {
  await ensureTable();
  const { rows } = await query(
    `SELECT id, format, no, copies, by_user, from_till, status, printer, error, created_at, done_at
       FROM print_jobs ORDER BY id DESC LIMIT 40`);
  const { rows: [w] } = await query(`SELECT count(*)::int AS waiting FROM print_jobs WHERE status IN ('waiting','taken')`);
  res.json({ ok: true, waiting: w.waiting, jobs: rows.map(j => ({ ...j, id: Number(j.id) })) });
}));

/* is the helper alive? it says so every time it asks for work */
r.get('/status', regalAuth, asyncHandler(async (_req, res) => {
  await ensureTable();
  const { rows: [w] } = await query(`SELECT count(*)::int AS waiting FROM print_jobs WHERE status IN ('waiting','taken')`);
  const h = await helperState();
  res.json({ ok: true, helper: h.alive, seenSecondsAgo: h.ago, printers: h.printers, waiting: w.waiting });
}));

export default r;
