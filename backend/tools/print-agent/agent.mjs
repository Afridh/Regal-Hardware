// The print helper: runs on the till PC and prints each bill on the right printer, no print box.
//   node backend/tools/print-agent/agent.mjs          (or the "Regal print helper" startup shortcut)
// The till POSTs { format: 'r80' | 'a5', html } to http://localhost:4100/print.  The helper renders
// the bill with the Chrome on this PC (exactly as the browser would print it), then hands the image to
// Windows for the printer named in config.json — 80mm receipts to the EPSON, A5 bills to the Canon.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const readCfg = (f) => { try { return JSON.parse(fs.readFileSync(path.join(here, f), 'utf8').replace(/^﻿/, '')) } catch { return null } };
// config.local.json is this PC's own — the print key lives there, never in the one that travels with the code
const cfg = Object.assign({}, readCfg('config.json') || {}, readCfg('config.local.json') || {});
if (!cfg.port) { console.error('config.json is missing or unreadable'); process.exit(1); }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!chrome) { console.error('No Chrome, Brave or Edge found to render bills with'); process.exit(1); }
const tmp = path.join(os.tmpdir(), 'regal-print'); fs.mkdirSync(tmp, { recursive: true });
// what was printed, when and from where — on the screen and in helper.log beside this file (kept to the last ~2MB)
const LOG = path.join(here, 'helper.log');
const log = (...a) => {
  const line = new Date().toLocaleString('en-GB') + ' ' + a.join(' ');
  console.log(line);
  try { if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2e6) fs.renameSync(LOG, LOG + '.old'); fs.appendFileSync(LOG, line + '\r\n'); } catch { /* the screen still has it */ }
};
/* The same bill arriving twice within a few seconds — sent here and to the shop's queue, or sent again
   while the first was still on its way — is printed once. A reprint asked for later still prints. */
const SAME_WITHIN_MS = 30 * 1000;
const lately = new Map();
function seenJustNow(format, html) {
  const now = Date.now();
  for (const [k, t] of lately) if (now - t > SAME_WITHIN_MS) lately.delete(k);
  const k = format + ':' + createHash('sha1').update(String(html)).digest('hex');
  if (lately.has(k)) return true;
  lately.set(k, now); return false;
}

let browser = null;
/* One page per format, kept open between bills, with what was in it last time. */
const held = new Map();
const styleOf = (html) => { const m = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html); return m ? m[1] : '' };
const billOf = (html) => { const m = /<div id="printArea"[^>]*>([\s\S]*)<\/div>\s*<\/body>/i.exec(html); return m ? m[1] : null };

async function getBrowser() {
  if (browser && browser.connected) return browser;
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  return browser;
}

