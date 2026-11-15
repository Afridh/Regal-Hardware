// The phone till, one step at a time (15 Nov 2026, the owner chose demo 3b: "only a small way to add an item"):
//  · step 1, Items: one small bar — the camera button, and a box where a few letters bring up the items to tap
//  · step 2, Customer: Walk-in, the customers billed lately, Find another — one tap each
//  · step 3, Payment: what is on the bill, who it is for, the total; Cash / Card / Bank / On their account, and Exact cash
//  · ← goes back a step; an empty bill is always on step 1
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
await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(2500);
const shot = async n => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, n + '.png') }) };
const tap = (sel) => pg.evaluate(sel => { const e = document.querySelector(sel); if (e) e.click(); return !!e }, sel);
const clearPrice = async () => { if (await pg.$('#pcaUse')) { await pg.click('#pcaUse'); await wait(300); } };
// a customer billed a moment ago, so they are a "recent" one
const c = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval("CFG.print.agent=''"); window.eval('CFG').msg.autoBill = false;
  const S = window.eval('S'), tag = 'PS' + Date.now().toString(36).slice(-4).toUpperCase();
  const cu = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: tag, name: tag + ' Hardware Stores', phone: '0700000051', level: 'retail', limit: 500000 }; S.customers.push(cu);
  const p = S.products.find(x => +x.retail > 100 && x.id !== window.eval('OPEN_PID') && /[a-z]{4}/i.test(x.name)); p.stock = Math.max(+p.stock || 0, 100);
  window.eval('completeSale')({ lines: [{ pid: p.id, qty: 1, price: +p.retail, disc: 0 }], customerId: cu.id, pays: [{ method: 'CASH', amount: +p.retail }], override: true });
  S.pos.lines = []; S.pos.customer = null; window.eval('go')('pos'); return { id: cu.id, name: cu.name, code: p.barcode || p.num || p.code, pid: p.id, word: p.name.split(/\s+/).find(w => /^[a-z]{4,}$/i.test(w)).slice(0, 4).toLowerCase() };
});
await wait(400);
const state = () => pg.evaluate(() => ({ step: window.eval('PH').step, on: (document.querySelector('.ph3-steps .on') || {}).textContent || '', lines: window.eval('S').pos.lines.length, cust: window.eval('S').pos.customer,
  go: (document.querySelector('.ph-bar .go') || {}).textContent || '', goOff: !!(document.querySelector('.ph-bar .go') || {}).disabled }));
// 1 — Items
let s = await state();
ok(s.step === 0 && /Items/.test(s.on) && !!(await pg.$('.ph3-cam')) && !!(await pg.$('#phQ')), 'step 1 (Items): a small bar — the camera button and the add box');
ok(s.goOff && /Add an item first/.test(s.go), 'with nothing on the bill, Next waits', s.go);
await pg.type('#phQ', c.word); await wait(400);
const hits = await pg.evaluate(() => { const h = document.querySelector('.ph3-hits'); return h ? { n: h.querySelectorAll('.ph-hit').length, over: getComputedStyle(h).position === 'absolute' } : null });
ok(hits && hits.n >= 1 && hits.n <= 6 && hits.over, 'a few letters: up to six items drop down under the box', JSON.stringify(hits));
await shot('ph3-search');
await tap('.ph3-hits .ph-hit'); await wait(300);
s = await state();
ok(s.lines === 1 && (await pg.evaluate(() => document.getElementById('phQ').value)) === '' && !(await pg.$('.ph3-hits')), 'a tap adds it and empties the box, ready for the next', String(s.lines));
// the camera button opens the scanner; a barcode adds; Done closes
await tap('.ph3-cam'); await wait(1200);
ok(!!(await pg.$('.scan')), 'the camera button opens the scanner');
await pg.evaluate(code => window.eval('scanHit')(String(code)), c.code); await wait(300);
s = await state();
ok(s.lines === 1 && (await pg.evaluate(() => window.eval('S').pos.lines[0].qty)) === 2, 'a barcode read adds it (the same item twice: 2 of it)');
await tap('.scan [data-scan="done"]'); await wait(500);
ok(!(await pg.$('.scan')), 'Done closes the scanner, back on the bill');
await shot('ph3-items');
// 2 — Customer
await tap('.ph-bar .go'); await wait(300);
s = await state();
const who = await pg.evaluate(() => [...document.querySelectorAll('.ph3-big')].map(x => (x.querySelector('b') || {}).textContent + (x.classList.contains('on') ? '*' : '')));
ok(s.step === 1 && /Customer/.test(s.on) && who[0] === 'Walk-in customer*' && /Find another/.test(who[who.length - 1]), 'step 2 (Customer): Walk-in (picked), recent ones, Find another', JSON.stringify(who));
ok(who.some(w => w.startsWith(c.name)), 'the customer billed a moment ago is there, one tap', c.name);
await pg.evaluate(id => document.querySelector(`.ph3-big[data-id="${id}"]`).click(), c.id); await wait(300); await clearPrice();
s = await state();
ok(s.cust === c.id && (await pg.evaluate(id => document.querySelector(`.ph3-big[data-id="${id}"]`).classList.contains('on'), c.id)), 'one tap: they are on the bill, marked ✓');
await shot('ph3-who');
await tap('.ph3-big.find'); await wait(300);
ok(!!(await pg.$('.modal #cq')), 'Find another customer opens the search');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove())); await wait(200);
// 3 — Payment
await tap('.ph-bar .go'); await wait(300);
s = await state();
const sum = await pg.evaluate(() => (document.querySelector('.ph3-sum') || {}).innerText || '');
ok(s.step === 2 && /Payment/.test(s.on) && sum.includes(c.name) && /Total/.test(sum), 'step 3 (Payment): the lines, who it is for and the total', sum.replace(/\s+/g, ' ').slice(0, 120));
ok(!(await pg.evaluate(() => document.querySelector('[data-w="CREDIT"]').disabled)), 'On their account can be pressed (a customer is on the bill)');
await shot('ph3-how');
// back, to walk-in, forward: On their account is off
await tap('.ph3-nav .back'); await wait(200);
ok((await state()).step === 1, '← goes back a step');
await tap('[data-act="phWalk"]'); await wait(300); await clearPrice();
await tap('.ph-bar .go'); await wait(300);
ok(await pg.evaluate(() => document.querySelector('[data-w="CREDIT"]').disabled), 'walk-in: On their account cannot be pressed');
// Exact cash: the payment window with the whole amount taken in cash
await tap('[data-act="phWay"][data-w="EXACT"]'); await wait(600);
const pay = await pg.evaluate(() => { const m = [...document.querySelectorAll('.modal')].pop(); return m ? { left: (m.querySelector('#payLeft') || {}).textContent || '', words: m.innerText.replace(/\s+/g, ' ').slice(0, 300) } : null });
ok(pay && /All taken|0\.00/.test(pay.words), 'Exact cash: the payment window opens with it all taken in cash', pay && pay.words.slice(0, 120));
await shot('ph3-pay');
// the bill cleared: back on step 1
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); S.pos.lines = []; S.pos.customer = null; window.eval('render')() }); await wait(200);
ok((await state()).step === 0, 'an empty bill is on step 1 again');
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
