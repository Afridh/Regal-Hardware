// Prints a made-up bill on the shop's printers through the print helper, to check a design on paper.
//   node tools/print-sample.mjs [a5|r80] [credit|cash] [style]
// Nothing is saved to the books; the bill is drawn from the till's own template with sample products.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fmt = process.argv[2] || 'a5';
const kind = process.argv[3] || 'credit';
const style = process.argv[4] || '';
const agent = process.env.AGENT || 'http://localhost:4100';
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('page error:', e.message));
const html = fs.readFileSync(path.join(here, '../app/index.html'), 'utf8')
  .replace(/<script src="regal-bridge\.js"><\/script>\r?\n?/, '')
  .replace(/<head>/i, '<head>\n<base href="' + pathToFileURL(path.join(here, '../app/')).href + '">\n<script src="demo-sandbox.js"></script>');
const tmp = path.join(here, '_sample.html'); fs.writeFileSync(tmp, html);
await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1500));
const billCss = fs.readFileSync(path.join(here, '../app/bill-print.css'), 'utf8');
const doc = await page.evaluate((fmt, kind, style, billCss) => {
  if (typeof billHtml !== 'function' || !S.products.length) return null;
  if (style) CFG.bill.a5Style = style;
  const c = S.customers.find(x => x.id !== 1) || S.customers[0];
  const lines = S.products.slice(0, 12).map((p, i) => ({ pid: p.id, qty: [6, 12, 1, 4, 3, 40, 2, 10, 1, 1, 5, 2][i] || 1,
    price: +(p.retail * (i % 3 ? 1 : 0.93)).toFixed(2), disc: 0, discPct: i % 3 ? undefined : 7.5, mrp: p.mrp, warranty: i === 2 ? '1 YEAR' : '0' }));
  const total = +lines.reduce((a, l) => a + l.qty * l.price, 0).toFixed(2);
  const credit = kind === 'credit', paid = credit ? 20000 : total;
  const inv = { no: 'SAMPLE-0001', date: new Date().toISOString().slice(0, 10), time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
    customerId: credit ? c.id : 1, lines, sub: total, billDisc: 0, total, paid, balance: +(total - paid).toFixed(2),
    pays: credit ? [{ method: 'CASH', amount: paid }, { method: 'CREDIT', amount: +(total - paid).toFixed(2) }] : [{ method: 'CASH', amount: paid }],
    by: (S.user && S.user.name) || 'AFRIDH', salesman: credit ? 'NIMAL' : null, terminal: 'T1', note: credit ? 'SAMPLE — not a real bill. Goods delivered to site.' : '', serial: 36186, proof: false };
  const inline = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${inline}\n${billCss}</style></head><body class="direct-print"><div id="printArea" class="printArea ${fmt}">${billHtml(inv, fmt)}</div></body></html>`;
}, fmt, kind, style, billCss);
await browser.close();
fs.unlinkSync(tmp);
if (!doc) { console.log('could not draw the bill'); process.exit(1); }
const r = await fetch(agent + '/print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: fmt, no: 'SAMPLE-0001', html: doc }) });
console.log(r.status, await r.text());
