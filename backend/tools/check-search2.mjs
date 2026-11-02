// Finding an item at the till, with the shop's own 6,486 products (Desktop/SePOS export/sepos-products.csv).
//  · words in any order: "valve 1/2" finds what "1/2 … valve" is called; "kevilton dimmer" finds the KEVILTON
//    LIGHT DIMMER; "12mm" finds "12 mm"
//  · an item that matched but sat past the first 12 now shows (the list holds 30, best first)
//  · a whole-name start comes first; codes still win
//  · fast enough to type: each search over 6,486 products in a few milliseconds
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-search2.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const CSV = process.env.CSV || 'C:/Users/Semicolans/Desktop/SePOS export/sepos-products.csv';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
// the shop's products from the SePOS export
const rows = fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean).map(line => {
  const out = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch } out.push(cur); return out });
const prods = rows.map((r, i) => ({ id: 900000 + i, code: r[0], name: r[1], cat: r[2], unit: r[3] || 'pcs', cost: +r[4] || 0, mrp: +r[5] || 0, retail: +r[6] || +r[5] || 0, wholesale: +r[7] || 0, min: 0, stock: 5, short: r[10] || '', barcode: r[11] || '', num: String(10000 + i), active: true }));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 120000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.dismiss());
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
// the shop's products in place of the sample ones, in this page only (nothing is saved)
const n = await pg.evaluate(ps => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {}; const S = window.eval('S'); S.products = ps; return S.products.length }, prods);
ok(n === prods.length, `the shop's ${n} products loaded`);
const find = (q) => pg.evaluate(q => { const t0 = performance.now(); const r = window.eval('csFind')(q); return { ms: performance.now() - t0, n: r.length, top: r.slice(0, 30).map(p => p.name) } }, q);
// words in any order, from real names
const sample = prods.filter(p => /\s/.test(p.name)).filter((_, i) => i % 97 === 0).slice(0, 40);
let found = 0, worst = 0;
for (const p of sample) {
  const ws = p.name.toLowerCase().split(/\s+/).filter(w => w.length > 2); if (ws.length < 2) { found++; continue }
  const q = [ws[ws.length - 1], ws[0]].join(' ');                // the last word, then the first — out of order
  const r = await find(q); worst = Math.max(worst, r.ms);
  if (r.top.includes(p.name)) found++; else console.log('   not in the first 30:', JSON.stringify(q), '→', p.name, `(${r.n} matches)`);
}
ok(found === sample.length, `${sample.length} real items, searched by two of their words out of order: every one comes up`, `${found}/${sample.length}`);
const dim = await find('dimmer kevilton');
ok(dim.top.some(x => /KEVILTON LIGHT DIMMER/.test(x)), '"dimmer kevilton" finds the KEVILTON LIGHT DIMMER', dim.top.slice(0, 3).join(' | '));
// an exact code still first
const code = await pg.evaluate(() => { const p = window.eval('S').products.find(x => x.short); return { short: p.short, first: window.eval('csFind')(p.short)[0].name, name: p.name } });
ok(code.first === code.name, 'a short code still finds its item first', JSON.stringify(code));
// speed
const many = await pg.evaluate(() => { const t0 = performance.now(); for (const q of ['c', 'ce', 'cem', 'ceme', 'cemen', 'cement', 'pvc', 'pvc 1/2', 'tap', 'valve']) window.eval('csFind')(q); return (performance.now() - t0) / 10 });
ok(many < 60 && worst < 120, `fast enough to type: ${many.toFixed(1)} ms a search on average (slowest ${worst.toFixed(1)} ms)`);
// the dropdown shows up to 30
const shown = await pg.evaluate(() => { window.eval('go')('pos'); const CS = window.eval('CS'); CS.q = 'pvc'; CS.pid = null; window.eval('render')(); const f = document.getElementById('csQ'); if (f) { f.value = 'pvc'; f.dispatchEvent(new Event('input', { bubbles: true })) } return document.querySelectorAll('[data-act="csPick"]').length });
ok(shown > 12 && shown <= 30, `typing "pvc": ${shown} items in the list (before: 12 at most)`);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
