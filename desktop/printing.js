// Printing from Regal POS itself — no print helper, no print box.
//
// The till already knows how to hand a bill to "the print helper on this PC" (http://localhost:4100).
// Inside Regal POS those calls are answered here instead: the bill is drawn exactly as the helper
// draws it and sent to this PC's own printer, found by name —
//   labels  → the Zebra        80mm receipts → the Epson        A5 bills → the Canon
// A format this PC has no printer for is passed on unchanged (to a helper, if one runs here), so the
// till then sends it to the counter through the shop, as it always has.
const { app, BrowserWindow, webContents } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// the same drawing settings as the print helper (backend/tools/print-agent/config.json)
const FMT = {
  r80: { widthPx: 576, dots: 576, dpi: 203, scale: 1, threshold: 186, oversample: 2 },
  a5: { widthPx: 733, scale: 2, oversample: 1, paper: 'A5', landscape: true }
};
const GUESS = {
  label: [/zdesigner|zebra|\bzpl\b|zd2\d\d|gk420|gc420/i],
  r80: [/tm-?t\d|epson.*(receipt|tm)|receipt|pos-?80|80\s?mm|xprinter|thermal/i, /epson/i],
  a5: [/lbp|canon/i]
};
const NAMES = { label: 'Labels (Zebra)', r80: '80mm receipts (Epson)', a5: 'A5 bills (Canon)' };

const tmp = path.join(os.tmpdir(), 'regal-pos-print');
const scripts = () => app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../backend/tools/print-agent');
let cfgFile = null, cfg = { r80: '', a5: '', label: '', chosen: {} };

function load() {
  cfgFile = path.join(app.getPath('userData'), 'printers.json');
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile, 'utf8'))); } catch { }
}
function save() { try { fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2)); } catch { } }

/** The printers on this PC, and for each format the one picked by hand or, failing that, by its name. */
async function detect() {
  const any = webContents.getAllWebContents()[0];
  const list = any ? await any.getPrintersAsync() : [];
  const names = list.map(p => p.name);
  for (const k of ['label', 'r80', 'a5']) {
    if (cfg.chosen[k] && names.includes(cfg[k])) continue;            // picked by hand and still there
    if (cfg.chosen[k] && cfg[k] === '') continue;                       // "none" picked by hand
    let hit = '';
    for (const re of GUESS[k]) { hit = names.find(n => re.test(n) && !(k === 'r80' && GUESS.label[0].test(n))) || ''; if (hit) break; }
    cfg[k] = hit; cfg.chosen[k] = false;
  }
  save();
  return { printers: names, chosen: { r80: cfg.r80, a5: cfg.a5, label: cfg.label } };
}
function choose(k, name) { if (!(k in NAMES)) return; cfg[k] = name || ''; cfg.chosen[k] = true; save(); }

function ps(script, args) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts(), script), ...args], { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error((err || out || 'print failed').trim().split('\n')[0])));
  });
}

/** Draw the bill to a black-and-white PNG at the printer's own size — what the helper's render() does. */
const T=(m)=>process.env.REGAL_SELFTEST&&console.log("STEP",m);
const within = (ms, p, why) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(why)), ms))]);
async function render(format, html) {
  const f = FMT[format]; if (!f) throw new Error('unknown format ' + format);
  fs.mkdirSync(tmp, { recursive: true });
  const page = path.join(tmp, 'bill-' + Date.now() + '.html'); fs.writeFileSync(page, html);
  const w = new BrowserWindow({ show: false, width: f.widthPx, height: 800, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true, partition: 'regal-print' } });
  try {
    await w.loadFile(page); T('loaded');
    const dbg = w.webContents.debugger; dbg.attach('1.3'); T('attached');
    const over = Math.max(1, Math.min(4, f.oversample || 1));
    await dbg.sendCommand('Emulation.setEmulatedMedia', { media: 'print' }); T('media');
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: f.widthPx, height: 800, deviceScaleFactor: (f.scale || 1) * over, mobile: false }); T('metrics');
    const rect = await w.webContents.executeJavaScript(`(async () => {
      document.body.classList.add('direct-print'); document.body.style.margin = '0'; document.body.style.background = '#fff';
      const p = document.querySelector('#printArea .print');
      if (p && ${format === 'r80'}) {
        const sc = +p.dataset.scale || 1;
        p.style.width = (302 / sc) + 'px'; p.style.border = '0'; p.style.padding = '2px 4px'; p.style.boxSizing = 'border-box';
        p.style.zoom = String(${f.dots || 576} / 302 * sc); p.style.webkitFontSmoothing = 'none';
        document.body.style.width = '${f.dots || 576}px';
      }
      // the fonts, but never waited on for ever: a font that does not come prints in the fallback
      if (document.fonts) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]);
      await new Promise(r => setTimeout(r, 60));
      // the roll: its whole width, from the top to the end of the receipt (a zoomed element's own box is
      // measured short by this Chromium, which cut the right-hand figures off)
      if (${format === 'r80'}) return { x: 0, y: 0, width: ${f.dots || 576}, height: Math.ceil(document.documentElement.scrollHeight) };
      const el = p || document.body, r = el.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: Math.ceil(r.width), height: Math.ceil(Math.max(r.height, el.scrollHeight || 0)) };
    })()`);
    T('rect ' + JSON.stringify(rect));
    // a hidden window only draws what fits in it: make it as tall as the bill, then take the picture
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: f.widthPx, height: Math.ceil(rect.y + rect.height) + 4, deviceScaleFactor: (f.scale || 1) * over, mobile: false });
    await w.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const shot = await within(15000, dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { ...rect, scale: 1 } }), 'the bill could not be drawn');
    T('shot');
    const wide = format === 'r80' ? (f.dots || 576) : 0, cut = Math.max(1, Math.min(254, f.threshold || 186));
    const png = await w.webContents.executeJavaScript(`(async () => {
      const img = new Image(); await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,${shot.data}' });
      const w = ${wide} || img.width, h = Math.round(img.height * (w / img.width));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h), px = d.data;
      for (let i = 0; i < px.length; i += 4) { const v = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) < ${cut} ? 0 : 255; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255; }
      g.putImageData(d, 0, 0); return c.toDataURL('image/png').split(',')[1];
    })()`);
    const file = path.join(tmp, 'bill-' + Date.now() + '.png'); fs.writeFileSync(file, Buffer.from(png, 'base64'));
    return file;
  } finally { w.destroy(); fs.unlink(page, () => { }); }
}

