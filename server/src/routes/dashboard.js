import { Router } from 'express';
import { query, dbKind } from '../db.js';
import { asyncHandler } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { today } from '../lib/util.js';

const r = Router();

r.get('/', requirePerm('view_home'), asyncHandler(async (req, res) => {
  const c = req.user.company_id; const d = today(); const loc = req.query.location_id || null;
  const sign = `(CASE WHEN inv_mode='RET' THEN -1 ELSE 1 END)`;
  const base = `FROM invoices WHERE company_id = $1 AND invoice_status = 'PRINTED' AND ($2::bigint IS NULL OR location_id = $2)`;
  const [
    { rows: [todayS] }, { rows: [monthS] }, { rows: trend }, { rows: [stock] }, { rows: [recv] }, { rows: [pay] }, { rows: topItems }, { rows: recent }, { rows: [ie] }, { rows: [chq] }, { rows: lowStock },
  ] = await Promise.all([
    query(`SELECT COUNT(*) FILTER (WHERE inv_mode='INV')::int AS invoices, COALESCE(SUM(${sign}*net_total),0) AS sales, COALESCE(SUM(${sign}*profit),0) AS profit, COALESCE(SUM(${sign}*cash_paid),0) AS cash ${base} AND invoice_date = $3`, [c, loc, d]),
    query(`SELECT COUNT(*) FILTER (WHERE inv_mode='INV')::int AS invoices, COALESCE(SUM(${sign}*net_total),0) AS sales, COALESCE(SUM(${sign}*profit),0) AS profit ${base} AND date_trunc('month', invoice_date) = date_trunc('month', $3::date)`, [c, loc, d]),
    // the last 14 days, each one present even with no sales; MySQL has no generate_series, so it counts them out
    dbKind === 'mysql'
      ? query(`WITH RECURSIVE g(day) AS (SELECT DATE_SUB(CAST(? AS DATE), INTERVAL 13 DAY) UNION ALL SELECT DATE_ADD(day, INTERVAL 1 DAY) FROM g WHERE day < CAST(? AS DATE))
           SELECT CAST(g.day AS CHAR) AS day, COALESCE(SUM(${sign}*i.net_total),0) AS sales, CAST(COUNT(CASE WHEN i.inv_mode='INV' THEN i.id END) AS SIGNED) AS invoices
           FROM g LEFT JOIN invoices i ON i.invoice_date = g.day AND i.company_id = ? AND i.invoice_status='PRINTED' AND (? IS NULL OR i.location_id = ?)
           GROUP BY g.day ORDER BY g.day`, [d, d, c, loc, loc])
      : query(`SELECT g.day::date::text AS day, COALESCE(SUM(${sign}*i.net_total),0) AS sales, COUNT(i.id) FILTER (WHERE i.inv_mode='INV')::int AS invoices
           FROM generate_series($3::date - INTERVAL '13 days', $3::date, INTERVAL '1 day') g(day)
           LEFT JOIN invoices i ON i.invoice_date = g.day::date AND i.company_id = $1 AND i.invoice_status='PRINTED' AND ($2::bigint IS NULL OR i.location_id = $2)
           GROUP BY g.day ORDER BY g.day`, [c, loc, d]),
    query(`SELECT COUNT(DISTINCT i.id)::int AS items, COALESCE(SUM(sb.qty_remain*sb.cost_price),0) AS value_cost, COALESCE(SUM(sb.qty_remain*sb.selling_price),0) AS value_selling,
                  COUNT(DISTINCT i.id) FILTER (WHERE sb.qty_remain <= sb.qty_min AND sb.qty_min > 0)::int AS low_items
           FROM items i LEFT JOIN stock_batches sb ON sb.item_id = i.id AND ($2::bigint IS NULL OR sb.location_id = $2) WHERE i.company_id = $1 AND i.active`, [c, loc]),
    query(`SELECT COALESCE(SUM(due_amount),0) AS total, COUNT(*) FILTER (WHERE due_amount > 0)::int AS customers FROM customers WHERE company_id = $1`, [c]),
    query(`SELECT COALESCE(SUM(due_amount),0) AS total, COUNT(*) FILTER (WHERE due_amount > 0)::int AS suppliers FROM suppliers WHERE company_id = $1`, [c]),
    query(`SELECT ii.item_name AS label, SUM(${sign.replace(/inv_mode/g, 'i.inv_mode')}*ii.qty) AS qty, SUM(${sign.replace(/inv_mode/g, 'i.inv_mode')}*ii.line_total) AS sales
           FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.company_id = $1 AND i.invoice_status='PRINTED' AND i.invoice_date >= $3::date - 30 AND ($2::bigint IS NULL OR i.location_id = $2)
           GROUP BY ii.item_id, ii.item_name ORDER BY sales DESC LIMIT 8`, [c, loc, d]),
    query(`SELECT id, serial_no, invoice_date, invoice_time, inv_mode, customer_name, net_total, pay_mode, order_status, created_by ${base} ORDER BY id DESC LIMIT 10`, [c, loc]),
    query(`SELECT COALESCE(SUM(amount) FILTER (WHERE kind='INCOME'),0) AS income, COALESCE(SUM(amount) FILTER (WHERE kind='EXPENSE'),0) AS expense FROM income_expenses WHERE company_id = $1 AND date_trunc('month', txn_date) = date_trunc('month', $2::date)`, [c, d]),
    query(`SELECT COUNT(*)::int AS pending, COALESCE(SUM(amount),0) AS amount, COUNT(*) FILTER (WHERE cheque_date <= CURRENT_DATE + 7)::int AS due_soon FROM cheques WHERE company_id = $1 AND status='PENDING' AND direction='IN'`, [c]),
    query(`SELECT i.code, i.name, SUM(sb.qty_remain) AS qty, MAX(sb.qty_min) AS qty_min FROM items i JOIN stock_batches sb ON sb.item_id = i.id AND ($2::bigint IS NULL OR sb.location_id = $2)
           WHERE i.company_id = $1 AND i.active GROUP BY i.id HAVING SUM(sb.qty_remain) <= MAX(sb.qty_min) ORDER BY qty LIMIT 8`, [c, loc]),
  ]);
  res.json({ date: d, today: todayS, month: monthS, trend, stock, receivables: recv, payables: pay, top_items: topItems, recent_invoices: recent, income_expense: ie, cheques: chq, low_stock: lowStock });
}));

export default r;
