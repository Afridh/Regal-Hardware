// Bills not delivered: NOT DELIVERED on the till (Ctrl+Shift+D) marks the bill; it is found under Bills →
// Not delivered and at the top of Deliveries; Delivered ✓ takes it off; a bill can be put on the list
// afterwards; a driver's delivery of it counts as delivered.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-undelivered.mjs [screenshot-dir]
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

// a phone order: NOT DELIVERED on the till, then billed on account through the till's own finish
const set = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S');
  S.sales.forEach(s => { if (s.undelivered && !s.deliveredAt) s.deliveredAt = 'earlier run' });
  const c = S.customers.find(x => x.id !== 1); c.limit = 1e8;
  S.pos.lines = []; window.eval('go')('pos'); window.eval('CS').paper = 'none';
  return { cid: c.id };
});
await wait(500);
await pg.keyboard.down('Control'); await pg.keyboard.down('Shift'); await pg.keyboard.press('KeyD'); await pg.keyboard.up('Shift'); await pg.keyboard.up('Control'); await wait(300);
ok(await pg.evaluate(() => window.eval('S').pos.toDeliver === true && document.querySelector('[data-act="csDlvToggle"]').classList.contains('on')), 'Ctrl+Shift+D: NOT DELIVERED is lit on the till');
await pg.screenshot({ path: OUT + '/undel-till.png', clip: { x: 0, y: 0, width: 1366, height: 160 } });
const no = await pg.evaluate(cid => {
  const S = window.eval('S');
  S.pos.lines = [{ pid: window.eval('OPEN_PID'), name: 'Cement 5 bags (phone order)', qty: 1, price: 11750, disc: 0, open: true }];
  const inv = window.eval('finishTillBill')({ cust: window.eval('C')(cid), pays: [{ method: 'CREDIT', amount: 0 }], override: true });
  window.eval('render')(); return inv.no;
}, set.cid);
const st = await pg.evaluate(no => ({ u: window.eval('billUndelivered')(window.eval('S').sales.find(x => x.no === no)), pos: !!window.eval('S').pos.toDeliver }), no);
ok(st.u && !st.pos, 'the bill is marked not delivered, and the till is back to normal for the next one', JSON.stringify(st));

// found on Bills → Not delivered
await pg.evaluate(() => { window.eval("billType='undelivered'; billQ=''; billFrom=''; billTo=''; billCust=0"); window.eval('go')('bills') }); await wait(600);
const rows = await pg.evaluate(() => [...document.querySelectorAll('.bl-row')].map(r => r.dataset.no));
ok(rows.length === 1 && rows[0] === no, 'Bills → Not delivered lists just that bill', rows.join(','));
const chip = await pg.evaluate(() => [...document.querySelectorAll('[data-act="billKind"]')].map(x => x.textContent).find(x => /Not delivered/.test(x)));
ok(/Not delivered · 1/.test(chip || ''), 'the chip says how many', chip);
await pg.evaluate(no => { window.eval('billSel=' + JSON.stringify(no)); window.eval('render')() }, no); await wait(400);
ok(await pg.evaluate(() => /not delivered/.test(document.querySelector('.bl-head').textContent) && !!document.querySelector('[data-act="billDlvDone"]')), 'the bill says not delivered, with Delivered ✓');
await pg.screenshot({ path: OUT + '/undel-bills.png' });
// the printed bills say so
const printed = await pg.evaluate(no => { const inv = window.eval('S').sales.find(x => x.no === no); return { a5: window.eval('billHtml')(inv, 'a5'), r80: window.eval('billHtml')(inv, 'r80') } }, no);
ok(/GOODS NOT DELIVERED YET/.test(printed.a5) && /GOODS NOT DELIVERED YET/.test(printed.r80), 'the A5 bill and the 80mm receipt both print GOODS NOT DELIVERED YET');

// and at the top of Deliveries
await pg.evaluate(() => { window.eval('dlvDay = null'); window.eval('go')('dlv') }); await wait(500);
const dtext = await pg.evaluate(() => document.querySelector('#main').innerText);
ok(/Bills not delivered yet/.test(dtext) && dtext.includes(no), 'Deliveries shows it under Bills not delivered yet');
await pg.screenshot({ path: OUT + '/undel-dlv.png' });

