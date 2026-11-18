// A list keeps where it was scrolled to when a row is clicked (18 Nov 2026, the owner: on every click the list was
//   drawn again from the top — customers, suppliers, everywhere). The page drawing again puts each scrolled box back.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010; testshop-snap.mjs restore after)
//   node backend/tools/check-listscroll.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
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
await pg.setViewport({ width: 1280, height: 640 });
// enough customers and suppliers for the lists to scroll
await pg.evaluate(() => { const S = window.eval('S');
  for (let i = 0; i < 60; i++) { S.customers.push({ id: 90000 + i, code: 'LS' + i, name: 'Listscroll Customer ' + String(i).padStart(2, '0'), phone: '', level: 'retail', limit: 0 });
    S.suppliers.push({ id: 90000 + i, code: 'LSS' + i, name: 'Listscroll Supplier ' + String(i).padStart(2, '0'), phone: '' }) } });
for (const [view, act, filt] of [['customers', 'cust', "custFilter='all'; custQ=''"], ['suppliers', 'sup', "supFilter='all'; supQ=''"]]) {
  await pg.evaluate((v, f) => { try { window.eval(f) } catch (e) {} window.eval('go')(v) }, view, filt); await wait(500);
  const box = await pg.evaluate(() => { const b = document.querySelector('#main .cu-rows'); if (!b) return null; b.scrollTop = 600; return { top: b.scrollTop, h: b.scrollHeight, c: b.clientHeight } });
  ok(box && box.top > 100, `${view}: the list scrolls (test set-up)`, JSON.stringify(box));
  // click a row that is on show, low in the list
  const id = await pg.evaluate(a => { const b = document.querySelector('#main .cu-rows'), br = b.getBoundingClientRect();
    const row = [...b.querySelectorAll(`[data-act="${a}"]`)].find(r => { const rr = r.getBoundingClientRect(); return rr.top > br.top + 40 && rr.bottom < br.bottom - 10 }); if (!row) return null; row.click(); return row.dataset.id }, act);
  await wait(400);
  const after = await pg.evaluate(() => { const b = document.querySelector('#main .cu-rows'); return b ? b.scrollTop : -1 });
  ok(id && Math.abs(after - box.top) < 5, `${view}: clicking a customer row keeps the list where it was`.replace('customer', view === 'customers' ? 'customer' : 'supplier'), `${box && box.top} → ${after}`);
  const sel = await pg.evaluate((v) => v === 'customers' ? window.eval('custSel') : window.eval('supSel'), view);
  ok(String(sel) === String(id), `${view}: and that one is picked`, `${id} / ${sel}`);
  // a second click, on another row
  await pg.evaluate(a => { const b = document.querySelector('#main .cu-rows'), br = b.getBoundingClientRect();
    const rows = [...b.querySelectorAll(`[data-act="${a}"]`)].filter(r => { const rr = r.getBoundingClientRect(); return rr.top > br.top + 10 && rr.bottom < br.bottom - 10 }); rows[0] && rows[0].click() }, act); await wait(400);
  const after2 = await pg.evaluate(() => document.querySelector('#main .cu-rows').scrollTop);
  ok(Math.abs(after2 - box.top) < 5, `${view}: and again on the next click`, `${box.top} → ${after2}`);
}
// going to another page still starts at the top there
await pg.evaluate(() => window.eval('go')('customers')); await wait(300);
await pg.evaluate(() => { document.querySelector('#main .cu-rows').scrollTop = 500; window.eval('go')('suppliers') }); await wait(400);
ok(await pg.evaluate(() => document.querySelector('#main .cu-rows').scrollTop === 0), 'another page opens at its top, not where the last one was');
await pg.evaluate(() => { const S = window.eval('S'); S.customers = S.customers.filter(c => c.id < 90000); S.suppliers = S.suppliers.filter(c => c.id < 90000) });
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
