import pg from 'pg';

const { Pool, types } = pg;

// Return NUMERIC / BIGINT as JS numbers instead of strings (values here never exceed 2^53).
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));   // NUMERIC
types.setTypeParser(20,   v => (v === null ? null : parseInt(v, 10)));  // INT8
types.setTypeParser(1082, v => v);                                       // DATE as 'YYYY-MM-DD' string

// Hosted PostgreSQL (Neon, Supabase, Vercel Postgres…) needs TLS; the local one does not.
const url = process.env.DATABASE_URL || '';
const hosted = /sslmode=require|\.neon\.tech|\.supabase\.co|\.vercel-storage\.com|\.render\.com/.test(url) || process.env.PGSSL === '1';

export const pool = new Pool({
  connectionString: url,
  max: process.env.VERCEL ? 3 : 10,      // a serverless instance should hold few connections
  ssl: hosted ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', err => console.error('pg pool error', err));

export const query = (text, params) => pool.query(text, params);

/** Run fn(client) inside a transaction. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
