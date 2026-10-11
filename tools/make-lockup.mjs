// Turns the shop's logo artwork (mark + REGAL HARDWARE + Sinhala name) into a crisp, trimmed,
// black-and-white PNG for the bills, and writes it to app/regal-lockup.png.
//   node tools/make-lockup.mjs <source image> [width px, default 900]
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
const W = +(process.argv[3] || 900);
if (!src || !fs.existsSync(src)) { console.log('give the source image path'); process.exit(1); }
const mime = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,` + fs.readFileSync(src).toString('base64');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const out = await page.evaluate(async (dataUrl, W) => {
  const img = new Image(); await new Promise(r => { img.onload = r; img.src = dataUrl; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  // trim the white margin
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4; if (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114 < 160) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const pad = 4; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, H = Math.round(ch * W / cw);
  const o = document.createElement('canvas'); o.width = W; o.height = H;
  const og = o.getContext('2d'); og.imageSmoothingQuality = 'high'; og.fillStyle = '#fff'; og.fillRect(0, 0, W, H);
  og.drawImage(c, x0, y0, cw, ch, 0, 0, W, H);
  // pure black ink on a transparent ground, so it sits on any paper or panel
  const od = og.getImageData(0, 0, W, H), p = od.data;
  for (let i = 0; i < p.length; i += 4) { const l = p[i] * .299 + p[i + 1] * .587 + p[i + 2] * .114; p[i] = p[i + 1] = p[i + 2] = 0; p[i + 3] = l < 150 ? 255 : (l < 200 ? Math.round((200 - l) / 50 * 255) : 0); }
  og.putImageData(od, 0, 0);
  return { url: o.toDataURL('image/png'), w: W, h: H };
}, dataUrl, W);
await browser.close();
const file = path.join(here, '../app/regal-lockup.png');
fs.writeFileSync(file, Buffer.from(out.url.split(',')[1], 'base64'));
console.log(`wrote app/regal-lockup.png ${out.w}x${out.h}, ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
