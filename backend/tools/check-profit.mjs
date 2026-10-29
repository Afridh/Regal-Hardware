// Profit by category, brand and salesman: a bill discount shared across its lines, a brand from the name
// or set on the item, commission at the shop's rate or a person's own.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-profit.mjs [screenshot-dir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});

// two bills on a day nothing else is on (2099-02-01): their profit is known exactly
await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'), CFG = window.eval('CFG'), ps = S.products.filter(p => !p.open);
  const A = ps[0], B = ps[1];
  S.sales = S.sales.filter(s => !/^PRF/.test(s.no));              // a run before this one left its bills
  A.name = 'TOKYO Super Cement 50kg'; A.brand = ''; A.cat = 'Cement Test';
  B.name = 'Weathershield White 4L'; B.brand = 'Dulux'; B.cat = 'Paint Test';
  S.sales.push({ no: 'PRF1', date: '2099-02-01', customerId: 1, type: 'CASH', total: 1800, balance: 0, billDisc: 200, by: 'Afridh', salesman: null,
    lines: [{ pid: A.id, qty: 2, price: 1000, disc: 0, cost: 800 }] });
  S.sales.push({ no: 'PRF2', date: '2099-02-01', customerId: 1, type: 'CASH', total: 500, balance: 0, billDisc: 0, by: 'Afridh', salesman: 'Azhad',
    lines: [{ pid: B.id, qty: 1, price: 500, disc: 0, cost: 300 }] });
  CFG.salesComm = { rate: 10, base: 'profit' };
  const az = S.users.find(u => u.name === 'Azhad'); if (az) az.commRate = 5;
  const af = S.users.find(u => u.name === 'Afridh'); if (af) delete af.commRate;
  window.eval("repFrom = '2099-02-01'"); window.eval("repTo = '2099-02-01'");
});
const report = async (key) => { await pg.evaluate(k => { window.eval(`repKey = '${k}'`); window.eval('go')('reports') }, key); await wait(600);
  return pg.evaluate(() => [...document.querySelectorAll('#main table tr')].map(r => [...r.cells].map(c => c.innerText.trim()))) };

const cat = await report('catprofit');
const cem = cat.find(r => r[0] === 'Cement Test'), pai = cat.find(r => r[0] === 'Paint Test');
ok(!!cem && cem[5] === 'Rs 200.00' && cem[3] === 'Rs 1,800.00', 'Profit by Category: cement 1,800 sold, 200 profit (the bill\'s 200 off shared in)', cem && cem.join(' | '));
ok(!!pai && pai[5] === 'Rs 200.00', 'paint 200 profit');
await pg.screenshot({ path: OUT + '/profit-cat.png' });

const br = await report('brandprofit');
ok(br.some(r => r[0] === 'Tokyo' && r[5] === 'Rs 200.00'), 'Profit by Brand: "Tokyo" from the first word of the name', JSON.stringify(br.find(r => r[0] === 'Tokyo')));
ok(br.some(r => r[0] === 'Dulux' && r[5] === 'Rs 200.00'), 'and "Dulux" as set on the item');

const sp = await report('salesprofit');
if (!sp.length) console.log('salesprofit drew:', (await pg.evaluate(() => document.getElementById('main').innerText)).slice(0, 400));
const af = sp.find(r => r[0] === 'Afridh'), az = sp.find(r => r[0] === 'Azhad');
ok(!!af && af[4] === 'Rs 200.00' && af[6] === '10%' && af[7] === 'Rs 20.00', 'Profit by Salesman: the cashier when nobody is named — 200 profit, 10% → 20.00', af && af.join(' | '));
ok(!!az && az[4] === 'Rs 200.00' && az[6] === '5%' && az[7] === 'Rs 10.00', 'the named salesman at their own 5% → 10.00', az && az.join(' | '));
await pg.screenshot({ path: OUT + '/profit-sales.png' });

// the shop's rate changed on the report
await pg.evaluate(() => { const i = document.querySelector('[data-salescomm="base"]'); i.value = 'sales'; i.dispatchEvent(new Event('change', { bubbles: true })) }); await wait(400);
const sp2 = await pg.evaluate(() => [...document.querySelectorAll('#main table tr')].map(r => [...r.cells].map(c => c.innerText.trim())));
ok(sp2.find(r => r[0] === 'Afridh')?.[7] === 'Rs 180.00', 'on what they sold instead: 10% of 1,800 = 180.00');
await pg.evaluate(() => { window.eval('CFG').salesComm = { rate: 0, base: 'profit' }; window.eval("repFrom = ''"); window.eval("repTo = ''"); window.eval('persist')(true) });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
