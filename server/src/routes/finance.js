import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { num, round2, pageParams, logActivity } from '../lib/util.js';
import { queueSms } from '../services/sms.js';

const r = Router();

async function bankTxn(client, req, { bankId, type, amount, date, reference, description, source, sourceId }) {
  const { rows: [{ next_serial: bs }] } = await client.query(`SELECT next_serial($1,NULL,'BNK','BNK-')`, [req.user.company_id]);
  await client.query(
    `INSERT INTO bank_transactions (company_id, location_id, bank_id, serial_no, txn_date, txn_type, amount, reference, description, source, source_id, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12)`,
    [req.user.company_id, req.locationId, bankId, bs, date || null, type, amount, reference || null, description || null, source, sourceId, req.user.username]);
}

// ================================================================ customer payments (credit settlement)
r.get('/customer-payments', asyncHandler(async (req, res) => {
  const { page, limit, offset, q } = pageParams(req);
  const params = [req.user.company_id]; const where = ['p.company_id = $1'];
  if (req.query.customer_id) { params.push(req.query.customer_id); where.push(`p.customer_id = $${params.length}`); }
  if (req.query.date_from) { params.push(req.query.date_from); where.push(`p.pay_date >= $${params.length}`); }
  if (req.query.date_to) { params.push(req.query.date_to); where.push(`p.pay_date <= $${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(p.serial_no ILIKE $${params.length} OR c.name ILIKE $${params.length})`); }
  const wsql = ' WHERE ' + where.join(' AND ');
  const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM customer_payments p JOIN customers c ON c.id = p.customer_id${wsql}`, params);
  const { rows } = await query(`SELECT p.*, c.name AS customer_name, c.code AS customer_code FROM customer_payments p JOIN customers c ON c.id = p.customer_id${wsql} ORDER BY p.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, total: count, page, limit });
}));

/** Outstanding invoices for a customer (for allocation). */
r.get('/customer-outstanding/:customerId', asyncHandler(async (req, res) => {
  const { rows: [cus] } = await query(`SELECT id, code, name, due_amount, advance_amount, credit_limit, loyalty_points FROM customers WHERE id = $1 AND company_id = $2`, [req.params.customerId, req.user.company_id]);
  if (!cus) throw new HttpError(404, 'Customer not found');
  const { rows: invoices } = await query(
    `SELECT id, serial_no, invoice_date, net_total, total_paid, due_amount, due_date FROM invoices WHERE customer_id = $1 AND inv_mode = 'INV' AND invoice_status = 'PRINTED' AND due_amount > 0 ORDER BY invoice_date, id`, [cus.id]);
  res.json({ customer: cus, invoices });
}));

/**
 * Record a customer payment.  body: { customer_id, amount, pay_type, reference, bank_id, cheque_*, allocations:[{invoice_id, amount}], entry_type }
 * If allocations are omitted, the amount is applied oldest-first (FIFO).
 */
