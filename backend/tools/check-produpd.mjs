// The product updater: the form on the left, the product records on the right (like the old SePOS screen).
//  · "Add a product" opens it; the records list has the newest item on top
//  · Save adds the product and leaves the updater open and empty, the new item now on top of the list
//  · clicking a record loads it; a price changed and saved is kept
//  · Ctrl+F finds a record, Enter loads it
//  · Delete item removes a product never bought or sold
//  · "Simple form" goes back to the one-product form, and "Updater view" returns
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-produpd.mjs
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
const NAME = 'Updater Test Hinge ' + Date.now().toString(36).slice(-4);
const otherModals = () => pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => { if (!m.querySelector('.pu-box')) m.remove() }));
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const C = window.eval('CFG'); delete C.prodForm; window.eval('go')('inventory'); window.eval('render')() });
await pg.evaluate(() => document.querySelector('[data-act="newProd"]').click()); await wait(400);
const open = await pg.evaluate(() => { const S = window.eval('S'); const first = document.querySelector('#puList [data-pu]');
  return { box: !!document.querySelector('.pu-box'), rows: document.querySelectorAll('#puList [data-pu]').length, firstId: first && +first.dataset.pu, lastId: S.products[S.products.length - 1].id } });
ok(open.box && open.rows > 3, '"Add a product" opens the updater, with the product records beside the form', JSON.stringify(open));
ok(open.firstId === open.lastId, 'the records list has the newest item on top');
// add one
await pg.type('#pname', NAME); await pg.type('#pretail', '450'); await pg.type('#pcost', '300'); await pg.type('#pmrp', '500');
const marg = await pg.evaluate(() => document.getElementById('puMarg').innerText);
ok(/Margin 33\.3%/.test(marg) && /MRP margin 40\.0%/.test(marg), 'the margins show under the prices', marg.replace(/\n/g, ' '));
await pg.click('#psave'); await wait(600); await otherModals(); await wait(200);
const after = await pg.evaluate(NAME => { const S = window.eval('S'); const np = S.products.find(x => x.name === NAME); const first = document.querySelector('#puList [data-pu]');
  return { added: !!np, id: np && np.id, open: !!document.querySelector('.pu-box'), blank: document.getElementById('pname') && document.getElementById('pname').value === '', top: first && +first.dataset.pu } }, NAME);
ok(after.added && after.open && after.blank, 'Save adds it and the updater stays open, empty for the next', JSON.stringify(after));
ok(after.top === after.id, 'the new item is now on top of the records');
// click a record
await pg.click(`#puList [data-pu="${after.id}"]`); await wait(400);
const loaded = await pg.evaluate(() => ({ name: document.getElementById('pname').value, on: !!document.querySelector('#puList tr.on'), del: !!document.getElementById('puDel') }));
ok(loaded.name === NAME && loaded.on, 'clicking a record loads it into the form', JSON.stringify(loaded));
await pg.evaluate(() => { const i = document.getElementById('pretail'); i.value = '475'; i.dispatchEvent(new Event('input', { bubbles: true })) });
await pg.keyboard.down('Control'); await pg.keyboard.press('s'); await pg.keyboard.up('Control'); await wait(600); await otherModals();
const price = await pg.evaluate(NAME => { const S = window.eval('S'); const p = S.products.find(x => x.name === NAME); const ap = (S.approvals || []).find(a => a.kind === 'prodPrice' && a.status === 'pending' && a.data && a.data.pid === p.id);
  return { retail: p.retail, waiting: !!ap, open: !!document.querySelector('.pu-box') } }, NAME);
ok((price.retail === 475 || price.waiting) && price.open, 'Ctrl+S saves the new price (or sends it for approval) and the updater stays open', JSON.stringify(price));
// Ctrl+F, type, Enter
await pg.keyboard.down('Control'); await pg.keyboard.press('f'); await pg.keyboard.up('Control'); await wait(100);
const focused = await pg.evaluate(() => document.activeElement && document.activeElement.id);
ok(focused === 'puQ', 'Ctrl+F goes to the records search', focused);
await pg.keyboard.type(NAME.split(' ').slice(-1)[0] + ' hinge updater'); await wait(200); await pg.keyboard.press('Enter'); await wait(400);
const found = await pg.evaluate(() => document.getElementById('pname').value);
ok(found === NAME, 'typing words in any order and Enter loads the item', found);
// delete it (never bought or sold)
await pg.click('#puDel'); await wait(500); await otherModals();
const gone = await pg.evaluate(NAME => ({ gone: !window.eval('S').products.some(x => x.name === NAME), open: !!document.querySelector('.pu-box') }), NAME);
ok(gone.gone && gone.open, 'Delete item removes a product never bought or sold', JSON.stringify(gone));
// simple form and back
await pg.click('#puSimple'); await wait(400);
const simple = await pg.evaluate(() => ({ pu: !!document.querySelector('.pu-box'), next: !!document.getElementById('pnext'), cfg: window.eval('CFG').prodForm }));
ok(!simple.pu && simple.next && simple.cfg === 'simple', '"Simple form" goes back to the one-product form', JSON.stringify(simple));
await pg.click('#puOn'); await wait(400);
const back = await pg.evaluate(() => ({ pu: !!document.querySelector('.pu-box'), cfg: window.eval('CFG').prodForm }));
ok(back.pu && back.cfg === 'updater', '"Updater view" brings it back', JSON.stringify(back));
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('persist')(true) }); await wait(800);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
