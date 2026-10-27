// Maintenance mode: a switch that puts the "back shortly" page in front of the website (scope "site")
// or of everything (scope "all": the tills and the shift board too).
//
// The switch is a small file next to the app (backend/maintenance.json, never in git), so it survives
// a restart and every server process sees it. The owner flips it from the till (Settings → Maintenance)
// or on the server with `node tools/maintenance.mjs on|off`.
//
// Whoever switches it on keeps working: their browser gets a pass (cookie regal_mx), and the preview
// link /?mx=<key> hands the same pass to any other browser. Machines that only carry work — the print
// helper, the camera helper — are never stopped. A till already open when "all" is switched on gets a
// 503 like a dropped line: it keeps its work on the PC and sends it up when the switch goes off.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MX_FILE = process.env.MAINTENANCE_FILE || path.resolve(here, '../../maintenance.json');
const PAGE = path.resolve(here, '../../../frontend/maintenance.html');
const OFF = { on: false, scope: 'site', msg: '', until: '', since: '', by: '', key: '', intro: 'shutter' };
// how the page opens: the shop's shutter rolling up, a soft fade, or straight in
export const INTROS = ['shutter', 'fade', 'none'];

let cache = null, cachedAt = 0;
export function mxState() {
  if (cache && Date.now() - cachedAt < 2000) return cache;
  try { cache = { ...OFF, ...JSON.parse(fs.readFileSync(MX_FILE, 'utf8')) }; } catch { cache = { ...OFF }; }
  cachedAt = Date.now();
  return cache;
}
export function mxSave(patch) {
  const cur = mxState();
  // only what was given changes: a patch of just { intro } leaves the switch where it is
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  if (!INTROS.includes(next.intro)) next.intro = 'shutter';
  if (!next.key) next.key = crypto.randomBytes(9).toString('base64url');   // the pass; kept between switch-ons
  if (next.on && !cur.on) next.since = new Date().toISOString();
  if (!next.on) next.since = '';
  next.scope = next.scope === 'all' ? 'all' : 'site';
  next.msg = String(next.msg || '').slice(0, 400);
  next.until = next.until && !isNaN(Date.parse(next.until)) ? new Date(next.until).toISOString() : '';
  fs.writeFileSync(MX_FILE, JSON.stringify(next, null, 2));
  cache = next; cachedAt = Date.now();
  return next;
}
// what anybody may know: no key
export const mxPublic = s => ({ on: !!s.on, scope: s.scope, msg: s.msg, until: s.until, since: s.since, intro: s.intro || 'shutter' });

// the page, told how to open (the owner's choice, or ?intro= when previewing one)
function sendPage(req, res, s) {
  if (!fs.existsSync(PAGE)) return res.type('text').send('Regal Hardware is being updated — back shortly.');
  const want = INTROS.includes(req.query && req.query.intro) ? req.query.intro : (s.intro || 'shutter');
  res.set('Cache-Control', 'no-store');
  res.type('html').send(fs.readFileSync(PAGE, 'utf8').replace('<body class="wait">', `<body class="wait" data-intro="${want}"${req.query && req.query.intro ? ' data-preview="1"' : ''}>`));
}

const cookieOf = (req, name) => {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
};
export const mxPass = (req, s = mxState()) => !!s.key && cookieOf(req, 'regal_mx') === s.key;

// files the page itself needs (logo, fonts, scripts) always come through; pages and the API are what stop
const isAsset = p => /\.[a-z0-9]{2,5}$/i.test(p) && !/\.(html?|php)$/i.test(p);
// the public side: the shop, the customer's page, the supplier's page, the e-bill link, and their APIs
const SITE = [/^\/$/, /^\/(shop|my|supplier|bill)(\.html)?\/?$/i, /^\/my\//i, /^\/b\//i, /^\/api\/(shop|my|sup)(\/|$)/i];
// always open: the switch itself, the health check, and the helpers on the shop's PCs
const ALWAYS = [/^\/api\/health$/i, /^\/api\/maintenance(\/|$)/i, /^\/api\/(print|cams)(\/|$)/i, /^\/maintenance(\.html)?$/i];

export function maintenanceGate(req, res, next) {
  const s = mxState();
  const p = req.path;
  // the page itself, on or off, so the owner can look at it (and try each way in) before switching on
  if (req.method === 'GET' && /^\/maintenance(\.html)?$/i.test(p)) return sendPage(req, res, s);
  if (!s.on) return next();
  // the preview link: /?mx=<key> gives this browser the pass and drops the key from the address
  if (req.query && req.query.mx && req.query.mx === s.key) {
    res.cookie('regal_mx', s.key, { path: '/', httpOnly: false, sameSite: 'lax', secure: req.secure, maxAge: 30 * 86400e3 });
    const q = new URLSearchParams(req.query); q.delete('mx');
    return res.redirect(302, p + (q.toString() ? '?' + q : ''));
  }
  if (ALWAYS.some(r => r.test(p)) || isAsset(p) || mxPass(req, s)) return next();
  const stopped = s.scope === 'all' || SITE.some(r => r.test(p));
  if (!stopped) return next();
  const wait = s.until ? Math.max(60, Math.round((Date.parse(s.until) - Date.now()) / 1000)) : 600;
  res.set('Retry-After', String(wait));
  res.set('Cache-Control', 'no-store');
  if (p.startsWith('/api/') || p === '/shift-api.php' || req.method !== 'GET')
    return res.status(503).json({ error: 'The shop system is being updated — back shortly', maintenance: true, until: s.until || null });
  res.status(503);
  sendPage(req, res, s);
}