r.post('/customer-payments', requirePerm('pay_due'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const amount = round2(body.amount);
  if (amount <= 0) throw new HttpError(400, 'Amount must be positive');
  const entryType = body.entry_type || 'PAYMENT';
  const pay = await withTransaction(async client => {
    const { rows: [cus] } = await client.query(`SELECT * FROM customers WHERE id = $1 AND company_id = $2 FOR UPDATE`, [body.customer_id, req.user.company_id]);
    if (!cus) throw new HttpError(400, 'Customer not found');
    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,$2,'CPAY','CRP-')`, [req.user.company_id, req.locationId]);
    const { rows: [pay] } = await client.query(
      `INSERT INTO customer_payments (company_id, location_id, serial_no, pay_date, customer_id, amount, pay_type, reference, bank_id, cheque_no, cheque_date, entry_type, remark, created_by)
       VALUES ($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user.company_id, req.locationId, serial, body.pay_date || null, cus.id, amount, body.pay_type || 'CASH', body.reference || null, body.bank_id || null, body.cheque_no || null, body.cheque_date || null, entryType, body.remark || null, req.user.username]);

    if (entryType === 'DEBIT_ADJ') {
      // increases what the customer owes (e.g. returned cheque charges)
      await client.query(`UPDATE customers SET due_amount = due_amount + $1 WHERE id = $2`, [amount, cus.id]);
      return pay;
    }

    // allocate to invoices
    let allocations = Array.isArray(body.allocations) && body.allocations.length ? body.allocations : null;
    let remaining = amount;
    if (!allocations) {
      const { rows: open } = await client.query(`SELECT id, due_amount FROM invoices WHERE customer_id = $1 AND inv_mode = 'INV' AND invoice_status = 'PRINTED' AND due_amount > 0 ORDER BY invoice_date, id FOR UPDATE`, [cus.id]);
      allocations = [];
      for (const inv of open) { if (remaining <= 0) break; const a = Math.min(remaining, num(inv.due_amount)); allocations.push({ invoice_id: inv.id, amount: a }); remaining = round2(remaining - a); }
    } else {
      remaining = round2(amount - allocations.reduce((s, a) => s + num(a.amount), 0));
      if (remaining < 0) throw new HttpError(400, 'Allocations exceed payment amount');
    }
    for (const a of allocations) {
      const amt = round2(a.amount); if (amt <= 0) continue;
      const { rows: [inv] } = await client.query(`UPDATE invoices SET due_amount = due_amount - $1, total_paid = total_paid + $1, order_status = CASE WHEN due_amount - $1 <= 0 THEN 'PAID' ELSE 'PARTIAL' END, updated_at = now()
                                                  WHERE id = $2 AND customer_id = $3 AND due_amount >= $1 RETURNING id`, [amt, a.invoice_id, cus.id]);
      if (!inv) throw new HttpError(400, `Allocation exceeds invoice ${a.invoice_id} balance`);
      await client.query(`INSERT INTO customer_payment_allocations (payment_id, invoice_id, amount) VALUES ($1,$2,$3)`, [pay.id, a.invoice_id, amt]);
    }
    const applied = round2(amount - remaining);
    await client.query(`UPDATE customers SET due_amount = due_amount - $1, advance_amount = advance_amount + $2 WHERE id = $3`, [applied, remaining, cus.id]);

    if (body.pay_type === 'CHEQUE') {
      await client.query(`INSERT INTO cheques (company_id, location_id, cheque_no, cheque_date, bank_name, amount, direction, party_type, party_id, party_name, source, source_id, created_by)
                          VALUES ($1,$2,$3,$4,$5,$6,'IN','CUS',$7,$8,'CPAY',$9,$10)`,
        [req.user.company_id, req.locationId, body.cheque_no || '-', body.cheque_date || null, body.cheque_bank || null, amount, cus.id, cus.name, pay.id, req.user.username]);
    }
    if (body.pay_type === 'BANK' && body.bank_id) await bankTxn(client, req, { bankId: body.bank_id, type: 'DEPOSIT', amount, date: pay.pay_date, reference: body.reference, description: `Customer payment ${serial} - ${cus.name}`, source: 'CPAY', sourceId: pay.id });
    pay.customer = cus;
    return pay;
  });
  await logActivity(req, 'CUSTOMER_PAYMENT', 'customer_payments', pay.id, { amount });
  const { rows: [cusNow] } = await query(`SELECT due_amount, mobile, name FROM customers WHERE id = $1`, [pay.customer_id]);
  if (cusNow?.mobile) await queueSms(req.user.company_id, cusNow.mobile, 'credit_settlement', { name: cusNow.name, amount: amount.toFixed(2), due: num(cusNow.due_amount).toFixed(2) });
  res.status(201).json(pay);
}));

