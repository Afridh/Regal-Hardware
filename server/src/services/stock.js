// Stock movements.  Every function takes a pg client already inside a transaction.
import { HttpError } from '../lib/errors.js';
import { num } from '../lib/util.js';

async function ledger(client, { companyId, locationId, itemId, batchId, txnType, refNo, qtyIn = 0, qtyOut = 0, costPrice = 0, sellingPrice = 0, user, date }) {
  const { rows: [{ bal }] } = await client.query(
    `SELECT COALESCE(SUM(qty_remain),0) AS bal FROM stock_batches WHERE item_id = $1 AND location_id = $2`, [itemId, locationId]);
  await client.query(
    `INSERT INTO item_ledger (company_id, location_id, item_id, batch_id, txn_date, txn_type, ref_no, qty_in, qty_out, balance, cost_price, selling_price, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12,$13)`,
    [companyId, locationId, itemId, batchId, date || null, txnType, refNo, qtyIn, qtyOut, bal, costPrice, sellingPrice, user]);
}

/**
 * Deduct qty from stock.  If batchId given, take from that batch (going negative only when allowNegative);
 * otherwise FIFO across batches at the location.  Returns [{batch_id, qty, cost_price}] consumed.
 */
export async function deductStock(client, { companyId, locationId, itemId, batchId, qty, txnType, refNo, sellingPrice, user, allowNegative = false, date }) {
  qty = num(qty);
  if (qty <= 0) return [];
  const consumed = [];

  if (batchId) {
    const { rows: [b] } = await client.query(`SELECT * FROM stock_batches WHERE id = $1 AND item_id = $2 FOR UPDATE`, [batchId, itemId]);
    if (!b) throw new HttpError(400, `Stock batch ${batchId} not found`);
    if (!allowNegative && b.qty_remain < qty) throw new HttpError(400, `Insufficient stock for item ${itemId} (have ${b.qty_remain}, need ${qty})`);
    await client.query(`UPDATE stock_batches SET qty_remain = qty_remain - $1, qty_sold = qty_sold + $1, last_sale_date = CURRENT_DATE, last_sale_price = $2, updated_at = now() WHERE id = $3`,
      [qty, sellingPrice ?? b.selling_price, b.id]);
    consumed.push({ batch_id: b.id, qty, cost_price: b.cost_price });
    await ledger(client, { companyId, locationId, itemId, batchId: b.id, txnType, refNo, qtyOut: qty, costPrice: b.cost_price, sellingPrice: sellingPrice ?? b.selling_price, user, date });
    return consumed;
  }

  const { rows: batches } = await client.query(
    `SELECT * FROM stock_batches WHERE item_id = $1 AND location_id = $2 ORDER BY (qty_remain > 0) DESC, id FOR UPDATE`, [itemId, locationId]);
  if (!batches.length) {
    if (!allowNegative) throw new HttpError(400, `No stock for item ${itemId} at this location`);
    // create a placeholder batch so negative stock has somewhere to live
    const { rows: [nb] } = await client.query(
      `INSERT INTO stock_batches (company_id, location_id, item_id, batch_no, created_by) VALUES ($1,$2,$3,'1',$4) RETURNING *`, [companyId, locationId, itemId, user]);
    batches.push(nb);
  }
  const total = batches.reduce((s, b) => s + num(b.qty_remain), 0);
  if (!allowNegative && total < qty) throw new HttpError(400, `Insufficient stock for item ${itemId} (have ${total}, need ${qty})`);

  let left = qty;
  for (const b of batches) {
    if (left <= 0) break;
    const avail = num(b.qty_remain);
    const isLast = b === batches[batches.length - 1];
    const take = isLast ? left : Math.min(Math.max(avail, 0), left);
    if (take <= 0) continue;
    await client.query(`UPDATE stock_batches SET qty_remain = qty_remain - $1, qty_sold = qty_sold + $1, last_sale_date = CURRENT_DATE, last_sale_price = $2, updated_at = now() WHERE id = $3`,
      [take, sellingPrice ?? b.selling_price, b.id]);
    consumed.push({ batch_id: b.id, qty: take, cost_price: b.cost_price });
    await ledger(client, { companyId, locationId, itemId, batchId: b.id, txnType, refNo, qtyOut: take, costPrice: b.cost_price, sellingPrice: sellingPrice ?? b.selling_price, user, date });
    left -= take;
  }
  return consumed;
}

/**
 * Add qty to stock.  If a batch with the same prices exists at the location it is topped up
 * (weighted-average cost); otherwise a new batch (price link) is created.  Returns the batch.
 */
