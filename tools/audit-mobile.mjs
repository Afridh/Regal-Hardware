// Walk every screen at phone size and report what does not fit.
//   npm start            (in server/)  — then:
//   node tools/audit-mobile.mjs [out-dir]
//
// Runs against /demo. For each view it measures the things that actually hurt on a phone:
// the page sliding sideways, anything wider than the screen, tap targets too small to hit,
// and tables too wide to read. Prints a table worst-first, and saves a shot of each.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4000';
const SHOTS = process.argv.includes('--shots');
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!exe) { console.error('No Chrome or Edge to drive.'); process.exit(1) }

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await pg.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
const errs = {};
let view = '?';
pg.on('pageerror', e => { (errs[view] = errs[view] || []).push(e.message.slice(0, 90)) });
pg.on('dialog', async d => { await d.accept() });

await pg.goto(BASE + '/demo', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await new Promise(r => setTimeout(r, 1200));

const list = await pg.evaluate(() => views.filter(v => v[0] !== 'grp' && allowed(v[0])).map(v => [v[0], v[1]]));
console.log(`${list.length} screens to walk\n`);

const rows = [];
for (const [key, label] of list) {
  view = key;
  try {
    await pg.evaluate(k => { go(k); render() }, key);
  } catch (e) { rows.push({ key, label, broke: e.message.slice(0, 50) }); continue }
  await new Promise(r => setTimeout(r, 480));

  const m = await pg.evaluate(() => {
    const win = window.innerWidth;
    const main = document.getElementById('main');
    const slides = document.documentElement.scrollWidth - win;
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 };
    /* Something wider than the screen is only a fault if there is no way to reach it.
       A table that scrolls sideways is wider than the screen on purpose. */
    const reachable = el => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/auto|scroll/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 2) return true;
        if (p === document.body) break;
      }
      return false;
    };
    const over = [...(main ? main.querySelectorAll('*') : [])].filter(el => {
      if (!vis(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= win + 2 && r.right <= win + 2) return false;
      return !reachable(el);                         // cut off, with no way to scroll to it
    });
    const tag = el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    /* A link inside running text is not a button and does not want a thumb's worth of
       height; a checkbox is fine when the label around it is big enough to hit. */
    const inlineLink = el => el.tagName === 'A' && !el.className && el.closest('p,td,li,.muted,h2,h1');
    const bigLabel = el => /checkbox|radio/.test(el.type || '') && el.closest('label')
      && el.closest('label').getBoundingClientRect().height >= 36;
    const tiny = [...(main ? main.querySelectorAll('button,a,input,select,[data-act],[data-view]') : [])]
      .filter(el => { if (!vis(el)) return false;
        if (inlineLink(el) || bigLabel(el)) return false;
        return el.getBoundingClientRect().height < 32 });
    /* a table whose content does not fit and cannot be scrolled to */
    const wideTables = [...(main ? main.querySelectorAll('table') : [])]
      .filter(t => vis(t) && t.scrollWidth > t.clientWidth + 2
        && !/auto|scroll/.test(getComputedStyle(t).overflowX));
    const scrollTables = [...(main ? main.querySelectorAll('table') : [])]
      .filter(t => vis(t) && t.scrollWidth > t.clientWidth + 2
        && /auto|scroll/.test(getComputedStyle(t).overflowX));
    return {
      slides, over: over.length, overWhat: [...new Set(over.map(tag))].slice(0, 4),
      tiny: tiny.length, tables: (main ? main.querySelectorAll('table').length : 0),
      wideTables: wideTables.length, scrollTables: scrollTables.length,
      height: main ? main.scrollHeight : 0, empty: !main || main.textContent.trim().length < 40
    };
  });
  rows.push({ key, label, ...m });
  if (SHOTS) await pg.screenshot({ path: `${OUT}/m-${key}.png` });
}

const score = r => (r.broke ? 1000 : 0) + Math.max(0, r.slides) * 10 + (r.over || 0) * 5 + (r.wideTables || 0) * 8 + (r.tiny || 0);
rows.sort((a, b) => score(b) - score(a));

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(pad('screen', 16) + pad('slides', 8) + pad('cut off', 9) + pad('clipped', 9) + pad('scrolls', 9) + pad('small taps', 11) + 'what is cut off');
console.log('-'.repeat(96));
for (const r of rows) {
  if (r.broke) { console.log(pad(r.key, 16) + 'THREW: ' + r.broke); continue }
  const bad = score(r) > 0;
  console.log(pad(r.key, 16) + pad(r.slides > 0 ? r.slides + 'px' : '·', 8)
    + pad(r.over || '·', 9) + pad(r.wideTables || '·', 9) + pad(r.scrollTables || '·', 9)
    + pad(r.tiny || '·', 11) + (bad ? (r.overWhat || []).join(' ') : ''));
}
const bad = rows.filter(r => score(r) > 0);
console.log(`\n${bad.length} of ${rows.length} screens have something wrong at 390px`);
console.log('worst: ' + bad.slice(0, 6).map(r => r.key).join(', '));
if (Object.keys(errs).length) console.log('\nthrew: ' + Object.entries(errs).map(([k, v]) => k + ' (' + v[0] + ')').join('; '));
await b.close();