// ================================================================ supplier payments
r.get('/supplier-payments', asyncHandler(async (req, res) => {
  const { page, limit, offset, q } = pageParams(req);
  const params = [req.user.company_id]; const where = ['p.company_id = $1'];
  if (req.query.supplier_id) { params.push(req.query.supplier_id); where.push(`p.supplier_id = $${params.length}`); }
  if (req.query.date_from) { params.push(req.query.date_from); where.push(`p.pay_date >= $${params.length}`); }
  if (req.query.date_to) { params.push(req.query.date_to); where.push(`p.pay_date <= $${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(p.serial_no ILIKE $${params.length} OR s.name ILIKE $${params.length})`); }
  const wsql = ' WHERE ' + where.join(' AND ');
  const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id${wsql}`, params);
  const { rows } = await query(`SELECT p.*, s.name AS supplier_name, s.code AS supplier_code FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id${wsql} ORDER BY p.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, total: count, page, limit });
}));

r.get('/supplier-outstanding/:supplierId', asyncHandler(async (req, res) => {
  const { rows: [sup] } = await query(`SELECT id, code, name, due_amount, advance_amount FROM suppliers WHERE id = $1 AND company_id = $2`, [req.params.supplierId, req.user.company_id]);
  if (!sup) throw new HttpError(404, 'Supplier not found');
  const { rows: purchases } = await query(
    `SELECT id, serial_no, invoice_no, purchase_date, net_total, paid_amount, due_amount, due_date FROM purchases WHERE supplier_id = $1 AND inv_mode = 'PCH' AND invoice_status = 'PRINTED' AND due_amount > 0 ORDER BY purchase_date, id`, [sup.id]);
  res.json({ supplier: sup, purchases });
}));

r.post('/supplier-payments', requirePerm('pay_due'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const amount = round2(body.amount);
  if (amount <= 0) throw new HttpError(400, 'Amount must be positive');
  const entryType = body.entry_type || 'PAYMENT';
  const pay = await withTransaction(async client => {
    const { rows: [sup] } = await client.query(`SELECT * FROM suppliers WHERE id = $1 AND company_id = $2 FOR UPDATE`, [body.supplier_id, req.user.company_id]);
    if (!sup) throw new HttpError(400, 'Supplier not found');
    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,$2,'SPAY','SPP-')`, [req.user.company_id, req.locationId]);
    const { rows: [pay] } = await client.query(
      `INSERT INTO supplier_payments (company_id, location_id, serial_no, pay_date, supplier_id, amount, pay_type, reference, bank_id, cheque_no, cheque_date, entry_type, remark, created_by)
       VALUES ($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user.company_id, req.locationId, serial, body.pay_date || null, sup.id, amount, body.pay_type || 'CASH', body.reference || null, body.bank_id || null, body.cheque_no || null, body.cheque_date || null, entryType, body.remark || null, req.user.username]);
    if (entryType === 'DEBIT_ADJ') { await client.query(`UPDATE suppliers SET due_amount = due_amount + $1 WHERE id = $2`, [amount, sup.id]); return pay; }

    let allocations = Array.isArray(body.allocations) && body.allocations.length ? body.allocations : null;
    let remaining = amount;
    if (!allocations) {
      const { rows: open } = await client.query(`SELECT id, due_amount FROM purchases WHERE supplier_id = $1 AND inv_mode = 'PCH' AND invoice_status = 'PRINTED' AND due_amount > 0 ORDER BY purchase_date, id FOR UPDATE`, [sup.id]);
      allocations = [];
      for (const p of open) { if (remaining <= 0) break; const a = Math.min(remaining, num(p.due_amount)); allocations.push({ purchase_id: p.id, amount: a }); remaining = round2(remaining - a); }
    } else {
      remaining = round2(amount - allocations.reduce((s, a) => s + num(a.amount), 0));
      if (remaining < 0) throw new HttpError(400, 'Allocations exceed payment amount');
    }
    for (const a of allocations) {
      const amt = round2(a.amount); if (amt <= 0) continue;
      const { rows: [p] } = await client.query(`UPDATE purchases SET due_amount = due_amount - $1, paid_amount = paid_amount + $1, order_status = CASE WHEN due_amount - $1 <= 0 THEN 'PAID' ELSE 'PARTIAL' END
                                                WHERE id = $2 AND supplier_id = $3 AND due_amount >= $1 RETURNING id`, [amt, a.purchase_id, sup.id]);
      if (!p) throw new HttpError(400, `Allocation exceeds GRN ${a.purchase_id} balance`);
      await client.query(`INSERT INTO supplier_payment_allocations (payment_id, purchase_id, amount) VALUES ($1,$2,$3)`, [pay.id, a.purchase_id, amt]);
    }
    const applied = round2(amount - remaining);
    await client.query(`UPDATE suppliers SET due_amount = due_amount - $1, advance_amount = advance_amount + $2 WHERE id = $3`, [applied, remaining, sup.id]);
    if (body.pay_type === 'CHEQUE') {
      await client.query(`INSERT INTO cheques (company_id, location_id, cheque_no, cheque_date, bank_name, amount, direction, party_type, party_id, party_name, source, source_id, created_by)
                          VALUES ($1,$2,$3,$4,$5,$6,'OUT','SUP',$7,$8,'SPAY',$9,$10)`,
        [req.user.company_id, req.locationId, body.cheque_no || '-', body.cheque_date || null, body.cheque_bank || null, amount, sup.id, sup.name, pay.id, req.user.username]);
    }
    if (body.pay_type === 'BANK' && body.bank_id) await bankTxn(client, req, { bankId: body.bank_id, type: 'WITHDRAW', amount, date: pay.pay_date, reference: body.reference, description: `Supplier payment ${serial} - ${sup.name}`, source: 'SPAY', sourceId: pay.id });
    return pay;
  });
  await logActivity(req, 'SUPPLIER_PAYMENT', 'supplier_payments', pay.id, { amount });
  res.status(201).json(pay);
}));

