// Turn parts of the 80mm receipt on or off, the way Settings → What the bill shows does.
//
//   node db/set-bill-blocks.js                          what is on and what is off
//   node db/set-bill-blocks.js --off name,barcode --write
//   node db/set-bill-blocks.js --on sinhala --write
//
// The names are the ones the designer uses: top, logo, name, sinhala, addr, phone, detail, items,
// totals, paid, barcode, sign, count, notck, foot, thanks, web. "items" cannot be turned off — a
// bill without its lines is not a bill.
import 'dotenv/config';
import { pool, query } from '../src/db.js';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const list = (flag) => {
  const i = args.indexOf(flag);
  return i < 0 ? [] : String(args[i + 1] || '').split(',').map(s => s.trim()).filter(Boolean);
};
const OFF = list('--off'), ON = list('--on');

const ALL = ['top', 'logo', 'name', 'sinhala', 'addr', 'phone', 'detail', 'items', 'totals', 'paid',
  'barcode', 'sign', 'count', 'notck', 'foot', 'thanks', 'web'];
const WHAT = {
  top: 'the INVOICE line and the date', logo: 'the shop\'s mark', name: 'the shop\'s name in words',
  sinhala: 'the name in Sinhala', addr: 'the address', phone: 'the phones',
  detail: 'invoice number, cashier, customer', items: 'what was sold', totals: 'gross, discount, total',
  paid: 'what was paid', barcode: 'the barcode of the number', sign: 'the two signature lines',
  count: 'how many items', notck: 'the warning about an unticked line', foot: 'the returns note',
  thanks: 'the closing line', web: 'the web address',
};
for (const k of [...OFF, ...ON]) if (!ALL.includes(k)) { console.error(`There is no part called "${k}".`); process.exit(1); }
if (OFF.includes('items')) { console.error('"items" cannot be turned off.'); process.exit(1); }

const { rows: [row] } = await query(`SELECT rev, data FROM books WHERE key = 'regal'`);
if (!row) { console.error('There are no books.'); process.exit(1); }
const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
data.CFG = data.CFG || {}; data.CFG.bill = data.CFG.bill || {};
const B = data.CFG.bill;
if (!B.r80 || !Array.isArray(B.r80.order)) B.r80 = { order: [...ALL], off: [] };
if (!Array.isArray(B.r80.off)) B.r80.off = [];

/* The older switches still rule where a shop has set one, so turning a part off here has to turn
   the old switch off too — otherwise the receipt and this disagree about the same thing. */
const OLD = { logo: 't80Logo', barcode: 'showBarcode', sign: 't80Sign', sinhala: 'showSinhala', web: 'showWeb' };

const was = new Set(B.r80.off);
for (const k of OFF) { B.r80.off.includes(k) || B.r80.off.push(k); if (OLD[k]) B[OLD[k]] = false }
B.r80.off = B.r80.off.filter(k => !ON.includes(k));
for (const k of ON) if (OLD[k]) B[OLD[k]] = true;

const isOff = (k) => B.r80.off.includes(k) || (OLD[k] && B[OLD[k]] === false);
console.log(`books revision ${row.rev} · the 80mm receipt, top to bottom\n`);
for (const k of B.r80.order) {
  const off = isOff(k), changed = off !== was.has(k) && (OFF.includes(k) || ON.includes(k));
  console.log(`  ${off ? 'off' : 'on '}  ${k.padEnd(9)} ${(WHAT[k] || '').padEnd(38)}${changed ? '  <- changed' : ''}`);
}

if (!OFF.length && !ON.length) { console.log('\nNothing asked for. Use --off a,b or --on a,b.'); await pool.end(); process.exit(0); }
if (!WRITE) { console.log('\nLook only — nothing written. Add --write.'); await pool.end(); process.exit(0); }

const nextRev = Number(row.rev) + 1;
const txt = JSON.stringify(data);
await query(`UPDATE books SET rev = $1, data = $2, updated_at = now(), updated_by = 'bill parts' WHERE key = 'regal'`, [nextRev, txt]);
await query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ('regal', $1, $2, 'bill parts')`, [nextRev, txt]);
console.log(`\nSaved as revision ${nextRev}.`);
await pool.end();
