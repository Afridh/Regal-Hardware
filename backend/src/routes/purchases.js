import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { num, round2, pageParams, logActivity } from '../lib/util.js';
import { addStock, deductStock } from '../services/stock.js';

const r = Router();

async function loadPurchase(id, companyId) {
  const { rows: [p] } = await query(
    `SELECT p.*, s.mobile AS sup_mobile, s.due_amount AS sup_due_amount, l.name AS location_name FROM purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN locations l ON l.id = p.location_id WHERE p.id = $1 AND p.company_id = $2`, [id, companyId]);
  if (!p) return null;
  const { rows: items } = await query(`SELECT * FROM purchase_items WHERE purchase_id = $1 ORDER BY line_no`, [id]);
  return { ...p, items };
}

// ---------------------------------------------------------------- GRN list / get
r.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset, q } = pageParams(req);
  const where = ['p.company_id = $1']; const params = [req.user.company_id];
  const add = (sql, v) => { params.push(v); where.push(sql + '$' + params.length); };
  if (req.query.date_from) add('p.purchase_date >= ', req.query.date_from);
  if (req.query.date_to) add('p.purchase_date <= ', req.query.date_to);
  if (req.query.supplier_id) add('p.supplier_id = ', req.query.supplier_id);
  if (req.query.status) add('p.invoice_status = ', req.query.status);
  if (req.query.order_status) add('p.order_status = ', req.query.order_status);
  if (req.query.inv_mode) add('p.inv_mode = ', req.query.inv_mode);
  if (q) { params.push(`%${q}%`); where.push(`(p.serial_no ILIKE $${params.length} OR p.invoice_no ILIKE $${params.length} OR p.supplier_name ILIKE $${params.length})`); }
  const wsql = ' WHERE ' + where.join(' AND ');
  const { rows: [{ count, sum_net, sum_due }] } = await query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(net_total),0) AS sum_net, COALESCE(SUM(due_amount),0) AS sum_due FROM purchases p${wsql}`, params);
  const { rows } = await query(`SELECT p.* FROM purchases p${wsql} ORDER BY p.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, page, limit, total: count, sum_net, sum_due });
}));

r.get('/orders', asyncHandler(async (req, res) => {
  const { page, limit, offset, q } = pageParams(req);
  const params = [req.user.company_id]; const where = ['po.company_id = $1'];
  if (q) { params.push(`%${q}%`); where.push(`(po.serial_no ILIKE $${params.length} OR po.supplier_name ILIKE $${params.length})`); }
  if (req.query.status) { params.push(req.query.status); where.push(`po.status = $${params.length}`); }
  const wsql = ' WHERE ' + where.join(' AND ');
  const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM purchase_orders po${wsql}`, params);
  const { rows } = await query(`SELECT po.* FROM purchase_orders po${wsql} ORDER BY po.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, total: count, page, limit });
}));

r.get('/orders/:id', asyncHandler(async (req, res) => {
  const { rows: [po] } = await query(`SELECT * FROM purchase_orders WHERE id = $1 AND company_id = $2`, [req.params.id, req.user.company_id]);
  if (!po) throw new HttpError(404, 'PO not found');
  const { rows: items } = await query(`SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY line_no`, [po.id]);
  res.json({ ...po, items });
}));