// ================================================================ income / expenses
r.get('/income-expenses', asyncHandler(async (req, res) => {
  const { page, limit, offset, q } = pageParams(req);
  const params = [req.user.company_id]; const where = ['x.company_id = $1'];
  if (req.query.kind) { params.push(req.query.kind); where.push(`x.kind = $${params.length}`); }
  if (req.query.date_from) { params.push(req.query.date_from); where.push(`x.txn_date >= $${params.length}`); }
  if (req.query.date_to) { params.push(req.query.date_to); where.push(`x.txn_date <= $${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(x.serial_no ILIKE $${params.length} OR x.description ILIKE $${params.length} OR x.vendor_name ILIKE $${params.length})`); }
  const wsql = ' WHERE ' + where.join(' AND ');
  const { rows: [{ count, total }] } = await query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount),0) AS total FROM income_expenses x${wsql}`, params);
  const { rows } = await query(`SELECT x.*, c.name AS category_name FROM income_expenses x LEFT JOIN expense_categories c ON c.id = x.category_id${wsql} ORDER BY x.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, total: count, sum: total, page, limit });
}));

r.post('/income-expenses', asyncHandler(async (req, res, next) => {
  const kind = req.body?.kind === 'INCOME' ? 'INCOME' : 'EXPENSE';
  return requirePerm(kind === 'INCOME' ? 'add_income' : 'add_expenses')(req, res, next);
}), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const amount = round2(body.amount);
  if (amount <= 0) throw new HttpError(400, 'Amount must be positive');
  const kind = body.kind === 'INCOME' ? 'INCOME' : 'EXPENSE';
  const row = await withTransaction(async client => {
    const { rows: [{ next_serial: serial }] } = await client.query(`SELECT next_serial($1,$2,$3,$4)`, [req.user.company_id, req.locationId, kind === 'INCOME' ? 'INC' : 'EXP', kind === 'INCOME' ? 'INC-' : 'EXP-']);
    const { rows: [row] } = await client.query(
      `INSERT INTO income_expenses (company_id, location_id, serial_no, txn_date, kind, category_id, description, vendor_name, amount, pay_mode, reference, bank_id, remark, created_by)
       VALUES ($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user.company_id, req.locationId, serial, body.txn_date || null, kind, body.category_id || null, body.description || null, body.vendor_name || null, amount, body.pay_mode || 'CASH', body.reference || null, body.bank_id || null, body.remark || null, req.user.username]);
    if (body.pay_mode === 'BANK' && body.bank_id) await bankTxn(client, req, { bankId: body.bank_id, type: kind === 'INCOME' ? 'DEPOSIT' : 'WITHDRAW', amount, date: row.txn_date, reference: body.reference, description: `${kind} ${serial} - ${body.description || ''}`, source: 'INCEXP', sourceId: row.id });
    return row;
  });
  await logActivity(req, kind === 'INCOME' ? 'ADD_INCOME' : 'ADD_EXPENSE', 'income_expenses', row.id, { amount });
  res.status(201).json(row);
}));

r.delete('/income-expenses/:id', requirePerm('add_expenses', 'add_income'), asyncHandler(async (req, res) => {
  await withTransaction(async client => {
    const { rows: [row] } = await client.query(`DELETE FROM income_expenses WHERE id = $1 AND company_id = $2 RETURNING id`, [req.params.id, req.user.company_id]);
    if (!row) throw new HttpError(404, 'Not found');
    await client.query(`DELETE FROM bank_transactions WHERE source = 'INCEXP' AND source_id = $1`, [row.id]);
  });
  await logActivity(req, 'DELETE_INCEXP', 'income_expenses', req.params.id);
  res.json({ ok: true });
}));

// ================================================================ bank transactions
r.get('/bank-transactions', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const params = [req.user.company_id]; const where = ['t.company_id = $1'];
  if (req.query.bank_id) { params.push(req.query.bank_id); where.push(`t.bank_id = $${params.length}`); }
  if (req.query.date_from) { params.push(req.query.date_from); where.push(`t.txn_date >= $${params.length}`); }
  if (req.query.date_to) { params.push(req.query.date_to); where.push(`t.txn_date <= $${params.length}`); }
  const wsql = ' WHERE ' + where.join(' AND ');
  const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM bank_transactions t${wsql}`, params);
  const { rows } = await query(`SELECT t.*, b.bank_name, b.account_no FROM bank_transactions t JOIN banks b ON b.id = t.bank_id${wsql} ORDER BY t.txn_date DESC, t.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, total: count, page, limit });
}));

r.get('/bank-balances', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT b.id, b.code, b.bank_name, b.branch, b.account_no, b.opening_balance,
            b.opening_balance + COALESCE(SUM(CASE WHEN t.txn_type IN ('DEPOSIT','CHEQUE_IN','CARD_SETTLE') THEN t.amount ELSE -t.amount END),0) AS balance
     FROM banks b LEFT JOIN bank_transactions t ON t.bank_id = b.id WHERE b.company_id = $1 AND b.active GROUP BY b.id ORDER BY b.bank_name`, [req.user.company_id]);
  res.json(rows);
}));

