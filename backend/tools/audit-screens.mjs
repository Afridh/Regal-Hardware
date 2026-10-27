// Every screen in /demo: script errors, sideways overflow, even margins, a screenshot; then every dashboard button.
//   npm start (in backend/), then: node backend/tools/audit-screens.mjs <out-dir> [width, default 1440]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = process.argv[2] || '.';
const W = +(process.argv[3] || 1440);
const BASE = process.env.BASE || 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: W, height: 1000 });
let errs = [];
pg.on('pageerror', e => errs.push('pageerror: ' + e.message.split('\n')[0]));
pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)) });
pg.on('dialog', async d => { await d.dismiss() });

await pg.goto(BASE + '/demo', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await new Promise(r => setTimeout(r, 1500));
const startErrs = errs.splice(0);
if (startErrs.length) console.log('START', startErrs);

const views = await pg.evaluate(() => Object.values(window.eval('SECTIONS')).flat());
const report = [];
const closeAll = () => pg.evaluate(() => { document.querySelectorAll('.modal-bg,.modal,.overlay,.toast').forEach(e => e.remove()); try { window.eval('closeModal&&closeModal()') } catch (e) {} });

const layout = () => pg.evaluate(() => {
  const main = document.getElementById('main'); if (!main) return { noMain: true };
  const vw = document.documentElement.clientWidth, mr = main.getBoundingClientRect();
  const out = { pageScrollX: document.documentElement.scrollWidth - vw, offRight: [], tight: 0, overlaps: [] };
  const boxes = [...main.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.offsetWidth > 0 });
  let maxR = 0;
  for (const e of boxes) {
    const r = e.getBoundingClientRect();
    // skip things inside a scroller on purpose
    let p = e.parentElement, scrolls = false;
    while (p && p !== main) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { scrolls = true; break } p = p.parentElement }
    if (scrolls) continue;
    if (r.right > vw + 1 && out.offRight.length < 6) out.offRight.push((e.className || e.tagName).toString().slice(0, 40) + ' r=' + Math.round(r.right));
    if (r.width > 40) maxR = Math.max(maxR, r.right);
  }
  out.rightGap = Math.round(Math.min(vw, mr.right) - maxR);
  out.leftGap = Math.round(Math.min(...boxes.filter(e => e.offsetWidth > 40).map(e => e.getBoundingClientRect().left)) - mr.left);
  // sibling cards overlapping each other
  const cards = [...main.querySelectorAll('.card,.panel,.tile,.kpi,section')].filter(e => e.offsetWidth > 0);
  for (let i = 0; i < cards.length && out.overlaps.length < 4; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], c = cards[j]; if (a.contains(c) || c.contains(a) || a.parentElement !== c.parentElement) continue;
    const A = a.getBoundingClientRect(), C = c.getBoundingClientRect();
    const ox = Math.min(A.right, C.right) - Math.max(A.left, C.left), oy = Math.min(A.bottom, C.bottom) - Math.max(A.top, C.top);
    if (ox > 4 && oy > 4) { out.overlaps.push((a.className + ' x ' + c.className).slice(0, 80)); break }
  }
  // text clipped: overflow hidden with content wider
  out.clipped = [...main.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return s.overflow === 'hidden' && s.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 30 && e.children.length < 3 && e.textContent.trim() }).slice(0, 4).map(e => (e.className || e.tagName) + ': ' + e.textContent.trim().slice(0, 30));
  out.empty = !main.textContent.trim();
  return out;
});

for (const v of views) {
  errs = [];
  await closeAll();
  try { await pg.evaluate(v => window.eval('go')(v), v) } catch (e) { errs.push('go: ' + e.message.split('\n')[0]) }
  await new Promise(r => setTimeout(r, 700));
  const l = await layout();
  await pg.screenshot({ path: `${OUT}/${W}-${v}.png` });
  const issues = [];
  if (errs.length) issues.push(...errs);
  if (l.pageScrollX > 1) issues.push('page scrolls sideways by ' + l.pageScrollX + 'px');
  if (l.offRight && l.offRight.length) issues.push('past right edge: ' + l.offRight.join(', '));
  if (l.rightGap !== undefined && l.rightGap < 8) issues.push('right margin ' + l.rightGap + 'px (left ' + l.leftGap + 'px)');
  if (l.overlaps && l.overlaps.length) issues.push('overlap: ' + l.overlaps.join(' | '));
  if (l.clipped && l.clipped.length) issues.push('clipped: ' + l.clipped.join(' | '));
  if (l.empty) issues.push('blank screen');
  report.push({ v, issues });
  console.log((issues.length ? 'ISSUE ' : 'ok    ') + v + (issues.length ? '\n        ' + issues.join('\n        ') : ''));
}

// every button on the dashboard, one at a time, from a fresh dashboard
if (W >= 1000) {
  await closeAll(); await pg.evaluate(() => window.eval('go')('dashboard')); await new Promise(r => setTimeout(r, 800));
  const n = await pg.$$eval('#main button, #main [data-act]', els => els.length);
  console.log('\nDASHBOARD BUTTONS: ' + n);
  for (let i = 0; i < n; i++) {
    errs = [];
    await closeAll(); await pg.evaluate(() => window.eval('go')('dashboard')); await new Promise(r => setTimeout(r, 400));
    const els = await pg.$$('#main button, #main [data-act]'); const el = els[i]; if (!el) continue;
    const info = await el.evaluate(e => ({ t: (e.textContent || e.getAttribute('aria-label') || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 40), act: e.dataset.act || '', vis: e.offsetWidth > 0 }));
    if (!info.vis) continue;
    const before = await pg.evaluate(() => (window.eval('S').view || '') + '|' + document.body.innerHTML.length);
    try { await el.click() } catch (e) { errs.push('click: ' + e.message.split('\n')[0]) }
    await new Promise(r => setTimeout(r, 450));
    const after = await pg.evaluate(() => (window.eval('S').view || '') + '|' + document.body.innerHTML.length);
    const dead = before === after;
    if (errs.length || dead) console.log(`  ${errs.length ? 'ERROR' : 'NO-OP'} [${info.act || '-'}] "${info.t}" ${errs.join(' ; ')}`);
  }
}
fs.writeFileSync(`${OUT}/report-${W}.json`, JSON.stringify(report, null, 1));
await b.close();