/** Suggested reorder list: items at/below reorder level. */
r.get('/reorder-suggestions', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT i.id AS item_id, i.code, i.name, i.supplier_id, s.name AS supplier_name, SUM(sb.qty_remain) AS qty_on_hand, MAX(sb.qty_min) AS qty_min, MAX(sb.qty_max) AS qty_max, MAX(sb.cost_price) AS cost_price
     FROM items i JOIN stock_batches sb ON sb.item_id = i.id AND sb.location_id = $2 LEFT JOIN suppliers s ON s.id = i.supplier_id
     WHERE i.company_id = $1 AND i.active AND i.remind_reorder
     GROUP BY i.id, s.name HAVING SUM(sb.qty_remain) <= MAX(sb.qty_min) ORDER BY i.name`, [req.user.company_id, req.locationId]);
  res.json(rows);
}));

r.get('/:id', asyncHandler(async (req, res) => {
  const p = await loadPurchase(req.params.id, req.user.company_id);
  if (!p) throw new HttpError(404, 'Purchase not found');
  res.json(p);
}));

// ---------------------------------------------------------------- create GRN
r.post('/', requirePerm('purchase'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, 'No items');
  const p = await withTransaction(async client => {
    const { rows: [sup] } = await client.query(`SELECT * FROM suppliers WHERE id = $1 AND company_id = $2 FOR UPDATE`, [body.supplier_id, req.user.company_id]);
    if (!sup) throw new HttpError(400, 'Supplier required');

    let gross = 0, itemDisc = 0, qtyTot = 0; const lines = []; let n = 0;
    for (const raw of body.items) {
      const { rows: [item] } = await client.query(`SELECT * FROM items WHERE id = $1 AND company_id = $2`, [raw.item_id, req.user.company_id]);
      if (!item) throw new HttpError(400, `Item ${raw.item_id} not found`);
      const qty = num(raw.qty), free = num(raw.free_qty), cost = num(raw.cost_price), disc = round2(raw.discount);
      if (qty <= 0 && free <= 0) throw new HttpError(400, `Invalid qty for ${item.name}`);
      const sell = num(raw.selling_price);
      if (sell > 0 && sell < cost && !body.allow_under_cost) throw new HttpError(400, `${item.name}: selling price below cost`);
      const lineTotal = round2(qty * cost - disc);
      gross += qty * cost; itemDisc += disc; qtyTot += qty + free;
      lines.push({ line_no: ++n, item, qty, free, cost, sell, ws: num(raw.wholesale_price) || sell, mrp: num(raw.mrp) || sell, discount_price: num(raw.discount_price) || sell,
        disc, lineTotal, expiry: raw.expiry_date || null, warranty: num(raw.warranty_months) || item.warranty_months || 0, newBatch: !!raw.new_batch });
    }
    const billDisc = round2(body.bill_discount), extra = round2(body.extra_charges);
    const net = round2(gross - itemDisc - billDisc + extra);
    const paid = Math.min(round2(body.paid_amount), net);
    const due = round2(net - paid);
    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,$2,'PCH','PCH-')`, [req.user.company_id, req.locationId]);
    const { rows: [p] } = await client.query(
      `INSERT INTO purchases (company_id, location_id, serial_no, invoice_no, purchase_date, supplier_id, supplier_name, pay_mode, order_status, gross_total, item_discount, bill_discount, extra_charges,
         net_total, total_qty, paid_amount, due_amount, due_date, remark, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [req.user.company_id, req.locationId, serial, body.invoice_no || null, body.purchase_date || null, sup.id, sup.name, body.pay_mode || (due > 0 ? 'CREDIT' : 'CASH'),
        due <= 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID', round2(gross), round2(itemDisc), billDisc, extra, net, qtyTot, paid, due, body.due_date || null, body.remark || null, req.user.username]);

    for (const l of lines) {
      let batchId = null;
      if (l.item.track_inventory && l.item.item_type === 'STOCK') {
        const b = await addStock(client, {
          companyId: req.user.company_id, locationId: req.locationId, itemId: l.item.id, qty: l.qty + l.free, costPrice: l.cost,
          sellingPrice: l.sell || null, discountPrice: l.discount_price || null, wholesalePrice: l.ws || null, mrp: l.mrp || null, expiryDate: l.expiry, warrantyMonths: l.warranty,
          txnType: 'PCH', refNo: serial, user: req.user.username, newBatch: l.newBatch, date: p.purchase_date,
        });
        batchId = b.id;
        if (l.free > 0) await client.query(`UPDATE stock_batches SET free_qty = free_qty + $1 WHERE id = $2`, [l.free, b.id]);
      }
      await client.query(
        `INSERT INTO purchase_items (purchase_id, line_no, item_id, batch_id, item_code, item_name, unit, qty, free_qty, cost_price, selling_price, wholesale_price, mrp, discount, line_total, expiry_date, warranty_months)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [p.id, l.line_no, l.item.id, batchId, l.item.code, l.item.name, l.item.unit, l.qty, l.free, l.cost, l.sell, l.ws, l.mrp, l.disc, l.lineTotal, l.expiry, l.warranty]);
    }
    await client.query(`UPDATE suppliers SET due_amount = due_amount + $1 WHERE id = $2`, [due, sup.id]);
    if (paid > 0 && body.pay_type === 'BANK' && body.bank_id) {
      const { rows: [{ next_serial: bs }] } = await client.query(`SELECT next_serial($1,NULL,'BNK','BNK-')`, [req.user.company_id]);
      await client.query(`INSERT INTO bank_transactions (company_id, location_id, bank_id, serial_no, txn_date, txn_type, amount, description, source, source_id, created_by)
                          VALUES ($1,$2,$3,$4,$5,'WITHDRAW',$6,$7,'PCH',$8,$9)`, [req.user.company_id, req.locationId, body.bank_id, bs, p.purchase_date, paid, `GRN ${serial}`, p.id, req.user.username]);
    }
    if (paid > 0 && body.pay_type === 'CHEQUE') {
      await client.query(`INSERT INTO cheques (company_id, location_id, cheque_no, cheque_date, bank_name, amount, direction, party_type, party_id, party_name, source, source_id, created_by)
                          VALUES ($1,$2,$3,$4,$5,$6,'OUT','SUP',$7,$8,'PCH',$9,$10)`,
        [req.user.company_id, req.locationId, body.cheque_no || '-', body.cheque_date || null, body.cheque_bank || null, paid, sup.id, sup.name, p.id, req.user.username]);
    }
    if (body.po_id) await client.query(`UPDATE purchase_orders SET status = 'RECEIVED' WHERE id = $1 AND company_id = $2`, [body.po_id, req.user.company_id]);
    return p;
  });
  await logActivity(req, 'CREATE_GRN', 'purchases', p.id, { serial: p.serial_no, net: p.net_total });
  res.status(201).json(await loadPurchase(p.id, req.user.company_id));
}));