r.post('/bank-transactions', requirePerm('add_deposit', 'add_withdraw'), asyncHandler(async (req, res) => {
  const { bank_id, txn_type, amount, txn_date, reference, description } = req.body || {};
  if (!['DEPOSIT', 'WITHDRAW'].includes(txn_type)) throw new HttpError(400, 'txn_type must be DEPOSIT or WITHDRAW');
  if (round2(amount) <= 0) throw new HttpError(400, 'Amount must be positive');
  await withTransaction(client => bankTxn(client, req, { bankId: bank_id, type: txn_type, amount: round2(amount), date: txn_date, reference, description, source: 'MANUAL', sourceId: null }));
  await logActivity(req, 'BANK_' + txn_type, 'bank_transactions', bank_id, { amount });
  res.status(201).json({ ok: true });
}));

// ================================================================ cheques
r.get('/cheques', asyncHandler(async (req, res) => {
  const { page, limit, offset, q } = pageParams(req);
  const params = [req.user.company_id]; const where = ['c.company_id = $1'];
  if (req.query.status) { params.push(req.query.status); where.push(`c.status = $${params.length}`); }
  if (req.query.direction) { params.push(req.query.direction); where.push(`c.direction = $${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(c.cheque_no ILIKE $${params.length} OR c.party_name ILIKE $${params.length} OR c.bank_name ILIKE $${params.length})`); }
  const wsql = ' WHERE ' + where.join(' AND ');
  const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM cheques c${wsql}`, params);
  const { rows } = await query(`SELECT c.*, b.bank_name AS deposit_bank FROM cheques c LEFT JOIN banks b ON b.id = c.deposit_bank_id${wsql} ORDER BY c.cheque_date NULLS LAST, c.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, total: count, page, limit });
}));

