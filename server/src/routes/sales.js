import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { requirePerm, hasPermission } from '../middleware/auth.js';
import { num, round2, pageParams, logActivity } from '../lib/util.js';
import { deductStock, restoreStock } from '../services/stock.js';
import { getSetting } from '../services/settings.js';
import { queueSms, renderTemplate } from '../services/sms.js';

const r = Router();

const PAY_TYPES = ['CASH', 'CARD', 'CHEQUE', 'BANK', 'CREDIT', 'VOUCHER', 'POINTS'];

/** Resolve unit price for a batch according to price type / customer category. */
function priceFor(batch, priceType, cusPriceCategory) {
  if (!batch) return 0;
  if (priceType === 'WHOLESALE' && num(batch.wholesale_price) > 0) return num(batch.wholesale_price);
  if (priceType === 'OFFER' && num(batch.offer_price) > 0) return num(batch.offer_price);
  if (priceType === 'CUSCAT' && cusPriceCategory > 0 && Array.isArray(batch.cus_cat_price) && num(batch.cus_cat_price[cusPriceCategory - 1]) > 0) {
    return num(batch.cus_cat_price[cusPriceCategory - 1]);
  }
  return num(batch.selling_price);
}

/** Validate + price the cart lines. Returns enriched lines and totals. */
async function buildLines(client, req, items, customer) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Invoice has no items');
  const lines = []; let gross = 0, itemDiscount = 0, costTotal = 0, totalQty = 0;
  let lineNo = 0;
  for (const raw of items) {
    const { rows: [item] } = await client.query(`SELECT * FROM items WHERE id = $1 AND company_id = $2 AND active`, [raw.item_id, req.user.company_id]);
    if (!item) throw new HttpError(400, `Item ${raw.item_id} not found`);
    let batch = null;
    if (raw.batch_id) ({ rows: [batch] } = await client.query(`SELECT * FROM stock_batches WHERE id = $1 AND item_id = $2`, [raw.batch_id, item.id]));
    if (!batch) ({ rows: [batch] } = await client.query(`SELECT * FROM stock_batches WHERE item_id = $1 AND location_id = $2 ORDER BY (qty_remain > 0) DESC, id LIMIT 1`, [item.id, req.locationId]));

    const qty = num(raw.qty);
    if (qty <= 0) throw new HttpError(400, `Invalid qty for ${item.name}`);
    if (!item.allow_decimal && !Number.isInteger(qty)) throw new HttpError(400, `${item.name} does not allow decimal quantity`);

    const priceType = raw.price_type || (customer?.category === 'WHOLESALE' ? 'WHOLESALE' : customer?.price_category > 0 ? 'CUSCAT' : 'RETAIL');
    const listPrice = num(batch?.selling_price);
    let unitPrice = raw.unit_price !== undefined && raw.unit_price !== null && raw.unit_price !== '' ? num(raw.unit_price) : priceFor(batch, priceType, customer?.price_category || 0);
    if (unitPrice !== priceFor(batch, priceType, customer?.price_category || 0) && !item.allow_edit_price_on_invoice && !hasPermission(req.user, 'price_change')) {
      throw new HttpError(403, `Price change not allowed for ${item.name}`);
    }
    if (batch && num(batch.discount_price) > 0 && unitPrice < num(batch.discount_price) && !hasPermission(req.user, 'price_change')) {
      throw new HttpError(403, `${item.name}: price below minimum (${batch.discount_price})`);
    }
    const discount = round2(raw.discount);
    if (discount > 0 && !item.allow_discount) throw new HttpError(400, `${item.name} does not allow discounts`);
    const lineTotal = round2(qty * unitPrice - discount);
    const cost = num(batch?.avg_cost || batch?.cost_price);

    gross += qty * listPrice;
    itemDiscount += qty * listPrice - lineTotal;
    costTotal += qty * cost;
    totalQty += qty;
    lines.push({
      line_no: ++lineNo, item, batch, item_id: item.id, batch_id: batch?.id || null, item_code: item.code, item_name: item.name, unit: item.unit,
      qty, cost_price: cost, selling_price: listPrice, unit_price: unitPrice, discount, line_total: lineTotal, price_type: priceType,
      warranty: raw.warranty || (item.warranty_months ? `${item.warranty_months} months` : null), serial_nos: raw.serial_nos || null, remark: raw.remark || null,
    });
  }
  return { lines, gross: round2(gross), itemDiscount: round2(itemDiscount), costTotal: round2(costTotal), totalQty };
}

