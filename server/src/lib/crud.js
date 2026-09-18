import { Router } from 'express';
import { query } from '../db.js';
import { HttpError, asyncHandler } from './errors.js';
import { requirePerm } from '../middleware/auth.js';
import { pageParams, buildInsert, buildUpdate, logActivity } from './util.js';

/**
 * Generic company-scoped CRUD router.
 *
 * opts = {
 *   table, columns (writable), searchColumns, orderBy,
 *   perms: { create, update, delete },      // permission keys (optional)
 *   codeKey: 'INV' (auto code via sequences if body.code missing),
 *   codePrefix: 'CUS',
 *   selectSql: custom list select (must alias base table as t),
 *   softDelete: true -> sets active=false instead of DELETE
 *   filters: { category_id: 't.category_id = $' }  // extra ?query params
 * }
 */
export function crudRouter(opts) {
  const r = Router();
  const {
    table, columns, searchColumns = ['name'], orderBy = 't.id DESC',
    perms = {}, codeKey, codePrefix, selectSql, softDelete = true, filters = {}, scoped = true,
  } = opts;

  const base = selectSql || `SELECT t.* FROM ${table} t`;
  const scope = scoped ? 't.company_id = $1' : 'TRUE';

  // LIST
  r.get('/', asyncHandler(async (req, res) => {
    const { page, limit, offset, q } = pageParams(req);
    const where = [scope]; const params = [req.user.company_id];
    if (q) {
      params.push(`%${q}%`);
      where.push('(' + searchColumns.map(c => `${c.includes('.') ? c : 't.' + c}::text ILIKE $${params.length}`).join(' OR ') + ')');
    }
    if (req.query.active === 'true') where.push('t.active = TRUE');
    if (req.query.active === 'false') where.push('t.active = FALSE');
    for (const [key, sql] of Object.entries(filters)) {
      if (req.query[key] !== undefined && req.query[key] !== '') { params.push(req.query[key]); where.push(sql + params.length); }
    }
    const wsql = ' WHERE ' + where.join(' AND ');
    const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM ${table} t${wsql}`, params);
    const { rows } = await query(`${base}${wsql} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows, page, limit, total: count });
  }));

  // GET ONE
  r.get('/:id', asyncHandler(async (req, res) => {
    const { rows: [row] } = await query(`${base} WHERE ${scope} AND t.id = $2`, [req.user.company_id, req.params.id]);
    if (!row) throw new HttpError(404, 'Not found');
    res.json(row);
  }));

  // CREATE
  const guardCreate = perms.create ? [requirePerm(perms.create)] : [];
  r.post('/', ...guardCreate, asyncHandler(async (req, res) => {
    const body = { ...req.body };
    if (codeKey && (!body.code || !String(body.code).trim())) {
      const { rows: [{ next_serial }] } = await query(`SELECT next_serial($1, NULL, $2, $3)`, [req.user.company_id, codeKey, codePrefix || (codeKey + '-')]);
      body.code = next_serial;
    }
    const extra = scoped ? { company_id: req.user.company_id } : {};
    if (columns.includes('created_by')) extra.created_by = req.user.username;
    const { cols, values, placeholders } = buildInsert(body, columns.filter(c => c !== 'created_by'), extra);
    if (!cols.length) throw new HttpError(400, 'No data');
    const { rows: [row] } = await query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`, values);
    await logActivity(req, 'CREATE', table, row.id);
    res.status(201).json(row);
  }));

  // UPDATE
  const guardUpdate = perms.update ? [requirePerm(perms.update)] : [];
  r.put('/:id', ...guardUpdate, asyncHandler(async (req, res) => {
    const { sets, values } = buildUpdate(req.body, columns.filter(c => c !== 'created_by' && c !== 'updated_at'), 3);
    if (!sets.length) throw new HttpError(400, 'No data');
    if (columns.includes('updated_at')) sets.push('updated_at = now()');
    const { rows: [row] } = await query(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE ${scoped ? 'company_id = $1' : 'TRUE'} AND id = $2 RETURNING *`,
      [req.user.company_id, req.params.id, ...values]);
    if (!row) throw new HttpError(404, 'Not found');
    await logActivity(req, 'UPDATE', table, row.id);
    res.json(row);
  }));

  // DELETE
  const guardDelete = perms.delete ? [requirePerm(perms.delete)] : [];
  r.delete('/:id', ...guardDelete, asyncHandler(async (req, res) => {
    const sql = softDelete
      ? `UPDATE ${table} SET active = FALSE WHERE ${scoped ? 'company_id = $1' : 'TRUE'} AND id = $2 RETURNING id`
      : `DELETE FROM ${table} WHERE ${scoped ? 'company_id = $1' : 'TRUE'} AND id = $2 RETURNING id`;
    const { rows: [row] } = await query(sql, [req.user.company_id, req.params.id]);
    if (!row) throw new HttpError(404, 'Not found');
    await logActivity(req, softDelete ? 'DEACTIVATE' : 'DELETE', table, row.id);
    res.json({ ok: true });
  }));

  return r;
}
