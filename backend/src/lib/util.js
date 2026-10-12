import { query } from '../db.js';

export const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const round2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;

export function today() { return new Date().toISOString().slice(0, 10); }

/** Pagination + search helper: parses ?page=&limit=&q= */
export function pageParams(req, maxLimit = 200) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit, q: (req.query.q || '').trim() };
}

export async function logActivity(req, action, entity, entityId, details) {
  try {
    await query(
      `INSERT INTO activity_log (company_id, user_id, username, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.user?.company_id, req.user?.id, req.user?.username, action, entity, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null, req.ip]);
  } catch (e) { console.error('activity log failed', e.message); }
}

/** Build "SET a=$1, b=$2" from an object restricted to allowed columns. */
export function buildUpdate(body, allowed, startIndex = 1) {
  const sets = []; const values = [];
  for (const col of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, col)) {
      values.push(body[col] === '' ? null : body[col]);
      sets.push(`${col} = $${startIndex + values.length - 1}`);
    }
  }
  return { sets, values };
}

export function buildInsert(body, allowed, extra = {}) {
  const cols = []; const values = [];
  for (const col of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, col) && body[col] !== undefined) {
      cols.push(col); values.push(body[col] === '' ? null : body[col]);
    }
  }
  for (const [k, v] of Object.entries(extra)) { cols.push(k); values.push(v); }
  const placeholders = values.map((_, i) => `$${i + 1}`);
  return { cols, values, placeholders };
}