// Delivered ✓: who took it, who received it, and the delivery note prints
await pg.evaluate(() => { window.__slips = []; window.eval('printPaper = (html, f, no) => { window.__slips.push({ html, f, no }) }') });
await pg.click(`[data-act="billDlvDone"][data-no="${no}"]`); await wait(400);
await pg.type('#ddWith', 'Nuwan'); await pg.type('#ddWho', 'Mr Silva'); await pg.keyboard.press('Enter'); await wait(400);
ok(await pg.evaluate(no => { const s = window.eval('S').sales.find(x => x.no === no); return !window.eval('billUndelivered')(s) && !!s.deliveredAt && s.deliveredWith === 'Nuwan' && s.receivedBy === 'Mr Silva' }, no), 'Delivered ✓ takes it off the list, with when, who took it and who received it');
const slip = await pg.evaluate(() => window.__slips);
ok(slip.length === 1 && slip[0].f === 'r80' && /DELIVERY NOTE/.test(slip[0].html) && slip[0].html.includes(no) && /NUWAN/.test(slip[0].html) && /MR SILVA/.test(slip[0].html) && /Cement 5 bags/i.test(slip[0].html) && /OUTSTANDING ON THIS BILL/.test(slip[0].html), 'a DELIVERY NOTE prints on the 80mm: the bill, the items, who took and received it, what is still owing', slip.length + ' slip(s)');
fs.writeFileSync(OUT + '/dlv-slip.html', slip[0] ? slip[0].html : '');
const again = await pg.evaluate(no => { const inv = window.eval('S').sales.find(x => x.no === no); return window.eval('billHtml')(inv, 'a5') }, no);
ok(/DELIVERED/.test(again) && !/NOT DELIVERED YET/.test(again) && /Mr Silva/.test(again), 'printed again, the bill says when it was delivered and to whom');
await pg.evaluate(no => { window.eval("billType='all'"); window.eval('billSel=' + JSON.stringify(no)); window.eval('go')('bills') }, no); await wait(400);
await pg.click(`[data-act="billDlvSlip"][data-no="${no}"]`); await wait(300);
ok(await pg.evaluate(() => window.__slips.length) === 2, 'Delivery note on the bill prints it again');
await pg.evaluate(() => { window.eval('go')('dlv') }); await wait(400);
ok(!/Bills not delivered yet/.test(await pg.evaluate(() => document.querySelector('#main').innerText)), 'the Deliveries list is empty again');

// an ordinary bill put on the list afterwards, then a driver's delivery of it
const no2 = await pg.evaluate(cid => window.eval('completeSale')({ lines: [{ pid: window.eval('OPEN_PID'), name: 'Paint 4L', qty: 1, price: 6200, disc: 0, open: true }], customerId: cid, pays: [{ method: 'CREDIT', amount: 0 }], override: true }).no, set.cid);
await pg.evaluate(no => { window.eval("billType='all'"); window.eval('billSel=' + JSON.stringify(no)); window.eval('go')('bills') }, no2); await wait(500);
await pg.click(`[data-act="billDlvNot"][data-no="${no2}"]`); await wait(300);
ok(await pg.evaluate(no => window.eval('billUndelivered')(window.eval('S').sales.find(x => x.no === no)), no2), 'Not delivered yet on a bill puts it on the list afterwards');
ok(await pg.evaluate(no => { const S = window.eval('S'); S.deliveries = (S.deliveries || []).concat([{ id: 'dvT', no: 'DLV-T', bill: no, status: 'delivered', date: '2026-01-01' }]);
  const r = !window.eval('billUndelivered')(S.sales.find(x => x.no === no)); S.deliveries = S.deliveries.filter(d => d.id !== 'dvT'); window.eval('billDeliverMark')(no, true); return r }, no2), 'a driver\'s delivery of the bill counts as delivered');
// a cash bill without the switch is not on the list
ok(await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines = [{ pid: window.eval('OPEN_PID'), name: 'Nails', qty: 1, price: 100, disc: 0, open: true }];
  const inv = window.eval('finishTillBill')({ cust: window.eval('C')(1), pays: [{ method: 'CASH', amount: 100 }] }); return !window.eval('billUndelivered')(inv) }), 'an ordinary bill is not on the list');
await pg.evaluate(() => window.eval('persist')(true));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
