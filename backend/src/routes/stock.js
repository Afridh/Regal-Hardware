import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { num, round2, pageParams, logActivity } from '../lib/util.js';
import { addStock, deductStock } from '../services/stock.js';

const r = Router();

/** Current stock listing (per item at the active location). */
r.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset, q } = pageParams(req, 500);
  const params = [req.user.company_id, req.query.location_id || req.locationId];
  const where = ['i.company_id = $1', 'i.active'];
  if (q) { params.push(`%${q}%`); where.push(`(i.code ILIKE $${params.length} OR i.barcode ILIKE $${params.length} OR i.name ILIKE $${params.length})`); }
  if (req.query.category_id) { params.push(req.query.category_id); where.push(`i.category_id = $${params.length}`); }
  if (req.query.supplier_id) { params.push(req.query.supplier_id); where.push(`i.supplier_id = $${params.length}`); }
  let having = '';
  if (req.query.filter === 'low') having = ' HAVING COALESCE(SUM(sb.qty_remain),0) <= COALESCE(MAX(sb.qty_min),0)';
  if (req.query.filter === 'zero') having = ' HAVING COALESCE(SUM(sb.qty_remain),0) <= 0';
  if (req.query.filter === 'negative') having = ' HAVING COALESCE(SUM(sb.qty_remain),0) < 0';
  if (req.query.filter === 'expiring') having = ` HAVING bool_or(sb.expiry_date IS NOT NULL AND sb.expiry_date <= CURRENT_DATE + INTERVAL '30 days' AND sb.qty_remain > 0)`;
  const core = `FROM items i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN suppliers s ON s.id = i.supplier_id
                LEFT JOIN stock_batches sb ON sb.item_id = i.id AND sb.location_id = $2 WHERE ${where.join(' AND ')}
                GROUP BY i.id, c.name, s.name${having}`;
  const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM (SELECT i.id ${core}) x`, params);
  const { rows } = await query(
    `SELECT i.id AS item_id, i.code, i.barcode, i.name, i.unit, c.name AS category_name, s.name AS supplier_name,
            COALESCE(SUM(sb.qty_remain),0) AS qty_on_hand, COALESCE(MAX(sb.qty_min),0) AS qty_min,
            -- the newest batch's prices (asked of that batch directly, so MySQL reads it the same way)
            (SELECT lb.selling_price FROM stock_batches lb WHERE lb.item_id = i.id AND lb.location_id = $2 ORDER BY lb.id DESC LIMIT 1) AS selling_price,
            (SELECT lb.cost_price FROM stock_batches lb WHERE lb.item_id = i.id AND lb.location_id = $2 ORDER BY lb.id DESC LIMIT 1) AS cost_price,
            MIN(sb.expiry_date) FILTER (WHERE sb.qty_remain > 0) AS next_expiry,
            COALESCE(SUM(sb.qty_remain * sb.cost_price),0) AS value_cost, COALESCE(SUM(sb.qty_remain * sb.selling_price),0) AS value_selling
     ${core} ORDER BY i.name LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, total: count, page, limit });
}));

/** Item ledger (bin card). */
r.get('/ledger/:itemId', asyncHandler(async (req, res) => {
  const params = [req.user.company_id, req.params.itemId]; const where = ['company_id = $1', 'item_id = $2'];
  if (req.query.location_id) { params.push(req.query.location_id); where.push(`location_id = $${params.length}`); }
  if (req.query.date_from) { params.push(req.query.date_from); where.push(`txn_date >= $${params.length}`); }
  if (req.query.date_to) { params.push(req.query.date_to); where.push(`txn_date <= $${params.length}`); }
  const { rows } = await query(`SELECT * FROM item_ledger WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`, params);
  res.json(rows);
}));