async function loadInvoice(id, companyId) {
  const { rows: [inv] } = await query(
    `SELECT i.*, c.mobile AS cus_mobile, c.due_amount AS cus_due_amount, e.name AS salesman_name, l.name AS location_name, t.name AS terminal_name
     FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN employees e ON e.id = i.salesman_id
     LEFT JOIN locations l ON l.id = i.location_id LEFT JOIN terminals t ON t.id = i.terminal_id
     WHERE i.id = $1 AND i.company_id = $2`, [id, companyId]);
  if (!inv) return null;
  const { rows: items } = await query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY line_no`, [id]);
  const { rows: payments } = await query(`SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY id`, [id]);
  return { ...inv, items, payments };
}

// ---------------------------------------------------------------- list
r.get('/invoices', asyncHandler(async (req, res) => {
  const { page, limit, offset, q } = pageParams(req);
  const where = ['i.company_id = $1']; const params = [req.user.company_id];
  const add = (sql, v) => { params.push(v); where.push(sql + '$' + params.length); };
  if (req.query.date_from) add('i.invoice_date >= ', req.query.date_from);
  if (req.query.date_to) add('i.invoice_date <= ', req.query.date_to);
  if (req.query.customer_id) add('i.customer_id = ', req.query.customer_id);
  if (req.query.status) add('i.invoice_status = ', req.query.status);
  if (req.query.order_status) add('i.order_status = ', req.query.order_status);
  if (req.query.inv_mode) add('i.inv_mode = ', req.query.inv_mode);
  if (req.query.location_id) add('i.location_id = ', req.query.location_id);
  if (q) { params.push(`%${q}%`); where.push(`(i.serial_no ILIKE $${params.length} OR i.invoice_no ILIKE $${params.length} OR i.customer_name ILIKE $${params.length})`); }
  const wsql = ' WHERE ' + where.join(' AND ');
  const { rows: [{ count, sum_net, sum_due }] } = await query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(net_total),0) AS sum_net, COALESCE(SUM(due_amount),0) AS sum_due FROM invoices i${wsql}`, params);
  const { rows } = await query(
    `SELECT i.id, i.serial_no, i.invoice_no, i.invoice_date, i.invoice_time, i.inv_mode, i.customer_name, i.pay_mode, i.invoice_status, i.order_status,
            i.net_total, i.total_paid, i.due_amount, i.total_qty, i.total_lines, i.created_by, i.profit
     FROM invoices i${wsql} ORDER BY i.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, page, limit, total: count, sum_net, sum_due });
}));

r.get('/invoices/held', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT id, serial_no, customer_name, net_total, total_qty, created_by, created_at, remark FROM invoices WHERE company_id = $1 AND invoice_status = 'HOLD' AND location_id = $2 ORDER BY id DESC`,
    [req.user.company_id, req.locationId]);
  res.json(rows);
}));

r.get('/invoices/:id', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req.params.id, req.user.company_id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  res.json(inv);
}));

