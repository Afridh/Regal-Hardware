// Choosing a customer that would move the prices on the bill asks first (10 Nov 2026: a bill made without a customer,
// edited and given the customer, came down to what they paid last time, with only a small message).
//  · the lines and the totals are shown; only a click answers it — no key, no click beside it
//  · a customer whose prices change nothing: no question
// Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-pricechange.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
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
await pg.waitForFunction(() => window.eval('S').products.filter(x => +x.retail > 0).length > 5, { timeout: 30000 }); await wait(1500);
const setup = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval("CFG.print.agent=''");
  const S = window.eval('S'), CFG = window.eval('CFG'); CFG.msg.autoBill = false; CFG.pos.repriceToLast = true;
  const tag = 'PCX' + Date.now().toString(36).slice(-4).toUpperCase();
  const c = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: tag, name: tag + ' Rehab Centre', phone: '0700000021', level: 'retail', limit: 9999999 }; S.customers.push(c);
  const p = S.products.find(x => x.id !== window.eval('OPEN_PID') && +x.retail > 200 && +x.cost < +x.retail - 50); p.stock = Math.max(+p.stock || 0, 100);
  const low = +(+p.retail - 30).toFixed(2);
  window.eval('completeSale')({ lines: [{ pid: p.id, qty: 1, price: low, disc: 0 }], customerId: c.id, pays: [{ method: 'CASH', amount: low }], override: true });   // they paid less last time
  return { cid: c.id, name: c.name, pid: p.id, retail: +p.retail, low };
});
const bill = (editing) => pg.evaluate((s, editing) => { const S = window.eval('S'); document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('go')('pos');
  S.pos.lines = [{ pid: s.pid, qty: 2, price: s.retail, disc: 0, auto: true }]; S.pos.customer = null; S.pos.editing = editing || null; window.eval('render')(); return window.eval('billTotal')() }, setup, editing);
const choose = async () => { await pg.evaluate(() => window.eval('pickCustomer')(() => {})); await wait(250); await pg.type('#cq', setup.name.slice(0, 7).toLowerCase()); await wait(250); await pg.keyboard.press('Enter'); await wait(400) };
const state = () => pg.evaluate(() => { const a = document.querySelector('.pca'); return { ask: !!a, text: a ? a.innerText.replace(/\s+/g, ' ') : '', total: window.eval('billTotal')(), price: window.eval('S').pos.lines[0].price, cust: window.eval('S').pos.customer } });

// a bill being edited
let t0 = await bill('10999'); await choose(); let s = await state();
ok(s.ask && s.text.includes(setup.name) && /Editing bill 10999/i.test(s.text) && s.text.includes((setup.retail).toLocaleString('en-US', { minimumFractionDigits: 2 })), 'editing a bill: choosing the customer shows the line, was → now, and the bill', s.text.slice(0, 220));
// no key answers it, nor a click beside it (10 Nov 2026, the owner asked for a click)
for (const k of ['Enter', 'Escape', ' ', 'k', 'u', 'Tab', 'F10']) await pg.keyboard.press(k);
await pg.mouse.click(30, 400); await wait(400); s = await state();
ok(s.ask && Math.abs(s.total - setup.low * 2) < 0.005, 'Enter, Esc, Space, letters, Tab, F10 and a click beside it: still asking, nothing settled', JSON.stringify({ ask: s.ask, total: s.total }));
await pg.click('#pcaKeep'); await wait(400); s = await state();
ok(!s.ask && s.cust === setup.cid && Math.abs(s.total - t0) < 0.005 && s.price === setup.retail, 'a click on Keep keeps the prices on the bill (the customer is on it)', JSON.stringify({ was: t0, now: s.total }));
// a new bill: a click on Use takes their prices
t0 = await bill(null); await choose(); s = await state();
ok(s.ask, 'a new bill: the question comes up too');
await pg.click('#pcaUse'); await wait(400); s = await state();
ok(!s.ask && s.price === setup.low && s.total < t0, 'a click on Use takes their prices', JSON.stringify({ was: t0, now: s.total }));
// nothing moves: no question
await pg.evaluate(s => { const S = window.eval('S'); S.pos.lines = [{ pid: s.pid, qty: 2, price: s.low, disc: 0, auto: false }]; S.pos.customer = null; S.pos.editing = null; window.eval('render')() }, setup);
await choose(); s = await state();
ok(!s.ask && s.cust === setup.cid, 'prices that do not move: no question, the customer goes on', JSON.stringify(s));
// a big bill (15 Nov 2026: a long return bill brought back from hold could not be changed — the question listed
// every line, ran off the bottom of the screen, and the two buttons could not be reached, while it held every key)
const big = await pg.evaluate(s => { const S = window.eval('S'); document.querySelectorAll('.modal').forEach(m => m.remove());
  S.pos.lines = []; for (let i = 0; i < 40; i++) S.pos.lines.push({ pid: s.pid, qty: i % 2 ? -1 : 2, price: s.retail, disc: 0, auto: true });
  S.pos.customer = null; S.pos.editing = null; window.eval('render')(); return window.eval('billTotal')() }, setup);
