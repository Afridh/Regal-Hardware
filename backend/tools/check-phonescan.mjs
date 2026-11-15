// The phone till, "Scan and go" (15 Nov 2026, the owner chose demo 2, "with an easy way to pick the customer"):
//  · the customer is one tap: Walk-in, the last few customers billed as buttons, or Find… for anybody else
//  · a customer picked shows as a card with what they owe, Change, and × back to walk-in
//  · the camera sits in the box at the top of the till: tapped, it opens there (not over the whole screen)
//    and stays open while items go on the bill underneath; ✕ closes it; Pay closes it too
// A phone-sized browser with Chrome's pretend camera. Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-phonescan.mjs [folder for screenshots]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const pg = await b.newPage(); await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button') || document.querySelector('.ph'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(1200);
const shot = async n => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, n + '.png') }) };
// a customer billed a moment ago, so they are a "recent" one
const c = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval("CFG.print.agent=''"); window.eval('CFG').msg.autoBill = false;
  const S = window.eval('S'), tag = 'PS' + Date.now().toString(36).slice(-4).toUpperCase();
  const cu = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: tag, name: tag + ' Hardware Stores', phone: '0700000051', level: 'retail', limit: 500000 }; S.customers.push(cu);
  const p = S.products.find(x => +x.retail > 100 && x.id !== window.eval('OPEN_PID')); p.stock = Math.max(+p.stock || 0, 100);
  window.eval('completeSale')({ lines: [{ pid: p.id, qty: 1, price: +p.retail, disc: 0 }], customerId: cu.id, pays: [{ method: 'CASH', amount: +p.retail }], override: true });
  S.pos.lines = []; S.pos.customer = null; window.eval('go')('pos'); return { id: cu.id, name: cu.name, short: cu.name.split(/\s+/).slice(0, 2).join(' '), code: p.barcode || p.num || p.code, pid: p.id };
});
await wait(400);
const look = () => pg.evaluate(() => ({ phone: !!document.querySelector('.ph2'), chips: [...document.querySelectorAll('.ph2-chips button')].map(x => x.textContent.trim() + (x.classList.contains('on') ? '*' : '')),
  card: (document.querySelector('.ph2-cust.sel .ph2-who') || {}).innerText || '', cust: window.eval('S').pos.customer, cam: !!document.querySelector('#phCam'), scan: !!document.querySelector('.scan') }));
let s = await look();
ok(s.phone && s.chips[0] === 'Walk-in*' && /Find/.test(s.chips[s.chips.length - 1]), 'the customer is a row of buttons: Walk-in (on), recent ones, Find…', JSON.stringify(s.chips));
ok(s.chips.includes(c.short), 'the customer billed a moment ago is one of them', c.short);
await shot('ph2-walkin');
// one tap picks them
await pg.evaluate(id => document.querySelector(`.ph2-chips [data-id="${id}"]`).click(), c.id); await wait(300);
if (await pg.$('#pcaUse')) { await pg.click('#pcaUse'); await wait(300); }
s = await look();
ok(s.cust === c.id && s.card.includes(c.name) && /nothing owing|owes/.test(s.card), 'one tap: they are on the bill, shown as a card with what they owe', s.card.replace(/\n/g, ' · '));
await shot('ph2-cust');
// × back to walk-in
await pg.evaluate(() => document.querySelector('.ph2-cust.sel .x').click()); await wait(300);
if (await pg.$('#pcaUse')) { await pg.click('#pcaUse'); await wait(300); }
s = await look();
ok(!s.cust && s.chips[0] === 'Walk-in*', '× takes the bill back to walk-in');
// Find… opens the customer search
await pg.evaluate(() => document.querySelector('.ph2-chips .find').click()); await wait(300);
ok(!!(await pg.$('.modal #cq')), 'Find… opens the customer search');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove())); await wait(200);
// the camera, in the box at the top
await pg.evaluate(() => document.getElementById('phCam').click()); await wait(1500);
const cam = await pg.evaluate(() => { const s = document.querySelector('.scan'), box = document.getElementById('phCam'); if (!s || !box) return null; const a = s.getBoundingClientRect(), r = box.getBoundingClientRect();
  return { inline: s.classList.contains('inline'), fits: Math.abs(a.top - r.top) < 2 && Math.abs(a.left - r.left) < 2 && Math.abs(a.width - r.width) < 2 && Math.abs(a.height - r.height) < 2, small: a.height < innerHeight / 2, live: !!(s.querySelector('video') && s.querySelector('video').srcObject) } });
ok(cam && cam.inline && cam.fits && cam.small, 'tapped: the camera opens in the box at the top, not over the whole screen', JSON.stringify(cam));
ok(cam && cam.live, 'and the camera is running');
// a barcode read: the item goes on the bill underneath, the camera stays open in the same place
const before = await pg.evaluate(() => document.querySelector('.scan'));
await pg.evaluate(code => window.eval('scanHit')(String(code)), c.code); await wait(400);
const after = await pg.evaluate(() => { const s = document.querySelector('.scan'), box = document.getElementById('phCam'); const a = s && s.getBoundingClientRect(), r = box && box.getBoundingClientRect();
  return { lines: window.eval('S').pos.lines.length, open: !!s, fits: !!(a && r && Math.abs(a.top - r.top) < 2), shown: document.querySelectorAll('.ph-line').length } });
ok(after.lines === 1 && after.shown === 1 && after.open && after.fits, 'a barcode read: the item is on the bill below, and the camera stays open over its box', JSON.stringify(after));
await shot('ph2-scanning');
// a barcode not on file says so on the camera
await pg.evaluate(() => window.eval('scanHit')('0000000000000')); await wait(200);
ok(/No item has the barcode/.test(await pg.evaluate(() => (document.querySelector('.scan .scan-note') || {}).textContent || '')), 'a barcode not on file says so on the camera');
// ✕ closes it
await pg.evaluate(() => document.querySelector('.scan [data-scan="done"]').click()); await wait(500);
s = await look();
ok(!s.scan && s.cam, '✕ closes the camera; the box is back, ready to tap');
// Pay closes it too
await pg.evaluate(() => document.getElementById('phCam').click()); await wait(1200);
await pg.evaluate(() => document.querySelector('.ph-bar .go').click()); await wait(500);
ok(!(await pg.$('.scan')) && !!(await pg.$('.modal')), 'Pay closes the camera and opens the payment');
const tracks = await pg.evaluate(() => window.eval('SCAN') === null);
ok(tracks, 'nothing left holding the camera');
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); S.pos.lines = []; S.pos.customer = null; window.eval('render')() });
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
