// Seeds the company, location, terminals, admin sign-in and standard settings — no sample goods or people.
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
       VALUES ('SEPOS', 'Regal Hardware', '748, Main Street, Kaduruwela', '077 222 2259', '', 'Thank you, come again!')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
    const companyId = co.id;

    const { rows: [loc] } = await client.query(
      `INSERT INTO locations (company_id, code, name, address) VALUES ($1,'1','Main Branch','Kaduruwela')
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

    // no sample goods, people or banks: only the cash customer every bill can fall back on
    await client.query(
      `INSERT INTO customers (company_id, code, name, category, mobile) VALUES ($1,'CUS000','CASH CUSTOMER','RETAIL',NULL)
       ON CONFLICT (company_id, code) DO NOTHING`, [companyId]);

    // expense categories
    const expCats = [['EX01','Electricity','EXPENSE'],['EX02','Rent','EXPENSE'],['EX03','Transport','EXPENSE'],['EX04','Salaries','EXPENSE'],['IN01','Other Income','INCOME'],['IN02','Service Charges','INCOME']];
    for (const [code, name, kind] of expCats) {
      await client.query(`INSERT INTO expense_categories (company_id, code, name, kind) VALUES ($1,$2,$3,$4) ON CONFLICT (company_id, code) DO NOTHING`, [companyId, code, name, kind]);
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
