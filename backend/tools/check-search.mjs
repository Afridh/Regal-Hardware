// Typing in a search box while the page redraws itself.
//  · the supplier search: a redraw in the middle of typing (the books coming in, another tab saving) keeps
//    every letter in its place; a letter typed in the middle stays in the middle; a " does not break the box
//  · a second tab of the till saving while the first is typing does not throw the first one's box about
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-search.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const signIn = async (pg) => {
  await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await wait(1500); await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
};
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await signIn(pg);
await pg.evaluate(() => { window.eval("supQ=''"); window.eval('go')('suppliers') }); await wait(400);
const box = () => pg.evaluate(() => { const q = document.querySelector('#supQ'); return { v: q.value, s: q.selectionStart, focus: document.activeElement === q } });

// 1. a redraw from elsewhere in the middle of typing
await pg.click('#supQ'); await pg.keyboard.type('to', { delay: 40 });
await pg.evaluate(() => window.eval('render')());                 // as when the books come in
await pg.keyboard.type('ky', { delay: 40 });
let r = await box();
ok(r.v === 'toky' && r.focus && r.s === 4, 'a redraw in the middle of typing: every letter in its place, the cursor at the end', JSON.stringify(r));
// 2. a letter in the middle stays in the middle
await pg.keyboard.press('ArrowLeft'); await pg.keyboard.press('ArrowLeft'); await pg.keyboard.type('X');
r = await box();
ok(r.v === 'toXky' && r.s === 3, 'a letter typed in the middle stays in the middle', JSON.stringify(r));
// 3. a " in the search does not break the box
await pg.evaluate(() => { const q = document.querySelector('#supQ'); q.value = ''; q.dispatchEvent(new Event('input')) });
await pg.keyboard.type('1/2" pipe');
r = await box();
ok(r.v === '1/2" pipe' && !!(await pg.$('#supQ')), 'a " typed in does not break the box', JSON.stringify(r));

// 4. a second tab saving while the first is typing
await pg.evaluate(() => { const q = document.querySelector('#supQ'); q.value = ''; q.dispatchEvent(new Event('input')) });
const pg2 = await b.newPage(); await pg2.setViewport({ width: 1200, height: 800 }); await signIn(pg2);
await pg.bringToFront(); await pg.click('#supQ');
await pg.keyboard.type('ga', { delay: 40 });
await pg2.evaluate(() => { const S = window.eval('S'); S.notes = (S.notes || 0) + 1; window.eval('persist')(true) });   // the other tab saves
await wait(400); await pg.keyboard.type('mpola', { delay: 40 });
r = await box();
ok(r.v === 'gampola' && r.focus, 'another tab saving while this one types: "gampola" stays whole', JSON.stringify(r));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
