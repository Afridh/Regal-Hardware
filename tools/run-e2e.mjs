// Runs the end-to-end suite against ITS OWN database and port, so it can never touch the shop's real books.
//   node tools/run-e2e.mjs            (needs the local PostgreSQL running: cd server; npm run db:local)
// It creates database `sepos_e2e` next to the real one (same server, same user), applies the schema,
// starts a second API on port 4010 with JWT/SMS settings of its own, clears the e2e books, runs e2e.mjs
// against it and stops the server again.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../server');
const env = Object.fromEntries(fs.readFileSync(path.join(serverDir, '.env'), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const real = new URL(env.DATABASE_URL);
const E2E_DB = process.env.E2E_DB || 'sepos_e2e', PORT = process.env.E2E_PORT || '4010';
const testUrl = new URL(real.href); testUrl.pathname = '/' + E2E_DB;

// 1. the test database
{
  const admin = new URL(real.href); admin.pathname = '/postgres';
  const c = new pg.Client({ connectionString: admin.href }); await c.connect();
  const { rows } = await c.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [E2E_DB]);
  if (!rows.length) { await c.query(`CREATE DATABASE "${E2E_DB}" ENCODING 'UTF8' TEMPLATE template0`); console.log(`created database ${E2E_DB}`); }
  await c.end();
}
const testEnv = { ...process.env, ...env, DATABASE_URL: testUrl.href, PORT, JWT_SECRET: 'e2e-secret', CORS_ORIGIN: '*' };
const node = process.execPath;
const run = (args, opts = {}) => { const r = spawnSync(node, args, { cwd: serverDir, env: testEnv, stdio: 'inherit', ...opts }); if (r.status) process.exit(r.status); };
run(['db/migrate.js']); run(['db/seed.js']); run(['db/clear-books.js']);

// 2. the API on its own port
const srv = spawn(node, ['src/index.js'], { cwd: serverDir, env: testEnv, stdio: ['ignore', 'pipe', 'inherit'] });
srv.stdout.on('data', d => process.stdout.write('[api] ' + d));
const up = async () => { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${PORT}/api/health`); if (r.ok) return true; } catch {} await new Promise(r => setTimeout(r, 250)); } return false; };
if (!(await up())) { console.error('e2e API did not start'); srv.kill(); process.exit(1); }

// 3. the suite
const r = spawnSync(node, [path.join(here, 'e2e.mjs')], { env: { ...process.env, E2E_BASE: `http://localhost:${PORT}` }, stdio: 'inherit' });
srv.kill();
process.exit(r.status || 0);
