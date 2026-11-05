// The prices on a product (5 Nov 2026): MRP first, then cost, then selling price, the boxes in line, and 35/ in the cost or
// the selling price takes 35% off the MRP.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-mrpcost.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
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
const val = id => pg.$eval('#' + id, e => e.value), focus = () => pg.evaluate(() => document.activeElement.id);
for (const view of ['updater', 'simple']) {
  await pg.evaluate(v => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('CFG').prodForm = v; window.eval('go')('inventory'); window.eval('productModal')(null) }, view); await wait(500);
  const order = await pg.evaluate(() => [...document.querySelectorAll('.pm-s-price .pm-g4 input')].map(i => i.id));
  ok(order.slice(0, 3).join() === 'pmrp,pcost,pretail', `${view}: MRP first, then cost, then selling price`, order.join());
  const x = await pg.evaluate(() => { const c = document.getElementById('pmOff'), r = c.getBoundingClientRect(); return { txt: c.innerText, seen: r.height > 0 } });
  ok(/35\/ in Cost or Selling price/.test(x.txt) && x.seen, `${view}: a line says how`, x.txt);
  // the boxes in line: the same top, height and width, and the labels one line each
  const box = await pg.evaluate(() => ['pmrp', 'pcost', 'pretail', 'pwhole'].map(id => { const i = document.getElementById(id), r = i.getBoundingClientRect(), l = i.closest('.f').querySelector('label'), lr = l.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), lab: Math.round(lr.height), font: getComputedStyle(i).fontSize } }));
  ok(new Set(box.map(b => b.top)).size === 1 && new Set(box.map(b => b.h)).size === 1 && new Set(box.map(b => b.w)).size === 1 && new Set(box.map(b => b.font)).size === 1 && new Set(box.map(b => b.lab)).size === 1, `${view}: all four boxes in line, the same size`, JSON.stringify(box[0]));
  await pg.focus('#pname'); await pg.keyboard.type('Test item'); await pg.keyboard.press('Enter');
  ok(await focus() === 'pmrp', `${view}: Enter from the name goes to the MRP`);
  await pg.keyboard.type('1000'); await pg.keyboard.press('Enter');
  ok(await focus() === 'pcost', `${view}: then to the cost`);
  await pg.keyboard.type('35/'); await wait(100);
  ok(await val('pcost') === '650.00', `${view}: 35/ makes the cost 650 from an MRP of 1,000`, await val('pcost'));
  await pg.keyboard.type('12.5/'); await wait(100);
  ok(await val('pcost') === '875.00', `${view}: typing over it, 12.5/ makes it 875`, await val('pcost'));
  await pg.keyboard.press('Enter');
  ok(await focus() === 'pretail', `${view}: then Enter to the selling price`);
  await pg.keyboard.type('20/'); await wait(100);
  ok(await val('pretail') === '800.00', `${view}: 20/ in the selling price makes it 800 from an MRP of 1,000`, await val('pretail'));
  await pg.keyboard.type('10/'); await wait(100);
  ok(await val('pretail') === '900.00', `${view}: typing over it, 10/ makes it 900`, await val('pretail'));
  if (view === 'updater') { const m = await pg.$eval('#puMarg', e => [...e.children].map(c => c.innerText)); ok(/^MRP margin/.test(m[0]) && /^Margin/.test(m[2]) && /^W\/S/.test(m[3]), 'each figure sits under its own box', m.join(' | ')); }
  if (process.env.SHOT) { await pg.setViewport({ width: 1366, height: 1300 }); await wait(250); await (await pg.$('.pm-s-price')).screenshot({ path: `${process.env.SHOT}/prices-${view}.png` }); await pg.setViewport({ width: 1366, height: 768 }); await wait(150) }
  await pg.keyboard.type('1000'); await wait(100);
  ok(/Profit/.test(await pg.$eval('#pmarg', e => e.innerText)), `${view}: the profit follows the worked-out cost`, (await pg.$eval('#pmarg', e => e.innerText)).replace(/\s+/g, ' ').slice(0, 60));
  // no MRP yet: says so, changes nothing
  await pg.evaluate(() => { document.getElementById('pmrp').value = ''; const c = document.getElementById('pcost'); c.value = ''; c.focus() }); await pg.keyboard.type('35/'); await wait(100);
  ok(await focus() === 'pmrp' && await val('pcost') === '35', `${view}: no MRP yet: it goes to the MRP box and the 35 stays as typed`, await val('pcost'));
  await pg.evaluate(() => { document.getElementById('pcost').value = ''; document.getElementById('pmrp').value = '500'; document.getElementById('pcost').focus() }); await pg.keyboard.type('/'); await wait(100);
  ok(await val('pcost') === '', `${view}: / with no percentage does nothing`);
}
// saved as worked out
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('CFG').prodForm = 'simple'; window.eval('productModal')(null) }); await wait(400);
const nm = 'Mrp Cost Test ' + Date.now();
await pg.focus('#pname'); await pg.keyboard.type(nm); await pg.keyboard.press('Enter'); await pg.keyboard.type('200'); await pg.keyboard.press('Enter'); await pg.keyboard.type('25/'); await pg.keyboard.press('Enter'); await pg.keyboard.type('180'); await wait(100);
await pg.click('#psave'); await wait(600);
const saved = await pg.evaluate(n => { const p = window.eval('S').products.find(x => x.name === n); return p && { mrp: p.mrp, cost: p.cost, retail: p.retail, id: p.id } }, nm);
ok(saved && saved.mrp === 200 && saved.cost === 150 && saved.retail === 180, 'saved: MRP 200, cost 150 (25% off), selling price 180', JSON.stringify(saved));
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); delete window.eval('CFG').prodForm });
if (saved) await pg.evaluate(id => { const S = window.eval('S'); S.products = S.products.filter(p => p.id !== id); S.movements = S.movements.filter(x => x.pid !== id); window.eval('persist')(true) }, saved.id);
await wait(1200);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
