// Reports.  Each endpoint accepts ?date_from=&date_to=&location_id= and returns rows ready for a table/chart.
// Replaces the Crystal report families: rptSales*, rptPurchase*, rptStock*, rptProfit*, rptCusOutstanding*, rptSupOutstanding*,
// rptIncExp*, rptP&LReport, rptDayReport*, rptSalesTop10*, rptItemDetLedger, rptCusWiseInvoiceHistory ...
import { Router } from 'express';
import { query } from '../db.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { today, num, round2 } from '../lib/util.js';

const r = Router();

function range(req) {
  const from = req.query.date_from || today();
  const to = req.query.date_to || from;
  const loc = req.query.location_id || null;
  return { from, to, loc };
}

const SALES_BASE = `FROM invoices i LEFT JOIN employees e ON e.id = i.salesman_id LEFT JOIN locations l ON l.id = i.location_id
  WHERE i.company_id = $1 AND i.invoice_status = 'PRINTED' AND i.invoice_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR i.location_id = $4)`;
const sign = `(CASE WHEN i.inv_mode = 'RET' THEN -1 ELSE 1 END)`;

// ---------------------------------------------------------------- sales
const SALES_GROUPS = {
  day:      { key: `i.invoice_date::text`, label: `i.invoice_date::text`, order: `1` },
  month:    { key: `to_char(i.invoice_date,'YYYY-MM')`, label: `to_char(i.invoice_date,'YYYY-MM')`, order: `1` },
  year:     { key: `to_char(i.invoice_date,'YYYY')`, label: `to_char(i.invoice_date,'YYYY')`, order: `1` },
  week:     { key: `to_char(i.invoice_date,'IYYY-IW')`, label: `to_char(i.invoice_date,'IYYY-"W"IW')`, order: `1` },
  hour:     { key: `extract(hour from i.invoice_time)::int::text`, label: `lpad(extract(hour from i.invoice_time)::int::text,2,'0') || ':00'`, order: `1` },
  customer: { key: `COALESCE(i.customer_id::text,'0')`, label: `i.customer_name`, order: `sales DESC` },
  salesman: { key: `COALESCE(i.salesman_id::text,'0')`, label: `COALESCE(e.name,'-')`, order: `sales DESC` },
  user:     { key: `i.created_by`, label: `i.created_by`, order: `sales DESC` },
  paymode:  { key: `i.pay_mode`, label: `i.pay_mode`, order: `sales DESC` },
  location: { key: `i.location_id::text`, label: `COALESCE(l.name,'-')`, order: `sales DESC` },
};

r.get('/sales/summary', requirePerm('cus_rpt', 'emp_rpt', 'account_det', 'view_home'), asyncHandler(async (req, res) => {
  const { from, to, loc } = range(req);
  const g = SALES_GROUPS[req.query.group_by || 'day'];
  if (!g) throw new HttpError(400, 'Invalid group_by');
  const { rows } = await query(
    `SELECT ${g.key} AS key, ${g.label} AS label, COUNT(*) FILTER (WHERE i.inv_mode='INV')::int AS invoices, COUNT(*) FILTER (WHERE i.inv_mode='RET')::int AS returns,
            COALESCE(SUM(${sign} * i.gross_total),0) AS gross, COALESCE(SUM(${sign} * (i.item_discount + i.bill_discount)),0) AS discount,
            COALESCE(SUM(${sign} * i.net_total),0) AS sales, COALESCE(SUM(${sign} * i.cost_total),0) AS cost, COALESCE(SUM(${sign} * i.profit),0) AS profit,
            COALESCE(SUM(${sign} * i.total_qty),0) AS qty, COALESCE(SUM(${sign} * i.cash_paid),0) AS cash, COALESCE(SUM(${sign} * i.card_paid),0) AS card,
            COALESCE(SUM(${sign} * i.credit_paid),0) AS credit, COALESCE(SUM(i.due_amount) FILTER (WHERE i.inv_mode='INV'),0) AS due
     ${SALES_BASE} GROUP BY 1, 2 ORDER BY ${g.order}`, [req.user.company_id, from, to, loc]);
  res.json(rows);
}));

