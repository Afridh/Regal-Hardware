// The Products page shows the newest item on top.
//  · with nothing typed in the search, the product added last is the first row, and the one before it second
//  · typing still ranks by the search (the best match first)
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-prodnew.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
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
const rows = await pg.evaluate(async () => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {};
  const S = window.eval('S'); const base = S.products[0]; let id = Math.max(...S.products.map(x => x.id));
  S.products.push({ ...base, id: ++id, name: 'Newest Test A', code: 'NTA1', short: '', barcode: '', num: '' }, { ...base, id: ++id, name: 'Newest Test B', code: 'NTB1', short: '', barcode: '', num: '' });
  window.eval('go')('inventory'); window.eval('render')(); await new Promise(r => setTimeout(r, 300));
  const names = () => [...document.querySelectorAll('#prGrid tr[data-pr] td.nm')].slice(0, 3).map(x => x.childNodes[0].textContent.trim());
  const blank = names(), note = !!document.querySelector('[name="prOrd"][value="new"]:checked');
  const f = document.getElementById('prodQ'); f.value = base.name; f.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 400));
  const typed = names(); S.products = S.products.filter(x => !/^Newest Test/.test(x.name)); return { blank, note, typed, want: base.name } });
ok(rows.blank[0] === 'Newest Test B' && rows.blank[1] === 'Newest Test A', 'nothing typed: the last added is on top, the one before it next', rows.blank.join(' | '));
ok(rows.note, 'the order is "Newest first"');
ok(rows.typed[0] === rows.want, 'typing still puts the best match first', rows.typed.join(' | '));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
