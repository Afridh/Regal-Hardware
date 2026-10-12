// Put the bill's link into the owner's own copy of a bill.
//
//   node db/set-owner-link.js            look only: what the owner's template says now
//   node db/set-owner-link.js --write    add the link to it
//
// The owner already gets a text for every bill (Settings → Messaging → "which bills"), but the
// wording had no link in it, so there was nothing to tap to see the bill. The link is already
// carried with every bill; this only adds {link} to the owner's wording.
//
// Templates live in the books so they can be edited in Settings and travel with the shop. This
// updates the stored wording only while it is still the default — a wording the shop has changed
// itself is left alone, and the line to add is printed instead.
import 'dotenv/config';
import { pool, query } from '../src/db.js';

const WRITE = process.argv.includes('--write');

const OLD = '{shop}: {kind} {invoice} {total} — {customer}, by {by}{balancePart}';
const NEW = '{shop}: {kind} {invoice} {total} — {customer}, by {by}{balancePart} — see it at {link}';
const OLD_VARS = '{shop} {kind} {invoice} {total} {customer} {by} {balance} {outstanding}';
const NEW_VARS = OLD_VARS + ' {link}';

const { rows: [row] } = await query(`SELECT rev, data FROM books WHERE key = 'regal'`);
if (!row) { console.error('There are no books.'); process.exit(1); }
const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
const tpl = (data.CFG && data.CFG.tpl && data.CFG.tpl.ownerBill) || null;

console.log(`books revision ${row.rev}`);
if (!tpl) { console.error('The owner-copy template is not in these books.'); await pool.end(); process.exit(1); }
console.log(`  the owner's copy now reads:\n    ${tpl.text}`);

if (tpl.text.includes('{link}')) { console.log('\n  It already has the link. Nothing to do.'); await pool.end(); process.exit(0); }
if (tpl.text !== OLD) {
  console.log('\n  This wording has been changed from the default, so it is left as it is.');
  console.log('  To add the link by hand, put {link} where you want it — for example at the end:');
  console.log(`    ${tpl.text} — see it at {link}`);
  await pool.end(); process.exit(0);
}

console.log(`\n  it would become:\n    ${NEW}`);
if (!WRITE) { console.log('\nLook only — nothing written. Add --write to put the link in.'); await pool.end(); process.exit(0); }

tpl.text = NEW;
if (tpl.vars === OLD_VARS) tpl.vars = NEW_VARS;
const nextRev = Number(row.rev) + 1;
const txt = JSON.stringify(data);
await query(`UPDATE books SET rev = $1, data = $2, updated_at = now(), updated_by = 'owner link' WHERE key = 'regal'`, [nextRev, txt]);
await query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ('regal', $1, $2, 'owner link')`, [nextRev, txt]);
console.log(`\nDone, as revision ${nextRev}. Every cash bill now texts the owner a link to see it.`);
await pool.end();