/** Render the bill to a PNG at print resolution. */
async function render(format, html) {
  const f = cfg[format]; if (!f) throw new Error('unknown format ' + format);
  const b = await getBrowser();
  const over = Math.max(1, Math.min(4, +f.oversample || 2));       // drawn this many times too big, then shrunk
  const css = styleOf(html), bill = billOf(html);
  let keep = held.get(format);
  if (keep && (keep.page.isClosed() || keep.css !== css || !bill)) { try { await keep.page.close() } catch (e) {} keep = null }

  let page, fresh = false;
  if (keep) {
    page = keep.page;
    // the styles are already in this page: only the bill itself is new
    await page.evaluate((b) => { document.getElementById('printArea').innerHTML = b }, bill);
  } else {
    page = await b.newPage();
    fresh = true;
    await page.setViewport({ width: f.widthPx, height: 800, deviceScaleFactor: (f.scale || 1) * over });
    await page.setContent(html, { waitUntil: 'load' });
  }
  try {
    await page.emulateMediaType('print');
    await page.evaluate((f, format) => {
      document.body.classList.add('direct-print'); document.body.style.margin = '0'; document.body.style.background = '#fff';
      const p = document.querySelector('#printArea .print'); if (!p) return;
      if (format === 'r80') {
        // one CSS pixel per printer dot: the receipt is designed 302px wide, the roll is `dots` wide → scale it up,
        // no border, hardly any side padding, and pure black on white so the printer does not dither the text
        const sc = +p.dataset.scale || 1;                    // text size chosen in Settings
        p.style.width = (302 / sc) + 'px'; p.style.border = '0'; p.style.padding = '2px 4px'; p.style.boxSizing = 'border-box';
        p.style.zoom = String((f.dots || 576) / 302 * sc);
        p.style.webkitFontSmoothing = 'none';                  // no grey fringe around the letters
        document.body.style.width = (f.dots || 576) + 'px';
      }
    }, f, format);
    /* It used to sleep 150ms in the hope the fonts had arrived. Ask instead: on a page that has
       already drawn a bill they are there, and it comes back at once. */
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await new Promise(r => setTimeout(r, fresh ? 60 : 16));
    // Windows clears its temp folder now and then while the helper keeps running: make it again each time
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, `bill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`);
    const target = await page.$('#printArea .print') || await page.$('body');
    const shot = await target.screenshot({ encoding: 'base64', omitBackground: false });

    /* Shrink it back to the paper's own width and force every pixel to black or white. The
       threshold is deliberately generous: a letter's soft edge becomes ink rather than being
       dropped, so the text reads solid instead of thin and broken. */
    const cut = Math.max(1, Math.min(254, +f.threshold || 186));
    const wide = format === 'r80' ? (f.dots || 576) : 0;      // A5 goes to a real printer at its own size
    const png = await page.evaluate(async (b64, wide, cut) => {
      const img = new Image();
      await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + b64 });
      const w = wide || img.width, h = Math.round(img.height * (w / img.width));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        // how bright the pixel is, as an eye would read it
        const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
        const v = lum < cut ? 0 : 255;
        px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
      }
      g.putImageData(d, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    }, shot, wide, cut);
    fs.writeFileSync(file, Buffer.from(png, 'base64'));
    held.set(format, { page, css });        // kept for the next bill, stylesheet and all
    return file;
  } catch (e) {
    held.delete(format);                    // a page that has gone wrong is not worth keeping
    try { await page.close() } catch (x) {}
    throw e;
  }
}

/** Hand the image to Windows for the printer this format goes to. */
function printImage(format, file) {
  const f = cfg[format];
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'print-image.ps1'), '-Printer', f.printer, '-Image', file];
  if (f.paper) args.push('-Paper', f.paper);
  if (f.landscape) args.push('-Landscape');
  if (format === 'r80') args.push('-Roll', '-Dpi', String(f.dpi || 203),
    '-Cut', String(Math.max(1, Math.min(254, +f.threshold || 186))), '-Flat');
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', args, { windowsHide: true });
    let out = '', err = '';
    ps.stdout.on('data', d => out += d); ps.stderr.on('data', d => err += d);
    ps.on('close', code => { fs.unlink(file, () => {}); code === 0 ? resolve(out.trim()) : reject(new Error((err || out || 'print failed').trim().split('\n')[0])); });
  });
}

/** Labels: the till sends the Zebra's own language (ZPL), which goes to the label printer untouched. */
function printRaw(printer, data, name) {
  fs.mkdirSync(tmp, { recursive: true });      // Windows' clean-up may have taken the folder since the helper started
  const file = path.join(tmp, 'labels-' + Date.now() + '.zpl'); fs.writeFileSync(file, data, 'utf8');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'print-raw.ps1'), '-Printer', printer, '-File', file, '-Name', name || 'Regal labels'];
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', args, { windowsHide: true });
    let out = '', err = '';
    ps.stdout.on('data', d => out += d); ps.stderr.on('data', d => err += d);
    ps.on('close', code => { fs.unlink(file, () => {}); code === 0 ? resolve(out.trim()) : reject(new Error((err || out || 'print failed').trim().split('\n')[0])); });
  });
}

/* ---- bills made somewhere else ----
   A bill keyed on a phone, on a second till or on the website has no printer of its own. It is left
   on the shop's server as a job, and this helper asks for the next one every couple of seconds and
   prints it here. Only outgoing calls, so nothing has to be opened to this PC from outside. */
const SERVER = String(cfg.server || process.env.PRINT_SERVER || 'http://127.0.0.1:4000').replace(/\/$/, '');
const KEY = String(cfg.key || process.env.PRINT_DEVICE_KEY || process.env.SHIFT_DEVICE_KEY || '');
/* every 5 s (never under 3): the shop reaches regalhw.lk from one address, and the hosting firewall blocked it
   as a bot when the tills and this helper asked every 2 s (30 Oct 2026). A bill printed at this PC does not wait
   on this — the till hands it to the helper directly; only bills from elsewhere come by the queue. */