let busy = Promise.resolve();                    // one at a time, in order
const queued = (fn) => { const run = busy.then(fn); busy = run.catch(() => { }); return run; };

async function printBill(format, html) {
  const printer = cfg[format]; const f = FMT[format];
  return queued(async () => {
    const file = await render(format, html);
    const args = ['-Printer', printer, '-Image', file];
    if (f.paper) args.push('-Paper', f.paper);
    if (f.landscape) args.push('-Landscape');
    if (format === 'r80') args.push('-Roll', '-Dpi', String(f.dpi), '-Cut', String(f.threshold), '-Flat');
    try { return await ps('print-image.ps1', args); } finally { fs.unlink(file, () => { }); }
  });
}
async function printLabels(zpl, name) {
  return queued(async () => {
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, 'labels-' + Date.now() + '.zpl'); fs.writeFileSync(file, zpl, 'utf8');
    try { return await ps('print-raw.ps1', ['-Printer', cfg.label, '-File', file, '-Name', name || 'Regal labels']); } finally { fs.unlink(file, () => { }); }
  });
}

/* The till's calls to "the print helper", answered here. Returns null to let the call go on as usual. */
const HEAD = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Private-Network': 'true' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: HEAD });
async function answer(req) {
  const u = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEAD });
  if (u.pathname === '/status') {
    if (!cfg.r80 && !cfg.a5 && !cfg.label) return null;              // no printers here: as if there were no helper
    return json({ ok: true, printers: { r80: cfg.r80 || null, a5: cfg.a5 || null, label: cfg.label || null }, renderer: 'Regal POS' });
  }
  if (u.pathname === '/print') {
    const body = await req.clone().json().catch(() => null);
    if (!body || !body.html || !FMT[body.format]) return json({ ok: false, error: 'format and html needed' }, 400);
    if (!cfg[body.format]) return null;                                  // no printer for this here: on to the counter
    const t0 = Date.now();
    try { await printBill(body.format, body.html); return json({ ok: true, printer: cfg[body.format], ms: Date.now() - t0 }); }
    catch (e) { return json({ ok: false, error: e.message }, 500); }
  }
  if (u.pathname === '/label') {
    const body = await req.clone().json().catch(() => null);
    if (!body || !String(body.zpl || '').includes('^XA')) return json({ ok: false, error: 'no labels in the request' }, 400);
    if (!cfg.label) return null;
    try { await printLabels(body.zpl, body.name); return json({ ok: true, printer: cfg.label }); }
    catch (e) { return json({ ok: false, error: e.message }, 500); }
  }
  if (u.pathname === '/preview') {
    const body = await req.clone().json().catch(() => null);
    if (!body || !FMT[body.format]) return json({ ok: false, error: 'format and html needed' }, 400);
    const file = await render(body.format, body.html); const png = fs.readFileSync(file); fs.unlink(file, () => { });
    return new Response(png, { headers: { ...HEAD, 'Content-Type': 'image/png' } });
  }
  return null;
}

/* ---------------- the Printers window (Ctrl+Shift+P) ---------------- */
const TEST_BILL = (fmt) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Arial,sans-serif}.print{width:${fmt === 'a5' ? '733px' : '302px'};padding:${fmt === 'a5' ? '30px' : '6px'};box-sizing:border-box;text-align:center}
h1{margin:6px 0;font-size:${fmt === 'a5' ? 40 : 22}px}p{margin:4px 0;font-size:${fmt === 'a5' ? 20 : 13}px}</style></head>
<body><div id="printArea"><div class="print" data-scale="1"><h1>REGAL HARDWARE</h1><p>Regal POS — printer test</p>
<p>${fmt === 'a5' ? 'A5 bill printer' : '80mm receipt printer'}</p><p>${new Date().toLocaleString('en-GB')}</p><p>If you can read this, it works.</p></div></div></body></html>`;
const TEST_LABEL = '^XA^CI28^PW800^LL200^FO30,30^A0N,40,40^FDRegal POS - label test^FS^FO30,90^A0N,28,28^FD' + new Date().toLocaleString('en-GB') + '^FS^XZ';

let pw = null;
function openPrintersWindow(parent) {
  if (pw && !pw.isDestroyed()) { pw.focus(); return; }
  pw = new BrowserWindow({ parent, width: 620, height: 520, resizable: false, minimizable: false, title: 'Regal POS — Printers', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'printers-preload.js'), contextIsolation: true } });
  pw.loadFile(path.join(__dirname, 'printers.html'));
}

module.exports = { load, detect, choose, answer, render, printBill, printLabels, openPrintersWindow, TEST_BILL, TEST_LABEL, NAMES, config: () => cfg };
