// Master data: categories, sub-categories, customers, suppliers, employees, items, banks, expense categories, locations, terminals
import { Router } from 'express';
import { crudRouter } from '../lib/crud.js';
import { query, dbKind } from '../db.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';

const r = Router();

r.use('/categories', crudRouter({
  table: 'categories', codeKey: 'CAT', codePrefix: 'C',
  columns: ['code', 'name', 'remark', 'show_on_web', 'active'],
  searchColumns: ['code', 'name'], orderBy: 't.name',
  perms: { create: 'add_cat', update: 'edit_cat', delete: 'del_cat' },
}));

r.use('/sub-categories', crudRouter({
  table: 'sub_categories', codeKey: 'SCAT', codePrefix: 'SC',
  columns: ['category_id', 'code', 'name', 'remark', 'active'],
  searchColumns: ['code', 'name'], orderBy: 't.name',
  selectSql: `SELECT t.*, c.name AS category_name FROM sub_categories t LEFT JOIN categories c ON c.id = t.category_id`,
  filters: { category_id: 't.category_id = $' },
  perms: { create: 'add_cat', update: 'edit_cat', delete: 'del_cat' },
}));

r.use('/suppliers', crudRouter({
  table: 'suppliers', codeKey: 'SUP', codePrefix: 'S',
  columns: ['code', 'name', 'phone', 'mobile', 'email', 'website', 'address', 'contact_person', 'contact_mobile', 'sup_group', 'remark', 'opening_balance', 'active'],
  searchColumns: ['code', 'name', 'mobile', 'phone'], orderBy: 't.name',
  perms: { create: 'add_sup', update: 'edit_sup', delete: 'del_sup' },
}));

r.use('/customers', crudRouter({
  table: 'customers', codeKey: 'CUS', codePrefix: 'CUS',
  columns: ['code', 'nic', 'name', 'category', 'price_category', 'cus_group', 'phone', 'mobile', 'email', 'address', 'company_name', 'occupation', 'remark',
    'opening_balance', 'credit_limit', 'allow_cash_discount', 'allow_cus_discount', 'allow_staff_discount', 'active'],
  searchColumns: ['code', 'name', 'mobile', 'phone', 'nic'], orderBy: 't.name',
  perms: { create: 'add_cus', update: 'edit_cus', delete: 'del_cus' },
}));

r.use('/employees', crudRouter({
  table: 'employees', codeKey: 'EMP', codePrefix: 'E',
  columns: ['location_id', 'code', 'nic', 'name', 'designation', 'department', 'emp_type', 'phone', 'mobile', 'email', 'address', 'salary_type', 'basic_salary', 'is_salesman', 'active'],
  searchColumns: ['code', 'name', 'mobile'], orderBy: 't.name',
  perms: { create: 'add_emp', update: 'edit_emp', delete: 'del_emp' },
}));

r.use('/banks', crudRouter({
  table: 'banks', codeKey: 'BNK', codePrefix: 'B',
  columns: ['code', 'bank_name', 'branch', 'account_no', 'account_type', 'opening_balance', 'active'],
  searchColumns: ['code', 'bank_name', 'branch', 'account_no'], orderBy: 't.bank_name',
  perms: { create: 'add_bank', update: 'edit_bank', delete: 'del_bank' },
}));

r.use('/expense-categories', crudRouter({
  table: 'expense_categories', codeKey: 'DCAT', codePrefix: 'D',
  columns: ['code', 'name', 'kind', 'direct', 'active'],
  searchColumns: ['code', 'name'], orderBy: 't.kind, t.name',
  filters: { kind: 't.kind = $' },
  perms: { create: 'add_expenses', update: 'add_expenses', delete: 'add_expenses' },
}));

r.use('/locations', crudRouter({
  table: 'locations',
  columns: ['code', 'name', 'address', 'manager_name', 'phone', 'mobile', 'active'],
  searchColumns: ['code', 'name'], orderBy: 't.code',
  perms: { create: 'company_settings', update: 'company_settings', delete: 'company_settings' },
}));

