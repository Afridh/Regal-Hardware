// Files the till attaches to things — the letter or photo of a quotation request, the signed copy of
// what was submitted — and email going out with them.  Files live here (bytea), the books only
// hold signed links, so the shared document stays small.
import { Router } from 'express';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { regalAuth } from './regal.js';

const r = Router();
const secret = () => process.env.JWT_SECRET || 'regal';
const sig = id => crypto.createHmac('sha256', secret()).update('file|' + id).digest('hex').slice(0, 20);
export const fileUrl = id => `/api/files/${id}?k=${sig(id)}`;
const ALLOWED = /^(image\/(jpeg|png|webp|gif)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/vnd\.ms-excel|text\/plain)$/;

let ready = null;
function ensure() {
  if (!ready) ready = query(`CREATE TABLE IF NOT EXISTS files (
    id bigserial PRIMARY KEY, kind varchar(20) NOT NULL, ref varchar(40) NOT NULL, name varchar(200) NOT NULL, mime varchar(100) NOT NULL,
    data bytea NOT NULL, bytes integer NOT NULL, uploaded_by varchar(80), created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS files_ref ON files (kind, ref)`).catch(e => { ready = null; throw e; });
  return ready;
}

/** Upload: { kind, ref, name, dataUrl }.  Returns the id and a link the till keeps in the books. */
r.post('/', regalAuth, asyncHandler(async (req, res) => {
  const { kind, ref, name, dataUrl } = req.body || {};
  if (!/^[a-z]{2,20}$/.test(kind || '') || !ref) throw new HttpError(400, 'kind and ref required');
  const m = /^data:([\w.+/-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m || !ALLOWED.test(m[1])) throw new HttpError(400, 'Attach a photo, PDF, Word, Excel or text file');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8e6) throw new HttpError(400, 'That file is too big — keep it under 8 MB');
  await ensure();
  const { rows: [{ id }] } = await query(`INSERT INTO files (kind, ref, name, mime, data, bytes, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [kind, String(ref).slice(0, 40), String(name || 'file').slice(0, 200), m[1], buf, buf.length, req.regalUser.name]);
  res.json({ ok: true, id, url: fileUrl(id), name: String(name || 'file').slice(0, 200), mime: m[1], bytes: buf.length });
}));

/** The file itself, by its signed link (works in <img>, <a> and email attachments). */
r.get('/:id', asyncHandler(async (req, res) => {
  const id = String(+req.params.id || 0);
  if (!id || req.query.k !== sig(id)) return res.status(404).end();
  await ensure();
  const { rows: [f] } = await query(`SELECT name, mime, data FROM files WHERE id = $1`, [id]);
  if (!f) return res.status(404).end();
  res.set('Content-Type', f.mime); res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.set('Content-Disposition', (req.query.dl ? 'attachment' : 'inline') + `; filename="${encodeURIComponent(f.name)}"`);
  res.send(f.data);
}));

r.delete('/:id', regalAuth, asyncHandler(async (req, res) => {
  await ensure();
  const { rowCount } = await query(`DELETE FROM files WHERE id = $1`, [+req.params.id || 0]);
  res.json({ ok: true, removed: rowCount });
}));

// ---------------------------------------------------------------- email (SMTP, Settings → Messaging → Email)
async function mailCfg() {
  const { rows: [row] } = await query(`SELECT data FROM books WHERE key = 'regal'`);
  const cfg = row?.data?.CFG?.mail || {};
  if (!cfg.host || !cfg.user || !cfg.pass) throw new HttpError(400, 'Email is not set up (Settings → Messaging → Email)');
  return { cfg, shop: row?.data?.CFG?.shop || {} };
}
function transport(cfg) {
  return nodemailer.createTransport({ host: cfg.host, port: +cfg.port || 587, secure: (+cfg.port || 587) === 465 || cfg.secure === true, auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 20000 });
}
/** { to, cc?, subject, text, html?, fileIds? } — attachments are files uploaded above. */
r.post('/mail/send', regalAuth, asyncHandler(async (req, res) => {
  const { to, cc, subject, text, html, fileIds } = req.body || {};
  if (!to || !subject) throw new HttpError(400, 'to and subject required');
  const { cfg, shop } = await mailCfg();
  await ensure();
  const ids = (Array.isArray(fileIds) ? fileIds : []).map(Number).filter(Boolean).slice(0, 10);
  const { rows } = ids.length ? await query(`SELECT id, name, mime, data FROM files WHERE id = ANY($1::bigint[])`, [ids]) : { rows: [] };
  const info = await transport(cfg).sendMail({
    from: cfg.from || `"${shop.name || 'Regal Hardware'}" <${cfg.user}>`, to, cc: cc || undefined, subject,
    text: text || '', html: html || undefined,
    attachments: rows.map(f => ({ filename: f.name, content: f.data, contentType: f.mime })) });
  res.json({ ok: true, status: 'Sent', id: info.messageId, attachments: rows.length });
}));
r.post('/mail/test', regalAuth, asyncHandler(async (req, res) => {
  const { cfg, shop } = await mailCfg();
  const to = req.body?.to || cfg.user;
  try { await transport(cfg).verify(); }
  catch (e) { return res.json({ ok: false, status: 'Cannot reach the mail server — ' + e.message }); }
  const info = await transport(cfg).sendMail({ from: cfg.from || `"${shop.name || 'Regal Hardware'}" <${cfg.user}>`, to, subject: `${shop.name || 'Regal Hardware'}: test email from the till`, text: 'If you can read this, email from the till is working.' });
  res.json({ ok: true, status: 'Sent to ' + to, id: info.messageId });
}));

export default r;
