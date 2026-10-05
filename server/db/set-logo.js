// Put the shop's logo on the bills.
//
//   node db/set-logo.js <file.png>            look only: what it is and what it would replace
//   node db/set-logo.js <file.png> --write    put it in the books
//
// The picture is kept in the books as a data URL, which is how the till's own logo box saves one —
// so it travels with the books to every till and every printer, and there is no file to go missing.
//
// It must have a see-through background. The bills print the logo through a filter that forces
// every pixel that is there to solid black, which is what makes a coloured logo come out properly
// on a thermal printer. A photograph with a white background has a pixel everywhere, so the whole
// rectangle would come out as a black slab. Converted first with:
//
//   ffmpeg -i logo.jpg -vf "scale=640:-1,format=rgba,
//     geq=r='0':g='0':b='0':a='255-(0.299*r(X,Y)+0.587*g(X,Y)+0.114*b(X,Y))'" logo.png
//
// which makes the artwork black and the paper behind it see-through.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pool, query } from '../src/db.js';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('Which picture?  node db/set-logo.js <file.png> [--write]'); process.exit(1); }
if (!fs.existsSync(file)) { console.error(`${file} is not there.`); process.exit(1); }

const buf = fs.readFileSync(file);
const ext = path.extname(file).toLowerCase();
const type = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml'
  : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : null;
if (!type) { console.error('A .png (best), .svg or .jpg, please.'); process.exit(1); }

/* A PNG says whether it can see through itself in its header: colour type 4 or 6 carries an alpha
   channel, and 3 may carry one in a tRNS chunk. Worth saying out loud, because the one way this
   goes wrong is a logo that prints as a black rectangle. */
let seeThrough = null;
if (type === 'image/png') {
  const colourType = buf[25];
  seeThrough = colourType === 4 || colourType === 6 || buf.includes(Buffer.from('tRNS'));
}

const url = `data:${type};base64,${buf.toString('base64')}`;
const { rows: [row] } = await query(`SELECT rev, data FROM books WHERE key = 'regal'`);
if (!row) { console.error('There are no books to put it in.'); process.exit(1); }
const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;

console.log(`books revision ${row.rev}`);
console.log(`  the picture      ${path.basename(file)} · ${(buf.length / 1024).toFixed(0)} KB · ${type}`);
console.log(`  as a data URL    ${(url.length / 1024).toFixed(0)} KB (it goes to the printer with every bill)`);
if (seeThrough === false) console.log('  WARNING          this PNG has no see-through background — it will print as a black rectangle');
else if (seeThrough) console.log('  background       see-through, which is what the bills need');
console.log(`  replacing        ${data.CFG?.shop?.logo ? `a logo already set (${(data.CFG.shop.logo.length / 1024).toFixed(0)} KB)` : 'the printed mark (no logo set)'}`);

if (!WRITE) { console.log('\nLook only — nothing written. Add --write to put it on the bills.'); await pool.end(); process.exit(0); }

data.CFG = data.CFG || {}; data.CFG.shop = data.CFG.shop || {};
data.CFG.shop.logo = url;
const nextRev = Number(row.rev) + 1;
const txt = JSON.stringify(data);
await query(`UPDATE books SET rev = $1, data = $2, updated_at = now(), updated_by = 'logo' WHERE key = 'regal'`, [nextRev, txt]);
await query(`INSERT INTO books_history (key, rev, data, saved_by) VALUES ('regal', $1, $2, 'logo')`, [nextRev, txt]);
console.log(`\nOn the bills, as revision ${nextRev}.`);
await pool.end();
