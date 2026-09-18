import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { logActivity } from '../lib/util.js';
import { PERMISSION_GROUPS } from '../permissions.js';

const r = Router();

function publicUser(u) {
  const { password_hash, pin, ...rest } = u;
  return rest;
}

r.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new HttpError(400, 'Username and password required');
  const { rows: [user] } = await query(`SELECT * FROM users WHERE lower(username) = lower($1)`, [username]);
  if (!user || !user.active) throw new HttpError(401, 'Invalid username or password');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new HttpError(401, 'Invalid username or password');
  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  req.user = user;
  await logActivity(req, 'LOGIN', 'users', user.id);

  const { rows: [company] } = await query(`SELECT * FROM companies WHERE id = $1`, [user.company_id]);
  const { rows: locations } = await query(`SELECT id, code, name FROM locations WHERE company_id = $1 AND active ORDER BY code`, [user.company_id]);
  res.json({ token: signToken(user), user: publicUser(user), company, locations });
}));

r.get('/me', authenticate, asyncHandler(async (req, res) => {
  const { rows: [company] } = await query(`SELECT * FROM companies WHERE id = $1`, [req.user.company_id]);
  const { rows: locations } = await query(`SELECT id, code, name FROM locations WHERE company_id = $1 AND active ORDER BY code`, [req.user.company_id]);
  res.json({ user: publicUser(req.user), company, locations });
}));

r.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) throw new HttpError(400, 'New password must be at least 6 characters');
  const { rows: [user] } = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  if (!(await bcrypt.compare(current_password || '', user.password_hash))) throw new HttpError(400, 'Current password is incorrect');
  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await bcrypt.hash(new_password, 10), req.user.id]);
  res.json({ ok: true });
}));

/** Verify a supervisor PIN (used for approvals: cash discount, cancel invoice, price change ...). */
r.post('/verify-pin', authenticate, asyncHandler(async (req, res) => {
  const { pin, permission } = req.body || {};
  const { rows } = await query(`SELECT id, name, role, permissions FROM users WHERE company_id = $1 AND active AND pin = $2`, [req.user.company_id, pin || '']);
  const approver = rows.find(u => u.role === 'ADMIN' || (permission ? u.permissions?.[permission] : true));
  if (!approver) throw new HttpError(403, 'PIN not accepted');
  res.json({ approved_by: approver.name });
}));

r.get('/permissions', authenticate, (_req, res) => res.json(PERMISSION_GROUPS));

export default r;
