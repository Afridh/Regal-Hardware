// The front page of regalhw.lk (store.html, since 8 Nov 2026) on phones, a tablet and a desk: nothing runs off the
// side, no script errors, the goods come up, and what is meant to be tapped is big enough for a thumb.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-store-phone.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
for (const [label, w, h, mobile] of [['phone', 390, 844, true], ['small phone', 360, 740, true], ['tablet', 820, 1180, true], ['desk', 1440, 900, false]]) {
  const pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
  const r = await pg.goto(BASE + '/', { waitUntil: 'networkidle2' }); await new Promise(r => setTimeout(r, 1500));
  ok(r.status() === 200, `${label}: the page opens`, String(r.status()));
  const m = await pg.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width && r.right > vw + 1 && cs.position !== 'fixed' && !e.closest('[style*="overflow"],.scroll,[class*="rail"],[class*="track"],[class*="strip"]') }).slice(0, 3).map(e => e.tagName + '.' + e.className);
    const taps = [...document.querySelectorAll('a[href],button,[role=button],input,select')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && getComputedStyle(e).visibility !== 'hidden' && r.top < innerHeight * 3 });
    const small = taps.filter(e => { const r = e.getBoundingClientRect(); return Math.max(r.width, r.height) < 24 || Math.min(r.width, r.height) < 18 });
    return { scrollW: document.documentElement.scrollWidth, vw, wide, taps: taps.length, small: small.slice(0, 4).map(e => (e.innerText || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)), nSmall: small.length,
      text: document.body.innerText.length };
  });
  ok(m.scrollW <= m.vw + 1, `${label}: nothing runs off the side`, `${m.scrollW} / ${m.vw}${m.wide.length ? ' ' + m.wide.join(', ') : ''}`);
  ok(m.text > 300, `${label}: the page has its words and goods`, m.text + ' characters');
  if (mobile) ok(m.nSmall <= 3, `${label}: what is meant to be tapped is big enough (${m.taps} looked at)`, m.nSmall ? m.nSmall + ' small: ' + m.small.join(' · ') : '');
  ok(!errs.length, `${label}: no script errors`, errs.join(' | '));
  await pg.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
