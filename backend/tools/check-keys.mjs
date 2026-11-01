// Shortcuts from any page: Alt + letter opens the page, Alt + Shift + letter adds a new one there, Ctrl+/ lists them.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-keys.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
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
const clear = () => pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await clear(); await pg.evaluate(() => window.eval('go')('dashboard')); await wait(200);
const press = async (k, shift) => { await pg.keyboard.down('Alt'); if (shift) await pg.keyboard.down('Shift'); await pg.keyboard.press('Key' + k); if (shift) await pg.keyboard.up('Shift'); await pg.keyboard.up('Alt'); await wait(250) };
const view = () => pg.evaluate(() => window.eval('S').view);
for (const [k, v] of [['P', 'products'], ['C', 'customers'], ['R', 'receipts'], ['S', 'suppliers'], ['K', 'stock'], ['T', 'stocktake'], ['X', 'expenses'], ['B', 'bills']]) {
  await clear(); await press(k); ok(await view() === v, `Alt+${k} opens ${v}`, await view());
}
// on Bills, Alt+L stays with the bill (large print), not Labels
await clear(); await press('L'); ok(await view() === 'bills', 'on Bills, Alt+L is left to the bill picked (not Labels)', await view());
await clear(); await pg.evaluate(() => window.eval('go')('dashboard')); await wait(150);
await press('L'); ok(await view() === 'labels', 'elsewhere, Alt+L opens Barcode labels', await view());
// Alt+Shift adds
await clear(); await press('P', true);
ok(await view() === 'products' && !!(await pg.$('.pm-box #pname')), 'Alt+Shift+P opens Products with the Add a product form');
await clear(); await press('C', true);
ok(await view() === 'customers' && !!(await pg.$('#cmOk')), 'Alt+Shift+C: Add a customer');
// typing in a search box still works with a shortcut
await clear(); await pg.evaluate(() => window.eval('go')('customers')); await wait(200);
const f = await pg.$('#custQ'); if (f) { await f.click(); await pg.keyboard.type('ab') }
await press('S'); ok(await view() === 'suppliers', 'a shortcut works while the cursor is in a search box');
// the list
await clear(); await pg.keyboard.down('Control'); await pg.keyboard.press('Slash'); await pg.keyboard.up('Control'); await wait(250);
const list = await pg.evaluate(() => { const m = document.querySelector('.modal'); return m ? m.innerText : '' });
ok(/Keyboard shortcuts/.test(list) && /Add a product/.test(list) && /Take a customer payment/.test(list), 'Ctrl+/ lists the shortcuts');
await clear();
// the menu shows them
const menu = await pg.evaluate(() => [...document.querySelectorAll('#nav [data-view="products"], #nav [data-view="bills"]')].map(x => x.innerText.replace(/\s+/g, ' ')).join(' | '));
ok(/Alt\+P/.test(menu) && /Alt\+B/.test(menu), 'the side menu shows Alt+P, Alt+B', menu);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
