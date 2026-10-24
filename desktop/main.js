// Regal POS for Windows — the till as a program of its own.
//
// It opens the shop's till at regalhw.lk/pos, so every update to the till reaches it the moment it is
// published, exactly as in the browser. What it adds:
//   · its own window: no address bar, no tabs, no browser help page on F1 — every key is the till's
//   · it opens with no internet: each page and file of the till is kept on this PC as it is loaded, and
//     when the shop's server cannot be reached the kept copy is used. The till then works from this PC's
//     own copy of the books (regal-bridge.js) and sends everything when the internet is back.
//   · one copy at a time: opening it again brings the open window to the front
//   · it prints by itself (printing.js): labels on the Zebra, 80mm on the Epson, A5 on the Canon, found by
//     name on this PC — Ctrl+Shift+P to change them. A PC without one sends that paper to the counter.
//   · it updates itself: a new version is fetched in the background and it asks before restarting
const { app, BrowserWindow, Menu, protocol, net, shell, session, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const printing = require('./printing');
const HELPER_PORT = '4100';

const SHOP = process.env.REGAL_SHOP || 'https://regalhw.lk';
const START = SHOP + '/pos';
const SHOP_HOST = new URL(SHOP).host;

// the till knows it is inside the program by this (Electron no longer puts the app's name in it by itself)
app.userAgentFallback = app.userAgentFallback + ' regal-pos/' + app.getVersion();
if (process.env.REGAL_PROFILE) app.setPath('userData', path.resolve(process.env.REGAL_PROFILE));   // for testing only
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.setAppUserModelId('lk.regalhw.pos');

/* ---------------- the till kept on this PC ---------------- */
let CACHE;
const keyOf = (u) => crypto.createHash('sha1').update(u).digest('hex');
const plain = (u) => { const x = new URL(u); x.search = ''; x.hash = ''; return x.href; };
function keep(url, type, buf) {
  try { fs.writeFileSync(path.join(CACHE, keyOf(url)), buf); fs.writeFileSync(path.join(CACHE, keyOf(url) + '.type'), type || ''); } catch { /* next time */ }
}
function kept(url) {
  for (const u of [url, plain(url)]) {
    const f = path.join(CACHE, keyOf(u));
    if (fs.existsSync(f)) return { body: fs.readFileSync(f), type: fs.existsSync(f + '.type') ? fs.readFileSync(f + '.type', 'utf8') : '' };
  }
  return null;
}
// what is kept: the till's own pages and files, and the fonts and libraries it loads — never the shop's data
const keepable = (u) => {
  if (u.host === SHOP_HOST) return !u.pathname.startsWith('/api') && !/\.php$/.test(u.pathname) && !u.pathname.startsWith('/reports');
  return /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com)$/.test(u.host);
};

const offlinePage = `<!doctype html><meta charset="utf-8"><title>Regal POS</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#16070a;color:#fff;font:16px Arial">
<div style="max-width:520px;text-align:center"><h1 style="margin:0 0 10px">Regal POS</h1>
<p>This PC has not opened the till with the internet yet, so there is no copy of it here to work from.</p>
<p>Connect to the internet once and open Regal POS — after that it opens and bills with or without the internet.</p>
<button onclick="location.href='${START}'" style="padding:10px 22px;font:600 15px Arial;border:0;border-radius:8px;background:#b3121f;color:#fff;cursor:pointer">Try again</button></div>`;

function wire() {
  // every web request passes through here: fetched as usual, kept when it is part of the till, and
  // answered from what is kept when there is no internet
  for (const scheme of ['https', 'http']) protocol.handle(scheme, async (req) => {
    const u = new URL(req.url);
    // the till asking "the print helper on this PC": this program prints it, if it has the printer
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === HELPER_PORT) {
      const mine = await printing.answer(req).catch(e => new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }));
      if (mine) return mine;
      return net.fetch(req, { bypassCustomProtocolHandlers: true });   // a helper on this PC, if there is one
    }
    const canKeep = req.method === 'GET' && keepable(u);
    try {
      const res = await net.fetch(req, { bypassCustomProtocolHandlers: true });
      if (canKeep && res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        keep(req.url, res.headers.get('content-type'), buf);
        return new Response(buf, { status: res.status, headers: res.headers });
      }
      return res;
    } catch (e) {
      if (canKeep) {
        const k = kept(req.url);
        if (k) return new Response(k.body, { status: 200, headers: { 'Content-Type': k.type || 'application/octet-stream', 'X-Regal-Offline': '1' } });
        if (req.mode === 'navigate' || /\/pos\/?$/.test(u.pathname)) return new Response(offlinePage, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      throw e;                                            // the till's own calls to the server fail as they would in a browser
    }
  });
}

