// The product form has the supplier.
//  · a new product with a supplier picked from the list: kept on the product, shown on the Products list
//  · editing a product shows its supplier; it can be changed or emptied
//  · a name that is no supplier is refused; "＋ A new supplier" adds one and it comes straight into the box
//  · Save & add another keeps the supplier for the next one
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-prodsup.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
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
const sup = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.labelSheet = () => {};
  const S = window.eval('S'); const s = S.suppliers.filter(x => x.active !== false); window.eval('go')('products'); return { a: s[0].name, aId: s[0].id, b: s[1].name, bId: s[1].id } });
const addOne = async (name, supName, again) => {
  await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('productModal')() }); await wait(300);
  await pg.type('#pname', name); await pg.type('#pretail', '450'); await pg.type('#pcost', '300');
  if (supName !== undefined) { await pg.$eval('#psup', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }, supName); }
  await pg.click(again ? '#pnext' : '#psave'); await wait(400);
  await pg.evaluate(() => document.querySelectorAll('.al-modal').forEach(m => m.remove()));   // the labels question
};
// 1. a new product with a supplier
await pg.evaluate(() => { window.eval('productModal')() }); await wait(300);
ok(!!(await pg.$('#psup')) && (await pg.$$eval('#psupList option', o => o.length)) > 0, 'the product form has Supplier, with the suppliers to pick from');
await addOne('Sup Test Valve 1/2', sup.a);
let p1 = await pg.evaluate(() => { const S = window.eval('S'); const p = S.products.find(x => x.name === 'Sup Test Valve 1/2'); return p && { id: p.id, sid: p.supplierId } });
ok(p1 && p1.sid === sup.aId, 'saved with that supplier', JSON.stringify(p1));
const listed = await pg.evaluate(id => { window.eval("prodQ='Sup Test Valve'"); window.eval('render')(); return (document.querySelector('#main table') || {}).innerText || '' }, p1.id);
ok(listed.includes(sup.a.split(/[–(]/)[0].trim()), 'the Products list shows the supplier');
// 2. editing shows it; changed; emptied
await pg.evaluate(id => window.eval('productModal')(id), p1.id); await wait(300);
ok(await pg.$eval('#psup', el => el.value) === sup.a, 'editing: the form shows its supplier');
await pg.$eval('#psup', (el, v) => { el.value = v }, sup.b); await pg.click('#psave'); await wait(400);
ok(await pg.evaluate(id => window.eval('P')(id).supplierId, p1.id) === sup.bId, 'changed to another supplier');
await pg.evaluate(id => window.eval('productModal')(id), p1.id); await wait(300);
await pg.$eval('#psup', el => { el.value = '' }); await pg.click('#psave'); await wait(400);
ok(await pg.evaluate(id => window.eval('P')(id).supplierId, p1.id) == null, 'emptied: no supplier');
// 3. a name that is no supplier
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('productModal')() }); await wait(300);
await pg.type('#pname', 'Sup Test Tap'); await pg.type('#pretail', '450');
await pg.$eval('#psup', el => { el.value = 'Nobody Traders' }); await pg.click('#psave'); await wait(300);
const refused = await pg.evaluate(() => ({ open: !!document.querySelector('.pm-box'), bad: document.querySelector('#psup').classList.contains('pm-bad'), saved: window.eval('S').products.some(x => x.name === 'Sup Test Tap') }));
ok(refused.open && refused.bad && !refused.saved, 'a name that is no supplier is refused, the box marked', JSON.stringify(refused));
// ＋ A new supplier: added, and in the box
await pg.click('#psupNew'); await wait(400);
const supForm = await pg.evaluate(() => { const ms = [...document.querySelectorAll('.modal')]; const top = ms[ms.length - 1]; const inp = top.querySelector('input'); return { n: ms.length, name: inp && inp.value } });
ok(supForm.n >= 2, 'the new supplier form opens over the product form', JSON.stringify(supForm));
await pg.evaluate(() => { const S = window.eval('S'); const ms = [...document.querySelectorAll('.modal')]; ms[ms.length - 1].remove();
  S.suppliers.push({ id: Math.max(...S.suppliers.map(x => x.id)) + 1, code: 'SNEW', name: 'Nobody Traders', phone: '', active: true }) });   // as the supplier form saves one
await wait(900);
ok(await pg.$eval('#psup', el => el.value) === 'Nobody Traders', 'the supplier just added comes straight into the box');
await pg.click('#psave'); await wait(400); await pg.evaluate(() => document.querySelectorAll('.al-modal').forEach(m => m.remove()));
ok(await pg.evaluate(() => { const S = window.eval('S'); const p = S.products.find(x => x.name === 'Sup Test Tap'); const s = S.suppliers.find(x => x.name === 'Nobody Traders'); return p && s && p.supplierId === s.id }), 'and the product is saved with it');
// 4. Save & add another keeps it
await addOne('Sup Test Elbow', sup.a, true);
ok(await pg.$eval('#psup', el => el.value) === sup.a, 'Save & add another: the next one starts with the same supplier');
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); S.products = S.products.filter(x => !/^Sup Test /.test(x.name)); S.suppliers = S.suppliers.filter(x => x.name !== 'Nobody Traders'); window.eval('persist')(true) }); await wait(1200);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
