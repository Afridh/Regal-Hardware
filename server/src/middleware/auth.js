import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { HttpError } from '../lib/errors.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, company_id: user.company_id, location_id: user.location_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '12h' },
  );
}

/** Verifies the bearer token and loads the user (with permissions) onto req.user. */
export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Not authenticated');
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows: [user] } = await query(
      `SELECT id, company_id, location_id, code, name, username, role, permissions, active FROM users WHERE id = $1`, [payload.sub]);
    if (!user || !user.active) throw new HttpError(401, 'User disabled');
    req.user = user;
    // allow the client to work in a different location than the user's home one
    const loc = req.headers['x-location-id'];
    req.locationId = loc ? Number(loc) : user.location_id;
    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return next(new HttpError(401, 'Session expired'));
    next(e);
  }
}

export function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  return !!(user.permissions && user.permissions[perm]);
}

/** Route guard: requirePerm('invoice') or requirePerm('add_item','edit_item') (any of). */
export function requirePerm(...perms) {
  return (req, _res, next) => {
    if (perms.some(p => hasPermission(req.user, p))) return next();
    next(new HttpError(403, `Permission required: ${perms.join(' or ')}`));
  };
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (roles.includes(req.user?.role)) return next();
    next(new HttpError(403, 'Insufficient role'));
  };
}
