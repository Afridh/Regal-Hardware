// Pull the shop's products out of SePOS into a spreadsheet, in the exact shape the till's
// "Add a product → Many at once (from Excel)" page reads back in.
//
//   node db/sepos-to-excel.js                 writes sepos-products.csv beside this project
//   node db/sepos-to-excel.js --out C:/Users/Semicolans/Desktop/products.csv
//   node db/sepos-to-excel.js --active        only the items SePOS still marks active
//   node db/sepos-to-excel.js --no-supplier   leave the supplier column blank
//
// On supplier names: the upload page will not add a product whose supplier is not already in the
// shop's supplier list, so an item that names one you have not set up is held back with "no supplier
// called …". Add those suppliers first and upload again, or run with --no-supplier to bring the
// products in now without the link and set suppliers later.
//
// The file is a CSV with the headings the upload page understands. Excel opens it as a sheet
// (double-click it), so you can look it over or change prices before uploading. Upload it at
// regalhw.lk/pos → Products → Add → "Many at once (from Excel)": it adds the new ones and can
// update the rest, and it checks every row (missing price, price below cost, a code twice) before
// anything goes in, so nothing bad slips through.
//
// It only reads SePOS — nothing on the old system is changed. Run it on the shop PC, where SePOS is.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const outArg = oi >= 0 ? args[oi + 1] : '';     // only a real --out gives a path; a bare flag is not one
const ACTIVE_ONLY = args.includes('--active');
const NO_SUPPLIER = args.includes('--no-supplier');
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(outArg && !outArg.startsWith('--') ? outArg : path.join(here, '..', '..', 'sepos-products.csv'));

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

console.log(`Reading ${MSDB} on ${MSSQL} …`);
const items = sql(`SELECT ItemCode, ItemBarcode, ItemBarcode1, ItemBarcode2, ItemName, ItemUnit, ItemCatName, ItemSupName, ActiveItem FROM tbl_ItemDet`);
const links = sql(`SELECT ItemCode, ItemUPrice, ItemSPrice, ItemDPrice, ItemWPrice, QtyMin, ItemAvgCost, CONVERT(varchar(10),CreateDate,120) CreateDate, IDx FROM tbl_PriceLink1`);

// the newest price link for each item — the same choice the import makes
const linksBy = new Map();
for (const l of links) { const k = s(l.ItemCode); if (!linksBy.has(k)) linksBy.set(k, []); linksBy.get(k).push(l); }
for (const arr of linksBy.values()) arr.sort((a, b) => (b.CreateDate || '').localeCompare(a.CreateDate || '') || (+b.IDx - +a.IDx));

// a short code only if it is a real one (pbmb, 40ss…), not a bare number or a dash
const shortOf = (it) => { for (const raw of [it.ItemBarcode1, it.ItemBarcode2]) { const x = s(raw).toLowerCase(); if (x && x !== '-' && !/^\d+$/.test(x)) return x; } return ''; };

// the headings the upload page reads (any order; these are the names it knows)
const HEAD = ['Item code', 'Description', 'Category', 'Unit', 'Cost', 'MRP', 'Discounted price', 'Wholesale price', 'Reorder level', 'Opening stock', 'Short code', 'Barcode', 'Supplier'];
const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const rowsOut = [HEAD.map(q).join(',')];
let wrote = 0, skippedInactive = 0, noPrice = 0;

for (const it of items) {
  if (ACTIVE_ONLY && s(it.ActiveItem) === '0') { skippedInactive++; continue; }
  const code = s(it.ItemCode); if (!code) continue;
  const latest = (linksBy.get(code) || [])[0] || {};
  const cost = +latest.ItemUPrice || +latest.ItemAvgCost || 0;
  const mrp = +latest.ItemSPrice || 0;
  const retail = +latest.ItemDPrice || mrp || 0;
  const wholesale = +latest.ItemWPrice || 0;
  if (!retail) noPrice++;
  const unit = s(it.ItemUnit) && s(it.ItemUnit) !== '-' ? s(it.ItemUnit) : 'pcs';
  const row = [
    code, s(it.ItemName) || code, s(it.ItemCatName) || 'Other', unit,
    n(cost), n(mrp), n(retail), n(wholesale),
    (+latest.QtyMin ? String(+latest.QtyMin) : ''),
    '0',                              // opening stock: counted at the shop, not trusted from the old system
    shortOf(it), s(it.ItemBarcode), NO_SUPPLIER ? '' : s(it.ItemSupName),
  ];
  rowsOut.push(row.map(q).join(','));
  wrote++;
}

fs.writeFileSync(OUT, '\ufeff' + rowsOut.join('\r\n'), 'utf8');   // the BOM makes Excel open it as UTF-8
console.log(`\n${wrote} products written to\n  ${OUT}`);
if (ACTIVE_ONLY) console.log(`(${skippedInactive} inactive items left out)`);
if (noPrice) console.log(`${noPrice} have no price yet — the upload page will flag those rather than add them`);
console.log(`\nNext: open regalhw.lk/pos on this PC → Products → Add → "Many at once (from Excel)",`);
console.log(`choose this file, and look over what it says before you add.`);
