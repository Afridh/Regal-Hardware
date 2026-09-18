// Wipes the Regal books (and the shift board) so the app starts from its demo seed again.
//   npm run db:clear-books
import 'dotenv/config';
import { pool, query } from '../src/db.js';
await query(`DELETE FROM books`);
await query(`DELETE FROM books_history`);
console.log('Books cleared — the next sign-in seeds the demo shop again.');
await pool.end();
