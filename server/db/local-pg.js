// Development only: runs a self-contained PostgreSQL (embedded-postgres) on port 5433
// with its data directory in server/.pgdata.  Use a real PostgreSQL server in production.
//   npm run db:local
//
// LOCAL_PG_DIR puts the data directory somewhere else, for a machine that will not have it
// where the checkout is:  LOCAL_PG_DIR=C:/regal-pgdata npm run db:local
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.LOCAL_PG_DIR
  ? path.resolve(process.env.LOCAL_PG_DIR)
  : path.resolve(here, '../.pgdata');
const port = Number(process.env.LOCAL_PG_PORT) || 5433;
const user = 'sepos', password = 'sepos', dbName = 'sepos';

// UTF-8 throughout: the shop's Sinhala name and the Rs/– characters on bills must round-trip.
// (Windows' default would be WIN1252, which cannot store them.)
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user, password, port, persistent: true, initdbFlags: ['-E', 'UTF8', '--locale=C'] });

const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
if (fresh) { console.log('Initialising database cluster in', dataDir); await pg.initialise(); }
await pg.start();
if (fresh) {
  const client = pg.getPgClient();
  await client.connect();
  await client.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
  await client.end();
  console.log(`Created database "${dbName}" (UTF-8)`);
}
console.log(`Local PostgreSQL ready: postgresql://${user}:${password}@localhost:${port}/${dbName}`);

const stop = async () => { console.log('Stopping local PostgreSQL…'); try { await pg.stop(); } catch {} process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30); // keep alive
