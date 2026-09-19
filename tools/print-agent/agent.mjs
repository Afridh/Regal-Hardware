// The print helper: runs on the till PC and prints each bill on the right printer, no print box.
//   node tools/print-agent/agent.mjs          (or the "Regal print helper" startup shortcut)
// The till POSTs { format: 'r80' | 'a5', html } to http://localhost:4100/print.  The helper renders
// the bill with the Chrome on this PC (exactly as the browser would print it), then hands the image to
// Windows for the printer named in config.json — 80mm receipts to the EPSON, A5 bills to the Canon.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8'));
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!chrome) { console.error('No Chrome, Brave or Edge found to render bills with'); process.exit(1); }
const tmp = path.join(os.tmpdir(), 'regal-print'); fs.mkdirSync(tmp, { recursive: true });
const log = (...a) => console.log(new Date().toLocaleTimeString('en-GB'), ...a);

let browser = null;
async function getBrowser() {
  if (browser && browser.connected) return browser;
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  return browser;
}

/** Render the bill to a PNG at print resolution. */
async function render(format, html) {
  const f = cfg[format]; if (!f) throw new Error('unknown format ' + format);
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: f.widthPx, height: 800, deviceScaleFactor: f.scale || 2 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMediaType('print');
    await page.evaluate(() => { document.body.classList.add('direct-print'); document.body.style.margin = '0'; document.body.style.background = '#fff'; });
    await new Promise(r => setTimeout(r, 150));
    const file = path.join(tmp, `bill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`);
    const target = await page.$('#printArea .print') || await page.$('body');
    await target.screenshot({ path: file, omitBackground: false });
    return file;
  } finally { await page.close(); }
}

/** Hand the image to Windows for the printer this format goes to. */
function printImage(format, file) {
  const f = cfg[format];
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'print-image.ps1'), '-Printer', f.printer, '-Image', file];
  if (f.paper) args.push('-Paper', f.paper);
  if (f.landscape) args.push('-Landscape');
  if (format === 'r80') args.push('-Roll');
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', args, { windowsHide: true });
    let out = '', err = '';
    ps.stdout.on('data', d => out += d); ps.stderr.on('data', d => err += d);
    ps.on('close', code => { fs.unlink(file, () => {}); code === 0 ? resolve(out.trim()) : reject(new Error((err || out || 'print failed').trim().split('\n')[0])); });
  });
}

const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true', 'Content-Type': 'application/json' };
const send = (res, code, body) => { res.writeHead(code, HEADERS); res.end(JSON.stringify(body)); };
let busy = Promise.resolve();

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/status') return send(res, 200, { ok: true, printers: { r80: cfg.r80.printer, a5: cfg.a5.printer }, renderer: path.basename(chrome) });
  if (req.method === 'POST' && req.url === '/print') {
    let body = ''; req.on('data', d => { body += d; if (body.length > 8e6) req.destroy(); });
    req.on('end', async () => {
      let job; try { job = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: 'bad request' }); }
      if (!job.html || !cfg[job.format]) return send(res, 400, { ok: false, error: 'format and html needed' });
      // one at a time, in order — two bills never fight over the printer
      const run = busy.then(async () => {
        const file = await render(job.format, job.html);
        return printImage(job.format, file);
      });
      busy = run.catch(() => {});
      try { const out = await run; log(job.format, job.no || '', '→', out); send(res, 200, { ok: true, printer: cfg[job.format].printer }); }
      catch (e) { log('FAILED', job.format, job.no || '', e.message); send(res, 500, { ok: false, error: e.message }); }
    });
    return;
  }
  send(res, 404, { ok: false, error: 'not found' });
}).listen(cfg.port, '127.0.0.1', () => log(`Regal print helper on http://localhost:${cfg.port} — 80mm → ${cfg.r80.printer}, A5 → ${cfg.a5.printer} (rendering with ${path.basename(chrome)})`));
process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit(0); });
