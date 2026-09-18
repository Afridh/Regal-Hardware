// One-off: drop and recreate the database as UTF-8 (for a cluster that was initialised with a
// Windows-1252 default).  Everything in the database is lost — run db:setup afterwards.
//   node db/recreate-utf8.js
import 'dotenv/config';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL);
const dbName = url.pathname.slice(1);
url.pathname = '/postgres';
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
const { rows: [cur] } = await client.query(`SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1`, [dbName]);
console.log(`"${dbName}" is currently ${cur ? cur.enc : 'missing'}`);
if (cur && cur.enc === 'UTF8') { console.log('Already UTF-8 — nothing to do.'); await client.end(); process.exit(0); }
await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [dbName]);
if (cur) await client.query(`DROP DATABASE "${dbName}"`);
await client.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
const { rows: [now] } = await client.query(`SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1`, [dbName]);
console.log(`"${dbName}" recreated as ${now.enc}.  Now run: npm run db:setup`);
await client.end();
