// Makes the MySQL database ready for the Regal server: every table, from db/schema.mysql.sql.
//   node db/mysql-setup.js            checks the connection, and builds the tables if there are none yet
//   node db/mysql-setup.js --fresh    builds them even if they exist — THIS EMPTIES EVERY TABLE
// DATABASE_URL (mysql://user:password@host:3306/database) comes from server/.env or the environment.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL || '';
if (!/^(mysql|mariadb):\/\//i.test(url)) {
  console.error('DATABASE_URL is not a MySQL address. Put this in server/.env:\n  DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/DATABASE');
  process.exit(1);
}
const u = new URL(url);
const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
let conn;
try {
  conn = await mysql.createConnection({
    host: u.hostname, port: +u.port || 3306, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: db, multipleStatements: true, charset: 'utf8mb4_general_ci',
  });
} catch (e) {
  console.error(`Could not connect to MySQL as ${decodeURIComponent(u.username)}@${u.hostname}/${db}: ${e.message}`);
  console.error('Check the user name, password and database name, and that the user was added to the database with ALL PRIVILEGES.');
  process.exit(1);
}
const [[v]] = await conn.query('SELECT VERSION() AS v');
console.log(`Connected: ${v.v} · database ${db}`);

const [tables] = await conn.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
const fresh = process.argv.includes('--fresh');
if (tables.length && !fresh) {
  const has = new Set(tables.map(r => r.t || r.TABLE_NAME));
  const [[b]] = has.has('books') ? await conn.query('SELECT COUNT(*) AS n, MAX(`rev`) AS rev FROM books') : [[{ n: 0 }]];
  console.log(`${tables.length} tables are already there${has.has('books') ? ` (books: ${b.n ? 'rev ' + b.rev : 'empty'})` : ''} — nothing changed.`);
  console.log('To wipe them and build again, run it with --fresh.');
  await conn.end();
  process.exit(0);
}
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'schema.mysql.sql');
await conn.query(fs.readFileSync(file, 'utf8'));
const [after] = await conn.query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()');
console.log(`${after[0].n} tables built.`);
await conn.end();
