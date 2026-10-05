// A proposed A5 invoice, drawn beside the one the shop prints now, with one of its own long bills.
//
//   node tools/a5-demo.mjs                 writes tools/a5-demo.html and two PNGs
//   node tools/a5-demo.mjs INVM-11-032208  use that bill instead of the longest one
//
// Nothing here changes what the till prints. It builds a page you can open and look at, so the
// design can be argued about before it is adopted.
//
// What the proposal does differently, and why:
//   · the heading is one band instead of three. The shop's name was set twice — once in the logo
//     and once in 24pt type beside it — and the strapline, the QR and the boxes each claimed their
//     own row. A third of the paper was used before the first thing sold.
//   · the lines are set tighter: 9.5pt on a 1.15 line, and the row padding halved. On a laser at
//     600dpi that is still comfortably readable; it was 11pt on 1.2 with room to spare.
//   · what that buys is rows. The count is printed on each sheet below, measured rather than
//     guessed, because the shop's own bills run past fifty lines and the question is how many of
//     them fit on one sheet.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const want = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const money = (n) => (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

const data = await pg.evaluate((wantNo) => {
  const sales = S.sales || [];
  const inv = (wantNo && sales.find(s => s.no === wantNo))
    || sales.slice().sort((a, b) => (b.lines || []).length - (a.lines || []).length)[0];
  const P = (id) => (S.products || []).find(p => p.id === id) || {};
  const cust = (S.customers || []).find(c => c.id === inv.customerId);
  return {
    now: billDocument(inv, 'a5'),
    no: inv.no, date: inv.date, by: inv.by || '', time: inv.time || '',
    customer: cust ? cust.name : '',
    sub: inv.sub, billDisc: inv.billDisc, total: inv.total, paid: inv.paid, balance: inv.balance,
    shop: { name: CFG.shop.name, addr: CFG.shop.addr, near: CFG.shop.near, phone: CFG.shop.phone,
            land: CFG.shop.land, logo: CFG.shop.logo || '', web: (CFG.shop.web || 'regalhw.lk') },
    // the same phone line and the same wording the real bill builds, so the demo is judged on its
    // shape and not on something that only looks wrong here
    phones: CFG.shop.phone || '',
    foot: ((CFG.bill && CFG.bill.footer) || '').replace('{days}', (CFG.bill && CFG.bill.returnDays) || 7),
    lines: (inv.lines || []).map(l => { const p = P(l.pid); return {
      code: p.num || p.code || '', name: p.name || l.desc || '', unit: p.unit || 'PCS',
      qty: l.qty, mrp: l.mrp || p.mrp || 0, price: l.price, amount: (+l.qty || 0) * (+l.price || 0) }; }),
  };
}, want);
await pg.close();
console.log(`using ${data.no} — ${data.lines.length} lines`);

/* ---------------------------------------------------------------- the proposal */
const rows = data.lines.map((l, i) => `<tr>
  <td class="n">${i + 1}</td><td>${esc(l.code)}</td><td class="d">${esc(l.name)}</td>
  <td class="n">${money(l.qty)}</td><td class="u">${esc(l.unit)}</td>
  <td class="n">${money(l.mrp)}</td><td class="n">${money(l.price)}</td><td class="n b">${money(l.amount)}</td></tr>`).join('');

const proposal = `<div class="sheet new">
 <div class="hd">
   <div class="hd-l">
     ${data.shop.logo ? `<img class="lg" src="${data.shop.logo}" alt="">` : `<b>${esc(data.shop.name)}</b>`}
     <div class="hd-addr">${esc(data.shop.addr)}${data.shop.near ? ` <i>${esc(data.shop.near)}</i>` : ''}
       <b>${esc(data.phones)}</b></div>
   </div>
   <div class="hd-r">
     <div class="ttl">INVOICE</div>
     <table class="meta">
       <tr><td>No</td><th>${esc(data.no)}</th><td>Date</td><th>${esc(data.date)} ${esc(data.time)}</th></tr>
       <tr><td>By</td><th>${esc(data.by)}</th><td>Customer</td><th>${esc(data.customer || 'Cash')}</th></tr>
     </table>
   </div>
 </div>
 <table class="itm">
  <thead><tr><th class="n">#</th><th>Code</th><th>Description</th><th class="n">Qty</th><th>UOM</th>
   <th class="n">MRP</th><th class="n">D.Price</th><th class="n">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
 </table>
 <div class="fill"></div>
 <div class="ft">
   <div class="ft-l">
     <div class="sg"><span>Authorised By</span><span>Received By</span></div>
     <div class="note">${esc(data.foot)}</div>
   </div>
   <table class="sum">
     <tr><td>Gross Total</td><td class="n">${money(data.sub)}</td></tr>
     <tr><td>- Inv.Discount</td><td class="n">${money(data.billDisc)}</td></tr>
     <tr class="net"><td>Net Total</td><td class="n">${money(data.total)}</td></tr>
     <tr><td>Amount Paid</td><td class="n">${money(data.paid)}</td></tr>
     <tr><td>${+data.balance > 0 ? 'Balance' : 'Change'} Rs.</td><td class="n">${money(Math.abs(data.balance || 0))}</td></tr>
   </table>
 </div>
</div>`;