// ---------------------------------------------------------------- adjustments
r.get('/adjustments', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM stock_adjustments WHERE company_id = $1`, [req.user.company_id]);
  const { rows } = await query(`SELECT a.*, l.name AS location_name FROM stock_adjustments a JOIN locations l ON l.id = a.location_id WHERE a.company_id = $1 ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`, [req.user.company_id]);
  res.json({ data: rows, total: count, page, limit });
}));

r.get('/adjustments/:id', asyncHandler(async (req, res) => {
  const { rows: [a] } = await query(`SELECT * FROM stock_adjustments WHERE id = $1 AND company_id = $2`, [req.params.id, req.user.company_id]);
  if (!a) throw new HttpError(404, 'Not found');
  const { rows: items } = await query(`SELECT * FROM stock_adjustment_items WHERE adjustment_id = $1 ORDER BY id`, [a.id]);
  res.json({ ...a, items });
}));

r.post('/adjustments', requirePerm('qty_adjust'), asyncHandler(async (req, res) => {
  const { adj_type, reason, items = [], adj_date } = req.body || {};
  if (!['ADD', 'DEDUCT', 'DAMAGE', 'EXPIRED', 'STOCK_TAKE'].includes(adj_type)) throw new HttpError(400, 'Invalid adjustment type');
  if (!items.length) throw new HttpError(400, 'No items');
  const adj = await withTransaction(async client => {
    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,$2,'QTYA','ADJ-')`, [req.user.company_id, req.locationId]);
    const { rows: [adj] } = await client.query(
      `INSERT INTO stock_adjustments (company_id, location_id, serial_no, adj_date, adj_type, reason, created_by) VALUES ($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6,$7) RETURNING *`,
      [req.user.company_id, req.locationId, serial, adj_date || null, adj_type, reason || null, req.user.username]);
    let totalQty = 0, totalCost = 0;
    for (const raw of items) {
      const { rows: [item] } = await client.query(`SELECT * FROM items WHERE id = $1 AND company_id = $2`, [raw.item_id, req.user.company_id]);
      if (!item) throw new HttpError(400, 'Item not found');
      let qty = num(raw.qty); let direction = adj_type === 'ADD' ? 1 : -1;
      let batchId = raw.batch_id || null; let cost = num(raw.cost_price);
      if (adj_type === 'STOCK_TAKE') {
        // qty = counted physical qty ; adjust by the difference
        const { rows: [{ cur }] } = await client.query(`SELECT COALESCE(SUM(qty_remain),0) AS cur FROM stock_batches WHERE item_id = $1 AND location_id = $2`, [item.id, req.locationId]);
        const diff = round2(qty - num(cur));
        if (diff === 0) continue;
        direction = diff > 0 ? 1 : -1; qty = Math.abs(diff);
      }
      if (qty <= 0) continue;
      if (direction > 0) {
        const b = await addStock(client, { companyId: req.user.company_id, locationId: req.locationId, itemId: item.id, batchId, qty, costPrice: cost || null, sellingPrice: num(raw.selling_price) || null, txnType: 'QTYA', refNo: serial, user: req.user.username, date: adj.adj_date });
        batchId = b.id; cost = num(b.cost_price);
      } else {
        const consumed = await deductStock(client, { companyId: req.user.company_id, locationId: req.locationId, itemId: item.id, batchId, qty, txnType: 'QTYA', refNo: serial, user: req.user.username, allowNegative: true, date: adj.adj_date });
        if (consumed.length) { batchId = consumed[0].batch_id; cost = num(consumed[0].cost_price); }
        if (adj_type === 'DAMAGE' && batchId) await client.query(`UPDATE stock_batches SET damage_qty = damage_qty + $1 WHERE id = $2`, [qty, batchId]);
        if (adj_type === 'EXPIRED' && batchId) await client.query(`UPDATE stock_batches SET expired_qty = expired_qty + $1 WHERE id = $2`, [qty, batchId]);
      }
      await client.query(`INSERT INTO stock_adjustment_items (adjustment_id, item_id, batch_id, item_code, item_name, qty, cost_price) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [adj.id, item.id, batchId, item.code, item.name, direction * qty, cost]);
      totalQty += direction * qty; totalCost += direction * qty * cost;
    }
    const { rows: [u] } = await client.query(`UPDATE stock_adjustments SET total_qty = $1, total_cost = $2 WHERE id = $3 RETURNING *`, [totalQty, round2(totalCost), adj.id]);
    return u;
  });
  await logActivity(req, 'STOCK_ADJUST', 'stock_adjustments', adj.id, { type: adj_type });
  res.status(201).json(adj);
}));

// ---------------------------------------------------------------- transfers
r.get('/transfers', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM stock_transfers WHERE company_id = $1`, [req.user.company_id]);
  const { rows } = await query(
    `SELECT t.*, f.name AS from_location_name, tl.name AS to_location_name FROM stock_transfers t JOIN locations f ON f.id = t.from_location_id JOIN locations tl ON tl.id = t.to_location_id
     WHERE t.company_id = $1 ORDER BY t.id DESC LIMIT ${limit} OFFSET ${offset}`, [req.user.company_id]);
  res.json({ data: rows, total: count, page, limit });
}));

r.get('/transfers/:id', asyncHandler(async (req, res) => {
  const { rows: [t] } = await query(`SELECT * FROM stock_transfers WHERE id = $1 AND company_id = $2`, [req.params.id, req.user.company_id]);
  if (!t) throw new HttpError(404, 'Not found');
  const { rows: items } = await query(`SELECT * FROM stock_transfer_items WHERE transfer_id = $1 ORDER BY id`, [t.id]);
  res.json({ ...t, items });
}));

