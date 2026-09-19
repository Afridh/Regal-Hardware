// Shows the last revisions of the shop's books: who saved, when, how big, what is in them.
//   node db/books-history.js
import 'dotenv/config';
import { pool, query } from '../src/db.js';
const { rows } = await query(`SELECT rev, saved_by, saved_at, length(data::text) AS bytes, jsonb_array_length(data->'S'->'products') AS products, jsonb_array_length(data->'S'->'customers') AS customers, jsonb_array_length(data->'S'->'sales') AS sales FROM books_history WHERE key='regal' ORDER BY rev DESC LIMIT 15`);
console.table(rows.map(r => ({ rev: r.rev, by: r.saved_by, at: new Date(r.saved_at).toLocaleString('en-GB'), MB: (r.bytes / 1048576).toFixed(2), products: r.products, customers: r.customers, sales: r.sales })));
const b = await query(`SELECT rev, updated_by, updated_at FROM books WHERE key='regal'`); console.log('current:', b.rows[0]);
await pool.end();
