// Seeds a company, location, terminal, admin user and a small set of master data.
// Usage:  npm run db:seed      (run after npm run db:schema)
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';
import { ALL_PERMISSIONS } from '../src/permissions.js';

const fullPerms = Object.fromEntries(ALL_PERMISSIONS.map(p => [p.key, true]));

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [co] } = await client.query(
      `INSERT INTO companies (code, name, address1, contact1, email, invoice_desc1)
       VALUES ('SEPOS', 'SePOS Demo Store', 'No. 1, Main Street, Colombo', '011-2345678', 'info@example.com', 'Thank you, come again!')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
    const companyId = co.id;

    const { rows: [loc] } = await client.query(
      `INSERT INTO locations (company_id, code, name, address) VALUES ($1,'1','Main Branch','Colombo')
       ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [companyId]);
    const locationId = loc.id;

    await client.query(
      `INSERT INTO terminals (location_id, code, name) VALUES ($1,'1','Counter 01'), ($1,'2','Counter 02')
       ON CONFLICT (location_id, code) DO NOTHING`, [locationId]);

    const hash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'admin123', 10);
    await client.query(
      `INSERT INTO users (company_id, location_id, code, name, username, password_hash, pin, role, permissions)
       VALUES ($1,$2,'U001','Administrator','admin',$3,'1234','ADMIN',$4)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, permissions = EXCLUDED.permissions`,
      [companyId, locationId, hash, JSON.stringify(fullPerms)]);

    await client.query(`DELETE FROM users WHERE lower(username) != 'admin'`);

    // categories
    const cats = [['C001','Grocery'],['C002','Beverages'],['C003','Household'],['C004','Electronics'],['C005','Stationery']];
    for (const [code, name] of cats) {
      await client.query(`INSERT INTO categories (company_id, code, name) VALUES ($1,$2,$3) ON CONFLICT (company_id, code) DO NOTHING`, [companyId, code, name]);
    }
    const { rows: catRows } = await client.query(`SELECT id, code FROM categories WHERE company_id=$1`, [companyId]);
    const catId = Object.fromEntries(catRows.map(r => [r.code, r.id]));

    // suppliers
    const sups = [['S001','Lanka Distributors (Pvt) Ltd','0112223344'],['S002','Ceylon Beverages','0777123456'],['S003','Tech Imports','0112998877']];
    for (const [code, name, mobile] of sups) {
      await client.query(`INSERT INTO suppliers (company_id, code, name, mobile) VALUES ($1,$2,$3,$4) ON CONFLICT (company_id, code) DO NOTHING`, [companyId, code, name, mobile]);
    }
    const { rows: supRows } = await client.query(`SELECT id, code FROM suppliers WHERE company_id=$1`, [companyId]);
    const supId = Object.fromEntries(supRows.map(r => [r.code, r.id]));

    // customers
    await client.query(
      `INSERT INTO customers (company_id, code, name, category, mobile) VALUES
        ($1,'CUS000','CASH CUSTOMER','RETAIL',NULL),
        ($1,'CUS001','Nimal Perera','RETAIL','0771234567'),
        ($1,'CUS002','ABC Traders','WHOLESALE','0112345678'),
        ($1,'CUS003','Kamal Silva','VIP','0719876543')
       ON CONFLICT (company_id, code) DO NOTHING`, [companyId]);

    // employees
    await client.query(
      `INSERT INTO employees (company_id, location_id, code, name, designation, mobile, is_salesman) VALUES
        ($1,$2,'E001','Sunil Fernando','Sales Executive','0770001111',TRUE),
        ($1,$2,'E002','Ruwan Jayasuriya','Store Keeper','0770002222',FALSE)
       ON CONFLICT (company_id, code) DO NOTHING`, [companyId, locationId]);

    // expense categories
    const expCats = [['EX01','Electricity','EXPENSE'],['EX02','Rent','EXPENSE'],['EX03','Transport','EXPENSE'],['EX04','Salaries','EXPENSE'],['IN01','Other Income','INCOME'],['IN02','Service Charges','INCOME']];
    for (const [code, name, kind] of expCats) {
      await client.query(`INSERT INTO expense_categories (company_id, code, name, kind) VALUES ($1,$2,$3,$4) ON CONFLICT (company_id, code) DO NOTHING`, [companyId, code, name, kind]);
    }

    // banks
    await client.query(
      `INSERT INTO banks (company_id, code, bank_name, branch, account_no, opening_balance) VALUES
        ($1,'B001','Commercial Bank','Colombo 03','8001234567',250000),
        ($1,'B002','Sampath Bank','Wellawatte','0011223344',100000)
       ON CONFLICT (company_id, code) DO NOTHING`, [companyId]);

    // items + opening stock
    const items = [
      ['I0001','4791234567001','Rice 5kg (Keeri Samba)','KG','C001','S001', 1250, 1450, 1400, 1380, 1500, 40],
      ['I0002','4791234567002','Sugar 1kg','KG','C001','S001', 210, 245, 240, 235, 250, 100],
      ['I0003','4791234567003','Ceylon Tea 200g','PCS','C001','S001', 380, 450, 440, 430, 460, 60],
      ['I0004','4791234567004','Coca-Cola 1.5L','PCS','C002','S002', 240, 290, 285, 280, 300, 48],
      ['I0005','4791234567005','Mineral Water 1L','PCS','C002','S002', 55, 80, 78, 75, 80, 120],
      ['I0006','4791234567006','Dish Wash Liquid 500ml','PCS','C003','S001', 280, 350, 340, 330, 360, 30],
      ['I0007','4791234567007','Laundry Powder 1kg','PCS','C003','S001', 520, 650, 640, 620, 675, 25],
      ['I0008','4791234567008','USB Cable Type-C 1m','PCS','C004','S003', 350, 650, 600, 550, 750, 40],
      ['I0009','4791234567009','Wireless Mouse','PCS','C004','S003', 1400, 2200, 2100, 2000, 2500, 15],
      ['I0010','4791234567010','A4 Paper Ream 80gsm','PCS','C005','S001', 1350, 1650, 1600, 1580, 1700, 20],
      ['I0011','4791234567011','Ball Point Pen (Blue)','PCS','C005','S001', 25, 40, 38, 35, 40, 300],
      ['I0012','4791234567012','Exercise Book 120pg','PCS','C005','S001', 95, 140, 135, 130, 150, 80],
    ];
    for (const [code, barcode, name, unit, cat, sup, cost, sell, disc, ws, mrp, qty] of items) {
      const { rows: [it] } = await client.query(
        `INSERT INTO items (company_id, code, barcode, name, unit, category_id, supplier_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'seed')
         ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [companyId, code, barcode, name, unit, catId[cat], supId[sup]]);
      const { rows: [sb] } = await client.query(
        `INSERT INTO stock_batches (company_id, location_id, item_id, batch_no, cost_price, selling_price, discount_price, wholesale_price, mrp,
            qty_received, qty_remain, qty_min, avg_cost, created_by)
         VALUES ($1,$2,$3,'1',$4,$5,$6,$7,$8,$9,$9,5,$4,'seed')
         ON CONFLICT (location_id, item_id, batch_no) DO NOTHING RETURNING id`,
        [companyId, locationId, it.id, cost, sell, disc, ws, mrp, qty]);
      if (sb) {
        await client.query(
          `INSERT INTO item_ledger (company_id, location_id, item_id, batch_id, txn_type, ref_no, qty_in, balance, cost_price, selling_price, created_by)
           VALUES ($1,$2,$3,$4,'OPEN','OPENING',$5,$5,$6,$7,'seed')`,
          [companyId, locationId, it.id, sb.id, qty, cost, sell]);
      }
    }

    await client.query(
      `INSERT INTO sms_settings (company_id, api_url, sender_id, templates, flags) VALUES ($1,'https://smslenz.lk/api/send-sms','SePOS',
        '{"invoice":"Dear {name}, invoice {serial} for Rs.{total} has been issued. Thank you!","credit_settlement":"Dear {name}, payment of Rs.{amount} received. Outstanding: Rs.{due}."}',
        '{"send_invoice_to_customer":false,"send_daily_summary_to_owner":false}')
       ON CONFLICT (company_id) DO NOTHING`, [companyId]);

    await client.query(
      `INSERT INTO settings (company_id, key, value) VALUES
        ($1,'loyalty', '{"enabled":true,"points_per_currency":0.01,"currency_per_point":1}'),
        ($1,'invoice', '{"allow_negative_stock":false,"default_pay_mode":"CASH","print_size":"80mm"}')
       ON CONFLICT (company_id, key) DO NOTHING`, [companyId]);

    // Shift Board (embedded attendance app) logins
    await client.query(
      `INSERT INTO shift_users (username, password_hash, role) VALUES ('admin', $1, 'owner')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`, [hash]);
    await client.query(`DELETE FROM shift_users WHERE lower(username) != 'admin'`);

    await client.query('COMMIT');
    console.log('Seed complete. Login: admin / ' + (process.env.SEED_ADMIN_PASSWORD || 'admin123'));
    console.log('Shift board: admin / ' + (process.env.SEED_ADMIN_PASSWORD || 'admin123'));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
main();
