// The Express app on its own, without listening — so it can be started locally
// (index.js) or handed to a serverless host such as Vercel (../../api/index.js).
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { authenticate } from './middleware/auth.js';
import { errorHandler } from './lib/errors.js';
import { pool } from './db.js';

import authRoutes from './routes/auth.js';
import masterRoutes from './routes/master.js';
import salesRoutes from './routes/sales.js';
import purchaseRoutes from './routes/purchases.js';
import stockRoutes from './routes/stock.js';
import financeRoutes from './routes/finance.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes from './routes/admin.js';
import regalRoutes from './routes/regal.js';
import shiftApi, { reportsDir } from './routes/shiftApi.js';
import shopRoutes from './routes/shop.js';
import supplierRoutes from './routes/supplier.js';

if (!process.env.JWT_SECRET) console.error('JWT_SECRET is not set (copy .env.example to .env, or set it in the host\'s environment)');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()), credentials: true }));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up', time: new Date().toISOString() }); }
  catch (e) { res.status(500).json({ ok: false, db: 'down', error: e.message }); }
});

app.use('/api/auth', authRoutes);
app.use('/api/master', authenticate, masterRoutes);
app.use('/api/sales', authenticate, salesRoutes);
app.use('/api/purchases', authenticate, purchaseRoutes);
app.use('/api/stock', authenticate, stockRoutes);
app.use('/api/finance', authenticate, financeRoutes);
app.use('/api/reports', authenticate, reportRoutes);
app.use('/api/dashboard', authenticate, dashboardRoutes);
app.use('/api/admin', authenticate, adminRoutes);

// Regal front-end: books store + SMS relay, and the shift board's PHP-style endpoint
app.use('/api', regalRoutes);
app.use('/', shiftApi);
// the public shop site's API — no sign-in, sees only the catalogue and its own orders
app.use('/api/shop', shopRoutes);
// the suppliers' page — reps sign in with the mobile on file, answer the shop's orders, upload the ones they took by hand
app.use('/api/sup', supplierRoutes);
// day sheets the Shift Board publishes (on Vercel these live in /tmp, so only until the function is recycled)
app.use('/reports', express.static(reportsDir));

// Pages: the customer's shop at /, the staff system at /pos (vercel.json does the same on Vercel).
// The older React client (client/dist) stays reachable under /react if it has been built.
// (On Vercel the static files are served by the platform itself, not by this app.)
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../app');
if (!process.env.VERCEL && fs.existsSync(appDir)) {
  // the pages and scripts change often: never let a browser show a stale copy
  const fresh = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  app.get('/', fresh, (_req, res) => res.sendFile(path.join(appDir, 'shop.html')));
  app.get(['/pos', '/pos/'], fresh, (_req, res) => res.sendFile(path.join(appDir, 'index.html')));
  app.get(['/supplier', '/supplier/'], fresh, (_req, res) => res.sendFile(path.join(appDir, 'supplier.html')));
  app.use(express.static(appDir, { index: false, extensions: ['html'], setHeaders: (res, p) => { if (/\.(html|js)$/.test(p)) res.set('Cache-Control', 'no-store'); } }));
}
const dist = path.resolve(here, '../../client/dist');
if (!process.env.VERCEL && fs.existsSync(dist)) {
  app.use('/react', express.static(dist));
  app.get(/^\/react(\/.*)?$/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

export default app;