// ---------------------------------------------------------------- create (POS)
r.post('/invoices', requirePerm('invoice'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const isHold = body.status === 'HOLD';
  if (isHold && !hasPermission(req.user, 'hold_invoice')) throw new HttpError(403, 'Hold invoice not allowed');

  const invoiceSettings = await getSetting(req.user.company_id, 'invoice', {});
  const loyalty = await getSetting(req.user.company_id, 'loyalty', { enabled: false });

  const result = await withTransaction(async client => {
    let customer = null;
    if (body.customer_id) {
      ({ rows: [customer] } = await client.query(`SELECT * FROM customers WHERE id = $1 AND company_id = $2 FOR UPDATE`, [body.customer_id, req.user.company_id]));
      if (!customer) throw new HttpError(400, 'Customer not found');
    }
    const { lines, gross, itemDiscount, costTotal, totalQty } = await buildLines(client, req, body.items, customer);

    const billDiscount = round2(body.bill_discount);
    if (billDiscount > 0 && !hasPermission(req.user, 'cash_discount') && !body.discount_approved_by) throw new HttpError(403, 'Bill discount requires approval');
    const extra = round2(body.extra_charges);
    const net = round2(gross - itemDiscount - billDiscount + extra);
    if (net < 0) throw new HttpError(400, 'Net total cannot be negative');
    const profit = round2(net - costTotal);

    // ---- payments
    const payments = isHold ? [] : (Array.isArray(body.payments) ? body.payments : []);
    let cash = 0, card = 0, cheque = 0, bank = 0, voucher = 0, points = 0, credit = 0;
    for (const p of payments) {
      const amt = round2(p.amount);
      if (!PAY_TYPES.includes(p.pay_type) || amt <= 0) continue;
      if (p.pay_type === 'CASH') cash += amt;
      else if (p.pay_type === 'CARD') card += amt;
      else if (p.pay_type === 'CHEQUE') cheque += amt;
      else if (p.pay_type === 'BANK') bank += amt;
      else if (p.pay_type === 'VOUCHER') voucher += amt;
      else if (p.pay_type === 'POINTS') points += amt;
      else if (p.pay_type === 'CREDIT') credit += amt;
    }
    if (points > 0) {
      if (!customer) throw new HttpError(400, 'Points redemption requires a customer');
      const pointsValue = num(customer.loyalty_points) * num(loyalty.currency_per_point || 1);
      if (points > pointsValue + 0.001) throw new HttpError(400, `Customer only has ${customer.loyalty_points} points`);
    }
    let paid = round2(cash + card + cheque + bank + voucher + points);
    let due = 0, change = 0, orderStatus = 'PAID', payMode = 'CASH';
    if (!isHold) {
      if (paid >= net) { change = round2(paid - net); cash = round2(cash - change); paid = net; credit = 0; }
      else {
        due = round2(net - paid);
        if (!customer || customer.code === 'CUS000') throw new HttpError(400, `Payment short by ${due}. Select a customer for credit sales.`);
        if (!hasPermission(req.user, 'credit_sales')) throw new HttpError(403, 'Credit sales not allowed');
        if (num(customer.credit_limit) > 0 && num(customer.due_amount) + due > num(customer.credit_limit)) throw new HttpError(400, `Credit limit exceeded (limit ${customer.credit_limit}, current due ${customer.due_amount})`);
        credit = due; orderStatus = paid > 0 ? 'PARTIAL' : 'UNPAID';
      }
      const kinds = [['CASH', cash], ['CARD', card], ['CHEQUE', cheque], ['BANK', bank], ['CREDIT', credit], ['VOUCHER', voucher], ['POINTS', points]].filter(([, v]) => v > 0);
      payMode = kinds.length === 1 ? kinds[0][0] : kinds.length > 1 ? 'MULTI' : 'CASH';
    }

    const pointsEarned = (!isHold && loyalty.enabled && customer && customer.code !== 'CUS000')
      ? round2(lines.filter(l => l.item.allow_loyalty).reduce((s, l) => s + l.line_total, 0) * num(loyalty.points_per_currency))
      : 0;

    // ---- header
    const key = body.inv_mode === 'RET' ? 'INVR' : 'INV';
    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,$2,$3,$4)`, [req.user.company_id, req.locationId, key, key + '-']);
    const { rows: [inv] } = await client.query(
      `INSERT INTO invoices (company_id, location_id, terminal_id, serial_no, invoice_no, invoice_date, inv_mode, customer_id, customer_name, customer_mobile, salesman_id,
         pay_mode, invoice_status, order_status, order_type, table_no, delivery_address, gross_total, item_discount, bill_discount, extra_charges, net_total, cost_total, profit,
         total_qty, total_lines, cash_paid, card_paid, cheque_paid, bank_paid, credit_paid, voucher_paid, points_redeemed, points_earned, total_paid, balance_amount, due_amount, due_date,
         remark, shift_id, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41)
       RETURNING *`,
      [req.user.company_id, req.locationId, body.terminal_id || null, serial, body.invoice_no || serial, hasPermission(req.user, 'change_date') ? body.invoice_date || null : null,
        body.inv_mode === 'RET' ? 'RET' : 'INV', customer?.id || null, customer?.name || body.customer_name || 'CASH CUSTOMER', customer?.mobile || body.customer_mobile || null, body.salesman_id || null,
        payMode, isHold ? 'HOLD' : 'PRINTED', isHold ? 'UNPAID' : orderStatus, body.order_type || 'COUNTER', body.table_no || null, body.delivery_address || null,
        gross, itemDiscount, billDiscount, extra, net, costTotal, profit, totalQty, lines.length,
        cash, card, cheque, bank, credit, voucher, points, pointsEarned, paid, change, due, due > 0 ? (body.due_date || null) : null,
        body.remark || null, body.shift_id || null, req.user.username]);

    // ---- lines + stock
    for (const l of lines) {
      let batchId = l.batch_id;
      if (!isHold && l.item.track_inventory && l.item.item_type === 'STOCK') {
        const consumed = await deductStock(client, {
          companyId: req.user.company_id, locationId: req.locationId, itemId: l.item_id, batchId: l.batch_id, qty: l.qty,
          txnType: 'INV', refNo: serial, sellingPrice: l.unit_price, user: req.user.username, allowNegative: !!invoiceSettings.allow_negative_stock, date: inv.invoice_date,
        });
        if (consumed.length) batchId = consumed[0].batch_id;
      }
      await client.query(
        `INSERT INTO invoice_items (invoice_id, line_no, item_id, batch_id, item_code, item_name, unit, qty, cost_price, selling_price, unit_price, discount, line_total, price_type, warranty, serial_nos, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [inv.id, l.line_no, l.item_id, batchId, l.item_code, l.item_name, l.unit, l.qty, l.cost_price, l.selling_price, l.unit_price, l.discount, l.line_total, l.price_type, l.warranty, l.serial_nos, l.remark]);
    }

    if (!isHold) {
      // ---- payment rows + side effects
      for (const p of payments) {
        const amt = p.pay_type === 'CASH' ? cash : round2(p.amount);
        if (!PAY_TYPES.includes(p.pay_type) || amt <= 0) continue;
        await client.query(
          `INSERT INTO invoice_payments (invoice_id, pay_type, amount, reference, bank_id, card_type, card_no, cheque_no, cheque_date, cheque_bank) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [inv.id, p.pay_type, amt, p.reference || null, p.bank_id || null, p.card_type || null, p.card_no || null, p.cheque_no || null, p.cheque_date || null, p.cheque_bank || null]);
        if (p.pay_type === 'CHEQUE') {
          await client.query(
            `INSERT INTO cheques (company_id, location_id, cheque_no, cheque_date, bank_name, amount, direction, party_type, party_id, party_name, source, source_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'IN','CUS',$7,$8,'INV',$9,$10)`,
            [req.user.company_id, req.locationId, p.cheque_no || '-', p.cheque_date || null, p.cheque_bank || null, amt, customer?.id || null, inv.customer_name, inv.id, req.user.username]);
        }
        if (p.pay_type === 'BANK' && p.bank_id) {
          const { rows: [{ next_serial: bs }] } = await client.query(`SELECT next_serial($1,NULL,'BNK','BNK-')`, [req.user.company_id]);
          await client.query(
            `INSERT INTO bank_transactions (company_id, location_id, bank_id, serial_no, txn_date, txn_type, amount, reference, description, source, source_id, created_by)
             VALUES ($1,$2,$3,$4,$5,'DEPOSIT',$6,$7,$8,'INV',$9,$10)`,
            [req.user.company_id, req.locationId, p.bank_id, bs, inv.invoice_date, amt, p.reference || null, `Invoice ${serial}`, inv.id, req.user.username]);
        }
        if (p.pay_type === 'VOUCHER' && p.reference) {
          const { rows: [v] } = await client.query(`UPDATE gift_vouchers SET status = 'REDEEMED', redeemed_invoice_id = $1 WHERE company_id = $2 AND voucher_no = $3 AND status = 'ACTIVE' RETURNING id`, [inv.id, req.user.company_id, p.reference]);
          if (!v) throw new HttpError(400, `Voucher ${p.reference} is not valid`);
        }
      }
      if (credit > 0) {
        await client.query(`INSERT INTO invoice_payments (invoice_id, pay_type, amount) VALUES ($1,'CREDIT',$2)`, [inv.id, credit]);
      }
      // ---- customer ledger + loyalty
      if (customer) {
        const redeemPts = points > 0 ? round2(points / num(loyalty.currency_per_point || 1)) : 0;
        await client.query(`UPDATE customers SET due_amount = due_amount + $1, loyalty_points = loyalty_points - $2 + $3 WHERE id = $4`, [credit, redeemPts, pointsEarned, customer.id]);
        if (redeemPts > 0) await client.query(`INSERT INTO loyalty_transactions (company_id, customer_id, invoice_id, txn_type, points, created_by) VALUES ($1,$2,$3,'REDEEM',$4,$5)`, [req.user.company_id, customer.id, inv.id, redeemPts, req.user.username]);
        if (pointsEarned > 0) await client.query(`INSERT INTO loyalty_transactions (company_id, customer_id, invoice_id, txn_type, points, created_by) VALUES ($1,$2,$3,'EARN',$4,$5)`, [req.user.company_id, customer.id, inv.id, pointsEarned, req.user.username]);
      }
    }

    // finalising a held invoice removes the hold record
    if (body.hold_id) await client.query(`DELETE FROM invoices WHERE id = $1 AND company_id = $2 AND invoice_status = 'HOLD'`, [body.hold_id, req.user.company_id]);

    return inv;
  });

  await logActivity(req, isHold ? 'HOLD_INVOICE' : 'CREATE_INVOICE', 'invoices', result.id, { serial: result.serial_no, net: result.net_total });
  if (!isHold && result.customer_mobile) {
    await queueSms(req.user.company_id, result.customer_mobile, result.due_amount > 0 ? 'credit_invoice' : 'invoice',
      { name: result.customer_name, serial: result.serial_no, total: result.net_total.toFixed(2), due: result.due_amount.toFixed(2) });
  }
  res.status(201).json(await loadInvoice(result.id, req.user.company_id));
}));

// ---------------------------------------------------------------- cancel
r.post('/invoices/:id/cancel', requirePerm('cancel_invoice'), asyncHandler(async (req, res) => {
  const inv = await withTransaction(async client => {
    const { rows: [inv] } = await client.query(`SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`, [req.params.id, req.user.company_id]);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    if (inv.invoice_status === 'CANCELLED') throw new HttpError(400, 'Already cancelled');
    if (inv.invoice_status !== 'HOLD') {
      const { rows: items } = await client.query(`SELECT ii.*, i.track_inventory, i.item_type FROM invoice_items ii JOIN items i ON i.id = ii.item_id WHERE invoice_id = $1`, [inv.id]);
      for (const it of items) {
        if (!it.track_inventory || it.item_type !== 'STOCK') continue;
        const fn = inv.inv_mode === 'RET' ? deductStock : restoreStock;
        await fn(client, { companyId: req.user.company_id, locationId: inv.location_id, itemId: it.item_id, batchId: it.batch_id, qty: it.qty, txnType: 'CANCEL', refNo: inv.serial_no, user: req.user.username, allowNegative: true });
      }
      if (inv.customer_id) {
        const sign = inv.inv_mode === 'RET' ? 1 : -1;
        await client.query(`UPDATE customers SET due_amount = due_amount + $1, loyalty_points = loyalty_points - $2 + $3 WHERE id = $4`,
          [sign * num(inv.due_amount), num(inv.points_earned), num(inv.points_redeemed), inv.customer_id]);
      }
      await client.query(`UPDATE cheques SET status = 'CANCELLED' WHERE source = 'INV' AND source_id = $1`, [inv.id]);
      await client.query(`DELETE FROM bank_transactions WHERE source = 'INV' AND source_id = $1`, [inv.id]);
      await client.query(`UPDATE gift_vouchers SET status = 'ACTIVE', redeemed_invoice_id = NULL WHERE redeemed_invoice_id = $1`, [inv.id]);
    }
    const { rows: [u] } = await client.query(
      `UPDATE invoices SET invoice_status = 'CANCELLED', due_amount = 0, cancelled_by = $1, cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [req.user.username, req.body?.reason || null, inv.id]);
    return u;
  });
  await logActivity(req, 'CANCEL_INVOICE', 'invoices', inv.id, { serial: inv.serial_no, reason: req.body?.reason });
  res.json(inv);
}));

