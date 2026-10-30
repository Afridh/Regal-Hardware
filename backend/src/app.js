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
import { pool, dbKind } from './db.js';

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
import fileRoutes from './routes/files.js';
import printRoutes from './routes/print.js';
import displayRoutes from './routes/display.js';
import presenceRoutes from './routes/presence.js';
import camRoutes from './routes/cams.js';
import custRoutes from './routes/customer.js';
import aiRoutes from './routes/ai.js';
import alexaRoutes from './routes/alexa.js';
import maintenanceRoutes from './routes/maintenance.js';
import dueRoutes from './routes/dues.js';
import dlvRoutes from './routes/deliveries.js';
import stockupRoutes from './routes/stockup.js';
import { maintenanceGate } from './lib/maintenance.js';

if (!process.env.JWT_SECRET) console.error('JWT_SECRET is not set (copy .env.example to .env, or set it in the host\'s environment)');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()), credentials: true }));
app.use(express.json({ limit: '12mb' }));       // the books, and attachments of up to 8 MB as data URLs
// maintenance mode: the back-shortly page in front of the website, or of everything (lib/maintenance.js)
app.use(maintenanceGate);
app.use('/api/maintenance', maintenanceRoutes);

app.get('/api/health', async (_req, res) => {
  // which setting the address came from, so a host that names it its own way can be told apart from none at all
  const from = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING', 'SUPABASE_DB_URL'].find(k => process.env[k]) || null;
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up', kind: dbKind, from, time: new Date().toISOString() }); }
  catch (e) { res.status(500).json({ ok: false, db: 'down', kind: dbKind, from, error: e.message }); }
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
// attachments (quotation requests, signed submissions) and outgoing email with them
app.use('/api/files', fileRoutes);
// the printers are on one PC: a bill made anywhere is left here and that PC's helper takes it
app.use('/api/print', printRoutes);
app.use('/api/display', displayRoutes);      // the customer's screen at the counter (regalhw.lk/count1)
app.use('/api/presence', presenceRoutes);    // who is signed in right now (the Super Admin sees them)
app.use('/api/dlv', dlvRoutes);              // the driver's phone page (regalhw.lk/driver)
app.use('/api/stockup', stockupRoutes);        // stock counts from a phone (regalhw.lk/stockup)
app.use('/api/dues', dueRoutes);             // credit follow-up: reminders to customers who owe
app.use('/api/cams', camRoutes);              // the cameras, seen from anywhere (the camera helper calls out)
// the Echo in the office: Amazon calls this, and the till reports what the books cannot see
app.use('/api/alexa', alexaRoutes);
// the customer's own page: what they owe, bill by bill, and a way to say they have paid
app.use('/api/my', custRoutes);
app.use('/api/ai', aiRoutes);
// day sheets the Shift Board publishes (on Vercel these live in /tmp, so only until the function is recycled)
app.use('/reports', express.static(reportsDir));

// Pages: the customer's shop at /, the staff system at /pos (vercel.json does the same on Vercel).
// (On Vercel the static files are served by the platform itself, not by this app.)
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../frontend');
if (!process.env.VERCEL && fs.existsSync(appDir)) {
  // the pages and scripts change often: never let a browser show a stale copy
  const fresh = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  app.get('/', fresh, (_req, res) => res.sendFile(path.join(appDir, 'shop.html')));
  app.get(['/pos', '/pos/'], fresh, (_req, res) => res.sendFile(path.join(appDir, 'index.html')));
  app.get(['/shift', '/shift/'], fresh, (_req, res) => res.sendFile(path.join(appDir, 'shift.html')));
  app.get(/^\/count(\d{0,2})\/?$/i, fresh, (_req, res) => res.sendFile(path.join(appDir, 'display.html')));   // a tablet facing the customer
  app.get(['/driver', '/driver/'], fresh, (_req, res) => res.sendFile(path.join(appDir, 'driver.html')));   // a driver's stops for the day
  app.get(['/stockup', '/stockup/'], fresh, (_req, res) => res.sendFile(path.join(appDir, 'stock.html')));   // stock counts from a phone
  app.get(['/supplier', '/supplier/'], fresh, (_req, res) => res.sendFile(path.join(appDir, 'supplier.html')));
  app.get(['/my', '/my/', '/my/:code'], fresh, (_req, res) => res.sendFile(path.join(appDir, 'my.html')));
  app.get(['/b/:id'], fresh, (_req, res) => res.sendFile(path.join(appDir, 'bill.html')));   // the e-bill link texted to a customer
  app.use(express.static(appDir, { index: false, extensions: ['html'], setHeaders: (res, p) => { if (/\.(html|js|css)$/.test(p)) res.set('Cache-Control', 'no-store'); } }));
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

export default app;
