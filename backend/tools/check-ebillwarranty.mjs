// The e-bill shows a warranty item's warranty (10 Nov 2026): the period, the day it runs to (from the bill's date),
// and the serial numbers; a line with no warranty shows none. The customer's own page shows it too.
// Nothing is texted and nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-ebillwarranty.mjs [screenshot.png]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => window.eval('S').products.filter(x => +x.retail > 0).length > 5, { timeout: 30000 }); await wait(1500);
const made = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''"); window.printPaper = () => {};
  const S = window.eval('S'), CFG = window.eval('CFG'); CFG.msg.autoBill = false;
  const ps = S.products.filter(x => x.id !== window.eval('OPEN_PID') && +x.retail > 0).slice(0, 2); ps.forEach(p => p.stock = Math.max(+p.stock || 0, 50));
  const c = S.customers.find(x => x.id !== 1);
  const inv = window.eval('completeSale')({ lines: [
    { pid: ps[0].id, qty: 1, price: +ps[0].retail, disc: 0, warranty: '1 YEAR', serials: ['SN-TEST-0001'] },
    { pid: ps[1].id, qty: 3, price: +ps[1].retail, disc: 0 }], customerId: c.id, pays: [{ method: 'CASH', amount: +ps[0].retail + 3 * ps[1].retail }], override: true });
  inv.link = window.eval('billLinkFor')(); window.eval('persist')(true);
  const until = new Date(inv.date + 'T12:00:00'); until.setFullYear(until.getFullYear() + 1);
  return { id: inv.link.split('/').pop(), until: until.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) };
});
await wait(2500);
const api = await (await fetch(BASE + '/api/my/b/' + made.id)).json();
const L = (api.bill || {}).lines || [];
ok(L[0] && L[0].warranty === '1 YEAR' && /^\d{4}-\d\d-\d\d$/.test(L[0].warrantyUntil || '') && (L[0].serials || [])[0] === 'SN-TEST-0001' && L[1] && !L[1].warranty,
  'the e-bill gets the warranty of the warranty line only', JSON.stringify(L.map(l => ({ w: l.warranty, u: l.warrantyUntil, s: l.serials }))));
const ph = await b.newPage(); await ph.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const perrs = []; ph.on('pageerror', e => perrs.push(e.message));
await ph.goto(BASE + '/b/' + made.id, { waitUntil: 'networkidle2' }); await wait(4000);
const v = await ph.evaluate(() => ({ items: document.querySelectorAll('.item').length, w: [...document.querySelectorAll('.item .wr')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
  wide: document.documentElement.scrollWidth > innerWidth + 1 }));
ok(v.items === 2 && v.w.length === 1, 'one line shows a warranty, the other none', JSON.stringify(v));
ok(v.w[0] && v.w[0].includes('Warranty 1 year') && v.w[0].includes('until ' + made.until) && v.w[0].includes('SN-TEST-0001'), 'it reads: Warranty 1 year · until the day · S/N', v.w[0]);
ok(!v.wide, 'nothing runs off the side of a phone');
const wr = await ph.$('.item.w'); if (wr) await wr.scrollIntoView();
await wait(600); await ph.screenshot({ path: process.argv[2] || 'ebill-warranty.png' });
ok(!errs.length && !perrs.length, 'no script errors', errs.concat(perrs).join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
