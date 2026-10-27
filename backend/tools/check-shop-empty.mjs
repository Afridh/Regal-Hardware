// The website shows only what the till lists. With every item switched off it says so — no sample
// goods; with the server down it says that; the hand-added switches follow "Only the items I tick".
//   npm start (in backend/), then:  node backend/tools/check-shop-empty.mjs [screenshot-dir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const SAMPLES = /Vortex-20X|Titan-Cut|IronClad|Weathercoat|Tough-Pox|Ti-Strike|Quad-Beam|Torx-Drive|Pro-Bore|ComfortFit|Quiet-Power|RockShield/;

// open the site with the catalogue answered as given (null = the server does not answer)
async function site(catalog, path = '/', name = 'x') {
  const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 900 });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.setRequestInterception(true);
  pg.on('request', rq => {
    if (catalog !== undefined && rq.url().includes('/api/shop/catalog')) {
      if (catalog === null) return rq.abort('connectionrefused');
      return rq.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog) });
    }
    rq.continue();
  });
  // the first paint, before the list arrives, must not show samples either
  let early = '';
  pg.once('domcontentloaded', async () => { try { early = await pg.evaluate(() => document.body.innerText) } catch {} });
  await pg.goto(BASE + path, { waitUntil: 'networkidle2' }); await new Promise(r => setTimeout(r, 2500));
  const text = await pg.evaluate(() => document.body.innerText);
  const n = 0;   // (the list lives inside the page's script; what it shows is what counts)
  await pg.screenshot({ path: `${OUT}/shop-${name}.png` });
  await pg.close();
  return { text, early, n, errs };
}
const shop = { name: 'Regal Hardware', phone: '077 222 2259' };
const prod = (i, extra = {}) => ({ id: i, code: 'PCT-11-00' + (1000 + i), name: 'TEST ITEM ' + i, cat: 'Tools', unit: 'pcs', mrp: 100, price: 90, stock: 5, img: '', ...extra });

const off = await site({ shop, settings: { open: true, listMode: 'all' }, categories: [], products: [] }, '/', 'all-off');
ok(!SAMPLES.test(off.text) && !SAMPLES.test(off.early), 'every item switched off: no sample goods, not even while loading');
ok(/catalogue is being updated/i.test(off.text), 'and the site says the catalogue is being updated');
ok(!/ORANGE ENIGMA/i.test(off.text), 'and the hand-added switches are off too');
const offSearch = await site({ shop, settings: { open: true }, categories: [], products: [] }, '/#/search?q=drill', 'all-off-search');
ok(!SAMPLES.test(offSearch.text) && !offSearch.errs.length, 'a search with nothing listed finds nothing, without errors', offSearch.errs.join(' | '));

const down = await site(null, '/', 'down');
ok(!SAMPLES.test(down.text) && /can’t reach the shop/i.test(down.text), 'server not answering: says so, no sample goods');

const all = await site({ shop, settings: { open: true, listMode: 'all' }, categories: [{ name: 'Tools', count: 3 }], products: [prod(1), prod(2), prod(3)] }, '/#/search?q=enigma', 'all');
const all2 = await site({ shop, settings: { open: true, listMode: 'all' }, categories: [{ name: 'Tools', count: 3 }], products: [prod(1), prod(2), prod(3)] }, '/#/search?q=test%20item', 'all2');
ok(/TEST ITEM 1/i.test(all2.text) && /ORANGE ENIGMA/i.test(all.text), 'everything listed: the till’s items, plus the hand-added switches');
const sel = await site({ shop, settings: { open: true, listMode: 'selected' }, categories: [{ name: 'Tools', count: 2 }], products: [prod(1), prod(2)] }, '/#/search?q=enigma', 'selected');
ok(!/ORANGE ENIGMA/i.test(sel.text), '"Only the items I tick": no hand-added switches');

ok(![off, offSearch, down, all, all2, sel].some(r => r.errs.length), 'no script errors', [off, offSearch, down, all, all2, sel].flatMap(r => r.errs).slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
