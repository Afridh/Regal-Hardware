// Items that were on the books and are not there now, or that are switched off. Look only: it writes nothing.
//
//   node db/find-missing-items.js                     everything it can find
//   node db/find-missing-items.js "conduite tee"      and whether this item is on the books now
//
// It reads the books, the till's own log of deleted items, and the saved copies of the books (books_history, the
// last 500 saves), oldest first, one at a time. For each item gone it gives the last save that had it and the save
// that went without it, with who was signed in there. An item that left before the oldest copy is only in the log.
// Works on MySQL (register.lk) and PostgreSQL.
import 'dotenv/config';
import { pool, query } from '../src/db.js';

const KEY = 'regal';
const asDoc = (d) => (typeof d === 'string' ? JSON.parse(d) : d);
const norm = (s) => String(s ?? '').toLowerCase().replace(/[‘’'"]/g, '').replace(/\s+/g, ' ').trim();
const hay = (p) => norm([p.name, p.code, p.short, p.num, p.barcode, p.cat].join(' '));
const label = (p) => `${p.name}  (code ${p.code || '-'}, No. ${p.num || '-'}, short ${p.short || '-'})`;
const when = (d) => String(d || '').slice(0, 24);

async function main() {
  const words = norm(process.argv.slice(2).join(' ')).split(' ').filter(Boolean);
  const hit = (p) => words.every((w) => hay(p).includes(w));
  const { rows: [cur] } = await query(`SELECT rev, data FROM books WHERE key = $1`, [KEY]);
  if (!cur) { console.log('No books here.'); return; }
  const S = asDoc(cur.data).S || {}, products = S.products || [];
  const off = products.filter((p) => p.active === false);
  console.log(`The books are at save ${cur.rev}: ${products.length} items, ${off.length} switched off.`);

  if (words.length) {
    const found = products.filter(hit);
    console.log(`\nLooking for "${words.join(' ')}" on the books now: ${found.length} found`);
    for (const p of found.slice(0, 40)) console.log(`  ${p.active === false ? 'SWITCHED OFF  ' : 'on the till   '}${label(p)}`);
  }

  const log = (S.trail || []).filter((t) => /^Product (deleted|taken off the till)/.test(String(t.what || t.text || '')));
  const logWanted = log.filter((t) => !words.length || words.every((w) => norm(t.what || t.text).includes(w)));
  console.log(`\nThe till's log of items deleted or taken off: ${log.length}${words.length ? `, ${logWanted.length} matching` : ''}`);
  for (const t of logWanted.slice(0, 200)) console.log(`  ${t.date || ''} ${t.time || ''}  ${t.who || t.by || t.user || ''}  ${t.what || t.text}`);

  const now = new Map(products.map((p) => [p.id, p]));
  const { rows: ids } = await query(`SELECT id, rev, saved_by, saved_at FROM books_history WHERE key = $1 ORDER BY id`, [KEY]);
  console.log(`\nReading ${ids.length} saved copies${ids.length ? `, from ${when(ids[0].saved_at)}` : ''}.`);
  const lost = new Map();
  let before = new Set(), unread = 0, smallest = Infinity, biggest = 0;
  for (const h of ids) {       // one at a time: these are big, and the host is small
    let list;
    try { const { rows: [row] } = await query(`SELECT data FROM books_history WHERE id = $1`, [h.id]); list = asDoc(row.data)?.S?.products || []; }
    catch (e) { unread++; continue; }
    smallest = Math.min(smallest, list.length); biggest = Math.max(biggest, list.length);
    const here = new Set();
    for (const p of list) {
      here.add(p.id);
      if (!now.has(p.id)) { const x = lost.get(p.id) || {}; Object.assign(x, { p, lastRev: h.rev, lastAt: h.saved_at }); delete x.wentRev; lost.set(p.id, x); }
    }
    for (const id of before) if (!here.has(id) && lost.has(id) && !lost.get(id).wentRev) Object.assign(lost.get(id), { wentRev: h.rev, wentAt: h.saved_at, wentBy: h.saved_by });
    before = here;
  }
  if (unread) console.log(`${unread} copies could not be read and were skipped.`);
  if (ids.length > unread) console.log(`The number of items in those copies ran from ${smallest} to ${biggest}.`);
  const gone = [...lost.values()].filter((x) => !words.length || hit(x.p));
  console.log(`\nIn those copies and gone from the books now: ${gone.length}${words.length ? ` matching (${lost.size} in all)` : ''}`);
  for (const x of gone.slice(0, 200)) {
    console.log(`  ${label(x.p)}`);
    console.log(`     last in save ${x.lastRev}, ${when(x.lastAt)}${x.wentRev ? `; gone with save ${x.wentRev}, ${when(x.wentAt)}, by ${x.wentBy}` : ''}`);
  }

  if (!words.length && off.length) {
    console.log(`\nSwitched off now (they do not show on the till):`);
    for (const p of off.slice(0, 200)) console.log(`  ${label(p)}`);
  }
  console.log('\nThis tool changed nothing.');
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end && pool.end());
