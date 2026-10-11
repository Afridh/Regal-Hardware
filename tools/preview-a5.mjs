// Draws the large (A5) invoice for a made-up bill to a PNG, so the layout can be checked without a printer.
//   node tools/preview-a5.mjs [out.png] [r80|a5]
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || 'a5-preview.png');
const fmt = process.argv[3] || 'a5';
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: fmt === 'a5' ? 900 : 420, height: 800, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('page error:', e.message));
// the sandboxed demo page: no server, the till seeds its own sample shop
let html = fs.readFileSync(path.join(here, '../app/index.html'), 'utf8')
  .replace(/<script src="regal-bridge\.js"><\/script>\r?\n?/, '')
  .replace(/<head>/i, '<head>\n<base href="' + pathToFileURL(path.join(here, '../app/')).href + '">\n<script src="demo-sandbox.js"></script>');
const tmp = path.join(here, '_preview.html'); fs.writeFileSync(tmp, html);
await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1500));
const ok = await page.evaluate((fmt, nLines, style) => {
  if (style) CFG.bill.a5Style = style;
  if (typeof billHtml !== 'function' || !window.S || !S.products || !S.products.length) return 'no app';
  const c = S.customers.find(x => x.id !== 1) || S.customers[0];
  const lines = S.products.slice(0, nLines).map((p, i) => ({ pid: p.id, qty: [6, 12, 1, 4, 3, 40, 2, 10, 1][i] || 1, price: +(p.retail * (i % 3 ? 1 : 0.93)).toFixed(2), disc: 0, discPct: i % 3 ? undefined : 7.5, mrp: p.mrp, warranty: i === 2 ? '1 YEAR' : '0' }));
  const total = +lines.reduce((a, l) => a + l.qty * l.price, 0).toFixed(2);
  const inv = { no: 'INVM-11-0472', date: '2026-10-11', time: '02:38:12 pm', customerId: c.id, lines, sub: total, billDisc: 0, total, paid: 20000, balance: +(total - 20000).toFixed(2), pays: [{ method: 'CASH', amount: 20000 }, { method: 'CREDIT', amount: +(total - 20000).toFixed(2) }], by: 'SAMEERA K.', salesman: 'NIMAL', terminal: 'T1', note: 'Goods delivered to Site B. Balance tiles to follow.', serial: 36186 };
  const box = document.createElement('div'); box.id = 'pv'; box.style.cssText = 'position:absolute;left:0;top:0;width:' + (fmt === 'a5' ? '880px' : '302px') + ';background:#fff;z-index:99999';
  box.innerHTML = billHtml(inv, fmt); document.body.appendChild(box); const pr = box.querySelector('.print'); if (pr) { pr.style.aspectRatio = 'auto'; pr.style.zoom = '1'; pr.style.width = '100%'; }
  return 'ok';
}, fmt, +(process.env.LINES || 9), process.env.STYLE || '');
console.log('render:', ok);
const el = await page.$('#pv');
if (el) await el.screenshot({ path: out });
await browser.close();
fs.unlinkSync(tmp);
console.log('saved', out);
