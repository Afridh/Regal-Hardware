import pg from 'pg';

const { Pool, types } = pg;

// Return NUMERIC / BIGINT as JS numbers instead of strings (values here never exceed 2^53).
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));   // NUMERIC
types.setTypeParser(20,   v => (v === null ? null : parseInt(v, 10)));  // INT8
types.setTypeParser(1082, v => v);                                       // DATE as 'YYYY-MM-DD' string

// Where the database is. DATABASE_URL is ours; the rest are the names the hosts set by themselves
// when a database is attached to the project — Supabase and Vercel Postgres write POSTGRES_URL,
// Neon writes both. Taking them as they come means attaching a database is all that is needed.
const url = process.env.DATABASE_URL
  || process.env.POSTGRES_URL                 // Supabase / Vercel Postgres integration (pooled)
  || process.env.POSTGRES_PRISMA_URL
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.SUPABASE_DB_URL
  || '';
// Hosted PostgreSQL (Neon, Supabase, Vercel Postgres…) needs TLS; the local one does not.
const hosted = /sslmode=require|\.neon\.tech|\.supabase\.(co|com)|pooler\.supabase\.com|\.vercel-storage\.com|\.render\.com/.test(url) || process.env.PGSSL === '1';

export const pool = new Pool({
  connectionString: url,
  max: process.env.VERCEL ? 3 : 10,      // a serverless instance should hold few connections
  ssl: hosted ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', err => console.error('pg pool error', err));
if (!url) console.error('No database address: set DATABASE_URL (or attach a database — POSTGRES_URL is read too).');

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
