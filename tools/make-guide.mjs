// Turn docs/guide/guide.html into the printed guide.
//   node tools/make-guide.mjs [out.pdf]
//
// Uses the Chrome or Edge already on the machine — nothing is downloaded. Edit the HTML,
// run this, and the PDF is rebuilt with its page numbers and footer intact.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = path.resolve('docs/guide/guide.html');
const OUT = path.resolve(process.argv[2] || 'docs/Regal-Hardware-Guide.pdf');

const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find(p => fs.existsSync(p));
if (!exe) { console.error('No Chrome or Edge found to print with.'); process.exit(1) }
if (!fs.existsSync(SRC)) { console.error('docs/guide/guide.html is missing.'); process.exit(1) }

/* Every "See 4.4" in the text has to point at a section that exists. Sections get renumbered
   when something is inserted, and a reference that quietly goes stale sends the reader to the
   wrong page — so the guide does not get built until they all resolve. */
const html = fs.readFileSync(SRC, 'utf8');
const have = new Set([...html.matchAll(/<span class="sn">([\d.]+)<\/span>/g)].map(m => m[1]));
const refs = [...html.matchAll(/(?:See|see)\s+(\d+\.\d+)|\((\d+\.\d+)\)/g)]
  .map(m => m[1] || m[2]);
const broken = [...new Set(refs.filter(r => !have.has(r)))];
if (broken.length) {
  console.error(`These cross-references point at sections that do not exist: ${broken.join(', ')}`);
  console.error(`Sections that do exist: ${[...have].join(', ')}`);
  process.exit(1);
}
console.log(`${have.size} sections, ${refs.length} cross-references, all resolve.`);

const foot = `
  <div style="width:100%;font:8pt 'Segoe UI',sans-serif;color:#8b8578;padding:0 16mm;
              display:flex;justify-content:space-between;align-items:center">
    <span style="letter-spacing:.14em;text-transform:uppercase">Regal Hardware · How the system works</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;

const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(pathToFileURL(SRC).href, { waitUntil: 'networkidle0' });

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await page.pdf({
  path: OUT,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',                 // the cover carries the title; no running header
  footerTemplate: foot,
  margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
  // the cover is full bleed, so it gets no footer
  pageRanges: '1-'
});
await browser.close();

const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${kb} KB${errs.length ? '  ERRORS: ' + errs.join(' | ') : ''}`);