/** Realize (deposit) or return a cheque. body: { status: REALIZED|RETURNED, deposit_bank_id } */
r.put('/cheques/:id/status', requirePerm('edit_chq'), asyncHandler(async (req, res) => {
  const { status, deposit_bank_id, realized_at } = req.body || {};
  if (!['REALIZED', 'RETURNED', 'PENDING', 'CANCELLED'].includes(status)) throw new HttpError(400, 'Invalid status');
  const chq = await withTransaction(async client => {
    const { rows: [chq] } = await client.query(`SELECT * FROM cheques WHERE id = $1 AND company_id = $2 FOR UPDATE`, [req.params.id, req.user.company_id]);
    if (!chq) throw new HttpError(404, 'Cheque not found');
    if (status === 'REALIZED' && chq.status !== 'REALIZED') {
      if (!deposit_bank_id) throw new HttpError(400, 'Select the bank the cheque was deposited to');
      await bankTxn(client, req, { bankId: deposit_bank_id, type: chq.direction === 'IN' ? 'CHEQUE_IN' : 'CHEQUE_OUT', amount: chq.amount, date: realized_at, reference: chq.cheque_no, description: `Cheque ${chq.cheque_no} - ${chq.party_name || ''}`, source: 'CHQ', sourceId: chq.id });
    }
    if (status === 'RETURNED' && chq.direction === 'IN' && chq.party_type === 'CUS' && chq.party_id) {
      // returned customer cheque -> customer owes the money again
      await client.query(`UPDATE customers SET due_amount = due_amount + $1 WHERE id = $2`, [chq.amount, chq.party_id]);
      await client.query(`DELETE FROM bank_transactions WHERE source = 'CHQ' AND source_id = $1`, [chq.id]);
    }
    const { rows: [u] } = await client.query(`UPDATE cheques SET status = $1::varchar, deposit_bank_id = COALESCE($2::bigint, deposit_bank_id), realized_at = CASE WHEN $1::varchar = 'REALIZED' THEN COALESCE($3::date, CURRENT_DATE) ELSE realized_at END WHERE id = $4 RETURNING *`,
      [status, deposit_bank_id || null, realized_at || null, chq.id]);
    return u;
  });
  await logActivity(req, 'CHEQUE_' + status, 'cheques', chq.id);
  res.json(chq);
}));

// ================================================================ shifts / cash denomination / day end
r.get('/shifts/current', asyncHandler(async (req, res) => {
  const { rows: [s] } = await query(`SELECT * FROM shifts WHERE company_id = $1 AND location_id = $2 AND status = 'OPEN' AND (terminal_id IS NOT DISTINCT FROM $3 OR $3 IS NULL) ORDER BY id DESC LIMIT 1`,
    [req.user.company_id, req.locationId, req.query.terminal_id || null]);
  res.json(s || null);
}));

r.get('/shifts', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int AS count FROM shifts WHERE company_id = $1`, [req.user.company_id]);
  const { rows } = await query(`SELECT s.*, t.name AS terminal_name FROM shifts s LEFT JOIN terminals t ON t.id = s.terminal_id WHERE s.company_id = $1 ORDER BY s.id DESC LIMIT ${limit} OFFSET ${offset}`, [req.user.company_id]);
  res.json({ data: rows, total: count, page, limit });
}));

r.post('/shifts/open', requirePerm('cash_denomination'), asyncHandler(async (req, res) => {
  const { terminal_id, opening_cash, opening_denoms } = req.body || {};
  const { rows: existing } = await query(`SELECT id FROM shifts WHERE company_id = $1 AND location_id = $2 AND status = 'OPEN' AND terminal_id IS NOT DISTINCT FROM $3`, [req.user.company_id, req.locationId, terminal_id || null]);
  if (existing.length) throw new HttpError(400, 'A shift is already open on this terminal');
  const { rows: [{ next_serial: no }] } = await query(`SELECT next_serial($1,$2,'SHIFT','SH-')`, [req.user.company_id, req.locationId]);
  const { rows: [s] } = await query(
    `INSERT INTO shifts (company_id, location_id, terminal_id, shift_no, opened_by, opening_cash, opening_denoms) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.company_id, req.locationId, terminal_id || null, no, req.user.username, round2(opening_cash), opening_denoms ? JSON.stringify(opening_denoms) : null]);
  await logActivity(req, 'SHIFT_OPEN', 'shifts', s.id);
  res.status(201).json(s);
}));