const ITEM_GROUPS = {
  item:     { key: `ii.item_id::text`, label: `ii.item_name`, extra: `MAX(ii.item_code) AS code,` },
  category: { key: `COALESCE(it.category_id::text,'0')`, label: `COALESCE(c.name,'-')`, extra: `` },
  subcat:   { key: `COALESCE(it.sub_category_id::text,'0')`, label: `COALESCE(sc.name,'-')`, extra: `` },
  supplier: { key: `COALESCE(it.supplier_id::text,'0')`, label: `COALESCE(s.name,'-')`, extra: `` },
};

/** Item-wise / category-wise / supplier-wise sales (movement) with qty, sales, GP. */
r.get('/sales/items', requirePerm('item_rpt', 'cat_rpt', 'sup_rpt', 'view_home'), asyncHandler(async (req, res) => {
  const { from, to, loc } = range(req);
  const g = ITEM_GROUPS[req.query.group_by || 'item'];
  if (!g) throw new HttpError(400, 'Invalid group_by');
  const limit = Math.min(1000, parseInt(req.query.limit, 10) || 1000);
  const order = { qty: 'qty DESC', sales: 'sales DESC', profit: 'profit DESC', name: 'label' }[req.query.order_by || 'sales'];
  const { rows } = await query(
    `SELECT ${g.key} AS key, ${g.label} AS label, ${g.extra} COUNT(DISTINCT i.id)::int AS invoices,
            COALESCE(SUM(${sign} * ii.qty),0) AS qty, COALESCE(SUM(${sign} * ii.qty * ii.selling_price),0) AS gross,
            COALESCE(SUM(${sign} * ii.line_total),0) AS sales, COALESCE(SUM(${sign} * ii.qty * ii.cost_price),0) AS cost,
            COALESCE(SUM(${sign} * (ii.line_total - ii.qty * ii.cost_price)),0) AS profit
     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id LEFT JOIN items it ON it.id = ii.item_id
       LEFT JOIN categories c ON c.id = it.category_id LEFT JOIN sub_categories sc ON sc.id = it.sub_category_id LEFT JOIN suppliers s ON s.id = it.supplier_id
     WHERE i.company_id = $1 AND i.invoice_status = 'PRINTED' AND i.invoice_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR i.location_id = $4)
     GROUP BY 1, 2 ORDER BY ${order} LIMIT ${limit}`, [req.user.company_id, from, to, loc]);
  res.json(rows);
}));

/** Invoice-wise detail (rptInvWiseInvDet / rptSalesInvoiceHistory) */
r.get('/sales/invoices', requirePerm('cus_rpt', 'account_det', 'view_home'), asyncHandler(async (req, res) => {
  const { from, to, loc } = range(req);
  const { rows } = await query(
    `SELECT i.id, i.serial_no, i.invoice_date, i.invoice_time, i.inv_mode, i.customer_name, i.pay_mode, i.order_status, i.gross_total, i.item_discount + i.bill_discount AS discount,
            i.net_total, i.cost_total, i.profit, i.total_qty, i.due_amount, i.created_by
     ${SALES_BASE} ORDER BY i.invoice_date, i.id`, [req.user.company_id, from, to, loc]);
  res.json(rows);
}));

