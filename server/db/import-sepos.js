// Bring the shop's real data across from the old SePOS (SQL Server) into the Regal books.
//
//   node db/import-sepos.js                 (dry run: reads everything, reports, writes nothing)
//   node db/import-sepos.js --write         (replaces the business data in the books)
//   node db/import-sepos.js --write --days 180
//
// What comes across
//   customers, suppliers, products (prices + stock), bank accounts, staff, users
//   each supplier's outstanding balance as one "Balance brought forward" bill
//   pending cheques written to suppliers
//   the last N days of bills with their lines (default 90) — as history, already settled
//   each customer's balance tied to their newest open credit invoices (payments in the old
//   system settled the oldest first), which come across as real unpaid bills
//   opening ledger entries so every balance in the new books agrees with the old system
//
// What stays behind (still in SQL Server for lookups): older bills, purchase history, the
// old payment log, SMS log.  The Regal books are one document the till carries, so they
// hold what the counter needs, not four years of paper.
//
// Reads SQL Server through sqlcmd with Windows authentication — no password needed on the
// server PC.  Writes the books straight into PostgreSQL as a new revision (with a backup of
// the previous books in db/backups/).  Settings, users and message templates are kept.
import dotenv from 'dotenv';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env') });   // works from any folder
const { pool, query } = await import('../src/db.js');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const DAYS = +(args[args.indexOf('--days') + 1] || 90) || 90;
const MSSQL = process.env.SEPOS_SQL_SERVER || '.';
const MSDB = process.env.SEPOS_SQL_DB || 'Semicolans_Regalhardware';
const SQLCMD = process.env.SQLCMD || ['C:/Program Files/Microsoft SQL Server/Client SDK/ODBC/170/Tools/Binn/SQLCMD.EXE', 'sqlcmd'].find(p => p === 'sqlcmd' || fs.existsSync(p));
const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- reading the old system
function sql(text) {
  const out = execFileSync(SQLCMD, ['-S', MSSQL, '-E', '-d', MSDB, '-h', '-1', '-y', '8000', '-Q', 'SET NOCOUNT ON; ' + text + ' FOR JSON PATH'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const txt = out.split(/\r?\n/).map(l => l.replace(/\s+$/, '')).join('').trim();
  if (!txt) return [];
  return JSON.parse(txt);
}
const s = v => String(v ?? '').trim();
const n = v => Math.round((+v || 0) * 100) / 100;
const q3 = v => Math.round((+v || 0) * 1000) / 1000;
const day = v => (v ? String(v).slice(0, 10) : '');
const hhmm = v => (v ? String(v).slice(11, 16) : '');
const phone = (...vals) => { for (const v of vals) { let d = s(v).replace(/\D/g, ''); if (d.startsWith('94') && d.length === 11) d = '0' + d.slice(2); if (/^0\d{9}$/.test(d)) return d; } return ''; };
const addr = (...vals) => vals.map(s).filter(Boolean).join(', ');
const title = str => s(str).replace(/\s+/g, ' ');
const sha = pw => 's' + createHash('sha256').update('regal|' + pw, 'utf8').digest('hex');

console.log(`Reading ${MSDB} on ${MSSQL} …`);
const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - DAYS); const CUT = cutoff.toISOString().slice(0, 10);
const T0 = Date.now();
const oldCus = sql(`SELECT CusCode, CusName, CusSureName, CusMob1, CusMob2, CusPhone, CusAddress, CusAddress2, CusAddress3, CusPriceCategory, CreditLimit, CreditTerm, CusPoints, DueAmount, CusRemark, ActiveCustomer, CONVERT(varchar(10),CreateDate,120) CreateDate FROM tbl_CusDet`);
const oldSup = sql(`SELECT SupCode, SupName, SupCPerson, SupMob1, SupPhone, SupCPersonMob1, SupAddress, SupAddress2, SupAddress3, CreditTerm, DueAmount, SupRemark, ActiveSupplier, CONVERT(varchar(10),CreateDate,120) CreateDate FROM tbl_SupDet`);
const oldItems = sql(`SELECT ItemCode, ItemBarcode, ItemBarcode1, ItemBarcode2, ItemName, ItemUnit, ItemCatName, ItemSupCode, ActiveItem, chkInventory, WarrantyPeriod FROM tbl_ItemDet`);
const oldLinks = sql(`SELECT ItemCode, ItemUPrice, ItemSPrice, ItemDPrice, ItemWPrice, QtyRemain, QtyMin, ItemAvgCost, CONVERT(varchar(10),CreateDate,120) CreateDate, IDx FROM tbl_PriceLink1`);
const oldBanks = sql(`SELECT BnkCode, BnkName, BranchName, ACNo, ACType, BalanceAmount FROM tbl_BankDet`);
const oldEmps = sql(`SELECT EmpCode, EmpName, EmpMob1, BasicSalary, SalaryPaymentType, ActiveEmployee FROM tbl_EmpDet`);
const oldUsers = sql(`SELECT UserCode, CName, UserName, UserType FROM tbl_UserAccounts`);
const oldChq = sql(`SELECT ChqNo, VenCode, VenName, TotalAmount, CONVERT(varchar(10),ChqDate,120) ChqDate, CONVERT(varchar(10),CreateDate,120) CreateDate, BnkName, BnkCode, Status FROM tbl_ChqDet WHERE Status='PENDING'`);
const oldInv = sql(`SELECT SerialNo AS InvoiceNo, CONVERT(varchar(10),CreateDate,120) CreateDate, CONVERT(varchar(19),CreateTime,120) CreateTime, CusCode, PayMode, GTotal, DiscountForTot, ItemDiscount, StaffDiscount, CusDiscount, NTotal, CreateBy, UnitNo, InvoiceStatus FROM tbl_InvSummery WHERE CreateDate >= '${CUT}' AND InvoiceStatus <> 'UNDO'`);
const oldLines = sql(`SELECT SerialNo AS InvoiceNo, ItemCode, Qty, ItemUPrice, ItemSPrice, ItemDPrice, TPrice, ItemDis1, ItemDis2 FROM tbl_InvDet WHERE CreateDate >= '${CUT}'`);
const company = sql(`SELECT CompName, CompAddress1, CompAddress2, CompContact1 FROM tbl_CompanyDet`)[0] || {};
// every credit invoice the old system still shows something owing on, newest first per customer
const oldOpenInv = sql(`SELECT SerialNo AS InvoiceNo, CusCode, CONVERT(varchar(10),CreateDate,120) CreateDate, CONVERT(varchar(19),CreateTime,120) CreateTime, GTotal, NTotal, ISNULL(CreditSettlement,0) CreditSettlement, CreateBy, UnitNo FROM tbl_InvSummery WHERE PayMode='CREDIT' AND InvoiceStatus<>'UNDO' AND NTotal-ISNULL(CreditSettlement,0)>0.005 ORDER BY CusCode, CreateDate DESC, SerialNo DESC`);
console.log(`  read in ${((Date.now() - T0) / 1000).toFixed(1)}s: ${oldCus.length} customers, ${oldSup.length} suppliers, ${oldItems.length} items / ${oldLinks.length} price links, ${oldBanks.length} banks, ${oldInv.length} bills / ${oldLines.length} lines since ${CUT}, ${oldChq.length} pending cheques`);

// ---------------------------------------------------------------- the books as they are
const { rows: [cur] } = await query(`SELECT rev, data FROM books WHERE key = 'regal'`);
if (!cur) { console.error('No books on the server yet — sign in once at /pos so the shop settings exist, then run this again.'); process.exit(1); }
const S = cur.data.S, CFG = cur.data.CFG;
const OPEN_DATE = new Date().toISOString().slice(0, 10);
const seqs = { JE: 1 };
const nextNo = (k, pad = 5) => `${k}-${String(seqs[k] = (seqs[k] || 0) + 1).padStart(pad, '0')}`;
const journal = [];
const post = (date, desc, ref, lines) => {
  const dr = lines.reduce((a, l) => a + (l.dr || 0), 0), cr = lines.reduce((a, l) => a + (l.cr || 0), 0);
  if (Math.abs(dr - cr) > 0.005) throw new Error(`Unbalanced ${desc} ${dr}/${cr}`);
  journal.push({ no: nextNo('JE'), date, desc, ref, lines: lines.map(l => ({ ac: l.ac, dr: n(l.dr || 0), cr: n(l.cr || 0), party: l.party || null })) });
};

// ---------------------------------------------------------------- customers
const customers = [{ id: 1, code: 'WALKIN', name: 'Walk-in customer', phone: '', level: 'retail', limit: 0, address: '', portal: false, points: 0 }];
const cusId = new Map();
let openCus = 0, cusOwing = 0, cusCredit = 0;
oldCus.forEach((c, i) => {
  const id = i + 2;
  const due = n(c.DueAmount);
  const limit = n(c.CreditLimit) > 0 ? n(c.CreditLimit) : Math.max(25000, Math.ceil(Math.max(due, 0) * 1.25 / 50000) * 50000);
  const rec = { id, code: s(c.CusCode), name: title(c.CusName + (s(c.CusSureName) ? ' ' + s(c.CusSureName) : '')) || s(c.CusCode), phone: phone(c.CusMob1, c.CusMob2, c.CusPhone),
    address: addr(c.CusAddress, c.CusAddress2, c.CusAddress3), level: s(c.CusPriceCategory).toUpperCase() === 'WHOLESALE' ? 'wholesale' : 'retail',
    limit, points: Math.floor(+c.CusPoints || 0), notes: s(c.CusRemark), active: s(c.ActiveCustomer) !== '0', portal: false, lastLogin: null, since: c.CreateDate || null, sepos: s(c.CusCode) };
  customers.push(rec); cusId.set(rec.code, id);
  if (due > 0.005) { openCus++; cusOwing += due; }
  if (due < -0.005) { cusCredit += -due; rec.advance = n(-due); }
});
// the same mobile on two accounts confuses the website sign-in: keep it on the one that owes / was seen last
const seen = new Map();
for (const c of customers.slice(1)) { if (!c.phone) continue; const other = seen.get(c.phone); if (other) { const keep = n(oldCus[other.id - 2]?.DueAmount) >= n(oldCus[c.id - 2]?.DueAmount) ? other : c; const drop = keep === other ? c : other; drop.phone2 = drop.phone; drop.phone = ''; seen.set(keep.phone, keep); } else seen.set(c.phone, c); }

// ---------------------------------------------------------------- suppliers
const suppliers = []; const supId = new Map(); const supByName = new Map();
let openSup = 0, supOwing = 0;
oldSup.forEach((x, i) => {
  const id = i + 1, due = n(x.DueAmount);
  const rec = { id, code: s(x.SupCode), name: title(x.SupName) || s(x.SupCode), contact: title(x.SupCPerson), phone: phone(x.SupMob1, x.SupPhone, x.SupCPersonMob1),
    address: addr(x.SupAddress, x.SupAddress2, x.SupAddress3), days: +x.CreditTerm || 30, notes: s(x.SupRemark), active: s(x.ActiveSupplier) !== '0',
    pin: '', showAccounts: false, enabled: false, lastLogin: null, since: x.CreateDate || null, sepos: s(x.SupCode) };
  suppliers.push(rec); supId.set(rec.code, id); supByName.set(rec.name.toUpperCase(), id);
  if (due > 0.005) { openSup++; supOwing += due; }
});

// ---------------------------------------------------------------- products: item + its price links
const linksBy = new Map();
for (const l of oldLinks) { const k = s(l.ItemCode); if (!linksBy.has(k)) linksBy.set(k, []); linksBy.get(k).push(l); }
const products = []; const prodId = new Map(); const cats = new Map();
// the old item number (ItemBarcode, e.g. 6465) is what the counter keys — keep it as the product number when it is a clean, unique figure
const numUsed = new Map(); for (const it of oldItems) { const b = s(it.ItemBarcode); if (/^\d{1,8}$/.test(b)) numUsed.set(b, (numUsed.get(b) || 0) + 1); }
let nextFree = 1000 + Math.max(0, ...[...numUsed.keys()].map(Number)); let shortCount = 0;
const shortUsed = new Set();
let stockVal = 0, negStock = 0, noPrice = 0;
oldItems.forEach((it, i) => {
  const code = s(it.ItemCode), links = (linksBy.get(code) || []).slice().sort((a, b) => (b.CreateDate || '').localeCompare(a.CreateDate || '') || (+b.IDx - +a.IDx));
  const latest = links[0] || {};
  const stock = 0;                                     // the old system never kept stock (it sold past zero for years) — start clean, count later
  const cost = n(+latest.ItemUPrice || +latest.ItemAvgCost || 0);
  const mrp = n(+latest.ItemSPrice || 0), retail = n(+latest.ItemDPrice || +latest.ItemSPrice || 0), wholesale = n(+latest.ItemWPrice || 0) || retail;
  if (!retail) noPrice++;
  const cat = title(it.ItemCatName) || 'Other'; cats.set(cat, (cats.get(cat) || 0) + 1);
  const oldNum = s(it.ItemBarcode);
  const num = (/^\d{1,8}$/.test(oldNum) && numUsed.get(oldNum) === 1) ? oldNum : String(nextFree++);
  // the short codes the counter knows by heart (20SS, 25VSS, PBMB …) — lower-cased, first one wins if two items share it
  const shorts = [s(it.ItemBarcode1), s(it.ItemBarcode2)].map(x => x.toLowerCase()).filter(x => x && x !== '-' && !/^\d+$/.test(x));
  let short = ''; const alt = [];
  for (const sc of shorts) { if (!short && !shortUsed.has(sc)) { short = sc; shortUsed.add(sc); } else if (sc !== short) alt.push(sc); }
  if (short) shortCount++;
  const rec = { id: i + 1, code, num, barcode: oldNum, name: title(it.ItemName) || code, cat, unit: s(it.ItemUnit) && s(it.ItemUnit) !== '-' ? s(it.ItemUnit) : 'pcs',
    cost, mrp: mrp || retail, retail, wholesale, stock, min: +latest.QtyMin || 0, active: s(it.ActiveItem) !== '0', supplierId: supId.get(s(it.ItemSupCode)) || null, sepos: code };
  if (short) rec.short = short;
  if (alt.length) rec.short2 = alt[0];
  const wm = parseInt(s(it.WarrantyPeriod), 10); if (wm > 0) rec.warrantyMonths = wm;
  products.push(rec); prodId.set(code, rec.id);
  if (stock > 0) stockVal += stock * cost;
});
const barcodes = new Map(); for (const p of products) { if (!p.barcode) continue; if (barcodes.has(p.barcode)) { p.barcode2 = p.barcode; p.barcode = ''; } else barcodes.set(p.barcode, p.id); }

// ---------------------------------------------------------------- banks
const BANK_OPENING = args.includes('--bank-balances');   // the old bank figures were never reconciled; off unless asked
const GL_BANK = ['1020', '1021', '1022', '1023', '1024', '1025', '1026'];
const banks = oldBanks.map((b, i) => ({ id: i + 1, name: title(b.BnkName) + (s(b.BranchName) ? ' – ' + title(b.BranchName) : ''), ac: GL_BANK[i], no: s(b.ACNo), type: s(b.ACType), nextChq: 1, sepos: s(b.BnkCode), opening: n(b.BalanceAmount) }));
const bankByOld = new Map(banks.map(b => [b.sepos, b]));
const bankByName = new Map(banks.map(b => [title(b.name.split(' – ')[0]).toUpperCase(), b]));

// ---------------------------------------------------------------- staff and logins
const employees = oldEmps.map((e, i) => ({ id: i + 1, code: s(e.EmpCode), name: title(e.EmpName).replace(/^MR\.?\s*/i, m => m.toUpperCase().replace(/MR\.?\s*/, 'Mr. ')), position: 'Staff', basis: s(e.SalaryPaymentType) === 'DAY' ? 'daily' : 'monthly', rate: n(e.BasicSalary), otMult: 1.5, days: 26, ot: 0, advance: 0, active: s(e.ActiveEmployee) !== '0' }));
const users = (S.users || []).slice();
const ROLE = { Admin: 'Owner', Manager: 'Manager' };
const perms = { Owner: ['sell', 'discount', 'cancelBill', 'cost', 'profit', 'adjustInvoice', 'overLimit', 'belowCost', 'paySupplier', 'receive', 'products', 'payroll', 'settings', 'users', 'approve'], Manager: ['sell', 'discount', 'cancelBill', 'cost', 'profit', 'adjustInvoice', 'overLimit', 'belowCost', 'receive', 'products'] };
let newUsers = 0;
for (const u of oldUsers) {
  const name = title(u.CName).split(' ').map(w => w.length <= 3 ? w.toUpperCase() : w[0] + w.slice(1).toLowerCase()).join(' ');
  if (!name || users.some(x => x.name.toLowerCase() === name.toLowerCase())) continue;
  const role = ROLE[s(u.UserType)] || 'Cashier';
  users.push({ name, role, uid: name.slice(0, 2).toUpperCase(), pin: '', passHash: sha(name.toLowerCase().replace(/[^a-z]/g, '') + '123'), perms: [...(perms[role] || ['sell', 'receive'])], active: true, lastSeen: null, prefs: {} });
  newUsers++;
}

// ---------------------------------------------------------------- what each customer owes, tied to their invoices
// The old system took payments "customer-wise", settling the oldest bills first, so what is
// still owed sits on the NEWEST open credit invoices.  Walk them newest-first until the
// customer's balance is covered; those invoices come across as real unpaid bills.  Anything the
// invoices cannot explain (rare) becomes a "Balance brought forward" bill.
const sales = [], purchases = [], cheques = [], movements = [];
const openBy = new Map();
for (const inv of oldOpenInv) { const k = s(inv.CusCode); if (!openBy.has(k)) openBy.set(k, []); openBy.get(k).push(inv); }
const linked = new Map();                    // InvoiceNo → balance still owed on it
let cusOpenBills = 0, linkedCount = 0, linkedAmt = 0, bfAmt = 0;
for (const c of customers.slice(1)) {
  const due = n(oldCus[c.id - 2].DueAmount);
  if (due > 0.005) {
    let left = due;
    for (const inv of (openBy.get(c.code) || [])) {                    // already newest first
      if (left <= 0.005) break;
      const rem = n(inv.NTotal - inv.CreditSettlement); if (rem <= 0.005) continue;
      const take = n(Math.min(rem, left)); linked.set(s(inv.InvoiceNo), { inv, balance: take, cid: c.id }); left = n(left - take); linkedCount++; linkedAmt += take;
    }
    if (left > 0.005) {
      const no = 'OPEN-' + c.code;
      sales.push({ no, date: OPEN_DATE, type: 'CREDIT', customerId: c.id, lines: [], sub: left, billDisc: 0, total: left, paid: 0, balance: left, pays: [], by: 'SePOS', terminal: 'SEPOS', time: '', note: 'Balance brought forward from SePOS (older than the bills on record)', opening: true, link: '' });
      post(OPEN_DATE, `Balance brought forward from SePOS — ${c.name}`, no, [{ ac: '1100', dr: left, party: { type: 'C', id: c.id } }, { ac: '3100', cr: left }]);
      cusOpenBills++; bfAmt += left;
    }
  } else if (due < -0.005) {
    post(OPEN_DATE, `Credit held from SePOS — ${c.name}`, 'OPEN-' + c.code, [{ ac: '3100', dr: -due }, { ac: '2050', cr: -due, party: { type: 'C', id: c.id } }]);
  }
}
// lines for the linked invoices that are older than the history window
const histNos = new Set(oldInv.map(i => s(i.InvoiceNo)));
const extraNos = [...linked.keys()].filter(no => !histNos.has(no));
const extraLines = [];
for (let i = 0; i < extraNos.length; i += 400) extraLines.push(...sql(`SELECT SerialNo AS InvoiceNo, ItemCode, Qty, ItemUPrice, ItemSPrice, ItemDPrice, TPrice, ItemDis1, ItemDis2 FROM tbl_InvDet WHERE SerialNo IN (${extraNos.slice(i, i + 400).map(x => `'${x.replace(/'/g, "''")}'`).join(',')})`));
oldLines.push(...extraLines);
for (const x of suppliers) {
  const due = n(oldSup[x.id - 1].DueAmount);
  if (due > 0.005) {
    const no = 'OPEN-' + x.code;
    purchases.push({ no, date: OPEN_DATE, supplierId: x.id, supInv: 'Balance brought forward', lines: [], other: 0, total: due, paid: 0, by: 'SePOS', note: 'Balance brought forward from SePOS', opening: true });
    post(OPEN_DATE, `Balance brought forward from SePOS — ${x.name}`, no, [{ ac: '3100', dr: due }, { ac: '2100', cr: due, party: { type: 'S', id: x.id } }]);
  }
}
for (const b of banks) if (BANK_OPENING && Math.abs(b.opening) > 0.005) post(OPEN_DATE, `Bank balance brought forward — ${b.name}`, 'OPEN-BANK', b.opening > 0 ? [{ ac: b.ac, dr: b.opening }, { ac: '3100', cr: b.opening }] : [{ ac: '3100', dr: -b.opening }, { ac: b.ac, cr: -b.opening }]);
let chqTotal = 0;
for (const c of oldChq) {
  const b = bankByOld.get(s(c.BnkCode)) || bankByName.get(title(c.BnkName).toUpperCase()) || banks[0];
  const sid = supId.get(s(c.VenCode)) || supByName.get(title(c.VenName).toUpperCase()) || null;
  cheques.push({ dir: 'ISSUED', no: s(c.ChqNo), bankId: b ? b.id : null, bank: b ? b.name : title(c.BnkName), date: c.ChqDate, payee: title(c.VenName), amount: n(c.TotalAmount), status: 'ISSUED', party: sid ? suppliers[sid - 1].name : title(c.VenName), supplierId: sid, ref: 'SePOS', history: [] });
  chqTotal += n(c.TotalAmount);
}
if (chqTotal > 0.005) post(OPEN_DATE, 'Cheques written before the changeover, not yet cleared', 'OPEN-CHQ', [{ ac: '3100', dr: n(chqTotal) }, { ac: '2110', cr: n(chqTotal) }]);

// ---------------------------------------------------------------- bills: the recent ones as history, plus every linked unpaid one
const linesBy = new Map();
for (const l of oldLines) { const k = s(l.InvoiceNo); if (!linesBy.has(k)) linesBy.set(k, []); linesBy.get(k).push(l); }
let histLines = 0, skippedLines = 0, histCount = 0;
const allInv = new Map();
for (const inv of oldInv) allInv.set(s(inv.InvoiceNo), { ...inv, PayMode: inv.PayMode });
for (const [no, x] of linked) if (!allInv.has(no)) allInv.set(no, { ...x.inv, PayMode: 'CREDIT' });
for (const inv of [...allInv.values()].sort((a, b) => (a.CreateDate + a.CreateTime).localeCompare(b.CreateDate + b.CreateTime))) {
  const no = s(inv.InvoiceNo);
  const lines = [];
  for (const l of (linesBy.get(no) || [])) {
    const pid = prodId.get(s(l.ItemCode)); if (!pid) { skippedLines++; continue; }
    const qty = q3(l.Qty); if (!qty) continue;
    const price = n(+l.ItemDPrice || (+l.TPrice || 0) / qty);
    lines.push({ pid, qty, price, disc: n((+l.ItemDis1 || 0) + (+l.ItemDis2 || 0)), cost: n(l.ItemUPrice), mrp: n(l.ItemSPrice) });
  }
  histLines += lines.length;
  const total = n(inv.NTotal), sub = n(inv.GTotal) || total;
  const credit = s(inv.PayMode).toUpperCase() === 'CREDIT';
  const link = linked.get(no);
  const balance = link ? link.balance : 0, cid = link ? link.cid : (cusId.get(s(inv.CusCode)) || 1);
  const rec = { no, date: inv.CreateDate, time: hhmm(inv.CreateTime), type: credit ? 'CREDIT' : 'CASH', customerId: cid, lines, sub, billDisc: n(Math.max(0, sub - total)), total, paid: n(total - balance), balance,
    pays: [{ method: credit ? 'CREDIT' : 'CASH', amount: total }], by: title(inv.CreateBy) || 'SePOS', terminal: s(inv.UnitNo) || 'SePOS', imported: true, note: link ? (balance < total - 0.005 ? `From SePOS — ${fmt0(total - balance)} of it paid there` : 'From SePOS') : 'From SePOS', link: '' };
  sales.push(rec);
  if (link) post(inv.CreateDate, `Owing on bill ${no} brought forward from SePOS`, no, [{ ac: '1100', dr: balance, party: { type: 'C', id: cid } }, { ac: '3100', cr: balance }]);
  else histCount++;
}
sales.sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
function fmt0(v) { return 'Rs ' + n(v).toLocaleString('en-LK', { minimumFractionDigits: 2 }); }

// ---------------------------------------------------------------- report
const fmt = v => 'Rs ' + n(v).toLocaleString('en-LK', { minimumFractionDigits: 2 });
console.log(`
Customers   ${customers.length - 1} (${openCus} owe ${fmt(cusOwing)}${cusCredit ? `, ${fmt(cusCredit)} held as credit` : ''})
Suppliers   ${suppliers.length} (${openSup} owed ${fmt(supOwing)})
Products    ${products.length} in ${cats.size} categories · ${shortCount} with a short code (e.g. ${products.filter(p => p.short).slice(0, 3).map(p => p.short + ' = ' + p.name).join(', ')}) · old item numbers kept · ${noPrice} without a price · stock starts at zero (the shop is marked as not tracking stock)
Banks       ${banks.map(b => b.name).join(' · ')}${BANK_OPENING ? '' : ' (balances not brought across — enter them from the bank statements)'}
Cheques     ${cheques.length} pending, ${fmt(chqTotal)}
Bills       ${histCount} from the last ${DAYS} days as history · ${linkedCount} unpaid credit bills carrying ${fmt(linkedAmt)} of what customers owe${cusOpenBills ? ` · ${cusOpenBills} balances brought forward for ${fmt(bfAmt)} the bills could not explain` : ''} · ${histLines} lines (${skippedLines} on unknown items skipped)
Staff       ${employees.length} · logins ${users.length} (${newUsers} added: ${users.slice(-newUsers).map(u => u.name).join(', ') || 'none'})
Ledger      ${journal.length} opening entries`);

if (!WRITE) { console.log('\nDry run — nothing written. Add --write to replace the books with this.'); await pool.end(); process.exit(0); }

// ---------------------------------------------------------------- write: backup, then the new books
const bdir = path.join(here, 'backups'); fs.mkdirSync(bdir, { recursive: true });
const bfile = path.join(bdir, `books-before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(bfile, JSON.stringify(cur.data));
console.log(`\nPrevious books saved to ${bfile}`);

const NS = { ...S };
Object.assign(NS, { customers, suppliers, products, banks, employees, users, sales, purchases, cheques, movements, journal,
  payments: [], expenses: [], damages: [], docs: [], orders: [], prns: [], stocktakes: [], counts: [], serials: [], notices: [], payruns: [], advances: [], vouchers: [], transfers: [],
  notif: [], approvals: [], messages: (S.messages || []).slice(0, 50), web: { ...(S.web || {}), settings: { ...((S.web || {}).settings || {}), showOutOfStock: true }, orders: [], cart: [], session: null },
  seq: { PRN: 1, STK: 1, WEB: 1, PO: 1, QTN: 1, DN: 1, INV: 1, PUR: 1, PAY: 1, RCT: 1, VCH: 1, EXP: 1, DMG: 1, JE: journal.length + 1 }, seqBy: {},
  locations: [{ id: 1, name: 'Main shop', till: true }], imported: { from: MSDB, at: new Date().toISOString(), days: DAYS, cutoff: CUT } });
delete NS.user; delete NS.pos; delete NS.view; delete NS.terminal; delete NS.held; delete NS.locId;
const NC = { ...CFG, stock: { ...(CFG.stock || {}), allowNegative: true, track: false }, shop: { ...(CFG.shop || {}), name: title(company.CompName) || CFG.shop?.name, addr: addr(company.CompAddress1, company.CompAddress2) || CFG.shop?.addr, phone: s(company.CompContact1) || CFG.shop?.phone } };
const doc = { v: 1, at: new Date().toISOString(), S: NS, CFG: NC };
const txt = JSON.stringify(doc);
const nextRev = Number(cur.rev) + 1;
await query(`UPDATE books SET rev = $1, data = $2, updated_at = now(), updated_by = 'SePOS import' WHERE key = 'regal'`, [nextRev, txt]);
await query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ('regal', $1, $2, 'SePOS import')`, [nextRev, txt]);
console.log(`Books written as revision ${nextRev} (${(txt.length / 1048576).toFixed(1)} MB). Every open till picks it up on its next poll; the till may need a refresh if it was mid-bill.`);
await pool.end();