// ---------------------------------------------------------------- cancel GRN
r.post('/:id/cancel', requirePerm('cancel_purchase'), asyncHandler(async (req, res) => {
  const p = await withTransaction(async client => {
    const { rows: [p] } = await client.query(`SELECT * FROM purchases WHERE id = $1 AND company_id = $2 FOR UPDATE`, [req.params.id, req.user.company_id]);
    if (!p) throw new HttpError(404, 'Purchase not found');
    if (p.invoice_status === 'CANCELLED') throw new HttpError(400, 'Already cancelled');
    if (p.paid_amount > 0 && p.paid_amount !== p.net_total - p.due_amount) throw new HttpError(400, 'Reverse supplier payments before cancelling');
    const { rows: items } = await client.query(`SELECT pi.*, i.track_inventory, i.item_type FROM purchase_items pi JOIN items i ON i.id = pi.item_id WHERE purchase_id = $1`, [p.id]);
    for (const it of items) {
      if (!it.track_inventory || it.item_type !== 'STOCK') continue;
      const qty = num(it.qty) + num(it.free_qty);
      if (p.inv_mode === 'RET') await addStock(client, { companyId: req.user.company_id, locationId: p.location_id, itemId: it.item_id, batchId: it.batch_id, qty, costPrice: it.cost_price, txnType: 'CANCEL', refNo: p.serial_no, user: req.user.username });
      else await deductStock(client, { companyId: req.user.company_id, locationId: p.location_id, itemId: it.item_id, batchId: it.batch_id, qty, txnType: 'CANCEL', refNo: p.serial_no, user: req.user.username, allowNegative: true });
    }
    await client.query(`UPDATE suppliers SET due_amount = due_amount - $1 WHERE id = $2`, [(p.inv_mode === 'RET' ? -1 : 1) * num(p.due_amount), p.supplier_id]);
    await client.query(`DELETE FROM bank_transactions WHERE source = 'PCH' AND source_id = $1`, [p.id]);
    await client.query(`UPDATE cheques SET status = 'CANCELLED' WHERE source = 'PCH' AND source_id = $1`, [p.id]);
    const { rows: [u] } = await client.query(`UPDATE purchases SET invoice_status = 'CANCELLED', due_amount = 0, cancelled_by = $1, cancelled_at = now() WHERE id = $2 RETURNING *`, [req.user.username, p.id]);
    return u;
  });
  await logActivity(req, 'CANCEL_GRN', 'purchases', p.id);
  res.json(p);
}));

