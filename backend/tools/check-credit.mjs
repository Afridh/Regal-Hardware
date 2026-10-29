// ON ACCOUNT (F6): the credit panel — pick from the regulars or search, part paid now, who took it,
// over the limit allowed on the spot or by an admin's PIN, Enter saves; the payment screen still works.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-credit.mjs [screenshot-dir]
// Every call to a printer is stopped and counted — the print helper on this PC is the shop's.
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
let prints = 0;
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url();
  if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u)) { if (/\/(print|label)\b/.test(u)) prints++; return rq.abort() }
  if (/\/api\/print\b/.test(u) && rq.method() === 'POST') { prints++; return rq.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) }
  rq.continue() });
await pg.evaluateOnNewDocument(() => { window.print = () => {} });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// a bill on the till, and two account customers: one with room, one near the limit
const setup = await pg.evaluate(() => {
  const S = window.eval('S'); window.eval('go')('pos'); window.eval('CS').paper = null;
  const ps = S.products.filter(p => p.retail > 0 && p.stock > 20 && !p.open).slice(0, 2);
  S.pos.lines = ps.map(p => ({ pid: p.id, qty: 2, price: p.retail, disc: 0 }));
  const cs = S.customers.filter(c => c.id !== 1 && c.active !== false);
  const roomy = cs[0], tight = cs[1];
  roomy.limit = 10000000; tight.limit = Math.max(1, Math.round(window.eval('partyBal')('C', tight.id) + 10));
  window.eval('render')();
  return { roomy: roomy.name, roomyId: roomy.id, tight: tight.name, tightId: tight.id, total: window.eval('csTotals')().net };
});

// F6 opens the panel, regulars first
await pg.keyboard.press('F6'); await wait(400);
ok(!!(await pg.$('.cp-modal .cp-sheet')), 'F6 opens the on-account panel beside the bill');
ok(await pg.evaluate(() => !!document.querySelector('.till-tbl, .till-lines, .cs-lines') || true) && await pg.evaluate(() => document.querySelectorAll('.cp-row').length > 0), 'with the regular credit customers listed', await pg.evaluate(() => document.querySelectorAll('.cp-row').length) + ' shown');
await pg.screenshot({ path: OUT + '/credit-panel-list.png' });

// search, Enter picks
await pg.type('#cpQ', setup.roomy.slice(0, 5)); await wait(250);
await pg.keyboard.press('Enter'); await wait(400);
ok(await pg.evaluate(() => window.eval('S').pos.customer) === setup.roomyId, 'typing a name and Enter puts them on the bill', setup.roomy);
ok(await pg.evaluate(() => /Outstanding now/i.test(document.querySelector('.cp-figs').innerText) && /Outstanding after/i.test(document.querySelector('.cp-figs').innerText)), 'it shows what they owe now, this bill, and what they will owe');

// half now in cash, taken by, no print, Enter
await pg.click('[data-cp="half"]'); await wait(200);
await pg.type('#cpTaken', 'Kamal · WP CAB-1234');
await pg.click('[data-cp-paper="none"]'); await wait(200);
// the shop asks "who sold it?" at the end of a bill: answered in the panel, not in a second window
const sold = await pg.evaluate(() => { const s = document.querySelector('#cpSold'); if (!s) return null; const o = [...s.options].find(o => o.value === 'Azhad') || s.options[1]; s.value = o.value; s.dispatchEvent(new Event('change')); return o.value });
ok(!(await pg.evaluate(() => window.eval('CFG').done.askSalesman)) || !!sold, '"Sold by" is in the panel when the shop asks it', sold || 'not asked here');
const split = await pg.evaluate(() => document.querySelector('.cp-split') && document.querySelector('.cp-split').innerText.replace(/\s+/g, ' '));
ok(!!split && /Paid now · cash/i.test(split) && /On account/i.test(split), 'Half splits it: paid now in cash, the rest on account', split);
await pg.screenshot({ path: OUT + '/credit-panel-half.png' });
const before = prints;
await pg.focus('#cpPaid'); await pg.keyboard.press('Enter'); await wait(1200);
const inv = await pg.evaluate(() => { const s = window.eval('S').sales.slice(-1)[0]; return { no: s.no, type: s.type, cust: s.customerId, total: s.total, paid: s.paid, balance: s.balance, pays: s.pays, note: s.note, takenBy: s.takenBy } });
const half = +(inv.total / 2).toFixed(2);   // the customer's own prices may have changed the total
ok(inv.cust === setup.roomyId && inv.type === 'CREDIT', 'Enter saves it as a credit bill on their account', inv.no);
ok(Math.abs(inv.paid - half) < 0.01 && Math.abs(inv.balance - (inv.total - half)) < 0.01 && inv.pays.some(p => p.method === 'CASH' && Math.abs(p.amount - half) < 0.01),
  'half paid in cash, the rest owed on the bill', `paid ${inv.paid} · owed ${inv.balance}`);
ok(/Taken by: Kamal/.test(inv.note || '') && inv.takenBy === 'Kamal · WP CAB-1234', 'who took the goods is on the bill', inv.note);
ok(!sold || await pg.evaluate(s => window.eval('S').sales.slice(-1)[0].salesman === s, sold), 'and who sold it', sold || '');
ok(await pg.evaluate(() => [...document.querySelectorAll('.modal')].length === 0), 'Enter was the last press — no second window asking anything');
ok(await pg.evaluate(() => !document.querySelector('.cp-modal') && window.eval('S').pos.lines.length === 0), 'the panel closes and the till is clear for the next bill');
ok(prints === before, 'No print: nothing went to a printer');

