// Pull the shop's products, customers and suppliers out of SePOS into spreadsheets, each in the shape
// the till's "Many at once (from Excel)" upload reads back in.
//
//   node db/sepos-to-excel.js                  writes all three: sepos-products.csv, sepos-customers.csv, sepos-suppliers.csv
//   node db/sepos-to-excel.js --what products  just one (products | customers | suppliers | all)
//   node db/sepos-to-excel.js --active         products: only the items SePOS still marks active
//   node db/sepos-to-excel.js --no-supplier    products: leave the supplier column blank
//   node db/sepos-to-excel.js --dir C:/Users/Semicolans/Desktop   put the files somewhere else
//
// Each file is a CSV with the headings the matching upload page understands. Excel opens them as
// sheets (double-click), so you can look them over before uploading. Upload at regalhw.lk/pos:
//   products   → Products → Add → "Many at once (from Excel)"
//   customers  → Customers → Add → "Many at once (from Excel)"
//   suppliers  → Suppliers → Add → "Many at once (from Excel)"
// Each upload checks every row before adding, and matches on the SePOS code, so uploading again
// updates and adds rather than duplicating.
//
// It only reads SePOS — nothing on the old system is changed. Run it on the shop PC.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''; };
const WHAT = (opt('--what') || 'all').toLowerCase();
const want = (x) => WHAT === 'all' || WHAT === x;
const ACTIVE_ONLY = args.includes('--active');
const NO_SUPPLIER = args.includes('--no-supplier');
const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(opt('--dir') || path.join(here, '..', '..'));

const MSSQL = process.env.SEPOS_SQL_SERVER || '.';
const MSDB = process.env.SEPOS_SQL_DB || 'Semicolans_Regalhardware';
const SQLCMD = process.env.SQLCMD || ['C:/Program Files/Microsoft SQL Server/Client SDK/ODBC/170/Tools/Binn/SQLCMD.EXE', 'sqlcmd'].find(p => p === 'sqlcmd' || fs.existsSync(p));