/** Top N items / customers / categories (rptSalesTop10*). */
r.get('/sales/top', requirePerm('view_home'), asyncHandler(async (req, res) => {
  const { from, to, loc } = range(req);
  const n = Math.min(50, parseInt(req.query.n, 10) || 10);
  const [items, customers, categories] = await Promise.all([
    query(`SELECT ii.item_name AS label, SUM(${sign} * ii.qty) AS qty, SUM(${sign} * ii.line_total) AS sales FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
           WHERE i.company_id = $1 AND i.invoice_status='PRINTED' AND i.invoice_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR i.location_id = $4) GROUP BY ii.item_id, ii.item_name ORDER BY sales DESC LIMIT ${n}`, [req.user.company_id, from, to, loc]),
    query(`SELECT i.customer_name AS label, COUNT(*)::int AS invoices, SUM(${sign} * i.net_total) AS sales ${SALES_BASE} AND i.customer_id IS NOT NULL GROUP BY i.customer_id, i.customer_name ORDER BY sales DESC LIMIT ${n}`, [req.user.company_id, from, to, loc]),
    query(`SELECT COALESCE(c.name,'-') AS label, SUM(${sign} * ii.qty) AS qty, SUM(${sign} * ii.line_total) AS sales FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id LEFT JOIN items it ON it.id = ii.item_id LEFT JOIN categories c ON c.id = it.category_id
           WHERE i.company_id = $1 AND i.invoice_status='PRINTED' AND i.invoice_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR i.location_id = $4) GROUP BY c.name ORDER BY sales DESC LIMIT ${n}`, [req.user.company_id, from, to, loc]),
  ]);
  res.json({ items: items.rows, customers: customers.rows, categories: categories.rows });
}));

// ---------------------------------------------------------------- purchases
r.get('/purchases/summary', requirePerm('sup_rpt', 'account_det'), asyncHandler(async (req, res) => {
  const { from, to, loc } = range(req);
  const groups = {
    day: [`p.purchase_date::text`, `p.purchase_date::text`], month: [`to_char(p.purchase_date,'YYYY-MM')`, `to_char(p.purchase_date,'YYYY-MM')`],
    year: [`to_char(p.purchase_date,'YYYY')`, `to_char(p.purchase_date,'YYYY')`], supplier: [`COALESCE(p.supplier_id::text,'0')`, `p.supplier_name`], user: [`p.created_by`, `p.created_by`],
  };
  const g = groups[req.query.group_by || 'day']; if (!g) throw new HttpError(400, 'Invalid group_by');
  const ps = `(CASE WHEN p.inv_mode = 'RET' THEN -1 ELSE 1 END)`;
  const { rows } = await query(
    `SELECT ${g[0]} AS key, ${g[1]} AS label, COUNT(*) FILTER (WHERE p.inv_mode='PCH')::int AS grns, COUNT(*) FILTER (WHERE p.inv_mode='RET')::int AS returns,
            COALESCE(SUM(${ps} * p.gross_total),0) AS gross, COALESCE(SUM(${ps} * (p.item_discount + p.bill_discount)),0) AS discount, COALESCE(SUM(${ps} * p.net_total),0) AS purchases,
            COALESCE(SUM(${ps} * p.total_qty),0) AS qty, COALESCE(SUM(p.paid_amount) FILTER (WHERE p.inv_mode='PCH'),0) AS paid, COALESCE(SUM(p.due_amount) FILTER (WHERE p.inv_mode='PCH'),0) AS due
     FROM purchases p WHERE p.company_id = $1 AND p.invoice_status = 'PRINTED' AND p.purchase_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR p.location_id = $4)
     GROUP BY 1, 2 ORDER BY ${g === groups.supplier || g === groups.user ? 'purchases DESC' : '1'}`, [req.user.company_id, from, to, loc]);
  res.json(rows);
}));

r.get('/purchases/items', requirePerm('sup_rpt', 'item_rpt'), asyncHandler(async (req, res) => {
  const { from, to, loc } = range(req);
  const byCat = req.query.group_by === 'category';
  const { rows } = await query(
    `SELECT ${byCat ? `COALESCE(c.name,'-')` : `pi.item_name`} AS label, ${byCat ? `''` : `MAX(pi.item_code)`} AS code,
            SUM(CASE WHEN p.inv_mode='RET' THEN -pi.qty ELSE pi.qty END) AS qty, SUM(CASE WHEN p.inv_mode='RET' THEN 0 ELSE pi.free_qty END) AS free_qty,
            SUM(CASE WHEN p.inv_mode='RET' THEN -pi.line_total ELSE pi.line_total END) AS amount, AVG(pi.cost_price) AS avg_cost
     FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id LEFT JOIN items it ON it.id = pi.item_id LEFT JOIN categories c ON c.id = it.category_id
     WHERE p.company_id = $1 AND p.invoice_status='PRINTED' AND p.purchase_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR p.location_id = $4)
     GROUP BY ${byCat ? 'c.name' : 'pi.item_id, pi.item_name'} ORDER BY amount DESC`, [req.user.company_id, from, to, loc]);
  res.json(rows);
}));

