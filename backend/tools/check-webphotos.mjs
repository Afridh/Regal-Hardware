// Photos from the web (15 Nov 2026, the owner: "get all paint products' images from their company website, and show the
// real photo on the shelf"):
//  · the server fetches a picture from a public web address and hands it back; it refuses the shop's own network,
//    a web page that is not a picture, and anything that is not http(s)
//  · the 📷 Photos window lists a kind of goods, the ones without a photo; Find the photo opens a picture search for it
//  · the picture's address pasted on a row → saved as the product's photo; a picture pasted (Ctrl+V) on a row → the same
//  · the shelf then shows the real photo for that product
// Needs the internet (it fetches one sample picture). Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-webphotos.mjs [folder for screenshots]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const SAMPLE = 'https://www.gstatic.com/webp/gallery/1.jpg';     // a public sample picture
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(2000);
const shot = async n => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, n + '.png') }) };
const ask = (url) => pg.evaluate(async url => { const r = await fetch('/api/shop/fetch-image', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + regalBridge.token() }, body: JSON.stringify({ url }) }); const j = await r.json().catch(() => ({})); return { status: r.status, ok: !!j.dataUrl, type: (j.dataUrl || '').slice(0, 20), error: j.error || '' } }, url);
// the server's fetch
let r = await ask(SAMPLE);
ok(r.status === 200 && r.ok && /^data:image\/jpeg/.test(r.type), 'a public picture: fetched and handed back', JSON.stringify(r));
r = await ask('http://127.0.0.1:4010/api/health');
ok(r.status === 400 && /public web/.test(r.error), 'the shop\'s own server: refused', r.error);
r = await ask('http://192.168.1.1/x.jpg');
ok(r.status === 400 && /public web/.test(r.error), 'the shop\'s own network: refused', r.error);
r = await ask('https://example.com/');
ok(r.status === 400 && /web page, not a picture/.test(r.error), 'a web page, not a picture: refused, with words saying so', r.error);
r = await ask('file:///C:/Windows/win.ini');
ok(r.status === 400 && /http/.test(r.error), 'not http(s): refused', r.error);
const noTok = await pg.evaluate(async () => (await fetch('/api/shop/fetch-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://www.gstatic.com/webp/gallery/1.jpg' }) })).status);
ok(noTok === 401 || noTok === 403, 'without signing in: refused', String(noTok));
// the window, from the shelf page
const pick = await pg.evaluate(async () => { const S = window.eval('S'); const two = S.products.filter(p => p.active !== false && p.id !== window.eval('OPEN_PID') && p.cat === (S.products.find(x => /paint/i.test(x.cat || '')) || S.products[0]).cat).slice(0, 2);
  for (const p of two) await fetch('/api/shop/media/' + encodeURIComponent('p:' + p.id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + regalBridge.token() } });   // start with no photo
  window.eval('shopMediaAt=0'); window.eval('loadShopMedia')(); window.eval('go')('shelf'); window.eval('SHF').cat = two[0].cat; window.eval('render')(); return { cat: two[0].cat, a: two[0], b: two[1] } });
await wait(800);
ok(!!(await pg.$('[data-act="shelfPics"]')), 'the shelf page has a 📷 Photos button (for staff)');
await pg.click('[data-act="shelfPics"]'); await wait(500);
const win = await pg.evaluate(() => ({ cat: (document.querySelector('#wphCat') || {}).value, rows: [...document.querySelectorAll('.wph-row')].map(r => +r.dataset.wrow), find: [...document.querySelectorAll('.wph-row')].map(r => r.querySelector('a[target=_blank]').href) }));
ok(win.cat === pick.cat && win.rows.includes(pick.a.id) && win.rows.includes(pick.b.id), 'the window lists that kind of goods, the ones without a photo', `${win.cat}: ${win.rows.length} rows`);
{ const f = win.find[win.rows.indexOf(pick.a.id)] || ''; ok(/google\.com\/search\?tbm=isch&q=/.test(f) && f.includes(encodeURIComponent(pick.a.name)), 'Find the photo opens a picture search for that product', f.slice(0, 100)); }
await shot('wph-1');
// 1) the address pasted on a row, then Save
await pg.type(`[data-wurl="${pick.a.id}"]`, SAMPLE); await pg.click(`[data-wsave="${pick.a.id}"]`);
await pg.waitForFunction(id => window.eval('hasPic')('p:' + id), { timeout: 20000 }, pick.a.id).catch(() => {});
ok(await pg.evaluate(id => window.eval('hasPic')('p:' + id), pick.a.id), 'the picture\'s address pasted and saved: it is the product\'s photo now');
// 2) a picture copied and pasted (Ctrl+V) on a row
await pg.evaluate(async id => {
  const c = document.createElement('canvas'); c.width = 120; c.height = 90; const g = c.getContext('2d'); g.fillStyle = '#AE1E2B'; g.fillRect(0, 0, 120, 90); g.fillStyle = '#fff'; g.fillRect(30, 20, 60, 50);
  const blob = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'copied.png', { type: 'image/png' }));
  document.querySelector(`[data-wrow="${id}"]`).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  document.querySelector(`[data-wrow="${id}"]`).dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
}, pick.b.id);
await pg.waitForFunction(id => window.eval('hasPic')('p:' + id), { timeout: 20000 }, pick.b.id).catch(() => {});
ok(await pg.evaluate(id => window.eval('hasPic')('p:' + id), pick.b.id), 'a picture pasted (Ctrl+V) on its row: saved as that product\'s photo');
await shot('wph-2');
// the shelf shows the real photos
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove())); await pg.evaluate(() => window.eval('render')()); await wait(800);
const shelf = await pg.evaluate(ids => ids.map(id => { const c = document.querySelector(`.shf-prod[data-id="${id}"] img`); return !!(c && c.complete && c.naturalWidth > 0) }), [pick.a.id, pick.b.id]);
ok(shelf.every(Boolean), 'the shelf shows the real photo for both', JSON.stringify(shelf));
await shot('wph-shelf');
// tidy: take the test photos off
await pg.evaluate(async ids => { for (const id of ids) await fetch('/api/shop/media/' + encodeURIComponent('p:' + id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + regalBridge.token() } }) }, [pick.a.id, pick.b.id]);
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
