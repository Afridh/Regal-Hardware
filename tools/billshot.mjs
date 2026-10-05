// A bill, rendered exactly as the printer is handed it.
//
//   node tools/billshot.mjs r80 out.png        the 80mm roll, 576 dots wide, pure black and white
//   node tools/billshot.mjs a5 out.png         the A5 invoice
//   node tools/billshot.mjs r80 out.png --grey keep the greys, to see what the thresholding does
//
// This is the whole chain the paper goes through — rendered at print size, shrunk to the roll's
// width, and every pixel forced to black or white — so what comes out of here is what comes out of
// the printer. Looking at the screen instead will flatter the result: the screen has greys and the
// thermal head does not.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const fmt = process.argv[2] === 'a5' ? 'a5' : 'r80';
const out = process.argv[3] || `tools/_bill_${fmt}.png`;
const GREY = process.argv.includes('--grey');
const DOTS = 576;                                  // what the 80mm head prints across

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1300, height: 900 });
await pg.goto('http://localhost:4000/pos', { waitUntil: 'networkidle2' });
await pg.waitForSelector('#lockScreen');
if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
await pg.type('#lockPw', 'Afridh123');
await pg.click('#lockGo');
await pg.waitForFunction(() => !document.getElementById('lockScreen'));
await new Promise(r => setTimeout(r, 1500));

const got = await pg.evaluate((f) => {
  const inv = S.sales.slice().reverse().find(s => (s.lines || []).length >= 3)
           || S.sales.slice().reverse().find(s => (s.lines || []).length >= 1) || S.sales.at(-1);
  return { no: inv.no, lines: (inv.lines || []).length, html: billDocument(inv, f) };
}, fmt);
await pg.close();

const p2 = await b.newPage();
await p2.setViewport({ width: fmt === 'r80' ? DOTS : 1200, height: 900, deviceScaleFactor: 2 });
await p2.setContent(got.html, { waitUntil: 'load' });
await p2.emulateMediaType('print');
await p2.evaluate((f, dots) => {
  document.body.classList.add('direct-print');
  document.body.style.margin = '0'; document.body.style.background = '#fff';
  const el = document.querySelector('#printArea .print'); if (!el) return;
  if (f === 'r80') {
    const sc = +el.dataset.scale || 1;
    el.style.width = (302 / sc) + 'px'; el.style.border = '0';
    el.style.padding = '2px 4px'; el.style.boxSizing = 'border-box';
    el.style.zoom = String(dots / 302 * sc);
    el.style.webkitFontSmoothing = 'none';
    document.body.style.width = dots + 'px';
  }
}, fmt, DOTS);
await p2.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
await new Promise(r => setTimeout(r, 350));

const shot = await (await p2.$('#printArea .print')).screenshot({ encoding: 'base64' });
const res = await p2.evaluate(async (b64, wide, grey) => {
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + b64 });
  const w = wide || img.width, h = Math.round(img.height * (w / img.width));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
  let ink = 0;
  if (!grey) {
    const d = g.getImageData(0, 0, w, h), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      const v = lum < 186 ? 0 : 255; if (!v) ink++;
      px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
  }
  return { url: c.toDataURL('image/png'), w, h, ink };
}, shot, fmt === 'r80' ? DOTS : 0, GREY);

fs.writeFileSync(out, Buffer.from(res.url.split(',')[1], 'base64'));
const mm = fmt === 'r80' ? (res.h / 576 * 80).toFixed(0) : null;
console.log(`${got.no} · ${got.lines} lines · ${res.w} x ${res.h} dots${mm ? ` · about ${mm}mm of roll` : ''} -> ${out}`);
await b.close();