function sql(text) {
  const out = execFileSync(SQLCMD, ['-S', MSSQL, '-E', '-d', MSDB, '-h', '-1', '-y', '8000', '-Q', 'SET NOCOUNT ON; ' + text + ' FOR JSON PATH'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const txt = out.split(/\r?\n/).map(l => l.replace(/\s+$/, '')).join('').trim();
  if (!txt) return [];
  return JSON.parse(txt);
}
const s = v => String(v ?? '').trim();
const n = v => { const x = Math.round((+v || 0) * 100) / 100; return x ? String(x) : ''; };
const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
// a Sri Lankan number from whatever columns carry one
const phone = (...vals) => { for (const v of vals) { let d = s(v).replace(/\D/g, ''); if (d.startsWith('94') && d.length === 11) d = '0' + d.slice(2); if (/^0\d{9}$/.test(d)) return d; } return ''; };
const addr = (...vals) => vals.map(s).filter(Boolean).join(', ');
const writeCsv = (name, head, rows) => {
  const file = path.join(DIR, name);
  fs.writeFileSync(file, '\ufeff' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n'), 'utf8');
  console.log(`  ${rows.length} rows -> ${file}`);
};

console.log(`Reading ${MSDB} on ${MSSQL} …\n`);

/* ---------------------------------------------------------------- products */
if (want('products')) {
  const items = sql(`SELECT ItemCode, ItemBarcode, ItemBarcode1, ItemBarcode2, ItemName, ItemUnit, ItemCatName, ItemSupName, ActiveItem FROM tbl_ItemDet`);
  const links = sql(`SELECT ItemCode, ItemUPrice, ItemSPrice, ItemDPrice, ItemWPrice, QtyMin, ItemAvgCost, CONVERT(varchar(10),CreateDate,120) CreateDate, IDx FROM tbl_PriceLink1`);
  const linksBy = new Map();
  for (const l of links) { const k = s(l.ItemCode); if (!linksBy.has(k)) linksBy.set(k, []); linksBy.get(k).push(l); }
  for (const arr of linksBy.values()) arr.sort((a, b) => (b.CreateDate || '').localeCompare(a.CreateDate || '') || (+b.IDx - +a.IDx));
  const shortOf = (it) => { for (const raw of [it.ItemBarcode1, it.ItemBarcode2]) { const x = s(raw).toLowerCase(); if (x && x !== '-' && !/^\d+$/.test(x)) return x; } return ''; };
  const rows = []; let noPrice = 0, skipped = 0;
  for (const it of items) {
    if (ACTIVE_ONLY && s(it.ActiveItem) === '0') { skipped++; continue; }
    const code = s(it.ItemCode); if (!code) continue;
    const latest = (linksBy.get(code) || [])[0] || {};
    const cost = +latest.ItemUPrice || +latest.ItemAvgCost || 0;
    const mrp = +latest.ItemSPrice || 0, retail = +latest.ItemDPrice || mrp || 0, wholesale = +latest.ItemWPrice || 0;
    if (!retail) noPrice++;
    const unit = s(it.ItemUnit) && s(it.ItemUnit) !== '-' ? s(it.ItemUnit) : 'pcs';
    rows.push([code, s(it.ItemName) || code, s(it.ItemCatName) || 'Other', unit,
      n(cost), n(mrp), n(retail), n(wholesale), (+latest.QtyMin ? String(+latest.QtyMin) : ''), '0',
      shortOf(it), s(it.ItemBarcode), NO_SUPPLIER ? '' : s(it.ItemSupName)]);
  }
  writeCsv('sepos-products.csv', ['Item code', 'Description', 'Category', 'Unit', 'Cost', 'MRP', 'Discounted price', 'Wholesale price', 'Reorder level', 'Opening stock', 'Short code', 'Barcode', 'Supplier'], rows);
  if (skipped) console.log(`    (${skipped} inactive items left out)`);
  if (noPrice) console.log(`    (${noPrice} have no price — the upload page flags those)`);
}

/* ---------------------------------------------------------------- customers */
if (want('customers')) {
  const cus = sql(`SELECT CusCode, CusName, CusSureName, CusMob1, CusMob2, CusPhone, CusAddress, CusAddress2, CusAddress3, CusPriceCategory, CreditLimit, CusRemark, ActiveCustomer FROM tbl_CusDet`);
  const rows = [];
  for (const c of cus) {
    const name = [s(c.CusName), s(c.CusSureName)].filter(Boolean).join(' ');
    if (!name) continue;
    // SePOS keeps a price category; anything that reads as wholesale/dealer is wholesale, the rest retail
    const level = /whole|dealer|trade|b2b/i.test(s(c.CusPriceCategory)) ? 'wholesale' : 'retail';
    rows.push([s(c.CusCode), name, phone(c.CusMob1, c.CusMob2, c.CusPhone),
      addr(c.CusAddress, c.CusAddress2, c.CusAddress3), level, n(c.CreditLimit), s(c.CusRemark)]);
  }
  writeCsv('sepos-customers.csv', ['Code', 'Name', 'Phone', 'Address', 'Price level', 'Credit limit', 'Notes'], rows);
}

/* ---------------------------------------------------------------- suppliers */
if (want('suppliers')) {
  const sup = sql(`SELECT SupCode, SupName, SupCPerson, SupMob1, SupPhone, SupCPersonMob1, SupAddress, SupAddress2, SupAddress3, CreditTerm, SupRemark FROM tbl_SupDet`);
  const rows = [];
  for (const v of sup) {
    const name = s(v.SupName); if (!name) continue;
    rows.push([s(v.SupCode), name, s(v.SupCPerson), phone(v.SupMob1, v.SupPhone, v.SupCPersonMob1),
      (+v.CreditTerm ? String(+v.CreditTerm) : ''), addr(v.SupAddress, v.SupAddress2, v.SupAddress3), s(v.SupRemark)]);
  }
  writeCsv('sepos-suppliers.csv', ['Code', 'Name', 'Contact person', 'Phone', 'Payment terms (days)', 'Address', 'Notes'], rows);
}

console.log(`\nDone. Upload each at regalhw.lk/pos → Products / Customers / Suppliers → Add → "Many at once (from Excel)".`);
