import { query } from '../db.js';

export async function getSetting(companyId, key, fallback = null) {
  const { rows: [row] } = await query(`SELECT value FROM settings WHERE company_id = $1 AND key = $2`, [companyId, key]);
  return row ? { ...fallback, ...row.value } : fallback;
}

export async function setSetting(companyId, key, value) {
  await query(`INSERT INTO settings (company_id, key, value) VALUES ($1,$2,$3) ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value`, [companyId, key, JSON.stringify(value)]);
}
