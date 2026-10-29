// Tradesmen: "Brought by" on a bill earns its commission; a credit bill's waits until paid; goods back
// come off it; the tradesman is thanked by text; paying them out posts to 6120 with a voucher.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-trades.mjs [screenshot-dir]
// Texts are caught in the page (window.sms) and printers are stopped — nothing leaves this PC.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
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
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  window.__texts = []; window.sms = (to, body) => { window.__texts.push({ to, body }); return Promise.resolve(true) };
  window.eval('CFG').trade = { ...window.eval('tradeCfg')(), rate: 2, sms: true };
  window.eval('S').trades = []; window.eval('S').tradePays = []; window.eval('go')('pos') });
const put = (q, cust) => pg.evaluate((q, cust) => { const S = window.eval('S'), p = S.products.find(x => x.retail > 100 && x.stock > 50 && !x.open);
  S.pos.lines = [{ pid: p.id, qty: q, price: p.retail, disc: 0 }]; S.pos.customer = cust || null; S.pos.billDisc = 0; window.eval('render')(); return q * p.retail }, q, cust);

// pick from the till: a new tradesman, added on the spot
await put(4);
ok(!!(await pg.$('[data-act="tradePick"]')), 'the till has "Brought by…"');
await pg.click('[data-act="tradePick"]'); await wait(300);
await pg.type('#tpQ', 'Sunil Perera'); await wait(150);
await pg.type('#tpP', '0771239999');
await pg.select('#tpK', 'Mason');
await pg.click('#tpAdd'); await wait(400);
const tid = await pg.evaluate(() => window.eval('S').pos.trade);
const btn = await pg.evaluate(() => document.querySelector('[data-act="tradePick"]').innerText);
ok(!!tid && /Sunil Perera/.test(btn) && /Mason · 2%/.test(btn), 'added and put on the bill — the button says who and at what rate', btn.replace(/\n/g, ' · '));
await pg.screenshot({ path: OUT + '/trades-till.png' });

// a cash bill: earns 2%, thanked by text
const cash = await pg.evaluate(() => { const S = window.eval('S'); const tot = S.pos.lines.reduce((a, l) => a + l.qty * l.price, 0);
  const inv = window.eval('finishTillBill')({ cust: window.eval('C')(1), pays: [{ method: 'CASH', amount: tot }] }); return { no: inv.no, total: inv.total, trade: inv.trade, rate: inv.tradeRate } });
ok(cash.trade === tid && cash.rate === 2, 'the bill keeps who brought it, and the rate', `${cash.no} · ${cash.rate}%`);
const t1 = await pg.evaluate(() => window.__texts.slice(-1)[0]);
ok(!!t1 && t1.to === '0771239999' && /^Dear Sunil,/.test(t1.body) && new RegExp('You earn: Rs ' + (cash.total * 0.02).toLocaleString('en-LK', { minimumFractionDigits: 2 })).test(t1.body),
  'Sunil is thanked by text, by name, with what he earned', t1 && t1.body.split('\n').slice(0, 4).join(' / '));
ok(await pg.evaluate(() => !window.eval('S').pos.trade), 'the next bill starts with nobody');

// a credit bill: the share still owed waits
const cid = await pg.evaluate(() => window.eval('S').customers.find(c => c.id !== 1).id);
await put(2, cid);
await pg.evaluate(id => { window.eval('S').pos.trade = id }, tid);
const cred = await pg.evaluate(() => { const S = window.eval('S'); const inv = window.eval('finishTillBill')({ cust: window.eval('C')(S.pos.customer), pays: [{ method: 'CREDIT', amount: 0 }], override: true }); return { no: inv.no, total: inv.total, balance: inv.balance } });
const tt1 = await pg.evaluate(id => window.eval('tradeTotals')(id), tid);
ok(Math.abs(tt1.earned - cash.total * 0.02) < 0.01 && Math.abs(tt1.pending - cred.balance * 0.02) < 0.01, 'on a credit bill the commission waits until the customer pays', `earned ${tt1.earned} · waiting on payment ${tt1.pending}`);
ok(/once they have paid/.test(await pg.evaluate(() => window.__texts.slice(-1)[0].body)), 'and the text says so');

// a return off the cash bill comes off the commission
const back = await pg.evaluate(no => { const S = window.eval('S'); const o = S.sales.find(x => x.no === no), l = o.lines[0];
  window.eval('completeSale')({ lines: [{ pid: l.pid, qty: -1, price: l.price, disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: -l.price }], returnOf: no });
  return l.price }, cash.no);
const tt2 = await pg.evaluate(id => window.eval('tradeTotals')(id), tid);
ok(Math.abs(tt2.earned - (cash.total - back) * 0.02) < 0.01, 'goods brought back come off what he earned', `earned now ${tt2.earned}`);

// pay him out: posted to 6120, a voucher
const j0 = await pg.evaluate(() => window.eval('S').journal.length);
await pg.evaluate(id => window.eval('tradePay')(id), tid); await wait(300);
await pg.click('.modal .np-chk');
await pg.click('#tyOk'); await wait(600);
const paid = await pg.evaluate((id) => { const S = window.eval('S'); const p = S.tradePays.slice(-1)[0]; const j = S.journal.slice(-1)[0]; return { p, lines: j.lines } }, tid);
ok(Math.abs(paid.p.amount - tt2.due) < 0.01 && paid.lines.some(l => l.ac === '6120' && Math.abs(l.dr - paid.p.amount) < 0.01) && paid.lines.some(l => l.ac === '1010'), 'Pay: posted to 6120 Tradesman commission from the cash drawer', `${paid.p.amount}`);
ok((await pg.evaluate(id => window.eval('tradeTotals')(id), tid)).due < 0.01, 'and nothing is left waiting');

// the page
await pg.evaluate(() => window.eval('go')('trades')); await wait(700);
const page = await pg.evaluate(() => document.getElementById('main').innerText);
ok(/Tradesmen/.test(page) && /Sunil Perera/.test(page) && /Mason/.test(page), 'the Tradesmen page lists him with his figures');
await pg.screenshot({ path: OUT + '/trades-page.png' });

// a held bill keeps who brought it
await pg.evaluate(id => { window.eval('go')('pos'); const S = window.eval('S'), p = S.products.find(x => x.retail > 0 && x.stock > 50 && !x.open);
  S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.trade = id; S.heldBills = [];
  window.eval('holdCurrentBill')(true, 'test'); window.eval('recallHeldBill')(S.heldBills[0].id) }, tid);
ok(await pg.evaluate(() => window.eval('S').pos.trade) === tid, 'a held bill brought back still says who brought it');
await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines = []; S.pos.trade = null; window.eval('render')() });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
