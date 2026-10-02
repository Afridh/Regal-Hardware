// What the printer is actually handed.
//
// A bill can reach the printer, be reported as printed, and still come out blank — the page is
// rendered to an image and an empty image prints just as happily as a full one. So this does not
// ask whether printing was attempted; it renders the bill the way the print helper does and looks
// at the pixels.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:4000';
const here = 'tools/print-agent';
const cfg = {
  ...JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8').replace(/^\uFEFF/, '')),
  ...(fs.existsSync(path.join(here, 'config.local.json'))
    ? JSON.parse(fs.readFileSync(path.join(here, 'config.local.json'), 'utf8').replace(/^\uFEFF/, '')) : {}),
};
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (c, w, x = '') => { c ? (pass++, console.log('PASS ' + w + (x ? '  ' + x : ''))) : (fail++, console.log('FAIL ' + w + (x ? '  ' + x : ''))) };

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const errs = [];

/* the bill as the till would send it to the helper */
const pg = await b.newPage();
pg.on('pageerror', e => errs.push(e.message));
await pg.setViewport({ width: 1300, height: 900 });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForSelector('#lockScreen');
if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
await pg.type('#lockPw', 'Afridh123');
await pg.click('#lockGo');
await pg.waitForFunction(() => !document.getElementById('lockScreen'));
await new Promise(r => setTimeout(r, 800));
const docs = await pg.evaluate(() => {
  const inv = S.sales.slice().reverse().find(s => (s.lines || []).length >= 2) || S.sales.at(-1);
  return { no: inv.no, total: inv.total, r80: billDocument(inv, 'r80'), a5: billDocument(inv, 'a5') };
});
await pg.close();

ok(docs.r80.length > 1000 && docs.a5.length > 1000, 'the till builds a bill to send',
   `${docs.no} · r80 ${docs.r80.length} chars · a5 ${docs.a5.length}`);

/* ---- rendered exactly as tools/print-agent/agent.mjs does it ---- */
for (const format of ['r80', 'a5']) {
  const f = cfg[format];
  const page = await b.newPage();
  page.on('pageerror', e => errs.push(format + ': ' + e.message));
  await page.setViewport({ width: f.widthPx, height: 800, deviceScaleFactor: f.scale || 2 });
  await page.setContent(docs[format], { waitUntil: 'load' });
  await page.emulateMediaType('print');
  const seen = await page.evaluate((f, format) => {
    document.body.classList.add('direct-print');
    document.body.style.margin = '0'; document.body.style.background = '#fff';
    const p = document.querySelector('#printArea .print');
    if (!p) return { print: false };
    if (format === 'r80') {
      const sc = +p.dataset.scale || 1;
      p.style.width = (302 / sc) + 'px'; p.style.border = '0'; p.style.padding = '2px 4px';
      p.style.boxSizing = 'border-box'; p.style.zoom = String((f.dots || 576) / 302 * sc);
      p.style.filter = 'contrast(400%)';
      document.body.style.width = (f.dots || 576) + 'px';
    }
    const cs = getComputedStyle(p);
    return { print: true, visibility: cs.visibility, display: cs.display, opacity: cs.opacity,
      text: p.textContent.replace(/\s+/g, ' ').trim().length,
      // every descendant has to be visible too: one blanket rule above can hide the lot
      hidden: [...p.querySelectorAll('*')].filter(el => getComputedStyle(el).visibility === 'hidden').length };
  }, f, format);
  await new Promise(r => setTimeout(r, 200));

  ok(seen.print, `${format}: the bill is in the page the helper renders`);
  ok(seen.visibility === 'visible' && seen.hidden === 0,
     `${format}: it is visible under print media, and so is everything on it`,
     JSON.stringify({ visibility: seen.visibility, hiddenChildren: seen.hidden }));

  /* and the decisive one: is there any ink on it */
  const target = await page.$('#printArea .print') || await page.$('body');
  const shot = await target.screenshot({ encoding: 'binary', omitBackground: false });
  const ink = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + b64 });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 && d[i + 1] < 200 && d[i + 2] < 200) dark++;
    return { w: img.width, h: img.height, dark, pct: +(dark / (c.width * c.height) * 100).toFixed(2) };
  }, Buffer.from(shot).toString('base64'));

  ok(ink.pct > 1, `${format}: there is ink on the paper, not a blank page`,
     `${ink.w}x${ink.h} · ${ink.pct}% of it marked`);
  await page.close();
}

ok(errs.length === 0, 'no script errors while rendering a bill', errs.join(' | '));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