/** Send: deducts from the source location immediately; receiving adds to destination. */
r.post('/transfers', requirePerm('stock_transfer'), asyncHandler(async (req, res) => {
  const { to_location_id, items = [], remark } = req.body || {};
  const from = req.locationId;
  if (!to_location_id || Number(to_location_id) === Number(from)) throw new HttpError(400, 'Choose a different destination location');
  if (!items.length) throw new HttpError(400, 'No items');
  const t = await withTransaction(async client => {
    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,NULL,'TRF','TRF-')`, [req.user.company_id]);
    const { rows: [t] } = await client.query(
      `INSERT INTO stock_transfers (company_id, serial_no, from_location_id, to_location_id, remark, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.company_id, serial, from, to_location_id, remark || null, req.user.username]);
    let total = 0;
    for (const raw of items) {
      const { rows: [item] } = await client.query(`SELECT * FROM items WHERE id = $1 AND company_id = $2`, [raw.item_id, req.user.company_id]);
      if (!item) throw new HttpError(400, 'Item not found');
      const qty = num(raw.qty); if (qty <= 0) continue;
      const consumed = await deductStock(client, { companyId: req.user.company_id, locationId: from, itemId: item.id, batchId: raw.batch_id || null, qty, txnType: 'TRF', refNo: serial, user: req.user.username });
      for (const c of consumed) {
        const { rows: [b] } = await client.query(`SELECT selling_price FROM stock_batches WHERE id = $1`, [c.batch_id]);
        await client.query(`INSERT INTO stock_transfer_items (transfer_id, item_id, from_batch_id, item_code, item_name, qty, cost_price, selling_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [t.id, item.id, c.batch_id, item.code, item.name, c.qty, c.cost_price, b?.selling_price || 0]);
      }
      total += qty;
    }
    const { rows: [u] } = await client.query(`UPDATE stock_transfers SET total_qty = $1 WHERE id = $2 RETURNING *`, [total, t.id]);
    return u;
  });
  await logActivity(req, 'STOCK_TRANSFER', 'stock_transfers', t.id);
  res.status(201).json(t);
}));

r.post('/transfers/:id/receive', requirePerm('stock_transfer'), asyncHandler(async (req, res) => {
  const t = await withTransaction(async client => {
    const { rows: [t] } = await client.query(`SELECT * FROM stock_transfers WHERE id = $1 AND company_id = $2 FOR UPDATE`, [req.params.id, req.user.company_id]);
    if (!t) throw new HttpError(404, 'Not found');
    if (t.status !== 'SENT') throw new HttpError(400, `Transfer is ${t.status}`);
    const { rows: items } = await client.query(`SELECT * FROM stock_transfer_items WHERE transfer_id = $1`, [t.id]);
    for (const it of items) {
      await addStock(client, { companyId: req.user.company_id, locationId: t.to_location_id, itemId: it.item_id, qty: it.qty, costPrice: it.cost_price, sellingPrice: it.selling_price, txnType: 'TRF', refNo: t.serial_no, user: req.user.username });
    }
    const { rows: [u] } = await client.query(`UPDATE stock_transfers SET status = 'RECEIVED', received_by = $1, received_at = now() WHERE id = $2 RETURNING *`, [req.user.username, t.id]);
    return u;
  });
  res.json(t);
}));

r.post('/transfers/:id/cancel', requirePerm('stock_transfer'), asyncHandler(async (req, res) => {
  const t = await withTransaction(async client => {
    const { rows: [t] } = await client.query(`SELECT * FROM stock_transfers WHERE id = $1 AND company_id = $2 FOR UPDATE`, [req.params.id, req.user.company_id]);
    if (!t) throw new HttpError(404, 'Not found');
    if (t.status !== 'SENT') throw new HttpError(400, `Transfer is ${t.status}`);
    const { rows: items } = await client.query(`SELECT * FROM stock_transfer_items WHERE transfer_id = $1`, [t.id]);
    for (const it of items) {
      await addStock(client, { companyId: req.user.company_id, locationId: t.from_location_id, itemId: it.item_id, batchId: it.from_batch_id, qty: it.qty, txnType: 'CANCEL', refNo: t.serial_no, user: req.user.username });
    }
    const { rows: [u] } = await client.query(`UPDATE stock_transfers SET status = 'CANCELLED' WHERE id = $1 RETURNING *`, [t.id]);
    return u;
  });
  res.json(t);
}));

export default r;
