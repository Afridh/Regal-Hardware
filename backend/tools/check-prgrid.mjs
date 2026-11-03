// Product records, like the old SePOS screen.
//  · boxes for the item number or name, the category and the supplier; each narrows the grid as it is typed,
//    and typing keeps the cursor in the box (only the grid is redrawn)
//  · order by item number, by name, or newest first
//  · one row picked out; ↑ ↓ move it; F3 / Enter edit it; F2 adds; F5 clears the search; no Delete in
//    the list — deleting is on the product, and anyone but an admin asks for approval
//  · the footer counts the records
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-prgrid.mjs
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
const info = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {}; const S = window.eval('S'); window.__keep = JSON.stringify(S.products);
  const s0 = S.suppliers.find(x => x.active !== false); S.products.slice(0, 3).forEach(p => { p.supplierId = s0.id }); const sup = s0.name;
  const cat = S.products[0].cat; window.eval('go')('inventory'); return { sup, cat, total: S.products.length } });
await wait(300);
const rows = () => pg.evaluate(() => [...document.querySelectorAll('#prGrid tr[data-pr]')].map(r => ({ id: +r.dataset.pr, num: r.querySelector('.pn').textContent, name: r.querySelector('.nm').childNodes[0].textContent.trim(), cat: r.children[2].textContent, sup: r.children[3].textContent, on: r.classList.contains('on') })));
ok(!!(await pg.$('#prodQ')) && !!(await pg.$('#prCat')) && !!(await pg.$('#prSup')) && (await pg.$$('[name="prOrd"]')).length === 3, 'boxes for item number or name, category and supplier, and Order by');
let r = await rows();
ok(r.length === info.total && r.filter(x => x.on).length === 1, `every product in the grid, one picked out (${r.length})`);
ok(/Total records: \d+\/\d+/.test(await pg.evaluate(() => document.querySelector('.pr-foot').innerText)), 'the footer counts the records');
// category
await pg.click('#prCat'); await pg.keyboard.type(info.cat.slice(0, 4)); await wait(150);
r = await rows(); const fc = await pg.evaluate(() => document.activeElement.id);
ok(r.length > 0 && r.every(x => x.cat.toLowerCase().includes(info.cat.slice(0, 4).toLowerCase())) && fc === 'prCat', 'the category box narrows the grid, the cursor stays in it', `${r.length} · focus ${fc}`);
await pg.evaluate(() => { const i = document.getElementById('prCat'); i.value = ''; i.dispatchEvent(new Event('input')) });
// supplier
await pg.click('#prSup'); await pg.keyboard.type(info.sup.slice(0, 5)); await wait(150);
r = await rows();
ok(r.length > 0 && r.every(x => x.sup.toLowerCase().includes(info.sup.slice(0, 5).toLowerCase())), 'the supplier box narrows the grid', `${r.length} for "${info.sup.slice(0, 5)}"`);
await pg.evaluate(() => { const i = document.getElementById('prSup'); i.value = ''; i.dispatchEvent(new Event('input')) });
// order
await pg.click('[name="prOrd"][value="name"]'); await wait(150); r = await rows();
ok(r.every((x, i) => i === 0 || r[i - 1].name.localeCompare(x.name) <= 0), 'order by item name');
await pg.click('[name="prOrd"][value="num"]'); await wait(150); r = await rows();
ok(r.every((x, i) => i === 0 || (+r[i - 1].num || 0) <= (+x.num || 0)), 'order by item number', r.slice(0, 4).map(x => x.num).join(','));
// arrows and F3
const start = (await rows()).findIndex(x => x.on);
await pg.click('#prodQ'); await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown'); await wait(100);
r = await rows(); const sel = r.findIndex(x => x.on);
ok(sel === start + 2, '↓ ↓ moves the picked row down two', start + ' → ' + sel);
await pg.keyboard.press('F3'); await wait(300);
const edit = await pg.evaluate(() => (document.getElementById('pname') || {}).value);
ok(edit === r[sel].name, 'F3 opens the picked item to edit', edit);
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await pg.click('#prodQ'); await pg.keyboard.press('Enter'); await wait(300);
ok(await pg.evaluate(() => (document.getElementById('pname') || {}).value) === r[sel].name, 'Enter in the search box edits the picked item too');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// F2
await pg.evaluate(() => document.activeElement.blur()); await pg.keyboard.press('F2'); await wait(300);
ok(await pg.evaluate(() => !!document.getElementById('pname') && document.getElementById('pname').value === ''), 'F2 adds a new product');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// Del on a product never sold
const nid = await pg.evaluate(() => { const S = window.eval('S'); const p = { ...S.products[0], id: 990777, num: '990777', code: '990777', barcode: '990777', name: 'Grid Delete Test', short: '' }; S.products.push(p); window.eval('PR').sel = null; window.eval('prodQ=""'); window.eval('render')(); return p.id });
await pg.click('#prodQ'); await pg.keyboard.type('Grid Delete Test'); await wait(150);
await pg.evaluate(() => document.activeElement.blur()); await pg.keyboard.press('Delete'); await wait(300);
ok(await pg.evaluate(id => window.eval('S').products.some(p => p.id === id) && !document.querySelector('.pr-acts .pu-del'), nid), 'the list has no Delete — no button, and the Del key does nothing');
// deleting, from the product itself: someone who is not an admin asks; an admin approves and it goes
await pg.evaluate(() => { const S = window.eval('S'); window.__u = S.user; S.user = { ...S.user, name: 'Del Tester', role: 'Manager', perms: ['approve', 'products_view'] } });
await pg.evaluate(id => window.eval('productModal')(id, { pu: true }), nid); await wait(300);
await pg.click('#puDel'); await wait(300);
const asked = await pg.evaluate(id => { const a = (window.eval('S').approvals || [])[0]; return { kind: a && a.kind, status: a && a.status, id: a && a.id, still: window.eval('S').products.some(p => p.id === id) } }, nid);
ok(asked.kind === 'prodDel' && asked.status === 'pending' && asked.still, 'a Manager deleting an item: sent for approval, the item stays', JSON.stringify(asked));
await pg.evaluate(id => window.eval('decideApproval')(id, true, ''), asked.id); await wait(200);
ok(await pg.evaluate(id => window.eval('S').products.some(p => p.id === id), nid), 'the Manager cannot approve it');
await pg.evaluate(id => { window.eval('S').user = window.__u; window.eval('decideApproval')(id, true, '') }, asked.id); await wait(200);
ok(await pg.evaluate(id => !window.eval('S').products.some(p => p.id === id), nid), 'an Admin approves: the item is deleted');
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('go')('inventory') }); await wait(200);
// F5
await pg.click('#prCat'); await pg.keyboard.type('zzzz'); await wait(100);
await pg.keyboard.press('F5'); await wait(300);
const after = await pg.evaluate(() => ({ q: document.getElementById('prodQ').value, cat: document.getElementById('prCat').value, n: document.querySelectorAll('#prGrid tr[data-pr]').length }));
ok(after.q === '' && after.cat === '' && after.n > 5, 'F5 clears the search and shows everything again', JSON.stringify(after));
await pg.evaluate(() => { window.eval('S').products = JSON.parse(window.__keep); window.eval('render')() });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
