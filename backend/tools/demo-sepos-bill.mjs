// A demo of the "Old SePOS invoice" large bill: the shop's example bill (cash) and the same on credit,
// drawn as they print on A5 landscape, saved as pictures.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/demo-sepos-bill.mjs <folder>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const OUT = process.argv[2] || '.';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1300, height: 900, deviceScaleFactor: 1.5 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await new Promise(r => setTimeout(r, 1500));
for (const kind of ['cash', 'credit']) {
  await pg.evaluate(kind => { document.querySelectorAll('.modal,#demoSheet').forEach(m => m.remove()); window.persist = () => {};
    const S = window.eval('S'), C = window.eval('CFG'); C.bill.a5Style = 'sepos';
    const base = S.products[0]; let id = 990500;
    const items = [['211275', '20L NIPPON ECO FILLER', 2, 9940, 6150], ['110687', '20L CHAMP INTERIOR B/WHITE', 1, 23600, 16000], ['211251', '1L NIPPON ACRYLIC EXTERIOR FILLER', 1, 1850, 1300], ['2163', 'ROLLER BRUSH 9"', 2, 850, 650]];
    const lines = items.map(([num, name, qty, mrp, price]) => { const p = { ...base, id: ++id, num, code: num, barcode: num, name, mrp, retail: price, unit: num === '2163' ? 'pcs' : 'tin' }; S.products.push(p); return { pid: p.id, name, qty, price, mrp, disc: 0 } });
    const cust = S.customers.find(c => c.id !== 1 && c.phone) || S.customers[1];
    const total = 30900;
    const inv = { no: 'INVM-11-037369', date: '2026-11-01', time: '1:44:29 PM', by: 'Afridh', lines, total, customerId: kind === 'cash' ? 1 : cust.id,
      paid: kind === 'cash' ? 30900 : 10000, balance: kind === 'cash' ? 0 : 20900, balanceNow: kind === 'cash' ? 0 : 20900, prevOut: kind === 'cash' ? 0 : 12270, type: kind === 'cash' ? 'CASH' : 'CREDIT', reprint: true,
      pays: [{ method: 'CASH', amount: kind === 'cash' ? 30900 : 10000 }] };
    const d = document.createElement('div'); d.id = 'demoSheet'; d.style.cssText = 'position:fixed;left:0;top:0;width:794px;height:559px;background:#fff;z-index:9999;padding:0;box-sizing:border-box';
    d.innerHTML = window.eval('billHtml')(inv, 'a5'); document.body.appendChild(d) }, kind);
  await new Promise(r => setTimeout(r, 600));
  const el = await pg.$('#demoSheet'); await el.screenshot({ path: `${OUT}/sepos-bill-${kind}.png` });
}
console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'ok');
await b.close();