// terminals are scoped by location, not company
const terminals = Router();
terminals.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT t.*, l.name AS location_name FROM terminals t JOIN locations l ON l.id = t.location_id WHERE l.company_id = $1 ORDER BY l.code, t.code`, [req.user.company_id]);
  res.json({ data: rows, total: rows.length });
}));
terminals.post('/', requirePerm('company_settings'), asyncHandler(async (req, res) => {
  const { location_id, code, name } = req.body;
  if (!location_id || !code || !name) throw new HttpError(400, 'location_id, code and name required');
  const { rows: [row] } = await query(`INSERT INTO terminals (location_id, code, name) VALUES ($1,$2,$3) RETURNING *`, [location_id, code, name]);
  res.status(201).json(row);
}));
terminals.put('/:id', requirePerm('company_settings'), asyncHandler(async (req, res) => {
  const { name, active, registered_pc } = req.body;
  const { rows: [row] } = await query(`UPDATE terminals SET name = COALESCE($1,name), active = COALESCE($2,active), registered_pc = COALESCE($3,registered_pc) WHERE id = $4 RETURNING *`,
    [name, active, registered_pc, req.params.id]);
  res.json(row);
}));
r.use('/terminals', terminals);

// ------------------------------------------------------------------ items (custom: joins + stock summary)
const itemCols = ['code', 'barcode', 'barcode1', 'barcode2', 'name', 'name2', 'item_type', 'unit', 'category_id', 'sub_category_id', 'supplier_id',
  'part_no', 'make', 'bin_no', 'allow_decimal', 'track_inventory', 'allow_discount', 'allow_wholesale', 'allow_loyalty', 'allow_edit_price_on_invoice',
  'ask_serial_on_invoice', 'warranty_months', 'remind_reorder', 'remind_expiry', 'remark', 'image_url', 'show_on_web', 'active', 'updated_at'];

const items = crudRouter({
  table: 'items', codeKey: 'ITEM', codePrefix: 'I',
  columns: itemCols,
  searchColumns: ['code', 'barcode', 'barcode1', 'barcode2', 'name', 'name2', 'part_no'], orderBy: 't.name',
  selectSql: `SELECT t.*, c.name AS category_name, sc.name AS sub_category_name, s.name AS supplier_name,
                (SELECT COALESCE(SUM(qty_remain),0) FROM stock_batches sb WHERE sb.item_id = t.id) AS qty_on_hand,
                (SELECT selling_price FROM stock_batches sb WHERE sb.item_id = t.id ORDER BY sb.id DESC LIMIT 1) AS selling_price,
                (SELECT cost_price FROM stock_batches sb WHERE sb.item_id = t.id ORDER BY sb.id DESC LIMIT 1) AS cost_price
              FROM items t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN sub_categories sc ON sc.id = t.sub_category_id LEFT JOIN suppliers s ON s.id = t.supplier_id`,
  filters: { category_id: 't.category_id = $', supplier_id: 't.supplier_id = $' },
  perms: { create: 'add_item', update: 'edit_item', delete: 'del_item' },
});

/** POS lookup: exact barcode/code first, then name search. Returns item + batches at the location. */
items.get('/lookup/pos', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const locationId = req.locationId;
  if (dbKind === 'mysql') {
    // MySQL cannot order or filter inside a JSON aggregate: the items first, then their batches, put together here
    const { rows: found } = await query(
      `SELECT i.id, i.code, i.barcode, i.name, i.unit, i.item_type, i.allow_decimal, i.allow_discount, i.allow_wholesale, i.allow_loyalty,
              i.allow_edit_price_on_invoice, i.ask_serial_on_invoice, i.warranty_months, i.track_inventory,
              (CASE WHEN i.barcode = $2 OR i.barcode1 = $2 OR i.barcode2 = $2 OR i.code = $2 THEN 0 ELSE 1 END) AS rank
       FROM items i
       WHERE i.company_id = $1 AND i.active
         AND (i.barcode = $2 OR i.barcode1 = $2 OR i.barcode2 = $2 OR i.code = $2 OR i.name ILIKE $3 OR i.name2 ILIKE $3)
       ORDER BY rank, i.name LIMIT 30`,
      [req.user.company_id, q, `%${q}%`]);
    const ids = found.map(r => r.id);
    const { rows: batches } = ids.length ? await query(
      `SELECT id, item_id, batch_no, cost_price, selling_price, discount_price, wholesale_price, mrp, offer_price, cus_cat_price, qty_remain, expiry_date, warranty_months
       FROM stock_batches WHERE location_id = $1 AND item_id = ANY($2) ORDER BY id`, [locationId, ids]) : { rows: [] };
    return res.json(found.map(r => ({ ...r, batches: batches.filter(b => b.item_id === r.id).map(({ item_id, ...b }) => b) })));
  }
  const { rows } = await query(
    `SELECT i.id, i.code, i.barcode, i.name, i.unit, i.item_type, i.allow_decimal, i.allow_discount, i.allow_wholesale, i.allow_loyalty,
            i.allow_edit_price_on_invoice, i.ask_serial_on_invoice, i.warranty_months, i.track_inventory,
            COALESCE(json_agg(json_build_object('id', sb.id, 'batch_no', sb.batch_no, 'cost_price', sb.cost_price, 'selling_price', sb.selling_price,
              'discount_price', sb.discount_price, 'wholesale_price', sb.wholesale_price, 'mrp', sb.mrp, 'offer_price', sb.offer_price,
              'cus_cat_price', sb.cus_cat_price, 'qty_remain', sb.qty_remain, 'expiry_date', sb.expiry_date, 'warranty_months', sb.warranty_months)
              ORDER BY sb.id) FILTER (WHERE sb.id IS NOT NULL), '[]') AS batches,
            (CASE WHEN i.barcode = $2 OR i.barcode1 = $2 OR i.barcode2 = $2 OR i.code = $2 THEN 0 ELSE 1 END) AS rank
     FROM items i
     LEFT JOIN stock_batches sb ON sb.item_id = i.id AND sb.location_id = $3
     WHERE i.company_id = $1 AND i.active
       AND (i.barcode = $2 OR i.barcode1 = $2 OR i.barcode2 = $2 OR i.code = $2 OR i.name ILIKE $4 OR i.name2 ILIKE $4)
     GROUP BY i.id ORDER BY rank, i.name LIMIT 30`,
    [req.user.company_id, q, locationId, `%${q}%`]);
  res.json(rows);
}));

/** Stock batches (price links) for one item across locations. */
items.get('/:id/batches', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT sb.*, l.name AS location_name FROM stock_batches sb JOIN locations l ON l.id = sb.location_id
     WHERE sb.item_id = $1 AND sb.company_id = $2 ORDER BY sb.location_id, sb.id`, [req.params.id, req.user.company_id]);
  res.json(rows);
}));