// ---------------------------------------------------------------- stock
r.get('/stock/valuation', requirePerm('stock_rpt'), asyncHandler(async (req, res) => {
  const loc = req.query.location_id || null;
  const byCat = req.query.group_by === 'category';
  const bySup = req.query.group_by === 'supplier';
  const label = byCat ? `COALESCE(c.name,'-')` : bySup ? `COALESCE(s.name,'-')` : `i.name`;
  const grp = byCat ? `c.name` : bySup ? `s.name` : `i.id, i.name`;
  const { rows } = await query(
    `SELECT ${label} AS label, ${byCat || bySup ? `COUNT(DISTINCT i.id)::int` : `MAX(i.code)`} AS code, COALESCE(SUM(sb.qty_remain),0) AS qty,
            COALESCE(SUM(sb.qty_remain * sb.cost_price),0) AS value_cost, COALESCE(SUM(sb.qty_remain * sb.selling_price),0) AS value_selling,
            COALESCE(SUM(sb.qty_remain * (sb.selling_price - sb.cost_price)),0) AS potential_profit
     FROM items i LEFT JOIN stock_batches sb ON sb.item_id = i.id AND ($2::bigint IS NULL OR sb.location_id = $2) LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN suppliers s ON s.id = i.supplier_id
     WHERE i.company_id = $1 AND i.active AND i.track_inventory GROUP BY ${grp} ORDER BY value_cost DESC`, [req.user.company_id, loc]);
  res.json(rows);
}));

r.get('/stock/reorder', requirePerm('stock_rpt'), asyncHandler(async (req, res) => {
  const loc = req.query.location_id || req.locationId;
  const { rows } = await query(
    `SELECT i.code, i.name, s.name AS supplier_name, SUM(sb.qty_remain) AS qty, MAX(sb.qty_min) AS qty_min, MAX(sb.qty_max) AS qty_max, GREATEST(MAX(sb.qty_max) - SUM(sb.qty_remain), 0) AS suggested
     FROM items i JOIN stock_batches sb ON sb.item_id = i.id AND sb.location_id = $2 LEFT JOIN suppliers s ON s.id = i.supplier_id
     WHERE i.company_id = $1 AND i.active GROUP BY i.id, s.name HAVING SUM(sb.qty_remain) <= MAX(sb.qty_min) ORDER BY i.name`, [req.user.company_id, loc]);
  res.json(rows);
}));

r.get('/stock/expiry', requirePerm('stock_rpt'), asyncHandler(async (req, res) => {
  const loc = req.query.location_id || req.locationId;
  const days = parseInt(req.query.days, 10) || 30;
  const { rows } = await query(
    `SELECT i.code, i.name, sb.batch_no, sb.expiry_date, sb.qty_remain, sb.cost_price, sb.qty_remain * sb.cost_price AS value, (sb.expiry_date - CURRENT_DATE) AS days_left
     FROM stock_batches sb JOIN items i ON i.id = sb.item_id WHERE sb.company_id = $1 AND sb.location_id = $2 AND sb.qty_remain > 0 AND sb.expiry_date IS NOT NULL AND sb.expiry_date <= CURRENT_DATE + ($3 || ' days')::interval
     ORDER BY sb.expiry_date`, [req.user.company_id, loc, String(days)]);
  res.json(rows);
}));

