// One number for each product: the product number is the item code and the barcode, for the bill, the label
// and the till.
//  · a new product: the form asks for the product number only, plus an
//    optional maker's barcode; the number carries on from the item added last; saved, number = code = barcode, and the maker's barcode finds it too
//  · a number another product answers to is refused
//  · Products → "One number for all": each item keeps its shop sticker number (labels still scan), a
//    repeated sticker number goes to one item only, a maker's long barcode is kept beside the number,
//    and every old code still finds its item; no number clashes are left
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-onecode.mjs
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
// this check works on a copy of the products in the page and never saves
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {}; const S = window.eval('S'), C = window.eval('CFG');
  window.__keep = JSON.stringify(S.products); window.__keepOne = C.oneCode; delete C.oneCode;
  // the shop's kind of numbers: sticker numbers in several series, the item added last being 11754
  S.products.slice(0, 3).forEach((p, i) => { p.barcode = String(5738 + i) }); S.products[3].barcode = '311312'; S.products[S.products.length - 1].barcode = '11754';
  window.eval('go')('inventory') });
const nonModal = () => pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => { if (!m.querySelector('.pm-box')) m.remove() }));
// 1. a new product
await pg.evaluate(() => window.eval('productModal')()); await wait(300);
const form = await pg.evaluate(() => { const vis = id => { const el = document.getElementById(id); return !!el && el.offsetParent !== null };
  return { num: document.getElementById('pnum') && document.getElementById('pnum').value, numVis: vis('pnum'), barVis: vis('pbar'), codeVis: vis('pcode'), makerVis: vis('pbar2') } });
ok(form.numVis && form.makerVis && !form.barVis && !form.codeVis, 'the form asks for the product number (and a maker\'s barcode), no separate code or barcode', JSON.stringify(form));
ok(+form.num === 11755, 'a new product carries on from the item added last (11754 → 11755), not the highest (311312)', form.num);
await pg.type('#pname', 'One Code Test Nut'); await pg.type('#pretail', '35'); await pg.type('#pbar2', '4790001112223');
await pg.click('#psave'); await wait(500); await nonModal();
const np = await pg.evaluate(() => { const p = window.eval('S').products.find(x => x.name === 'One Code Test Nut'); const f = q => (window.eval('codeExact')(q)[0] || {}).name;
  return p && { num: p.num, code: p.code, barcode: p.barcode, b2: p.barcode2, byNum: f(p.num), byMaker: f('4790001112223') } });
ok(np && np.num === '11755' && np.code === '11755' && np.barcode === '11755', 'saved: product number = item code = barcode', JSON.stringify(np));
ok(np && np.byNum === 'One Code Test Nut' && np.byMaker === 'One Code Test Nut', 'the number and the maker\'s barcode both find it at the till');
// 2. a number taken
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('productModal')() }); await wait(300);
await pg.evaluate(() => { const i = document.getElementById('pnum'); i.value = '5738'; i.dispatchEvent(new Event('input', { bubbles: true })) });
await pg.type('#pname', 'One Code Test Clash'); await pg.type('#pretail', '35'); await pg.click('#psave'); await wait(300);
const clash = await pg.evaluate(() => ({ saved: window.eval('S').products.some(x => x.name === 'One Code Test Clash'), bad: document.getElementById('pnum').classList.contains('pm-bad') }));
ok(!clash.saved && clash.bad, 'a number another product answers to is refused', JSON.stringify(clash));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// 3. every product onto one number
const all = await pg.evaluate(() => { const S = window.eval('S'); const base = S.products[0]; let id = 990100;
  const mk = (o) => { const p = { ...base, id: ++id, short: '', short2: '', barcode2: '', oldCode: '', ...o }; S.products.push(p); return p };
  const A = mk({ name: 'OC A', num: '1500', code: 'PCT-A', barcode: '7701' });
  const B = mk({ name: 'OC B', num: '1501', code: 'PCT-B', barcode: '7701' });               // the same sticker number twice
  const Cc = mk({ name: 'OC C', num: '1502', code: 'PCT-C', barcode: '4791234567890' });     // a maker's barcode
  window.eval('render')(); const btn = document.querySelector('[data-act="oneNumber"]'); if (!btn) return { btn: false };
  btn.click();
  const f = q => (window.eval('codeExact')(q)[0] || {}).name;
  const same = S.products.every(p => String(p.num) === String(p.code) && String(p.code) === String(p.barcode));
  return { btn: true, same, A: A.num, B: B.num, C: C => 0, Cnum: Cc.num, Cb2: Cc.barcode2, finds: [f('PCT-A'), f('PCT-B'), f('PCT-C'), f('4791234567890'), f('7701')], clashes: window.eval('codeClashes')().length,
    sticker: S.products.slice(0, 3).map(p => p.num), unique: new Set(S.products.map(p => String(p.num))).size === S.products.length } });
ok(all.btn, 'Products has a "One number for all" button');
ok(all.same && all.unique, 'every product: number = code = barcode, each number used once');
ok(JSON.stringify(all.sticker) === '["5738","5739","5740"]' && all.A === '7701', 'an item with a shop sticker number keeps it, so the shelf labels still scan', JSON.stringify(all.sticker) + ' A=' + all.A);
ok(all.B !== '7701' && all.Cnum === '1502' && all.Cb2 === '4791234567890', 'a repeated sticker number goes to one item; a maker\'s barcode is kept beside the number', JSON.stringify({ B: all.B, C: all.Cnum, Cb2: all.Cb2 }));
ok(JSON.stringify(all.finds) === JSON.stringify(['OC A', 'OC B', 'OC C', 'OC C', 'OC A']), 'every old code still finds its item', JSON.stringify(all.finds));
ok(all.clashes === 0, 'no number clashes left');
await pg.evaluate(() => { const S = window.eval('S'), C = window.eval('CFG'); S.products = JSON.parse(window.__keep); if (window.__keepOne === undefined) delete C.oneCode; else C.oneCode = window.__keepOne; document.querySelectorAll('.modal').forEach(m => m.remove()) });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