/** Update prices / reorder levels on a batch (legacy "Price Change" with chkPriceChange). */
items.put('/batches/:batchId', requirePerm('price_change'), asyncHandler(async (req, res) => {
  const allowed = ['cost_price', 'selling_price', 'discount_price', 'wholesale_price', 'mrp', 'offer_price', 'qty_min', 'qty_max', 'expiry_date', 'warranty_months'];
  const sets = []; const values = [];
  for (const c of allowed) if (req.body[c] !== undefined) { values.push(req.body[c] === '' ? null : req.body[c]); sets.push(`${c} = $${values.length}`); }
  if (!sets.length) throw new HttpError(400, 'No data');
  values.push(req.params.batchId, req.user.company_id);
  const { rows: [row] } = await query(`UPDATE stock_batches SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`, values);
  if (!row) throw new HttpError(404, 'Batch not found');
  res.json(row);
}));

/** Create an opening-stock batch for an item (used by the item form's "opening stock" section). */
items.post('/:id/opening-stock', requirePerm('qty_adjust', 'add_item'), asyncHandler(async (req, res) => {
  const { location_id = req.locationId, qty = 0, cost_price = 0, selling_price = 0, discount_price, wholesale_price, mrp, qty_min = 0, expiry_date } = req.body;
  const { rows: [item] } = await query(`SELECT id FROM items WHERE id = $1 AND company_id = $2`, [req.params.id, req.user.company_id]);
  if (!item) throw new HttpError(404, 'Item not found');
  const { rows: [{ n }] } = await query(`SELECT COUNT(*)::int + 1 AS n FROM stock_batches WHERE item_id = $1 AND location_id = $2`, [item.id, location_id]);
  const { rows: [sb] } = await query(
    `INSERT INTO stock_batches (company_id, location_id, item_id, batch_no, cost_price, selling_price, discount_price, wholesale_price, mrp, qty_received, qty_remain, qty_min, avg_cost, expiry_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$5,$12,$13) RETURNING *`,
    [req.user.company_id, location_id, item.id, String(n), cost_price, selling_price, discount_price ?? selling_price, wholesale_price ?? selling_price, mrp ?? selling_price, qty, qty_min, expiry_date || null, req.user.username]);
  if (Number(qty) > 0) {
    await query(`INSERT INTO item_ledger (company_id, location_id, item_id, batch_id, txn_type, ref_no, qty_in, balance, cost_price, selling_price, created_by)
                 VALUES ($1,$2,$3,$4,'OPEN','OPENING',$5,$5,$6,$7,$8)`, [req.user.company_id, location_id, item.id, sb.id, qty, cost_price, selling_price, req.user.username]);
  }
  res.status(201).json(sb);
}));

r.use('/items', items);

export default r;