r.get('/stock/movement', requirePerm('stock_rpt'), asyncHandler(async (req, res) => {
  const { from, to, loc } = range(req);
  const { rows } = await query(
    `SELECT i.code, i.name,
            COALESCE(SUM(l.qty_in) FILTER (WHERE l.txn_type='OPEN'),0) AS opening,
            COALESCE(SUM(l.qty_in) FILTER (WHERE l.txn_type IN ('PCH','TRF','CANCEL')),0) AS purchased,
            COALESCE(SUM(l.qty_out) FILTER (WHERE l.txn_type='INV'),0) AS sold,
            COALESCE(SUM(l.qty_in) FILTER (WHERE l.txn_type='INVR'),0) AS returned,
            COALESCE(SUM(l.qty_in - l.qty_out) FILTER (WHERE l.txn_type='QTYA'),0) AS adjusted,
            COALESCE(SUM(l.qty_out) FILTER (WHERE l.txn_type IN ('TRF','PCHR')),0) AS transferred_out,
            (SELECT COALESCE(SUM(qty_remain),0) FROM stock_batches sb WHERE sb.item_id = i.id AND ($4::bigint IS NULL OR sb.location_id = $4)) AS on_hand
     FROM item_ledger l JOIN items i ON i.id = l.item_id
     WHERE l.company_id = $1 AND l.txn_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR l.location_id = $4) GROUP BY i.id ORDER BY i.name`, [req.user.company_id, from, to, loc]);
  res.json(rows);
}));

// ---------------------------------------------------------------- outstanding
r.get('/outstanding/customers', requirePerm('cus_rpt', 'account_det'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.code, c.name, c.mobile, c.due_amount, c.advance_amount, c.credit_limit,
            COALESCE(SUM(i.due_amount) FILTER (WHERE CURRENT_DATE - i.invoice_date <= 30),0) AS age_0_30,
            COALESCE(SUM(i.due_amount) FILTER (WHERE CURRENT_DATE - i.invoice_date BETWEEN 31 AND 60),0) AS age_31_60,
            COALESCE(SUM(i.due_amount) FILTER (WHERE CURRENT_DATE - i.invoice_date BETWEEN 61 AND 90),0) AS age_61_90,
            COALESCE(SUM(i.due_amount) FILTER (WHERE CURRENT_DATE - i.invoice_date > 90),0) AS age_90_plus,
            MIN(i.invoice_date) FILTER (WHERE i.due_amount > 0) AS oldest_due
     FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id AND i.invoice_status='PRINTED' AND i.inv_mode='INV' AND i.due_amount > 0
     WHERE c.company_id = $1 AND (c.due_amount <> 0 OR c.advance_amount <> 0) GROUP BY c.id ORDER BY c.due_amount DESC`, [req.user.company_id]);
  res.json(rows);
}));

r.get('/outstanding/suppliers', requirePerm('sup_rpt', 'account_det'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.code, s.name, s.mobile, s.due_amount, s.advance_amount,
            COALESCE(SUM(p.due_amount) FILTER (WHERE CURRENT_DATE - p.purchase_date <= 30),0) AS age_0_30,
            COALESCE(SUM(p.due_amount) FILTER (WHERE CURRENT_DATE - p.purchase_date BETWEEN 31 AND 60),0) AS age_31_60,
            COALESCE(SUM(p.due_amount) FILTER (WHERE CURRENT_DATE - p.purchase_date BETWEEN 61 AND 90),0) AS age_61_90,
            COALESCE(SUM(p.due_amount) FILTER (WHERE CURRENT_DATE - p.purchase_date > 90),0) AS age_90_plus
     FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id AND p.invoice_status='PRINTED' AND p.inv_mode='PCH' AND p.due_amount > 0
     WHERE s.company_id = $1 AND (s.due_amount <> 0 OR s.advance_amount <> 0) GROUP BY s.id ORDER BY s.due_amount DESC`, [req.user.company_id]);
  res.json(rows);
}));

