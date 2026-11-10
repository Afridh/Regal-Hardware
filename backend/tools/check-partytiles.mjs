// The Customers and Suppliers pages in the "Tiles" look (chosen 10 Nov 2026, demo 5):
//  · a dark list with Customers | Suppliers at the top and a debt bar under each name that owes
//  · the name card, every button in one row, the figure tiles, the unpaid bills oldest first
//  · ticking bills and pressing Take payment / Pay (or F7) opens the payment window with those bills ticked
//  · nothing ticked: the window opens with none ticked (the oldest are settled first, as before)
// Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-partytiles.mjs [folder for screenshots]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010';
const SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
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
await pg.waitForFunction(() => window.eval('S').customers.length > 2, { timeout: 30000 }); await wait(1200);
const shot = async n => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, n + '.png') }) };

// a customer with three unpaid bills
const cid = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval("CFG.print.agent=''"); window.eval('CFG').msg.autoBill = false;
  const S = window.eval('S'), tag = 'PTX' + Date.now().toString(36).slice(-4).toUpperCase();
  const c = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: tag, name: tag + ' Builders', phone: '0700000031', level: 'retail', limit: 500000 }; S.customers.push(c);
  const p = S.products.find(x => +x.retail > 100 && x.id !== window.eval('OPEN_PID')); p.stock = Math.max(+p.stock || 0, 100);
  for (const q of [1, 2, 3]) window.eval('completeSale')({ lines: [{ pid: p.id, qty: q, price: +p.retail, disc: 0 }], customerId: c.id, pays: [], type: 'CREDIT', override: true });
  window.eval('custQ=""; custFilter="all"; custSel=' + c.id); window.eval('go')('customers'); return c.id;
});
await wait(500);
const look = await pg.evaluate(() => ({
  dark: getComputedStyle(document.querySelector('.cu-list')).backgroundColor, kind: [...document.querySelectorAll('.pt-kind button')].map(x => x.textContent + (x.classList.contains('on') ? '*' : '')).join('|'),
  top: (document.querySelector('.pt-top h2') || {}).textContent || '', btns: document.querySelectorAll('.pt-ribbon .pt-b').length, svg: document.querySelectorAll('.pt-ribbon .pt-b svg').length,
  tiles: [...document.querySelectorAll('.pt-tile small')].map(x => x.textContent), out: (document.querySelector('.pt-tile.r b') || {}).textContent || '',
  bills: [...document.querySelectorAll('.pt-bl')].map(x => x.dataset.no), bars: document.querySelectorAll('.cu-row .pt-rb').length,
  owed: window.eval('partyBal')('C', window.eval('custSel')), fmt: window.eval('fmt')(window.eval('partyBal')('C', window.eval('custSel')))
}));
ok(look.dark === 'rgb(29, 33, 37)' && look.kind === 'Customers*|Suppliers', 'the list is dark, with Customers | Suppliers on top', look.dark + ' ' + look.kind);
ok(look.bars > 0, 'a debt bar under the names that owe', String(look.bars));
ok(/PTX.* Builders/.test(look.top) && look.btns >= 10 && look.svg === look.btns, 'the name card, and every button in one row with a picture', `${look.btns} buttons`);
ok(look.tiles.slice(0, 3).join('|') === 'Outstanding|Credit limit|Last payment' && look.tiles.includes('Bought in all') && look.out === look.fmt, 'the tiles: outstanding (as the ledger), limit, last payment, bought in all', look.tiles.join(', ') + ' · ' + look.out);
ok(look.bills.length === 3, 'the three unpaid bills, with tick boxes', look.bills.join(', '));
await shot('cust-tiles');

// nothing ticked → the window opens with none ticked
await pg.click('.pt-pay'); await wait(300);
let picked = await pg.evaluate(() => [...document.querySelectorAll('.modal [data-pick]:checked')].map(x => x.dataset.pick));
ok(!!(await pg.$('.modal #ra')) && picked.length === 0, 'nothing ticked: Take payment opens with no bill ticked (the oldest go first)');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// tick the 1st and 3rd → the bar adds them up → the window opens with them ticked
await pg.click(`.pt-bl[data-no="${look.bills[0]}"]`); await wait(150); await pg.click(`.pt-bl[data-no="${look.bills[2]}"]`); await wait(200);
const bar = await pg.evaluate(() => ({ t: document.querySelector('.pt-payb').innerText.replace(/\s+/g, ' '), on: [...document.querySelectorAll('.pt-bl.t')].map(x => x.dataset.no) }));
ok(bar.on.length === 2 && /2 bills ticked/.test(bar.t), 'two ticked, and the bar says so with their total', bar.t);
await shot('cust-ticked');
await pg.keyboard.press('F7'); await wait(300);
picked = await pg.evaluate(() => [...document.querySelectorAll('.modal [data-pick]:checked')].map(x => x.dataset.pick));
ok(picked.length === 2 && picked.includes(look.bills[0]) && picked.includes(look.bills[2]), 'F7 opens the payment window with those two ticked', picked.join(', '));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// another customer: the ticks do not follow
await pg.evaluate(() => { const S = window.eval('S'), o = S.customers.find(x => x.id !== 1 && x.id !== window.eval('custSel')); window.eval('custSel=' + o.id); window.eval('render')() });
ok((await pg.evaluate(() => window.eval('ptTicked')('C', window.eval('custSel')).length)) === 0, 'another customer: nothing ticked for them');
// clicking the bill number opens the bill, it does not tick it
await pg.evaluate(id => { window.eval('custSel=' + id); window.eval('render')() }, cid); await wait(200);
await pg.click('.pt-bl .pt-no a'); await wait(300);
ok(!!(await pg.$('.modal')), 'the bill number opens the bill');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// suppliers: the same look, and Pay opens with the ticked bill
await pg.click('.pt-kind button[data-view="suppliers"]'); await wait(500);
const sup = await pg.evaluate(() => {
  const S = window.eval('S'), s = S.suppliers.find(x => S.purchases.some(p => p.supplierId === x.id && p.total - p.paid > 0.005));
  if (s) { window.eval('supQ=""; supFilter="all"; supSel=' + s.id); window.eval('render')() }
  return { view: S.view, has: !!s, kind: [...document.querySelectorAll('.pt-kind button.on')].map(x => x.textContent).join(), btn: (document.querySelector('.pt-b.main') || {}).innerText || '' };
});
await wait(300);
const sbills = await pg.evaluate(() => [...document.querySelectorAll('.pt-bl')].map(x => x.dataset.no));
ok(sup.view === 'suppliers' && sup.kind === 'Suppliers' && /Pay supplier/.test(sup.btn), 'Suppliers: the switch on top opens it, Pay supplier first in the row', JSON.stringify(sup));
await shot('sup-tiles');
if (sup.has && sbills.length) {
  await pg.click(`.pt-bl[data-no="${sbills[0]}"]`); await wait(200); await pg.click('.pt-pay'); await wait(300);
  const sp = await pg.evaluate(() => [...document.querySelectorAll('.modal [data-sbill]:checked')].map(x => x.dataset.sbill));
  ok(sp.length === 1 && sp[0] === sbills[0], 'Suppliers: Pay opens with the ticked bill ticked', sp.join(', '));
  await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
} else ok(true, 'Suppliers: no supplier owing in the sample books — tick test skipped');

ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