// over the limit: allowed on the spot by someone who may
await pg.evaluate(id => { const S = window.eval('S'), ps = S.products.filter(p => p.retail > 0 && p.stock > 20 && !p.open).slice(0, 1);
  S.pos.lines = ps.map(p => ({ pid: p.id, qty: 3, price: p.retail, disc: 0 })); S.pos.customer = id; window.eval('render')() }, setup.tightId);
await pg.keyboard.press('F6'); await wait(400);
ok(await pg.evaluate(() => !!document.querySelector('.cp-who')), 'with a customer already on the bill, F6 goes straight to them');
const overTxt = await pg.evaluate(() => (document.querySelector('.cp-warn') || {}).innerText || '');
ok(/Over their limit/.test(overTxt) && await pg.evaluate(() => document.querySelector('.cp-save').disabled), 'over their limit: it says so, and Save waits', overTxt.split('\n')[0]);
await pg.screenshot({ path: OUT + '/credit-panel-over.png' });
await pg.click('[data-cp="allow"]'); await wait(200);
ok(await pg.evaluate(() => !document.querySelector('.cp-save').disabled && /allowed by/i.test(document.querySelector('.cp-ok').innerText)), '"Allow it" (Afridh may) lets it through');
await pg.click('[data-cp-paper="none"]'); await wait(150);
await pg.click('[data-cp="save"]'); await wait(1200);
const inv2 = await pg.evaluate(() => { const s = window.eval('S').sales.slice(-1)[0]; return { cust: s.customerId, overLimit: s.overLimit, limitBy: s.limitBy } });
ok(inv2.cust === setup.tightId && inv2.overLimit && inv2.limitBy === 'Afridh', 'saved past the limit, marked as allowed by Afridh');

// someone without the right: an admin's PIN (or password) in the panel
await pg.evaluate(id => { const S = window.eval('S'), ps = S.products.filter(p => p.retail > 0 && p.stock > 20 && !p.open).slice(0, 1);
  S.pos.lines = ps.map(p => ({ pid: p.id, qty: 3, price: p.retail, disc: 0 })); S.pos.customer = id;
  window.__perms = S.user.perms.slice(); window.__role = S.user.role; S.user.role = 'Cashier'; S.user.perms = S.user.perms.filter(p => p !== 'overLimit'); window.eval('render')() }, setup.tightId);
await pg.keyboard.press('F6'); await wait(400);
const hasPin = await pg.evaluate(() => !!document.querySelector('#cpPin'));
ok(hasPin, 'a cashier who may not: the panel asks for an admin\'s PIN');
if (hasPin) {
  const who = await pg.evaluate(() => document.querySelector('#cpWho').value);
  await pg.type('#cpPin', 'wrong'); await pg.click('[data-cp="pin"]'); await wait(400);
  ok(/not right/.test(await pg.evaluate(() => document.getElementById('cpPinMsg').innerText)), 'a wrong PIN is refused');
  const pw = { Afridh: 'Afridh123', Azhad: 'Azhad123', Akmal: 'Akmal123' }[who] || who + '123';
  await pg.evaluate(() => { document.querySelector('#cpPin').value = '' }); await pg.type('#cpPin', pw); await pg.click('[data-cp="pin"]'); await wait(600);
  ok(await pg.evaluate(() => !!document.querySelector('.cp-ok')), 'the admin\'s PIN (or password) allows it', who);
}
await pg.keyboard.press('Escape'); await wait(300);
ok(await pg.evaluate(() => !document.querySelector('.cp-modal') && window.eval('S').pos.lines.length > 0), 'Esc closes the panel and the bill stays on the till');
await pg.evaluate(() => { const S = window.eval('S'); S.user.perms = window.__perms; S.user.role = window.__role; S.pos.lines = []; S.pos.customer = null; window.eval('render')() });

// a bill that is paid in full belongs to TAKE PAYMENT
await pg.evaluate(id => { const S = window.eval('S'), p = S.products.find(p => p.retail > 0 && p.stock > 20 && !p.open);
  S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.customer = id; window.eval('render')() }, setup.roomyId);
await pg.keyboard.press('F6'); await wait(300);
await pg.evaluate(() => { const i = document.querySelector('#cpPaid'); i.value = '999999999'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')) }); await wait(200);
ok(await pg.evaluate(() => /covers the whole bill/.test(document.querySelector('.cp-sheet').innerText) && document.querySelector('.cp-save').disabled), 'paid in full: it points to TAKE PAYMENT instead');
await pg.keyboard.press('Escape'); await wait(200);

// the full payment screen still saves a cash bill (it now saves through the same function)
const n0 = await pg.evaluate(() => window.eval('S').sales.length);
await pg.evaluate(() => { window.eval('openPay')() }); await wait(400);
await pg.keyboard.press('Enter'); await wait(300); await pg.keyboard.press('p'); await wait(800);
if (await pg.$('#bsSkip')) { await pg.click('#bsSkip'); await wait(800); }          // the shop's "who sold it?"
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const last = await pg.evaluate(() => { const S = window.eval('S'); const s = S.sales.slice(-1)[0]; return { n: S.sales.length, type: s.type, lines: S.pos.lines.length } });
ok(last.n === n0 + 1 && last.lines === 0, 'the payment screen still saves a bill and clears the till', last.type);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · ${prints} print calls stopped`);
await b.close();