/** Customer statement: invoices, returns and payments in date order with running balance. */
r.get('/statement/customer/:id', requirePerm('cus_rpt', 'account_det'), asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const { rows: [cus] } = await query(`SELECT id, code, name, mobile, address, due_amount, opening_balance FROM customers WHERE id = $1 AND company_id = $2`, [req.params.id, req.user.company_id]);
  if (!cus) throw new HttpError(404, 'Customer not found');
  const { rows } = await query(
    `SELECT * FROM (
       SELECT invoice_date AS txn_date, created_at, serial_no AS ref, CASE WHEN inv_mode='RET' THEN 'Sales Return' ELSE 'Invoice' END AS type,
              CASE WHEN inv_mode='RET' THEN 0 ELSE net_total END AS debit,
              CASE WHEN inv_mode='RET' THEN net_total ELSE net_total - credit_paid END AS credit   -- paid at the counter; later settlements appear as Payment rows
       FROM invoices WHERE customer_id = $1 AND invoice_status='PRINTED'
       UNION ALL
       SELECT pay_date, created_at, serial_no, CASE entry_type WHEN 'DEBIT_ADJ' THEN 'Debit Adjustment' WHEN 'CREDIT_ADJ' THEN 'Credit Adjustment' ELSE 'Payment' END,
              CASE WHEN entry_type='DEBIT_ADJ' THEN amount ELSE 0 END, CASE WHEN entry_type='DEBIT_ADJ' THEN 0 ELSE amount END
       FROM customer_payments WHERE customer_id = $1
     ) x WHERE txn_date BETWEEN $2 AND $3 ORDER BY txn_date, created_at`, [cus.id, from, to]);
  let bal = 0; const lines = rows.map(l => { bal = round2(bal + num(l.debit) - num(l.credit)); return { ...l, balance: bal }; });
  res.json({ customer: cus, lines });
}));

r.get('/statement/supplier/:id', requirePerm('sup_rpt', 'account_det'), asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const { rows: [sup] } = await query(`SELECT id, code, name, mobile, address, due_amount, opening_balance FROM suppliers WHERE id = $1 AND company_id = $2`, [req.params.id, req.user.company_id]);
  if (!sup) throw new HttpError(404, 'Supplier not found');
  const { rows } = await query(
    `SELECT * FROM (
       SELECT purchase_date AS txn_date, created_at, serial_no AS ref, CASE WHEN inv_mode='RET' THEN 'Purchase Return' ELSE 'GRN' END AS type,
              CASE WHEN inv_mode='RET' THEN 0 ELSE net_total END AS credit,
              CASE WHEN inv_mode='RET' THEN net_total ELSE paid_amount - COALESCE((SELECT SUM(amount) FROM supplier_payment_allocations a WHERE a.purchase_id = purchases.id),0) END AS debit
       FROM purchases WHERE supplier_id = $1 AND invoice_status='PRINTED'
       UNION ALL
       SELECT pay_date, created_at, serial_no, CASE entry_type WHEN 'DEBIT_ADJ' THEN 'Debit Adjustment' ELSE 'Payment' END, CASE WHEN entry_type='DEBIT_ADJ' THEN amount ELSE 0 END, CASE WHEN entry_type='DEBIT_ADJ' THEN 0 ELSE amount END
       FROM supplier_payments WHERE supplier_id = $1
     ) x WHERE txn_date BETWEEN $2 AND $3 ORDER BY txn_date, created_at`, [sup.id, from, to]);
  let bal = 0; const lines = rows.map(l => { bal = round2(bal + num(l.credit) - num(l.debit)); return { ...l, balance: bal }; });
  res.json({ supplier: sup, lines });
}));