export async function addStock(client, { companyId, locationId, itemId, batchId, qty, costPrice, sellingPrice, discountPrice, wholesalePrice, mrp, expiryDate, warrantyMonths, txnType, refNo, user, newBatch = false, date }) {
  qty = num(qty);
  let batch = null;
  // no selling price supplied (e.g. GRN line left blank) -> inherit from the latest batch so we never create a 0-priced batch
  if (sellingPrice === null || sellingPrice === undefined || num(sellingPrice) <= 0) {
    const { rows: [prev] } = await client.query(`SELECT selling_price, discount_price, wholesale_price, mrp FROM stock_batches WHERE item_id = $1 AND location_id = $2 ORDER BY id DESC LIMIT 1`, [itemId, locationId]);
    if (prev) { sellingPrice = prev.selling_price; discountPrice = discountPrice ?? prev.discount_price; wholesalePrice = wholesalePrice ?? prev.wholesale_price; mrp = mrp ?? prev.mrp; }
    else sellingPrice = num(sellingPrice);
  }
  if (batchId) {
    ({ rows: [batch] } = await client.query(`SELECT * FROM stock_batches WHERE id = $1 FOR UPDATE`, [batchId]));
  } else if (!newBatch) {
    ({ rows: [batch] } = await client.query(
      `SELECT * FROM stock_batches WHERE item_id = $1 AND location_id = $2 AND cost_price = $3 AND selling_price = $4 AND expiry_date IS NOT DISTINCT FROM $5
       ORDER BY id DESC LIMIT 1 FOR UPDATE`, [itemId, locationId, num(costPrice), num(sellingPrice), expiryDate || null]));
    if (!batch) {
      // fall back to the latest batch if its prices match on selling price only and it has no stock (keeps batch count low)
      ({ rows: [batch] } = await client.query(
        `SELECT * FROM stock_batches WHERE item_id = $1 AND location_id = $2 AND qty_remain <= 0 ORDER BY id DESC LIMIT 1 FOR UPDATE`, [itemId, locationId]));
    }
  }

  if (batch) {
    const oldQty = Math.max(num(batch.qty_remain), 0);
    const newAvg = (oldQty + qty) > 0 ? ((oldQty * num(batch.avg_cost || batch.cost_price)) + (qty * num(costPrice ?? batch.cost_price))) / (oldQty + qty) : num(costPrice);
    const { rows: [u] } = await client.query(
      `UPDATE stock_batches SET qty_received = qty_received + $1, qty_remain = qty_remain + $1,
         cost_price = COALESCE($2, cost_price), selling_price = COALESCE($3, selling_price), discount_price = COALESCE($4, discount_price),
         wholesale_price = COALESCE($5, wholesale_price), mrp = COALESCE($6, mrp), expiry_date = COALESCE($7, expiry_date),
         warranty_months = COALESCE($8, warranty_months), avg_cost = $9, last_purchase_date = CURRENT_DATE, last_purchase_price = COALESCE($2, last_purchase_price), updated_at = now()
       WHERE id = $10 RETURNING *`,
      [qty, costPrice ?? null, sellingPrice ?? null, discountPrice ?? null, wholesalePrice ?? null, mrp ?? null, expiryDate || null, warrantyMonths ?? null, newAvg, batch.id]);
    batch = u;
  } else {
    const { rows: [{ n }] } = await client.query(`SELECT COUNT(*)::int + 1 AS n FROM stock_batches WHERE item_id = $1 AND location_id = $2`, [itemId, locationId]);
    ({ rows: [batch] } = await client.query(
      `INSERT INTO stock_batches (company_id, location_id, item_id, batch_no, cost_price, selling_price, discount_price, wholesale_price, mrp, qty_received, qty_remain,
         expiry_date, warranty_months, avg_cost, last_purchase_date, last_purchase_price, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$5,CURRENT_DATE,$5,$13) RETURNING *`,
      [companyId, locationId, itemId, String(n), num(costPrice), num(sellingPrice), num(discountPrice ?? sellingPrice), num(wholesalePrice ?? sellingPrice), num(mrp ?? sellingPrice),
        qty, expiryDate || null, warrantyMonths ?? 0, user]));
  }
  if (qty !== 0) {
    await ledger(client, { companyId, locationId, itemId, batchId: batch.id, txnType, refNo, qtyIn: qty, costPrice: batch.cost_price, sellingPrice: batch.selling_price, user, date });
  }
  return batch;
}

/** Return stock into a specific batch (sales return / cancel invoice). */
export async function restoreStock(client, { companyId, locationId, itemId, batchId, qty, txnType, refNo, user, date }) {
  qty = num(qty);
  if (qty <= 0) return;
  let target = null;
  if (batchId) ({ rows: [target] } = await client.query(`SELECT * FROM stock_batches WHERE id = $1 FOR UPDATE`, [batchId]));
  if (!target) ({ rows: [target] } = await client.query(`SELECT * FROM stock_batches WHERE item_id = $1 AND location_id = $2 ORDER BY id DESC LIMIT 1 FOR UPDATE`, [itemId, locationId]));
  if (!target) {
    ({ rows: [target] } = await client.query(`INSERT INTO stock_batches (company_id, location_id, item_id, batch_no, created_by) VALUES ($1,$2,$3,'1',$4) RETURNING *`, [companyId, locationId, itemId, user]));
  }
  await client.query(`UPDATE stock_batches SET qty_remain = qty_remain + $1, qty_sold = GREATEST(qty_sold - $1, 0), updated_at = now() WHERE id = $2`, [qty, target.id]);
  await ledger(client, { companyId, locationId, itemId, batchId: target.id, txnType, refNo, qtyIn: qty, costPrice: target.cost_price, sellingPrice: target.selling_price, user, date });
}