/* ---------------- the window ---------------- */
let win = null, pageStatus = 'starting…', updStatus = '';
function setTitle() { if (win && !win.isDestroyed()) win.setTitle(['Regal POS ' + app.getVersion(), pageStatus, updStatus].filter(Boolean).join('   ·   ')); }
function open() {
  Menu.setApplicationMenu(null);                          // no browser menus, no F1 help page
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600, show: false,
    title: 'Regal POS', backgroundColor: '#16070a',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, spellcheck: false, backgroundThrottling: false }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL(START);
  // the title bar: the version, how the till stands (from the page: "RPOS|● Online · synced 08:31") and any update
  win.on('page-title-updated', (e, title) => { e.preventDefault(); if (String(title).startsWith('RPOS|')) { pageStatus = String(title).slice(5); setTitle(); } });
  setTitle();

  // keys a browser menu would have given
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    const k = i.key.toLowerCase();
    if (k === 'f5' || (i.control && k === 'r')) { e.preventDefault(); i.shift ? win.webContents.reloadIgnoringCache() : win.webContents.reload(); }
    else if (i.control && i.shift && k === 'i') { e.preventDefault(); win.webContents.toggleDevTools(); }
    else if (i.control && (k === '=' || k === '+')) { e.preventDefault(); win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5); }
    else if (i.control && k === '-') { e.preventDefault(); win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5); }
    else if (i.control && k === '0') { e.preventDefault(); win.webContents.setZoomLevel(0); }
    else if (k === 'f11' && i.shift) { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }   // F11 alone is the till's (Barcode labels)
    else if (i.control && i.shift && k === 'p') { e.preventDefault(); printing.openPrintersWindow(win); }
  });

  // the till's own pop-ups (a bill to print, a label sheet) open here; WhatsApp, maps and the like in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url || url === 'about:blank' || url.startsWith(SHOP) || url.startsWith('blob:') || url.startsWith('data:')) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: path.join(__dirname, 'icon.png') } };
    }
    shell.openExternal(url); return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(SHOP)) { e.preventDefault(); shell.openExternal(url); }
  });
  // closing with work not yet sent: say so (it is kept on this PC either way)
  win.on('close', async (e) => {
    if (win.__closing) return;
    e.preventDefault();
    let unsent = false;
    try { unsent = await win.webContents.executeJavaScript('!!(window.regalBridge && regalBridge.unsynced && regalBridge.unsynced())'); } catch { }
    if (unsent) {
      const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Close anyway', 'Stay open'], defaultId: 1, cancelId: 1, title: 'Regal POS',
        message: 'Some work on this PC has not reached the shop yet.', detail: 'It is kept on this PC and will be sent the next time Regal POS is open with the internet. Closing is safe — but the other tills will not see it until then.' });
      if (r.response === 1) return;
    }
    win.__closing = true; win.close();
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  CACHE = path.join(app.getPath('userData'), 'till-kept'); fs.mkdirSync(CACHE, { recursive: true });
  // the camera for scanning barcodes, notifications and the clipboard: allowed for the shop's own pages
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, d) => cb((d.requestingUrl || '').startsWith(SHOP) && ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
  printing.load();
  ipcMain.handle('printers:list', () => printing.detect());
  ipcMain.handle('printers:choose', (e, kind, name) => printing.choose(kind, name));
  ipcMain.handle('printers:test', async (e, kind) => {
    const c = printing.config();
    try {
      if (kind === 'label') await printing.printLabels(printing.TEST_LABEL, 'Regal POS test');
      else await printing.printBill(kind, printing.TEST_BILL(kind));
      return { ok: true, printer: c[kind] };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  wire();
  open();
  // the printers on this PC, found as soon as there is a window to ask through
  win.webContents.once('did-finish-load', () => printing.detect().catch(() => { }));
  // checking the drawing without paper: REGAL_SELFTEST=<folder> draws a sample 80mm and A5 bill there and quits
  if (process.env.REGAL_SELFTEST) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    for (const f of ['r80', 'a5']) {
      try {
        const html = await win.webContents.executeJavaScript(`billDocument(sampleInvoice(), '${f}')`);
        fs.writeFileSync(path.join(process.env.REGAL_SELFTEST, 'bill-' + f + '.html'), html);
        const t = Date.now(); const file = await printing.render(f, html);
        fs.copyFileSync(file, path.join(process.env.REGAL_SELFTEST, 'app-' + f + '.png'));
        console.log('SELFTEST', f, 'drawn in', Date.now() - t, 'ms');
      } catch (e) { console.log('SELFTEST', f, 'FAILED', e.message); }
    }
    win.__closing = true; app.quit();
  }, 6000));
  updates();
});

/* ---------------- a new version of the program ----------------
   Looked for at start and every half hour (GitHub releases of Afridh/Regal-Hardware). It is fetched in the
   background; when it is ready the program asks — nothing restarts in the middle of a bill. The till
   itself (regalhw.lk/pos) updates on its own as before. */
function updates() {
  if (!app.isPackaged || process.env.REGAL_PROFILE) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let asked = false;
  autoUpdater.on('update-downloaded', async (info) => {
    updStatus = 'update ' + info.version + ' ready — restart to use it'; setTitle();
    if (asked || !win) return; asked = true;
    const r = await dialog.showMessageBox(win, { type: 'info', buttons: ['Restart and update', 'Later'], defaultId: 0, cancelId: 1, title: 'Regal POS',
      message: 'A new version of Regal POS is ready (' + info.version + ').',
      detail: 'Restart now to use it — it takes a few seconds, and nothing on the till is lost. Choose Later and it is put in the next time Regal POS is closed.' });
    if (r.response === 0) { win.__closing = true; setImmediate(() => autoUpdater.quitAndInstall(false, true)); }
  });
  autoUpdater.on('checking-for-update', () => { updStatus = 'checking for updates'; setTitle(); });
  autoUpdater.on('update-not-available', () => { updStatus = 'up to date'; setTitle(); });
  autoUpdater.on('update-available', (i) => { updStatus = 'downloading update ' + i.version + '…'; setTitle(); });
  autoUpdater.on('download-progress', (p) => { updStatus = 'downloading update ' + Math.round(p.percent || 0) + '%'; setTitle(); });
  autoUpdater.on('error', () => { updStatus = ''; setTitle(); });                     // no internet, or GitHub not answering: try again later
  const look = () => autoUpdater.checkForUpdates().catch(() => { });
  setTimeout(look, 15000);
  setInterval(look, 30 * 60 * 1000);
}
app.on('window-all-closed', () => app.quit());