// ---------------------------------------------------------------- sales return
r.post('/invoices/:id/return', requirePerm('invoice_return'), asyncHandler(async (req, res) => {
  const { items = [], refund_type = 'CASH', reason } = req.body || {};
  const ret = await withTransaction(async client => {
    const { rows: [orig] } = await client.query(`SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND invoice_status = 'PRINTED' FOR UPDATE`, [req.params.id, req.user.company_id]);
    if (!orig) throw new HttpError(404, 'Original invoice not found');
    const { rows: origItems } = await client.query(`SELECT ii.*, i.track_inventory, i.item_type FROM invoice_items ii JOIN items i ON i.id = ii.item_id WHERE invoice_id = $1`, [orig.id]);
    const { rows: prev } = await client.query(
      `SELECT ri.item_id, SUM(ri.qty) AS qty FROM invoice_items ri JOIN invoices r ON r.id = ri.invoice_id WHERE r.remark LIKE $1 AND r.inv_mode = 'RET' AND r.invoice_status <> 'CANCELLED' GROUP BY ri.item_id`,
      [`RETURN OF ${orig.serial_no}%`]);
    const returned = Object.fromEntries(prev.map(p => [p.item_id, num(p.qty)]));

    let net = 0, cost = 0, qtyTot = 0; const lines = [];
    for (const rq of items) {
      const oi = origItems.find(o => o.id === Number(rq.invoice_item_id));
      if (!oi) throw new HttpError(400, 'Invalid invoice line');
      const qty = num(rq.qty);
      if (qty <= 0 || qty + (returned[oi.item_id] || 0) > num(oi.qty)) throw new HttpError(400, `Return qty exceeds sold qty for ${oi.item_name}`);
      const unitNet = num(oi.line_total) / num(oi.qty);
      const lineTotal = round2(unitNet * qty);
      net += lineTotal; cost += num(oi.cost_price) * qty; qtyTot += qty;
      lines.push({ oi, qty, lineTotal });
    }
    if (!lines.length) throw new HttpError(400, 'Nothing to return');
    net = round2(net); cost = round2(cost);

    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,$2,'INVR','RET-')`, [req.user.company_id, req.locationId]);
    const refundCredit = refund_type === 'CREDIT' && orig.customer_id;
    const { rows: [ret] } = await client.query(
      `INSERT INTO invoices (company_id, location_id, terminal_id, serial_no, invoice_no, inv_mode, customer_id, customer_name, customer_mobile, salesman_id, pay_mode, invoice_status, order_status,
         gross_total, net_total, cost_total, profit, total_qty, total_lines, cash_paid, credit_paid, total_paid, remark, created_by)
       VALUES ($1,$2,$3,$4,$4,'RET',$5,$6,$7,$8,$9,'PRINTED','PAID',$10,$10,$11,$12,$13,$14,$15,$16,$10,$17,$18) RETURNING *`,
      [req.user.company_id, req.locationId, orig.terminal_id, serial, orig.customer_id, orig.customer_name, orig.customer_mobile, orig.salesman_id, refundCredit ? 'CREDIT' : 'CASH',
        net, cost, round2(cost - net), qtyTot, lines.length, refundCredit ? 0 : net, refundCredit ? net : 0, `RETURN OF ${orig.serial_no}${reason ? ' - ' + reason : ''}`, req.user.username]);

    let ln = 0;
    for (const { oi, qty, lineTotal } of lines) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, line_no, item_id, batch_id, item_code, item_name, unit, qty, cost_price, selling_price, unit_price, discount, line_total, price_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13)`,
        [ret.id, ++ln, oi.item_id, oi.batch_id, oi.item_code, oi.item_name, oi.unit, qty, oi.cost_price, oi.selling_price, round2(lineTotal / qty), lineTotal, oi.price_type]);
      if (oi.track_inventory && oi.item_type === 'STOCK') {
        await restoreStock(client, { companyId: req.user.company_id, locationId: orig.location_id, itemId: oi.item_id, batchId: oi.batch_id, qty, txnType: 'INVR', refNo: serial, user: req.user.username });
      }
    }
    await client.query(`INSERT INTO invoice_payments (invoice_id, pay_type, amount) VALUES ($1,$2,$3)`, [ret.id, refundCredit ? 'CREDIT' : 'CASH', net]);
    if (refundCredit) await client.query(`UPDATE customers SET due_amount = due_amount - $1 WHERE id = $2`, [net, orig.customer_id]);
    return ret;
  });
  await logActivity(req, 'SALES_RETURN', 'invoices', ret.id, { serial: ret.serial_no, of: req.params.id });
  res.status(201).json(await loadInvoice(ret.id, req.user.company_id));
}));