// ---------------------------------------------------------------- income / expense & P&L
r.get('/income-expense', requirePerm('account_det'), asyncHandler(async (req, res) => {
  const { from, to, loc } = range(req);
  const g = req.query.group_by === 'day' ? `x.txn_date::text` : req.query.group_by === 'month' ? `to_char(x.txn_date,'YYYY-MM')` : `COALESCE(c.name,'Uncategorised')`;
  const { rows } = await query(
    `SELECT ${g} AS label, x.kind, COUNT(*)::int AS entries, SUM(x.amount) AS amount FROM income_expenses x LEFT JOIN expense_categories c ON c.id = x.category_id
     WHERE x.company_id = $1 AND x.txn_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR x.location_id = $4) GROUP BY 1, 2 ORDER BY 1, 2`, [req.user.company_id, from, to, loc]);
  res.json(rows);
}));

r.get('/profit-loss', requirePerm('account_det'), asyncHandler(async (req, res) => {
  const { from, to, loc } = range(req);
  const p = [req.user.company_id, from, to, loc];
  const [{ rows: [s] }, { rows: [pc] }, { rows: ie }, { rows: [adj] }] = await Promise.all([
    query(`SELECT COALESCE(SUM(${sign} * i.net_total),0) AS sales, COALESCE(SUM(${sign} * i.cost_total),0) AS cogs, COALESCE(SUM(${sign} * (i.item_discount + i.bill_discount)),0) AS discounts, COALESCE(SUM(${sign} * i.gross_total),0) AS gross ${SALES_BASE}`, p),
    query(`SELECT COALESCE(SUM(CASE WHEN inv_mode='RET' THEN -net_total ELSE net_total END),0) AS purchases FROM purchases WHERE company_id = $1 AND invoice_status='PRINTED' AND purchase_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR location_id = $4)`, p),
    query(`SELECT x.kind, COALESCE(c.direct, TRUE) AS direct, COALESCE(c.name,'Uncategorised') AS category, SUM(x.amount) AS amount FROM income_expenses x LEFT JOIN expense_categories c ON c.id = x.category_id
           WHERE x.company_id = $1 AND x.txn_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR x.location_id = $4) GROUP BY 1,2,3 ORDER BY 1,2,3`, p),
    query(`SELECT COALESCE(SUM(sai.qty * sai.cost_price),0) AS stock_adjustments FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adjustment_id
           WHERE sa.company_id = $1 AND sa.adj_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR sa.location_id = $4)`, p),
  ]);
  const income = ie.filter(x => x.kind === 'INCOME'); const expenses = ie.filter(x => x.kind === 'EXPENSE');
  const otherIncome = income.reduce((a, x) => a + num(x.amount), 0);
  const totalExpenses = expenses.reduce((a, x) => a + num(x.amount), 0);
  const grossProfit = round2(num(s.sales) - num(s.cogs));
  const netProfit = round2(grossProfit + otherIncome - totalExpenses + num(adj.stock_adjustments));
  res.json({
    period: { from, to }, gross_sales: num(s.gross), discounts: num(s.discounts), net_sales: num(s.sales), cost_of_goods_sold: num(s.cogs), gross_profit: grossProfit,
    gross_margin_pct: num(s.sales) ? round2(grossProfit / num(s.sales) * 100) : 0, purchases: num(pc.purchases), other_income: round2(otherIncome), income, expenses,
    total_expenses: round2(totalExpenses), stock_adjustments: num(adj.stock_adjustments), net_profit: netProfit,
  });
}));

