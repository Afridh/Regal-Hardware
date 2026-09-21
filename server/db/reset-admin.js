// Resets the authentication system to only the admin user with password admin123
// across the Regal books document, relational users table, and shift board users table.
// Usage: node db/reset-admin.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, query, withTransaction } from '../src/db.js';
import { sha } from '../src/services/regalHash.js';
import { ALL_PERMISSIONS } from '../src/permissions.js';

const ADMIN_NAME = 'admin';
const ADMIN_PASS = process.env.SEED_ADMIN_PASSWORD || 'admin123';
const fullPerms = Object.fromEntries(ALL_PERMISSIONS.map(p => [p.key, true]));

async function main() {
  console.log(`Resetting authentication to user: "${ADMIN_NAME}" / "${ADMIN_PASS}"...`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Reset books document (key = 'regal')
    const { rows: [b] } = await client.query(`SELECT rev, data FROM books WHERE key = 'regal' FOR UPDATE`);
    if (b && b.data) {
      const doc = b.data;
      doc.S = doc.S || {};
      doc.S.users = [{
        name: ADMIN_NAME,
        role: 'Owner',
        uid: 'AD',
        pin: '',
        passHash: sha(ADMIN_PASS),
        perms: ['sell','discount','cancelBill','cost','profit','adjustInvoice','overLimit','belowCost','receive','products','paySupplier','reports','settings','users','approve'],
        active: true,
        lastSeen: new Date().toISOString().slice(0, 10),
        prefs: {}
      }];
      doc.S.user = { name: ADMIN_NAME, role: 'Owner' };
      const nextRev = Number(b.rev) + 1;
      await client.query(
        `UPDATE books SET rev = $1, data = $2, updated_at = now(), updated_by = 'reset-admin' WHERE key = 'regal'`,
        [nextRev, JSON.stringify(doc)]
      );
      await client.query(
        `INSERT INTO books_history (key, rev, data, saved_by) VALUES ('regal', $1, $2, 'reset-admin')`,
        [nextRev, JSON.stringify(doc)]
      );
      console.log(`- Regal books updated to rev ${nextRev}: users reset to [admin]`);
    } else {
      console.log(`- No existing books row found in database (seed will initialize with admin)`);
    }

    // 2. Reset relational users table
    const hash = await bcrypt.hash(ADMIN_PASS, 10);
    const { rows: coRows } = await client.query(`SELECT id FROM companies LIMIT 1`);
    if (coRows.length) {
      const companyId = coRows[0].id;
      const { rows: locRows } = await client.query(`SELECT id FROM locations WHERE company_id = $1 LIMIT 1`, [companyId]);
      const locationId = locRows.length ? locRows[0].id : null;

      await client.query(
        `INSERT INTO users (company_id, location_id, code, name, username, password_hash, pin, role, permissions, active)
         VALUES ($1, $2, 'U001', 'Administrator', $3, $4, '1234', 'ADMIN', $5, true)
         ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, permissions = EXCLUDED.permissions, active = true`,
        [companyId, locationId, ADMIN_NAME, hash, JSON.stringify(fullPerms)]
      );
      await client.query(`DELETE FROM users WHERE lower(username) != $1`, [ADMIN_NAME.toLowerCase()]);
      console.log(`- Relational users table: only [admin] retained with new password`);
    }

    // 3. Reset shift_users table
    await client.query(
      `INSERT INTO shift_users (username, password_hash, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'owner'`,
      [ADMIN_NAME, hash]
    );
    await client.query(`DELETE FROM shift_users WHERE lower(username) != $1`, [ADMIN_NAME.toLowerCase()]);
    console.log(`- Shift board users table: only [admin] retained with new password`);

    await client.query('COMMIT');
    console.log(`\nSuccess! Authentication reset complete.`);
    console.log(`Login Credentials:\n  Username: ${ADMIN_NAME}\n  Password: ${ADMIN_PASS}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Reset failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();

