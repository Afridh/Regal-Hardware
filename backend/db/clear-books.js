// Wipes the Regal books (and the shift board) so the app starts from its demo seed again.
//   npm run db:clear-books
import 'dotenv/config';
import { pool, query } from '../src/db.js';
await query(`DELETE FROM books`);
await query(`DELETE FROM books_history`);
await query(`DELETE FROM shop_orders`).catch(() => {});   // website orders (table exists once the site has been used)
// what suppliers and customers sent from their pages, waiting to go into these books — and the e-bills
// drawn for them: without the books they belong to nothing (and would read as "already asked")
for (const t of ['sup_inbox', 'cust_inbox', 'bill_views']) await query(`DELETE FROM ${t}`).catch(() => {});
console.log('Books cleared — the next sign-in seeds the demo shop again.');
await pool.end();