const css = `
 body{margin:0;background:#4a5553;font:13px system-ui,Segoe UI,Arial,sans-serif;color:#111}
 .wrap{padding:18px;display:flex;flex-direction:column;gap:18px;align-items:center}
 .cap{color:#fff;font-weight:700;align-self:flex-start;margin-left:4px}
 .cap small{font-weight:400;opacity:.8}
 /* A5 landscape, at 96 dots to the inch: 210mm x 148mm */
 .sheet{width:794px;height:559px;background:#fff;box-sizing:border-box;overflow:hidden;position:relative}
 .sheet.old{padding:0}
 .new{padding:7px 10px;font-family:Arial,Helvetica,sans-serif;font-size:9.5px;line-height:1.15;
      display:flex;flex-direction:column;border:1px solid #000}
 .new .hd{display:flex;gap:12px;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:4px}
 .new .hd-l{flex:1;min-width:0}
 .new .lg{height:34px;width:auto;max-width:300px;object-fit:contain;display:block;
          filter:grayscale(1) brightness(0)}
 .new .hd-addr{margin-top:2px;font-size:9px;line-height:1.25}
 .new .hd-addr i{font-style:normal;color:#444}
 .new .hd-addr b{display:block;font-size:11px;letter-spacing:.01em}
 .new .hd-r{flex:0 0 330px}
 .new .ttl{font-size:15px;font-weight:800;letter-spacing:.08em;text-align:right;line-height:1}
 .new table.meta{width:100%;border-collapse:collapse;margin-top:3px;font-size:9px}
 .new table.meta td{color:#444;padding:0 4px 0 0;white-space:nowrap;width:1%}
 .new table.meta th{text-align:left;font-weight:700;padding:0 10px 0 0;white-space:nowrap}
 .new table.itm{width:100%;border-collapse:collapse;margin-top:4px}
 .new table.itm th{border-bottom:1.5px solid #000;border-top:1px solid #000;padding:2px 4px;
   font-size:9px;text-align:left;text-transform:uppercase;letter-spacing:.03em}
 .new table.itm th.n,.new table.itm td.n{text-align:right}
 .new table.itm td{border-bottom:1px dotted #aaa;padding:1.5px 4px;font-size:9.5px}
 .new table.itm td.d{font-weight:600}
 .new table.itm td.u{color:#333;font-size:8.5px}
 .new table.itm td.b{font-weight:700}
 .new .fill{flex:1}
 .new .ft{display:flex;gap:14px;align-items:flex-end;border-top:2px solid #000;padding-top:4px;margin-top:4px}
 .new .ft-l{flex:1;min-width:0}
 .new .sg{display:flex;gap:28px;margin-bottom:5px}
 .new .sg span{border-top:1px dotted #000;padding-top:2px;font-size:9px;min-width:150px;text-align:center}
 .new .note{font-size:8px;line-height:1.2;color:#222}
 .new table.sum{flex:0 0 250px;border-collapse:collapse;font-size:10px}
 .new table.sum td{border:1px solid #000;padding:1.5px 6px}
 .new table.sum td.n{text-align:right;width:110px}
 .new table.sum tr.net td{font-weight:800;font-size:12px;padding:2px 6px}
`;

const page = `<!doctype html><html><head><meta charset="utf-8"><title>A5 invoice — a proposal</title>
<style>${css}</style></head><body><div class="wrap">
 <div class="cap">PROPOSED &nbsp;<small>${data.lines.length} lines on this bill · A5 landscape, 210 × 148mm</small></div>
 ${proposal}
 <div class="cap">WHAT IT PRINTS NOW &nbsp;<small>the same bill</small></div>
 <div class="sheet old"><iframe style="border:0;width:794px;height:559px" srcdoc="${esc(data.now)}"></iframe></div>
</div></body></html>`;

fs.writeFileSync('tools/a5-demo.html', page);

/* how many rows actually fit on one sheet, measured rather than guessed */
const p3 = await b.newPage();
await p3.setViewport({ width: 860, height: 700, deviceScaleFactor: 2 });
await p3.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
 <body><div class="wrap">${proposal}</div></body></html>`, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 300));
const fit = await p3.evaluate(() => {
  const sheet = document.querySelector('.sheet.new');
  const body = sheet.querySelector('table.itm tbody');   // the items, not the little box of invoice details
  const all = [...body.rows];
  const room = () => sheet.scrollHeight <= sheet.clientHeight + 1;
  let keep = all.length;
  while (keep > 0 && !room()) { body.deleteRow(--keep) }
  return { fits: keep, of: all.length };
});
await (await p3.$('.sheet.new')).screenshot({ path: 'tools/a5-proposed.png' });
await p3.close();
console.log(`the proposal holds ${fit.fits} lines on one sheet (this bill has ${fit.of})`);

const p4 = await b.newPage();
await p4.setViewport({ width: 860, height: 700, deviceScaleFactor: 2 });
await p4.setContent(data.now, { waitUntil: 'load' });
await p4.emulateMediaType('print');
await p4.evaluate(() => { document.body.style.margin = '0'; document.body.classList.add('direct-print');
  const el = document.querySelector('#printArea .print'); if (el) { el.style.width = '794px'; el.style.height = '559px'; el.style.boxSizing = 'border-box' } });
await new Promise(r => setTimeout(r, 300));
const el = await p4.$('#printArea .print');
if (el) await el.screenshot({ path: 'tools/a5-now.png' });
await p4.close();

console.log('wrote tools/a5-demo.html, tools/a5-proposed.png, tools/a5-now.png');
await b.close();
