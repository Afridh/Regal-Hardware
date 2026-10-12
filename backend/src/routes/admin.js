// Users, company profile, SMS settings, app settings, SMS outbox
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { logActivity, buildUpdate } from '../lib/util.js';
import { getSetting, setSetting } from '../services/settings.js';
import { sendNow } from '../services/sms.js';

const r = Router();

// ---------------------------------------------------------------- users
r.get('/users', requirePerm('add_user', 'edit_user', 'user_control'), asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT u.id, u.code, u.name, u.username, u.role, u.permissions, u.active, u.location_id, l.name AS location_name, u.created_at, u.last_login_at
                                FROM users u LEFT JOIN locations l ON l.id = u.location_id WHERE u.company_id = $1 ORDER BY u.name`, [req.user.company_id]);
  res.json({ data: rows, total: rows.length });
}));

r.post('/users', requirePerm('add_user'), asyncHandler(async (req, res) => {
  const { name, username, password, pin, role = 'CASHIER', permissions = {}, location_id, code } = req.body || {};
  if (!name || !username || !password) throw new HttpError(400, 'name, username and password are required');
  if (role === 'ADMIN' && req.user.role !== 'ADMIN') throw new HttpError(403, 'Only an admin can create admins');
  const hash = await bcrypt.hash(password, 10);
  const { rows: [u] } = await query(
    `INSERT INTO users (company_id, location_id, code, name, username, password_hash, pin, role, permissions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, code, name, username, role, permissions, active, location_id`,
    [req.user.company_id, location_id || req.locationId, code || null, name, username, hash, pin || null, role, JSON.stringify(permissions)]);
  await logActivity(req, 'CREATE_USER', 'users', u.id);
  res.status(201).json(u);
}));

r.put('/users/:id', requirePerm('edit_user', 'user_control'), asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (body.role === 'ADMIN' && req.user.role !== 'ADMIN') throw new HttpError(403, 'Only an admin can grant admin role');
  if (body.permissions) body.permissions = JSON.stringify(body.permissions);
  const { sets, values } = buildUpdate(body, ['name', 'username', 'pin', 'role', 'permissions', 'active', 'location_id', 'code'], 3);
  if (body.password) { values.push(await bcrypt.hash(body.password, 10)); sets.push(`password_hash = $${values.length + 2}`); }
  if (!sets.length) throw new HttpError(400, 'No data');
  const { rows: [u] } = await query(`UPDATE users SET ${sets.join(', ')} WHERE company_id = $1 AND id = $2 RETURNING id, code, name, username, role, permissions, active, location_id`,
    [req.user.company_id, req.params.id, ...values]);
  if (!u) throw new HttpError(404, 'User not found');
  await logActivity(req, 'UPDATE_USER', 'users', u.id);
  res.json(u);
}));

r.delete('/users/:id', requirePerm('del_user'), asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'You cannot disable yourself');
  const { rows: [u] } = await query(`UPDATE users SET active = FALSE WHERE company_id = $1 AND id = $2 RETURNING id`, [req.user.company_id, req.params.id]);
  if (!u) throw new HttpError(404, 'User not found');
  await logActivity(req, 'DISABLE_USER', 'users', u.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- company
r.get('/company', asyncHandler(async (req, res) => {
  const { rows: [c] } = await query(`SELECT * FROM companies WHERE id = $1`, [req.user.company_id]);
  res.json(c);
}));

r.put('/company', requirePerm('company_settings'), asyncHandler(async (req, res) => {
  const cols = ['name', 'address1', 'address2', 'address3', 'contact1', 'contact2', 'email', 'fax', 'vat_reg_no', 'invoice_desc1', 'invoice_desc2', 'logo_url', 'currency_name', 'currency_symbol', 'day_start_time'];
  const { sets, values } = buildUpdate(req.body || {}, cols, 2);
  if (!sets.length) throw new HttpError(400, 'No data');
  const { rows: [c] } = await query(`UPDATE companies SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [req.user.company_id, ...values]);
  await logActivity(req, 'UPDATE_COMPANY', 'companies', c.id);
  res.json(c);
}));

// ---------------------------------------------------------------- generic settings (loyalty, invoice options ...)
r.get('/settings/:key', asyncHandler(async (req, res) => res.json(await getSetting(req.user.company_id, req.params.key, {}))));
r.put('/settings/:key', requirePerm('company_settings'), asyncHandler(async (req, res) => {
  await setSetting(req.user.company_id, req.params.key, req.body || {});
  await logActivity(req, 'UPDATE_SETTING', 'settings', req.params.key);
  res.json(await getSetting(req.user.company_id, req.params.key, {}));
}));

// ---------------------------------------------------------------- SMS
r.get('/sms', requirePerm('sms_settings'), asyncHandler(async (req, res) => {
  const { rows: [s] } = await query(`SELECT * FROM sms_settings WHERE company_id = $1`, [req.user.company_id]);
  res.json(s || { company_id: req.user.company_id, templates: {}, flags: {} });
}));

r.put('/sms', requirePerm('sms_settings'), asyncHandler(async (req, res) => {
  const { api_url, api_key, sender_id, owner_mobile, templates = {}, flags = {} } = req.body || {};
  const { rows: [s] } = await query(
    `INSERT INTO sms_settings (company_id, api_url, api_key, sender_id, owner_mobile, templates, flags, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (company_id) DO UPDATE SET api_url = EXCLUDED.api_url, api_key = EXCLUDED.api_key, sender_id = EXCLUDED.sender_id, owner_mobile = EXCLUDED.owner_mobile, templates = EXCLUDED.templates, flags = EXCLUDED.flags, updated_at = now()
     RETURNING *`, [req.user.company_id, api_url || null, api_key || null, sender_id || null, owner_mobile || null, JSON.stringify(templates), JSON.stringify(flags)]);
  await logActivity(req, 'UPDATE_SMS', 'sms_settings', s.company_id);
  res.json(s);
}));

r.post('/sms/test', requirePerm('sms_settings'), asyncHandler(async (req, res) => {
  const { mobile, message } = req.body || {};
  const { rows: [s] } = await query(`SELECT * FROM sms_settings WHERE company_id = $1`, [req.user.company_id]);
  if (!s) throw new HttpError(400, 'Save SMS settings first');
  try {
    const out = await sendNow(s, mobile, message || 'SePOS test message');
    res.json({ status: 'OK', response: out });
  } catch (e) {
    res.json({ status: 'FAIL', error: e.message });
  }
}));

r.get('/sms/outbox', requirePerm('sms_settings'), asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM sms_outbox WHERE company_id = $1 ORDER BY id DESC LIMIT 200`, [req.user.company_id]);
  res.json({ data: rows, total: rows.length });
}));

export default r;