const EVERY = Math.max(3000, +cfg.pollMs || 5000);
let failing = 0;                                           // the server erroring or out of reach: ask further apart, up to 2 minutes
const backoff = () => Math.min(120000, EVERY * 2 ** Math.min(++failing, 5));
let queueSaid = '';
async function takeJobs() {
  if (!KEY) return;                                        // no key set: the helper only serves this PC
  try {
    const printers = encodeURIComponent(JSON.stringify({ r80: cfg.r80.printer, a5: cfg.a5.printer, label: (cfg.label && cfg.label.printer) || null }));
    const r = await fetch(`${SERVER}/api/print/next?key=${encodeURIComponent(KEY)}&printers=${printers}`);
    if (!r.ok) { const why = r.status === 403 ? 'the server does not know this key' : 'the server said ' + r.status;
      if (queueSaid !== why) { queueSaid = why; log('queue:', why) } return 'err' }
    if (queueSaid) { log('queue: talking to the shop server again'); queueSaid = '' }
    const j = await r.json().catch(() => ({}));
    const job = j && j.job; if (!job) return false;
    log('queue job', job.id, job.format, job.no || '', 'from', job.by || '?', job.till ? '· till ' + job.till : '');
    try {
      // labels from another PC: the Zebra's own language, straight to the label printer
      if (job.format === 'label') {
        const printer = (cfg.label && cfg.label.printer) || '';
        if (!printer) throw new Error('no label printer set on this PC (config.json: "label")');
        const run = busy.then(() => printRaw(printer, job.html, 'Labels ' + (job.no || '')));
        busy = run.catch(() => {}); await run;
        await say(job.id, { ok: true, printer });
        log('queue job', job.id, '→ labels on', printer);
        return true;
      }
      if (seenJustNow(job.format, job.html)) {
        await say(job.id, { ok: true, printer: cfg[job.format].printer });
        log('queue job', job.id, job.no || '', 'NOT printed again — the same bill was printed seconds ago');
        return true;
      }
      const t0 = Date.now(); let tDraw = 0;
      const run = busy.then(async () => {
        const file = await render(job.format, job.html);
        tDraw = Date.now() - t0;
        let out = '';
        for (let i = 0; i < (job.copies || 1); i++) out = await printImage(job.format, i ? await render(job.format, job.html) : file);
        return out;
      });
      busy = run.catch(() => {});
      await run;
      await say(job.id, { ok: true, printer: cfg[job.format].printer });
      log('queue job', job.id, '→ printed on', cfg[job.format].printer,
        `· drew it in ${tDraw}ms, the printer took ${Date.now() - t0 - tDraw}ms`);
    } catch (e) {
      await say(job.id, { ok: false, error: e.message });
      log('queue job', job.id, 'FAILED', e.message);
    }
    return true;                                           // there may be another behind it
  } catch (e) {
    const why = 'cannot reach ' + SERVER + ' (' + e.message + ')';
    if (queueSaid !== why) { queueSaid = why; log('queue:', why, '— asking less often until it answers') }
    return 'err';
  }
}
const say = (id, body) => fetch(`${SERVER}/api/print/${id}/done?key=${encodeURIComponent(KEY)}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});

const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true', 'Content-Type': 'application/json' };
const send = (res, code, body) => { res.writeHead(code, HEADERS); res.end(JSON.stringify(body)); };
let busy = Promise.resolve();

/* Who may print on this PC's printers straight away: the shop's till page (regalhw.lk, also inside the
   Regal POS program, which opens that page) — the same server the queue is fetched from. A till opened
   from anywhere else on this PC — a copy on localhost, a test, a script — is refused, and prints the
   browser's own way instead. Test runs here once sent their sample vouchers to the shop's printer
   (V-00310 and V-00311, a dozen times on 27 Oct 2026). More addresses: "allow": [...] in config.local.json. */
const siteOf = (u) => { try { return new URL(u).origin.toLowerCase() } catch { return '' } };
const ALLOWED = new Set([cfg.server, ...(Array.isArray(cfg.allow) ? cfg.allow : [])].map(siteOf).filter(Boolean)
  .flatMap(o => [o, o.replace('://www.', '://'), o.replace('://', '://www.').replace('://www.www.', '://www.')])
  .flatMap(o => [o, o.replace(/^https:/, 'http:'), o.replace(/^http:/, 'https:')]));
const fromTheShop = (req) => ALLOWED.has(String(req.headers.origin || '').toLowerCase());
const refuse = (req, res, what) => { log(what, 'NOT printed — asked from', req.headers.origin || 'no web page (a script on this PC)', '— only the shop till prints here');
  send(res, 403, { ok: false, error: 'This print helper only prints for the shop till (' + [...ALLOWED][0] + ')' }); };

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/status') return send(res, 200, { ok: true, printers: { r80: cfg.r80.printer, a5: cfg.a5.printer, label: cfg.label && cfg.label.printer || null }, renderer: path.basename(chrome) });
  if (req.method === 'POST' && req.url === '/preview') {            // the rendered image, for checking — nothing is printed
    let body = ''; req.on('data', d => { body += d; }); req.on('end', async () => {
      try { const job = JSON.parse(body); const file = await render(job.format, job.html); const png = fs.readFileSync(file); fs.unlink(file, () => {}); res.writeHead(200, { ...HEADERS, 'Content-Type': 'image/png' }); res.end(png); }
      catch (e) { send(res, 500, { ok: false, error: e.message }); } });
    return;
  }
  if (req.method === 'POST' && req.url === '/label') {             // { zpl } → straight to the label printer
    if (!fromTheShop(req)) return refuse(req, res, 'labels');
    let body = ''; req.on('data', d => { body += d; if (body.length > 4e6) req.destroy(); });
    req.on('end', async () => {
      let job; try { job = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: 'bad request' }); }
      const printer = (cfg.label && cfg.label.printer) || '';
      if (!printer) return send(res, 400, { ok: false, error: 'no label printer set in the print helper (config.json: "label")' });
      if (!job.zpl || !job.zpl.includes('^XA')) return send(res, 400, { ok: false, error: 'no labels in the request' });
      const run = busy.then(() => printRaw(printer, job.zpl, job.name)); busy = run.catch(() => {});
      try { const out = await run; log('labels', job.count || '', '→', out); send(res, 200, { ok: true, printer }); }
      catch (e) { log('FAILED labels', e.message); send(res, 500, { ok: false, error: e.message }); }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/print') {
    if (!fromTheShop(req)) return refuse(req, res, 'print');
    let body = ''; req.on('data', d => { body += d; if (body.length > 8e6) req.destroy(); });
    req.on('end', async () => {
      let job; try { job = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: 'bad request' }); }
      if (!job.html || !cfg[job.format]) return send(res, 400, { ok: false, error: 'format and html needed' });
      if (seenJustNow(job.format, job.html)) { log(job.format, job.no || '', 'NOT printed again — the same bill was printed seconds ago');
        return send(res, 200, { ok: true, printer: cfg[job.format].printer, again: false }); }
      // one at a time, in order — two bills never fight over the printer
      const t0 = Date.now(); let tDraw = 0;
      const run = busy.then(async () => {
        const file = await render(job.format, job.html);
        tDraw = Date.now() - t0;
        return printImage(job.format, file);
      });
      busy = run.catch(() => {});
      try { const out = await run; log(job.format, job.no || '', '→', out,
        `· drew it in ${tDraw}ms, the printer took ${Date.now() - t0 - tDraw}ms`);
        send(res, 200, { ok: true, printer: cfg[job.format].printer, ms: Date.now() - t0, drawMs: tDraw }); }
      catch (e) { log('FAILED', job.format, job.no || '', e.message); send(res, 500, { ok: false, error: e.message }); }
    });
    return;
  }
  send(res, 404, { ok: false, error: 'not found' });
}).listen(cfg.port, '127.0.0.1', () => {
  log(`Regal print helper on http://localhost:${cfg.port} — 80mm → ${cfg.r80.printer}, A5 → ${cfg.a5.printer}, labels → ${(cfg.label && cfg.label.printer) || 'none'} (rendering with ${path.basename(chrome)})`);
  if (KEY) {
    log(`Watching ${SERVER} for bills sent from anywhere else`);
    const tick = () => takeJobs()
      .then(did => { if (did === 'err') return backoff(); failing = 0; return did === true ? 0 : EVERY },   // just printed one? look again at once
            e => { if (queueSaid !== 'unreachable') { queueSaid = 'unreachable'; log('queue: cannot reach', SERVER, '(' + e.message + ') — asking less often until it answers') } return backoff() })
      .then(wait => setTimeout(tick, wait));
    tick();
  }
  else log('No print key set, so only this PC can print through the helper (config.json: "key", and the same in the server\'s PRINT_DEVICE_KEY)');
});
process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit(0); });