/** Day summary (rptDayReportSummery): everything that happened on one day. */
r.get('/day-summary', requirePerm('print_day_summary', 'view_home'), asyncHandler(async (req, res) => {
  const { from, to, loc } = range(req);
  const p = [req.user.company_id, from, to, loc];
  const [{ rows: [sales] }, { rows: [pur] }, { rows: [cp] }, { rows: [sp] }, { rows: [ie] }, { rows: [bank] }, { rows: paymodes }] = await Promise.all([
    query(`SELECT COUNT(*) FILTER (WHERE i.inv_mode='INV')::int AS invoices, COUNT(*) FILTER (WHERE i.inv_mode='RET')::int AS returns, COALESCE(SUM(${sign}*i.net_total),0) AS net, COALESCE(SUM(${sign}*i.gross_total),0) AS gross,
                  COALESCE(SUM(${sign}*(i.item_discount+i.bill_discount)),0) AS discount, COALESCE(SUM(${sign}*i.cost_total),0) AS cost, COALESCE(SUM(${sign}*i.profit),0) AS profit, COALESCE(SUM(${sign}*i.total_qty),0) AS qty,
                  COALESCE(SUM(${sign}*i.cash_paid),0) AS cash, COALESCE(SUM(${sign}*i.card_paid),0) AS card, COALESCE(SUM(${sign}*i.cheque_paid),0) AS cheque, COALESCE(SUM(${sign}*i.bank_paid),0) AS bank,
                  COALESCE(SUM(${sign}*i.credit_paid),0) AS credit, COALESCE(SUM(${sign}*i.voucher_paid),0) AS voucher, COALESCE(SUM(${sign}*i.points_redeemed),0) AS points ${SALES_BASE}`, p),
    query(`SELECT COUNT(*)::int AS grns, COALESCE(SUM(CASE WHEN inv_mode='RET' THEN -net_total ELSE net_total END),0) AS net, COALESCE(SUM(paid_amount) FILTER (WHERE inv_mode='PCH'),0) AS paid FROM purchases WHERE company_id=$1 AND invoice_status='PRINTED' AND purchase_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR location_id=$4)`, p),
    query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total, COALESCE(SUM(amount) FILTER (WHERE pay_type='CASH'),0) AS cash FROM customer_payments WHERE company_id=$1 AND pay_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR location_id=$4) AND entry_type='PAYMENT'`, p),
    query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total, COALESCE(SUM(amount) FILTER (WHERE pay_type='CASH'),0) AS cash FROM supplier_payments WHERE company_id=$1 AND pay_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR location_id=$4) AND entry_type='PAYMENT'`, p),
    query(`SELECT COALESCE(SUM(amount) FILTER (WHERE kind='INCOME'),0) AS income, COALESCE(SUM(amount) FILTER (WHERE kind='EXPENSE'),0) AS expense, COALESCE(SUM(amount) FILTER (WHERE kind='INCOME' AND pay_mode='CASH'),0) AS cash_income, COALESCE(SUM(amount) FILTER (WHERE kind='EXPENSE' AND pay_mode='CASH'),0) AS cash_expense FROM income_expenses WHERE company_id=$1 AND txn_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR location_id=$4)`, p),
    query(`SELECT COALESCE(SUM(amount) FILTER (WHERE txn_type IN ('DEPOSIT','CHEQUE_IN')),0) AS deposits, COALESCE(SUM(amount) FILTER (WHERE txn_type IN ('WITHDRAW','CHEQUE_OUT')),0) AS withdrawals FROM bank_transactions WHERE company_id=$1 AND txn_date BETWEEN $2 AND $3 AND ($4::bigint IS NULL OR location_id=$4)`, p),
    query(`SELECT i.pay_mode AS label, COUNT(*)::int AS invoices, COALESCE(SUM(${sign}*i.net_total),0) AS sales ${SALES_BASE} GROUP BY i.pay_mode ORDER BY sales DESC`, p),
  ]);
  const cashInHand = round2(num(sales.cash) + num(cp.cash) + num(ie.cash_income) - num(sp.cash) - num(ie.cash_expense));
  res.json({ period: { from, to }, sales, purchases: pur, customer_payments: cp, supplier_payments: sp, income_expense: ie, bank, pay_modes: paymodes, cash_in_hand: cashInHand });
}));

// ---------------------------------------------------------------- activity log
r.get('/activity', requirePerm('user_control'), asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await query(`SELECT * FROM activity_log WHERE company_id = $1 AND created_at::date BETWEEN $2 AND $3 ORDER BY id DESC LIMIT 1000`, [req.user.company_id, from, to]);
  res.json(rows);
}));

export default r;
