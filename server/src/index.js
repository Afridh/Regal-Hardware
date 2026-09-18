import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { authenticate } from './middleware/auth.js';
import { errorHandler } from './lib/errors.js';
import { pool } from './db.js';
import { startSmsWorker } from './services/sms.js';

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
import shiftApi from './routes/shiftApi.js';

if (!process.env.JWT_SECRET) { console.error('JWT_SECRET is not set (copy .env.example to .env)'); process.exit(1); }

const app = express();
app.disable('x-powered-by');
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

// The primary UI is the Regal app in ../../app (index.html + regal-bridge.js + reports/).
// The older React client (client/dist) stays reachable under /react if it has been built.
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../app');
if (fs.existsSync(appDir)) {
  app.use(express.static(appDir, { index: 'index.html', extensions: ['html'] }));
}
const dist = path.resolve(here, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use('/react', express.static(dist));
  app.get(/^\/react(\/.*)?$/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`SePOS API listening on http://localhost:${port}`);
  startSmsWorker();
});
