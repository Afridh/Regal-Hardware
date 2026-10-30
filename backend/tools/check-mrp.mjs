// A line sold above its MRP shows no MRP — on the A5 bill, the 80mm receipt, the Bills page and the till;
// a line sold at or under its MRP still shows it.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-mrp.mjs
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
pg.on('request', rq => { if (/:41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});

// two items, MRP 1,234.00 and 5,678.00: the first sold above it (1,500.00), the second under it (5,000.00)
const r = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'), ps = S.products.filter(x => x.active !== false && x.stock > 5).slice(0, 2);
  ps[0].mrp = 1234; ps[1].mrp = 5678;
  const inv = window.eval('completeSale')({ lines: [{ pid: ps[0].id, qty: 1, price: 1500, disc: 0 }, { pid: ps[1].id, qty: 1, price: 5000, disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: 6500 }], override: true });
  const a5 = window.eval('billHtml')(inv, 'a5'), r80 = window.eval('billHtml')(inv, 'r80');
  window.eval('billSel=' + JSON.stringify(inv.no)); window.eval("billType='all'"); window.eval('go')('bills');
  return { a5, r80, page: document.querySelector('.bl-lines') ? document.querySelector('.bl-lines').innerText : '' };
});
ok(!r.a5.includes('1,234.00') && r.a5.includes('5,678.00'), 'A5 bill: no MRP beside the line sold above it; the MRP still shows on the line sold under it');
ok(!r.r80.includes('1,234.00') && r.r80.includes('5,678.00'), '80mm receipt: the same');
ok(!r.page.includes('1,234.00') && r.page.includes('5,678.00'), 'Bills page: the same');
// the till: keying the first item above its MRP blanks the MRP in the entry row
const till = await pg.evaluate(() => {
  const S = window.eval('S'), p = S.products.find(x => x.mrp === 1234); S.pos.lines = []; window.eval('go')('pos'); window.eval('csStart')(p.id);
  const pf = document.querySelector('#csPrice'); pf.value = '1500'; pf.dispatchEvent(new Event('input'));
  const above = document.querySelector('#tbMrp').textContent;
  pf.value = '1200'; pf.dispatchEvent(new Event('input'));
  return { above, under: document.querySelector('#tbMrp').textContent };
});
ok(till.above === '—' && /1,234\.00/.test(till.under), 'the till: priced above the MRP the MRP shows —, at or under it the MRP shows', JSON.stringify(till));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
