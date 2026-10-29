// VAT and SSCL: off with no VAT number; with one, both bills show the VAT inside the total and the customer's
// VAT number, the supplier's VAT number makes their bills input VAT, and the monthly return adds up.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-vat.mjs [screenshot-dir]
// Printers are stopped.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
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

// a bill of 11,800 to a business customer, and a supplier's bill of 5,900
const set = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'), CFG = window.eval('CFG');
  CFG.shop.vat = ''; CFG.tax = { rate: 18, sscl: false, ssclRate: 2.5 };
  const c = S.customers.find(x => x.id !== 1); c.limit = 1e8;
  const inv = window.eval('completeSale')({ lines: [{ pid: window.eval('OPEN_PID'), name: 'Roofing sheets', qty: 1, price: 11800, disc: 0, open: true }], customerId: c.id, pays: [{ method: 'CREDIT', amount: 0 }], override: true });
  return { cid: c.id, no: inv.no, sid: S.suppliers[0].id, date: inv.date };
});
const a5Off = await pg.evaluate(no => window.eval('billHtml')(window.eval('S').sales.find(x => x.no === no), 'a5'), set.no);
ok(!/TAX INVOICE/.test(a5Off) && !/excl\. VAT/.test(a5Off), 'no VAT number: an ordinary invoice, no VAT lines');

// the customer's VAT number, through their form
await pg.evaluate(id => window.eval('custModal')(id), set.cid); await wait(300);
await pg.$eval('#cmTin', el => el.value = ''); await pg.type('#cmTin', '114567890-7000'); await pg.click('#cmOk'); await wait(400);
ok(await pg.evaluate(id => window.eval('C')(id).tin, set.cid) === '114567890-7000', 'the customer form keeps their VAT number');
// the supplier's, through theirs
await pg.evaluate(id => window.eval('supModal')(id), set.sid); await wait(300);
await pg.$eval('#smTin', el => el.value = ''); await pg.type('#smTin', '104512345-7000'); await pg.click('#smOk'); await wait(400);
ok(await pg.evaluate(id => window.eval('SU')(id).tin, set.sid) === '104512345-7000', 'the supplier form keeps their VAT number');

// the shop's VAT number, through Settings → Shop details
await pg.evaluate(() => { window.eval("setTab='shop'"); window.eval('go')('settings') }); await wait(600);
await pg.type('[data-set="shop.vat"]', '409876543-7000'); await pg.$eval('[data-set="shop.vat"]', el => el.dispatchEvent(new Event('change'))); await wait(400);
ok(await pg.evaluate(() => window.eval('CFG').shop.vat) === '409876543-7000', 'Settings: the shop\'s VAT number is saved');

const a5 = await pg.evaluate(no => window.eval('billHtml')(window.eval('S').sales.find(x => x.no === no), 'a5'), set.no);
fs.writeFileSync(OUT + '/vat-a5.html', a5);
ok(/TAX INVOICE/.test(a5) && /Value excl\. VAT<\/span><b>10,000\.00/.test(a5) && /VAT 18%<\/span><b>1,800\.00/.test(a5), 'A5: TAX INVOICE, 10,000.00 + VAT 18% 1,800.00 = 11,800');
ok(/VAT No 114567890-7000/.test(a5), 'A5: the customer\'s VAT number under their name');
const r80 = await pg.evaluate(no => window.eval('billHtml')(window.eval('S').sales.find(x => x.no === no), 'r80'), set.no);
ok(/Incl\. VAT 18% Rs\.<\/span><i>:<\/i><b>1,800\.00/.test(r80) && /409876543-7000/.test(r80) && /114567890-7000/.test(r80), '80mm: the VAT inside the total, the shop\'s and the customer\'s VAT numbers');


// the return: this month's sales and the VAT supplier's bill
const ret = await pg.evaluate((sid, date) => {
  const S = window.eval('S');
  const keepS = S.sales, keepP = S.purchases;
  S.sales = S.sales.filter(x => x.date === date && x.total === 11800).slice(0, 1);
  S.purchases = [{ no: 'PUR-T1', date, supplierId: sid, total: 5900, paid: 0, lines: [] }, { no: 'PUR-T2', date, supplierId: -99, total: 1000, paid: 0, lines: [] }];
  window.eval('CFG').tax.sscl = true;
  window.eval("repFrom=''"); window.eval("repTo=''"); window.eval("repKey='vat'");
  let r; try { r = window.eval('reportData')() } catch (e) { r = { err: e.message } }
  S.sales = keepS; S.purchases = keepP;
  return r;
}, set.sid, set.date);
if (ret.err) ok(false, 'the return runs', ret.err);
else {
  const row = ret.rows[0] || [];
  ok(/11,800/.test(row[1]) && /10,000/.test(row[2]) && /1,800/.test(row[3]), 'return: sales 11,800 → 10,000 + output VAT 1,800', row.join(' | '));
  ok(/5,900/.test(row[4]) && /900/.test(row[5]) && /^(Rs\s?)?900/.test(String(row[6]).trim()), 'return: only the VAT supplier\'s 5,900 counts → input 900, payable 900');
  ok(/250/.test(row[7]), 'return: SSCL 2.5% on 10,000 = 250', row[7]);
}
await pg.evaluate(() => { window.eval("repKey='vat'"); window.eval('go')('reports') }); await wait(800);
await pg.screenshot({ path: OUT + '/vat-return.png' });
await pg.evaluate(() => { const C = window.eval('CFG'); C.shop.vat = ''; C.tax.sscl = false; window.eval('persist')(true) });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