/** Day-end summary for a shift (or for a date range if no shift) — the "Z report". */
async function shiftSummary(companyId, locationId, shift) {
  const params = [companyId, locationId, shift.opened_at, shift.closed_at || new Date()];
  const { rows: [sales] } = await query(
    `SELECT COUNT(*) FILTER (WHERE inv_mode='INV' AND invoice_status='PRINTED')::int AS invoices,
            COALESCE(SUM(net_total) FILTER (WHERE inv_mode='INV' AND invoice_status='PRINTED'),0) AS sales_total,
            COALESCE(SUM(net_total) FILTER (WHERE inv_mode='RET' AND invoice_status='PRINTED'),0) AS returns_total,
            COALESCE(SUM(cash_paid) FILTER (WHERE inv_mode='INV' AND invoice_status='PRINTED'),0) - COALESCE(SUM(cash_paid) FILTER (WHERE inv_mode='RET' AND invoice_status='PRINTED'),0) AS cash_sales,
            COALESCE(SUM(card_paid) FILTER (WHERE invoice_status='PRINTED'),0) AS card_sales,
            COALESCE(SUM(cheque_paid) FILTER (WHERE invoice_status='PRINTED'),0) AS cheque_sales,
            COALESCE(SUM(bank_paid) FILTER (WHERE invoice_status='PRINTED'),0) AS bank_sales,
            COALESCE(SUM(credit_paid) FILTER (WHERE inv_mode='INV' AND invoice_status='PRINTED'),0) AS credit_sales,
            COALESCE(SUM(voucher_paid) FILTER (WHERE invoice_status='PRINTED'),0) AS voucher_sales,
            COALESCE(SUM(points_redeemed) FILTER (WHERE invoice_status='PRINTED'),0) AS points_sales,
            COALESCE(SUM(bill_discount + item_discount) FILTER (WHERE inv_mode='INV' AND invoice_status='PRINTED'),0) AS discounts,
            COALESCE(SUM(profit) FILTER (WHERE invoice_status='PRINTED'),0) AS profit,
            COUNT(*) FILTER (WHERE invoice_status='CANCELLED')::int AS cancelled
     FROM invoices WHERE company_id = $1 AND location_id = $2 AND created_at >= $3 AND created_at <= $4`, params);
  const { rows: [cp] } = await query(`SELECT COALESCE(SUM(amount) FILTER (WHERE pay_type='CASH'),0) AS cash, COALESCE(SUM(amount),0) AS total FROM customer_payments WHERE company_id = $1 AND location_id = $2 AND created_at >= $3 AND created_at <= $4 AND entry_type = 'PAYMENT'`, params);
  const { rows: [sp] } = await query(`SELECT COALESCE(SUM(amount) FILTER (WHERE pay_type='CASH'),0) AS cash, COALESCE(SUM(amount),0) AS total FROM supplier_payments WHERE company_id = $1 AND location_id = $2 AND created_at >= $3 AND created_at <= $4 AND entry_type = 'PAYMENT'`, params);
  const { rows: [ie] } = await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE kind='INCOME' AND pay_mode='CASH'),0) AS cash_income, COALESCE(SUM(amount) FILTER (WHERE kind='EXPENSE' AND pay_mode='CASH'),0) AS cash_expense,
            COALESCE(SUM(amount) FILTER (WHERE kind='INCOME'),0) AS income, COALESCE(SUM(amount) FILTER (WHERE kind='EXPENSE'),0) AS expense
     FROM income_expenses WHERE company_id = $1 AND location_id = $2 AND created_at >= $3 AND created_at <= $4`, params);
  const { rows: [pch] } = await query(`SELECT COALESCE(SUM(paid_amount) FILTER (WHERE pay_mode='CASH' AND inv_mode='PCH'),0) AS cash_purchases, COALESCE(SUM(net_total) FILTER (WHERE inv_mode='PCH'),0) AS purchases FROM purchases WHERE company_id = $1 AND location_id = $2 AND created_at >= $3 AND created_at <= $4 AND invoice_status='PRINTED'`, params);
  const expectedCash = round2(num(shift.opening_cash) + num(sales.cash_sales) + num(cp.cash) + num(ie.cash_income) - num(sp.cash) - num(ie.cash_expense) - num(pch.cash_purchases));
  return { sales, customer_payments: cp, supplier_payments: sp, income_expense: ie, purchases: pch, expected_cash: expectedCash };
}

r.get('/shifts/:id/summary', asyncHandler(async (req, res) => {
  const { rows: [s] } = await query(`SELECT * FROM shifts WHERE id = $1 AND company_id = $2`, [req.params.id, req.user.company_id]);
  if (!s) throw new HttpError(404, 'Shift not found');
  res.json({ shift: s, ...(await shiftSummary(req.user.company_id, s.location_id, s)) });
}));

r.post('/shifts/:id/close', requirePerm('cash_denomination'), asyncHandler(async (req, res) => {
  const { closing_cash, closing_denoms, remark } = req.body || {};
  const { rows: [s] } = await query(`SELECT * FROM shifts WHERE id = $1 AND company_id = $2 AND status = 'OPEN'`, [req.params.id, req.user.company_id]);
  if (!s) throw new HttpError(404, 'Open shift not found');
  const summary = await shiftSummary(req.user.company_id, s.location_id, { ...s, closed_at: new Date() });
  const closing = round2(closing_cash);
  const { rows: [u] } = await query(
    `UPDATE shifts SET status = 'CLOSED', closed_by = $1, closed_at = now(), closing_cash = $2, closing_denoms = $3, expected_cash = $4, variance = $5, remark = $6 WHERE id = $7 RETURNING *`,
    [req.user.username, closing, closing_denoms ? JSON.stringify(closing_denoms) : null, summary.expected_cash, round2(closing - summary.expected_cash), remark || null, s.id]);
  await logActivity(req, 'SHIFT_CLOSE', 'shifts', s.id, { variance: u.variance });
  res.json({ shift: u, ...summary });
}));

// ================================================================ gift vouchers
r.get('/vouchers', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM gift_vouchers WHERE company_id = $1 ORDER BY id DESC LIMIT 500`, [req.user.company_id]);
  res.json({ data: rows, total: rows.length });
}));
r.get('/vouchers/:no', asyncHandler(async (req, res) => {
  const { rows: [v] } = await query(`SELECT * FROM gift_vouchers WHERE company_id = $1 AND voucher_no = $2`, [req.user.company_id, req.params.no]);
  if (!v) throw new HttpError(404, 'Voucher not found');
  res.json(v);
}));
r.post('/vouchers', requirePerm('invoice'), asyncHandler(async (req, res) => {
  const { amount, customer_id, customer_name, expires_at, voucher_no } = req.body || {};
  if (round2(amount) <= 0) throw new HttpError(400, 'Amount must be positive');
  const no = voucher_no || (await query(`SELECT next_serial($1,NULL,'GV','GV-')`, [req.user.company_id])).rows[0].next_serial;
  const { rows: [v] } = await query(`INSERT INTO gift_vouchers (company_id, voucher_no, amount, customer_id, customer_name, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.company_id, no, round2(amount), customer_id || null, customer_name || null, expires_at || null, req.user.username]);
  res.status(201).json(v);
}));

export default r;
