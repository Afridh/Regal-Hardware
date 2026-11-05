// A line already on the bill changed to a minus quantity (5 Nov 2026: "Quantity must be above zero", though the entry row takes -1).
//  · typed in the row: the amount follows as it is typed, the line is a return, the bill total comes down
//  · a discount stays a discount: the line comes to minus the price less the discount, in % or rupees
//  · not refused as under cost; 0 is refused; back to plus is an ordinary line again
//  · a serial-numbered line and a collect-later line are refused
//  · the same in the bigger window, and a % on -1 on the entry row
//  · the bill saves: books balanced, stock back for the return and down for the sale
// Nothing reaches a printer: printPaper is replaced here and :41xx is blocked.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-minusline.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
const near = (a, b) => Math.abs(a - b) < 0.011;
// two items, the first priced under its cost so a wrong "under cost" would show
const ids = await pg.evaluate(() => { const S = window.eval('S'), ps = S.products.filter(y => y.active !== false && y.stock > 10 && y.retail > 100 && y.cost > 50 && !y.serialised && !(y.tiers || []).length); return [ps[0].id, ps[1].id] });
const setUp = line => pg.evaluate((line, ids) => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; const S = window.eval('S'), C = window.eval('CFG'), p = window.eval('prefs')(); C.done.askCustomer = false; C.done.askSalesman = false; C.done.askSize = false; C.done.printAnim = false; C.pos.discFromMrp = false; p.till = 'classic'; p.tillLook = 'sepos';
  const x = S.products.find(y => y.id === ids[0]); S.pos.lines = [{ pid: x.id, qty: 1, price: x.retail, disc: 0, auto: true, ...line }]; S.pos.billDisc = 0; S.pos.customer = null; window.eval('go')('pos') }, line, ids).then(() => wait(300));
const open = () => pg.evaluate(() => window.eval('csLineEdit')(0)).then(() => wait(250));
const typeQty = async v => { await pg.focus('#lnQty'); await pg.evaluate(() => document.getElementById('lnQty').select()); await pg.keyboard.type(v); await wait(100) };
const save = async () => { await pg.keyboard.press('Enter'); await wait(120); await pg.keyboard.press('Enter'); await wait(300) };
const line = () => pg.evaluate(() => { const S = window.eval('S'), l = S.pos.lines[0], p = S.products.find(y => y.id === l.pid); return { qty: l.qty, price: l.price, disc: l.disc, amt: +(l.qty * l.price - l.disc).toFixed(2), editing: window.eval('CS').editLine != null, retail: p.retail, net: window.eval('csTotals')().net, ret: !!document.querySelector('.till-tbl tr.retline'), modal: !!document.querySelector('.modal'), toast: [...document.querySelectorAll('.toast')].map(t => t.innerText).join('|') } });