// ---------------------------------------------------------------- delete a held invoice
r.delete('/invoices/:id/hold', requirePerm('delete_hold_invoice', 'hold_invoice'), asyncHandler(async (req, res) => {
  const { rows: [row] } = await query(`DELETE FROM invoices WHERE id = $1 AND company_id = $2 AND invoice_status = 'HOLD' RETURNING id`, [req.params.id, req.user.company_id]);
  if (!row) throw new HttpError(404, 'Held invoice not found');
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- quotations
r.get('/quotations', asyncHandler(async (req, res) => {
  const { page, limit, offset, q } = pageParams(req);
  const params = [req.user.company_id]; const where = ['q.company_id = $1'];
  if (q) { params.push(`%${q}%`); where.push(`(q.serial_no ILIKE $${params.length} OR q.customer_name ILIKE $${params.length})`); }
  if (req.query.status) { params.push(req.query.status); where.push(`q.status = $${params.length}`); }
  const wsql = ' WHERE ' + where.join(' AND ');
  const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM quotations q${wsql}`, params);
  const { rows } = await query(`SELECT q.* FROM quotations q${wsql} ORDER BY q.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, total: count, page, limit });
}));

r.get('/quotations/:id', asyncHandler(async (req, res) => {
  const { rows: [qt] } = await query(`SELECT q.*, c.mobile AS cus_mobile, c.address AS cus_address FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = $1 AND q.company_id = $2`, [req.params.id, req.user.company_id]);
  if (!qt) throw new HttpError(404, 'Quotation not found');
  const { rows: items } = await query(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY line_no`, [qt.id]);
  res.json({ ...qt, items });
}));

r.post('/quotations', requirePerm('quotation'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const qt = await withTransaction(async client => {
    let customer = null;
    if (body.customer_id) ({ rows: [customer] } = await client.query(`SELECT * FROM customers WHERE id = $1 AND company_id = $2`, [body.customer_id, req.user.company_id]));
    const { lines, gross, itemDiscount } = await buildLines(client, req, body.items, customer);
    const discount = round2(body.bill_discount);
    const net = round2(gross - itemDiscount - discount);
    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,$2,'QUOT','QUO-')`, [req.user.company_id, req.locationId]);
    const { rows: [qt] } = await client.query(
      `INSERT INTO quotations (company_id, location_id, serial_no, valid_till, customer_id, customer_name, gross_total, discount, net_total, remark, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.company_id, req.locationId, serial, body.valid_till || null, customer?.id || null, customer?.name || body.customer_name || 'CASH CUSTOMER', gross, round2(itemDiscount + discount), net, body.remark || null, req.user.username]);
    for (const l of lines) {
      await client.query(`INSERT INTO quotation_items (quotation_id, line_no, item_id, item_code, item_name, qty, unit_price, discount, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [qt.id, l.line_no, l.item_id, l.item_code, l.item_name, l.qty, l.unit_price, l.discount, l.line_total]);
    }
    return qt;
  });
  await logActivity(req, 'CREATE_QUOTATION', 'quotations', qt.id);
  res.status(201).json(qt);
}));

r.put('/quotations/:id/status', requirePerm('quotation'), asyncHandler(async (req, res) => {
  const { status, invoice_id } = req.body || {};
  if (!['OPEN', 'CONVERTED', 'EXPIRED', 'CANCELLED'].includes(status)) throw new HttpError(400, 'Invalid status');
  const { rows: [qt] } = await query(`UPDATE quotations SET status = $1, converted_invoice_id = COALESCE($2, converted_invoice_id) WHERE id = $3 AND company_id = $4 RETURNING *`, [status, invoice_id || null, req.params.id, req.user.company_id]);
  if (!qt) throw new HttpError(404, 'Quotation not found');
  res.json(qt);
}));

export default r;
