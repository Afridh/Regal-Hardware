// The barcode number as the item code.
//  · a new product: "same as the barcode" is ticked; the item code follows the barcode as it is typed and is saved as it
//  · an item whose code differs: unticked; ticking it makes the code the barcode, and the old code still finds the item
//  · Products → "Barcode as code": every product's code becomes its barcode, the old codes still find them;
//    one whose barcode is another product's code is left alone
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-codebar.mjs
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
// the books are kept as they were: this check works on a copy in the page and never saves
const keep = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {}; const S = window.eval('S'); window.__keep = JSON.stringify(S.products); window.eval('go')('inventory'); return S.products.length });
const nonModal = () => pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => { if (!m.querySelector('.pm-box')) m.remove() }));
// 1. a new product
await pg.evaluate(() => window.eval('productModal')()); await wait(300);
const fresh = await pg.evaluate(() => ({ ticked: document.getElementById('pcodeBar').checked, code: document.getElementById('pcode').value, bar: document.getElementById('pbar').value, ro: document.getElementById('pcode').readOnly }));
ok(fresh.ticked && fresh.ro && fresh.code === fresh.bar, 'a new product: "same as the barcode" is ticked and the item code is the barcode', JSON.stringify(fresh));
await pg.evaluate(() => { const i = document.getElementById('pbar'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })) });
await pg.type('#pbar', '7731234'); await pg.type('#pname', 'Codebar Test Bolt'); await pg.type('#pretail', '120');
ok(await pg.$eval('#pcode', x => x.value) === '7731234', 'the item code follows the barcode as it is typed');
await pg.click('#psave'); await wait(500); await nonModal();
const saved = await pg.evaluate(() => { const p = window.eval('S').products.find(x => x.name === 'Codebar Test Bolt'); return p && { code: p.code, barcode: p.barcode } });
ok(saved && saved.code === '7731234' && saved.barcode === '7731234', 'saved with the barcode as its item code', JSON.stringify(saved));
// 2. an item with a different code
const old = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); const p = S.products.find(x => x.barcode && x.code && x.code !== x.barcode && !x.oldCode); window.eval('productModal')(p.id); return { id: p.id, code: p.code, barcode: p.barcode } });
await wait(300);
const un = await pg.evaluate(() => ({ ticked: document.getElementById('pcodeBar').checked, code: document.getElementById('pcode').value }));
ok(!un.ticked && un.code === old.code, 'an item whose code differs: unticked, its own code shown', JSON.stringify(un));
await pg.click('#pcodeBar'); await wait(100);
ok(await pg.$eval('#pcode', x => x.value) === old.barcode, 'ticking it puts the barcode in the item code');
await pg.click('#psave'); await wait(500); await nonModal();
const after = await pg.evaluate(o => { const p = window.eval('P')(o.id); const f = window.eval('codeExact')(o.code); return { code: p.code, oldCode: p.oldCode, finds: f[0] && f[0].id === o.id } }, old);
ok(after.code === old.barcode && after.oldCode === old.code && after.finds, 'saved: the code is the barcode, and the old code still finds the item', JSON.stringify(after));
// 3. all at once
const bulk = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S');
  const others = S.products.filter(x => x.barcode && x.code !== x.barcode && x.name !== 'Codebar Test Bolt');
  const a = others[0], z = others[1];
  const clash = { ...z, id: 990001, name: 'Codebar Clash', barcode: '5559991', code: a.code, num: '' };   // its barcode is free, but make a's barcode taken by this one's code
  clash.code = String(a.barcode); clash.barcode = '5559991'; S.products.push(clash);
  const before = others.map(x => ({ id: x.id, code: x.code })); window.eval('render')();
  const btn = document.querySelector('[data-act="codesToBar"]'); if (!btn) return { btn: false };
  btn.click();
  const P = window.eval('P');
  const changed = before.filter(x => x.id !== a.id).every(x => P(x.id).code === String(P(x.id).barcode) && window.eval('codeExact')(x.code).some(q => q.id === x.id));
  return { btn: true, changed, aLeft: P(a.id).code !== String(P(a.id).barcode), n: before.length } });
ok(bulk.btn, 'Products has a "Barcode as code" button');
ok(bulk.changed, `every product's code becomes its barcode, and each old code still finds it (${bulk.n})`);
ok(bulk.aLeft, 'one whose barcode is already another product\'s code is left alone');
await pg.evaluate(() => { window.eval('S').products = JSON.parse(window.__keep); document.querySelectorAll('.modal').forEach(m => m.remove()) });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