await choose(); s = await state();
const reach = async (sel) => pg.evaluate(sel => { const b = document.querySelector(sel); if (!b) return { there: false };
  const r = b.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { there: true, inView: r.top >= 0 && r.bottom <= innerHeight, hit: !!at && (at === b || b.contains(at)), bottom: Math.round(r.bottom), h: innerHeight } }, sel);
const rk = await reach('#pcaKeep'), ru = await reach('#pcaUse');
ok(s.ask && rk.inView && rk.hit && ru.inView && ru.hit, 'a 40-line bill: both buttons are on the screen and can be clicked', JSON.stringify({ keep: rk, use: ru }));
const lst = await pg.evaluate(() => { const l = document.querySelector('.pca-list'), h = document.querySelector('.pca-h').getBoundingClientRect(), t = document.querySelector('.pca-t').getBoundingClientRect();
  return l ? { rows: l.querySelectorAll('tr').length, scrolls: l.scrollHeight > l.clientHeight, head: h.top >= 0, total: t.top >= 0 && t.bottom <= innerHeight } : null });
ok(lst && lst.rows === 40 && lst.scrolls && lst.head && lst.total, 'every line is listed, in a list that scrolls; the name and the total stay on the screen', JSON.stringify(lst));
// another window opened over the question (the black/red list warning) gets its own keys
const over = await pg.evaluate(() => { const m2 = window.eval('modal')('<input id="ovIn">'); const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
  let got = false; m2.addEventListener('keydown', () => { got = true }); document.getElementById('ovIn').dispatchEvent(ev); m2.remove(); return got && !ev.defaultPrevented });
ok(over, 'a window opened over the question gets its keys');
// closed without a click (Esc in a window over it closes every window): the prices stay as they were
const keepAt = await pg.evaluate(() => window.eval('billTotal')());
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove())); await wait(300);
let sx = await state();
ok(!sx.ask && keepAt < big - 0.005 && Math.abs(sx.total - big) < 0.005, 'closed without a click: the prices on the bill stay as they were', JSON.stringify({ was: big, shown: keepAt, now: sx.total }));
// ask again for the rest of the checks
await pg.evaluate(s => { const S = window.eval('S'); S.pos.customer = null; S.pos.lines.forEach(l => { l.price = s.retail; l.auto = true; delete l.fromLast; delete l.last }); window.eval('render')() }, setup);
await choose();
if (rk.hit) { await pg.click('#pcaKeep'); await wait(400); }
s = await state();
ok(!s.ask && Math.abs(s.total - big) < 0.005, 'Keep clicked: the big bill stays as it was and the till is free again', JSON.stringify({ was: big, now: s.total }));
// the big return bill held: the held list shows what it comes to, minus — not Rs 0.00
const held = await pg.evaluate(s => { const S = window.eval('S'); document.querySelectorAll('.modal').forEach(m => m.remove());
  S.pos.lines = [{ pid: s.pid, qty: -3, price: s.retail, disc: 0 }]; S.pos.customer = null; S.pos.editing = null;
  window.eval('holdCurrentBill')(true, 'RET-TEST'); window.eval('showHeldBillsModal')(0);
  const card = [...document.querySelectorAll('.hb-card')].find(c => /RET-TEST/.test(c.innerText)); const amt = card ? card.querySelector('.hb-c-amt').textContent : '';
  const want = window.eval('fmt')(-3 * s.retail); document.querySelectorAll('.modal').forEach(m => m.remove());
  const i = S.heldBills.findIndex(b => b.ref === 'RET-TEST'); if (i >= 0) S.heldBills.splice(i, 1); window.eval('render')(); return { amt, want } }, setup);
ok(held.amt === held.want, 'a held return bill shows its minus amount in the held list', JSON.stringify(held));
await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines = []; S.pos.customer = null; S.pos.editing = null; window.eval('render')() });
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