// ---------------------------------------------------------------- purchase return
r.post('/:id/return', requirePerm('purchase_return'), asyncHandler(async (req, res) => {
  const { items = [], reason } = req.body || {};
  const ret = await withTransaction(async client => {
    const { rows: [orig] } = await client.query(`SELECT * FROM purchases WHERE id = $1 AND company_id = $2 AND invoice_status = 'PRINTED' FOR UPDATE`, [req.params.id, req.user.company_id]);
    if (!orig) throw new HttpError(404, 'Purchase not found');
    const { rows: origItems } = await client.query(`SELECT pi.*, i.track_inventory, i.item_type FROM purchase_items pi JOIN items i ON i.id = pi.item_id WHERE purchase_id = $1`, [orig.id]);
    let net = 0, qtyTot = 0; const lines = [];
    for (const rq of items) {
      const oi = origItems.find(o => o.id === Number(rq.purchase_item_id));
      const qty = num(rq.qty);
      if (!oi || qty <= 0 || qty > num(oi.qty)) throw new HttpError(400, 'Invalid return line');
      const lineTotal = round2(qty * num(oi.cost_price));
      net += lineTotal; qtyTot += qty; lines.push({ oi, qty, lineTotal });
    }
    if (!lines.length) throw new HttpError(400, 'Nothing to return');
    net = round2(net);
    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,$2,'PCHR','PRT-')`, [req.user.company_id, req.locationId]);
    const { rows: [ret] } = await client.query(
      `INSERT INTO purchases (company_id, location_id, serial_no, invoice_no, inv_mode, supplier_id, supplier_name, pay_mode, order_status, gross_total, net_total, total_qty, paid_amount, due_amount, remark, created_by)
       VALUES ($1,$2,$3,$3,'RET',$4,$5,'CREDIT','PAID',$6,$6,$7,0,$6,$8,$9) RETURNING *`,
      [req.user.company_id, req.locationId, serial, orig.supplier_id, orig.supplier_name, net, qtyTot, `RETURN OF ${orig.serial_no}${reason ? ' - ' + reason : ''}`, req.user.username]);
    let n = 0;
    for (const { oi, qty, lineTotal } of lines) {
      await client.query(`INSERT INTO purchase_items (purchase_id, line_no, item_id, batch_id, item_code, item_name, unit, qty, cost_price, selling_price, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [ret.id, ++n, oi.item_id, oi.batch_id, oi.item_code, oi.item_name, oi.unit, qty, oi.cost_price, oi.selling_price, lineTotal]);
      if (oi.track_inventory && oi.item_type === 'STOCK') {
        await deductStock(client, { companyId: req.user.company_id, locationId: orig.location_id, itemId: oi.item_id, batchId: oi.batch_id, qty, txnType: 'PCHR', refNo: serial, user: req.user.username, allowNegative: true });
      }
    }
    // a purchase return reduces what we owe the supplier
    await client.query(`UPDATE suppliers SET due_amount = due_amount - $1 WHERE id = $2`, [net, orig.supplier_id]);
    return ret;
  });
  await logActivity(req, 'PURCHASE_RETURN', 'purchases', ret.id);
  res.status(201).json(await loadPurchase(ret.id, req.user.company_id));
}));

// ---------------------------------------------------------------- purchase orders
r.post('/orders', requirePerm('purchase_order'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, 'No items');
  const po = await withTransaction(async client => {
    const { rows: [sup] } = await client.query(`SELECT * FROM suppliers WHERE id = $1 AND company_id = $2`, [body.supplier_id, req.user.company_id]);
    if (!sup) throw new HttpError(400, 'Supplier required');
    let net = 0, qtyTot = 0; const lines = []; let n = 0;
    for (const raw of body.items) {
      const { rows: [item] } = await client.query(`SELECT id, code, name FROM items WHERE id = $1 AND company_id = $2`, [raw.item_id, req.user.company_id]);
      if (!item) throw new HttpError(400, 'Item not found');
      const qty = num(raw.qty), cost = num(raw.cost_price); const lt = round2(qty * cost);
      net += lt; qtyTot += qty; lines.push({ n: ++n, item, qty, cost, lt });
    }
    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,$2,'PO','PO-')`, [req.user.company_id, req.locationId]);
    const { rows: [po] } = await client.query(
      `INSERT INTO purchase_orders (company_id, location_id, serial_no, supplier_id, supplier_name, expected_date, net_total, total_qty, remark, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.company_id, req.locationId, serial, sup.id, sup.name, body.expected_date || null, round2(net), qtyTot, body.remark || null, req.user.username]);
    for (const l of lines) {
      await client.query(`INSERT INTO purchase_order_items (po_id, line_no, item_id, item_code, item_name, qty, cost_price, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [po.id, l.n, l.item.id, l.item.code, l.item.name, l.qty, l.cost, l.lt]);
    }
    return po;
  });
  await logActivity(req, 'CREATE_PO', 'purchase_orders', po.id);
  res.status(201).json(po);
}));

r.put('/orders/:id/status', requirePerm('purchase_order'), asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!['OPEN', 'RECEIVED', 'CANCELLED'].includes(status)) throw new HttpError(400, 'Invalid status');
  const { rows: [po] } = await query(`UPDATE purchase_orders SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING *`, [status, req.params.id, req.user.company_id]);
  if (!po) throw new HttpError(404, 'PO not found');
  res.json(po);
}));

export default r;