// plain
await setUp({}); await open(); await typeQty('-1');
const live = await pg.$eval('#lnAmt', e => e.textContent), r0 = await line();
ok(/-|−/.test(live) && live.replace(/[^\d.]/g, '') === Number(r0.retail).toFixed(2), 'the amount on the row follows as it is typed, minus', live);
await save(); let r = await line();
ok(r.qty === -1 && !r.editing && r.ret && near(r.amt, -r.retail) && near(r.net, -r.retail), '-1 is taken: a return line, the bill comes down by it', JSON.stringify({ qty: r.qty, amt: r.amt, net: r.net }));
await open(); await typeQty('3'); await save(); r = await line();
ok(r.qty === 3 && !r.ret && near(r.amt, 3 * r.retail), 'changed back to 3: an ordinary line again', JSON.stringify({ qty: r.qty, amt: r.amt }));
await setUp({}); await open(); await typeQty('0'); await save(); r = await line();
ok(r.qty === 1 && r.editing && /-1 to take one back/.test(r.toast), '0 is refused, and says what to type', r.toast);
// discounts
const rt = await pg.evaluate(id => window.eval('S').products.find(y => y.id === id).retail, ids[0]);
await setUp({ discPct: 10, disc: +(rt * .1).toFixed(2) }); await open(); await typeQty('-2'); await save(); r = await line();
ok(r.qty === -2 && near(r.amt, -2 * rt * .9), 'a 10% line, to -2: minus two at the discounted price', JSON.stringify({ amt: r.amt, disc: r.disc }));
await setUp({ disc: 20 }); await open(); await typeQty('-1'); await save(); r = await line();
ok(r.qty === -1 && near(r.amt, -(rt - 20)), 'Rs 20 off, to -1: minus the price less the 20', JSON.stringify({ amt: r.amt, disc: r.disc }));
await open(); await typeQty('1'); await save(); r = await line();
ok(r.qty === 1 && near(r.amt, rt - 20) && r.disc === 20, 'and back to 1: plus the price less the 20', JSON.stringify({ amt: r.amt, disc: r.disc }));
await setUp({}); await open(); await typeQty('-2'); await pg.evaluate(() => { const d = document.getElementById('lnDisc'); d.value = '50'; d.dispatchEvent(new Event('input', { bubbles: true })) }); await pg.focus('#lnQty'); await save(); r = await line();
ok(near(r.amt, -rt), '50% typed on a -2 line: minus one price', JSON.stringify({ amt: r.amt, disc: r.disc }));
// a plain sale keeps its rules
await setUp({}); await open(); await typeQty('2'); await pg.evaluate(() => { const e = document.getElementById('lnPrice'); e.value = '1'; e.dispatchEvent(new Event('input', { bubbles: true })) }); await pg.focus('#lnQty'); await save(); r = await line();
ok(r.modal, 'a plain sale under cost is still asked about');
await setUp({}); await open(); await typeQty('-1'); await pg.evaluate(() => { const e = document.getElementById('lnPrice'); e.value = '1'; e.dispatchEvent(new Event('input', { bubbles: true })) }); await pg.focus('#lnQty'); await save(); r = await line();
ok(r.qty === -1 && !r.modal && !r.editing, 'a return under cost is not asked about', JSON.stringify({ qty: r.qty, modal: r.modal }));
// refused
await setUp({ serials: ['SN1'] }); await open(); await typeQty('-1'); await save(); r = await line();
ok(r.qty === 1 && /serial/.test(r.toast), 'a serial-numbered line is sent to Returns', r.toast);
await setUp({ later: 1 }); await open(); await typeQty('-1'); await save(); r = await line();
ok(r.qty === 1 && /collect-later/.test(r.toast), 'a collect-later line is refused', r.toast);
// the bigger window
await setUp({}); await pg.evaluate(() => window.eval('csEditLine')(0)); await wait(300); await pg.evaluate(() => { const e = document.getElementById('elQty'); e.value = '-1'; e.dispatchEvent(new Event('input', { bubbles: true })); const d = document.getElementById('elDisc'); d.value = '20'; d.dispatchEvent(new Event('input', { bubbles: true })) }); await wait(100);
const shown = await pg.$eval('#elAmt', e => e.textContent); await pg.click('#elOk'); await wait(300); r = await line();
ok(r.qty === -1 && near(r.amt, -(rt - 20)) && shown.replace(/[^\d.]/g, '') === (rt - 20).toFixed(2), 'the bigger window takes -1 with Rs 20 off too', JSON.stringify({ shown, amt: r.amt }));
// the entry row: a % on -1
const code = await pg.evaluate(id => { const p = window.eval('S').products.find(y => y.id === id); return String(p.num || p.code) }, ids[1]);
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); S.pos.lines = []; window.eval('CFG').pos.discFromMrp = true; window.eval('render')() }); await wait(250);
await pg.click('#csQ'); await pg.keyboard.type(code); await pg.keyboard.press('Enter'); await wait(300);
await pg.evaluate(() => document.getElementById('csQty').select()); await pg.keyboard.type('-1'); await pg.keyboard.press('Enter'); await wait(150); await pg.keyboard.press('Enter'); await wait(150);
await pg.evaluate(() => document.getElementById('csDisc').select()); await pg.keyboard.type('10'); await pg.keyboard.press('Enter'); await wait(400);
const en = await pg.evaluate(() => { const S = window.eval('S'), l = S.pos.lines[0], p = l && S.products.find(y => y.id === l.pid); return l && { qty: l.qty, amt: +(l.qty * l.price - l.disc).toFixed(2), mrp: p.mrp, modal: !!document.querySelector('.modal') } });
ok(en && en.qty === -1 && near(en.amt, -en.mrp * .9) && !en.modal, 'the entry row: -1 at 10% off the MRP comes to minus 90% of it, not nothing', JSON.stringify(en));
await pg.evaluate(() => { window.eval('CFG').pos.discFromMrp = false });
// the whole bill: one sold, one back, saved
await setUp({}); await pg.evaluate(id => { const S = window.eval('S'), x = S.products.find(y => y.id === id); S.pos.lines.push({ pid: id, qty: 1, price: x.retail, disc: 0, auto: true }); window.eval('render')() }, ids[1]); await wait(250);
await pg.evaluate(() => window.eval('csLineEdit')(1)); await wait(250); await typeQty('-1'); await save();
const b0 = await pg.evaluate(ids => { const S = window.eval('S'); return { stock: ids.map(i => S.products.find(y => y.id === i).stock), cash: window.eval('bal')('1010'), net: window.eval('csTotals')().net, n: S.sales.length } }, ids);
if (b0.net > 0) { await pg.focus('#csQ'); await pg.keyboard.press('End'); } else { await pg.evaluate(() => window.eval('openPay')()); await wait(300); await pg.keyboard.press('Enter'); }
await wait(1400);
const b1 = await pg.evaluate(ids => { const S = window.eval('S'), s = S.sales.at(-1), lines = S.journal.filter(j => j.ref === s.no).flatMap(j => j.lines); return { no: s.no, n: S.sales.length, total: s.total, stock: ids.map(i => S.products.find(y => y.id === i).stock), cash: window.eval('bal')('1010'), dr: lines.reduce((a, l) => a + l.dr, 0), cr: lines.reduce((a, l) => a + l.cr, 0), left: S.pos.lines.length } }, ids);
ok(b1.n === b0.n + 1 && near(b1.total, b0.net) && near(b1.dr, b1.cr) && b1.dr !== 0 && b1.left === 0 && near(b1.cash - b0.cash, b0.net), 'the bill saves at the right total, the books balanced', JSON.stringify({ total: b1.total, cash: b1.cash - b0.cash, dr: b1.dr, cr: b1.cr }));
ok(b1.stock[0] === b0.stock[0] - 1 && b1.stock[1] === b0.stock[1] + 1, 'the one sold leaves the stock, the one returned comes back', JSON.stringify([b0.stock, b1.stock]));
await pg.evaluate(no => { const S = window.eval('S'), s = S.sales.find(x => x.no === no); window._allowWipeOnce = Date.now(); s.lines.forEach(l => { const p = S.products.find(y => y.id === l.pid); if (p) p.stock += l.qty }); S.sales = S.sales.filter(x => x.no !== no); S.journal = S.journal.filter(j => j.ref !== no); S.movements = S.movements.filter(m => m.ref !== no); S.pos.lines = []; const C = window.eval('CFG'); C.done.askCustomer = true; document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('persist')(true) }, b1.no); await wait(1500);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
