// Find (and, asked to, remove) any sample record left in the shop's books — the sample products,
// customers and suppliers the till used to start with, and test supplier orders.
//
//   node db/find-samples.js          look only: lists what it finds, writes nothing
//   node db/find-samples.js --go     removes them: the books as they are go to db/backups/ first,
//                                    and the change is a new revision, so it can be put back
//                                    (node db/recover-books.js)
//
// A record counts as a sample only when its code AND its name are exactly the sample's, so a real
// product that happens to share a code is never touched. A sample that real bills, purchases or
// payments point at is kept and reported — taking it out would break those papers.
// Works on MySQL (register.lk) and PostgreSQL.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, query } from '../src/db.js';
import { SAMPLE_SHOP_JS } from '../tools/fixtures/sample-shop.js';

const KEY = 'regal', GO = process.argv.includes('--go');
const here = path.dirname(fileURLToPath(import.meta.url));

// the signatures, read out of the sample shop itself
const SRC = SAMPLE_SHOP_JS;
const prodSig = new Set([...SRC.matchAll(/\['([A-Z]{2,4}-[A-Z0-9-]+)','([^']+)'/g)].map(m => m[1] + '|' + m[2]));
const custSig = new Set([...SRC.matchAll(/code:'(C\d{4})',name:'([^']+)'/g)].map(m => m[1] + '|' + m[2]).filter(s => !/Walk-in/.test(s)));
const supSig = new Set([...SRC.matchAll(/code:'(S\d{4})',name:'([^']+)'/g)].map(m => m[1] + '|' + m[2]));
const sampleOrder = o => ['ord1', 'ord2'].includes(o.id) && /Kevilton wire 2\.5mm² — 6 rolls|Dulux Weathershield 4L White — 12 tins/.test(o.text || '') || /^tst\d*$/.test(String(o.id || ''));

async function main() {
  const { rows: [row] } = await query(`SELECT rev, data FROM books WHERE key = $1`, [KEY]);
  if (!row) { console.log('No books on this server.'); return; }
  const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  const S = data.S || {};
  console.log(`Books rev ${row.rev}: ${(S.products || []).length} products, ${(S.customers || []).length} customers, ${(S.suppliers || []).length} suppliers, ${(S.sales || []).length} bills\n`);

  // what real papers point at
  const usedP = new Set(), usedC = new Set(), usedS = new Set();
  for (const s of S.sales || []) { usedC.add(s.customerId); for (const l of s.lines || []) usedP.add(l.pid); }
  for (const p of S.purchases || []) { usedS.add(p.supplierId); for (const l of p.lines || []) usedP.add(l.pid); }
  for (const p of S.payments || []) { if (p.customerId) usedC.add(p.customerId); if (p.supplierId) usedS.add(p.supplierId); }

  const pick = (list, sig, used, label, name) => {
    const hit = (list || []).filter(x => sig.has(x.code + '|' + x.name));
    const go = hit.filter(x => !used.has(x.id)), keep = hit.filter(x => used.has(x.id));
    console.log(`${label}: ${hit.length ? hit.length + ' found' : 'none'}`);
    go.forEach(x => console.log(`   remove  ${x.code}  ${name(x)}`));
    keep.forEach(x => console.log(`   KEEP    ${x.code}  ${name(x)}  — bills, purchases or payments point at it, so it stays to keep those papers whole`));
    return new Set(go.map(x => x.id));
  };
  const goP = pick(S.products, prodSig, usedP, 'Sample products', x => x.name);
  const goC = pick(S.customers, custSig, usedC, 'Sample customers', x => x.name);
  const goS = pick(S.suppliers, supSig, usedS, 'Sample suppliers', x => x.name);
  const ords = (S.orders || []).filter(sampleOrder);
  console.log(`Sample / test supplier orders: ${ords.length ? ords.length + ' found' : 'none'}`);
  ords.forEach(o => console.log(`   remove  ${o.id}  ${String(o.text || '').split('\n')[0].slice(0, 60)}`));

  const n = goP.size + goC.size + goS.size + ords.length;
  if (!n) { console.log('\nNothing to remove — the books hold no sample records.'); return; }
  if (!GO) { console.log(`\n${n} record(s) would be removed. Nothing was written. Run again with --go to remove them.`); return; }

  const bdir = path.join(here, 'backups'); fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `books-before-samples-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify({ rev: row.rev, data }));
  S.products = (S.products || []).filter(x => !goP.has(x.id));
  S.customers = (S.customers || []).filter(x => !goC.has(x.id));
  S.suppliers = (S.suppliers || []).filter(x => !goS.has(x.id));
  S.orders = (S.orders || []).filter(o => !sampleOrder(o));
  data.at = new Date().toISOString();
  const next = Number(row.rev) + 1;
  await query(`UPDATE books SET rev = $2, data = $3, updated_at = now(), updated_by = $4 WHERE key = $1`, [KEY, next, JSON.stringify(data), 'find-samples']);
  await query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ($1,$2,$3,$4)`, [KEY, next, JSON.stringify(data), 'find-samples']);
  console.log(`\nRemoved ${n} record(s) — books now rev ${next}. The tills pick it up on their next sync.`);
  console.log('The books as they were are in', path.relative(process.cwd(), backup));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
