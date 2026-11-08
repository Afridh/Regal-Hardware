// Walking the bill with the arrow keys (8 Nov 2026: going up from the bottom, the top lines and the first
// product could not be seen — each line stepped onto was scrolled to the very top, under the list's
// fixed header). Every line walked onto, down and back up, must sit in full below the header.
// Nothing reaches a printer: :41xx is blocked and nothing is printed.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-tillwalk.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
for (const [w, h] of [[1366, 768], [1280, 640]]) {
  const pg = await b.newPage(); await pg.setViewport({ width: w, height: h });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await wait(1500);
  const N = 30;
  await pg.evaluate(N => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {};
    const S = window.eval('S'), ps = S.products.filter(y => y.active !== false && y.retail > 0);
    S.pos.lines = Array.from({ length: N }, (_, i) => { const x = ps[i % ps.length]; return { pid: x.id, qty: 1, price: x.retail, disc: 0, auto: true } });
    S.pos.sel = -1; window.eval('go')('pos') }, N);
  await wait(600);
  // where is the selected line, against the list's header and bottom edge
  const seen = () => pg.evaluate(() => { const box = document.querySelector('.till-lines'), th = box.querySelector('thead th'), sel = window.eval('S').pos.sel;
    const tr = box.querySelector(`tbody tr[data-i="${sel}"]`); if (!tr) return { sel, ok: false };
    const b = box.getBoundingClientRect(), r = tr.getBoundingClientRect(), hb = th && getComputedStyle(th).display !== 'none' ? th.getBoundingClientRect().bottom : b.top;
    return { sel, ok: r.top >= hb - 1 && r.bottom <= b.bottom + 1, top: Math.round(r.top), head: Math.round(hb), bottom: Math.round(r.bottom), boxBottom: Math.round(b.bottom), scrolls: box.scrollHeight > box.clientHeight } });
  await pg.evaluate(() => document.querySelector('.till-lines').focus());
  const bad = []; let first = null;
  for (let i = 0; i < N + 2; i++) { await pg.keyboard.press('ArrowDown'); await wait(40); const s = await seen(); if (!first) first = s; if (!s.ok) bad.push(['down', s]) }
  const atEnd = await seen();
  ok(atEnd.sel === N - 1 && atEnd.ok && atEnd.scrolls, `${w}×${h}: ↓ to the last line, and it is in view (the list scrolls)`, JSON.stringify(atEnd));
  for (let i = 0; i < N - 1; i++) { await pg.keyboard.press('ArrowUp'); await wait(40); const s = await seen(); if (!s.ok) bad.push(['up', s]) }
  const top = await seen();
  ok(top.sel === 0 && top.ok, `${w}×${h}: ↑ back to the first product, and it is in view below the header`, JSON.stringify(top));
  ok(!bad.length, `${w}×${h}: every line walked onto, down and up, is in full view`, bad.length ? bad.length + ' hidden, e.g. ' + JSON.stringify(bad[0]) : '');
  await pg.keyboard.press('ArrowUp'); await wait(200);
  ok(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'csQ'), `${w}×${h}: one more ↑ goes back to the item box`);
  ok(!errs.length, `${w}×${h}: no script errors`, errs.join(' | '));
  await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines = []; S.pos.sel = -1 });
  await pg.close();
}
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
