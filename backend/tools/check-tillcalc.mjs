// The small Calculator button on the till: sums by mouse and by keyboard, and it leaves the bill alone.
// While it is open no key reaches the till: above all Esc, which on the till clears the bill.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-tillcalc.mjs [screenshot-dir]
// The till here never reaches the print helper on this PC: its printers are the shop's.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
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
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const p = window.eval('prefs')(); delete p.tillLook; p.till = 'classic';
  window._printed = []; window.printPaper = (h, f, n) => { window._printed.push(n) };
  const S = window.eval('S'), q = S.products.find(x => x.active !== false && x.stock > 10 && x.retail > 100 && !x.serialised);
  S.pos.lines = [{ pid: q.id, qty: 2, price: q.retail, disc: 0 }]; window.eval('go')('pos') });
await wait(700);

const open = () => pg.evaluate(() => document.querySelector('[data-act="csCalc"]').click()).then(() => wait(200));
const shown = () => pg.evaluate(() => { const x = document.getElementById('calcNow'); return x ? x.textContent : null });
const lines = () => pg.evaluate(() => window.eval('S').pos.lines.length);
const q = () => pg.evaluate(() => (document.getElementById('csQ') || {}).value);
const typed = async (t) => { for (const k of t) await pg.keyboard.press(k === '\n' ? 'Enter' : k); await wait(60) };
const clickKeys = async (list) => { for (const k of list) await pg.evaluate(v => document.querySelector(`#calcKeys [data-k="${v}"]`).click(), k); await wait(60) };

ok(await pg.evaluate(() => !!document.querySelector('.till.sp-look .till-out [data-act="csCalc"]')), 'the button is on the till');
await open();
ok(await shown() === '0', 'it opens at 0', String(await shown()));
if (OUT) { await clickKeys(['1', '2', '5', '0', '*', '4']); await pg.screenshot({ path: OUT + '/till-calc.png' }); await pg.keyboard.press('c'); }
await pg.keyboard.press('c');
await clickKeys(['7', '5', '0', '+', '2', '5', '0', '=']);
ok(await shown() === '1,000', 'by mouse: 750 + 250 = 1,000', await shown());

const sums = [['12*4\n', '48'], ['100/8\n', '12.5'], ['10-25\n', '-15'], ['0.1+0.2\n', '0.3'], ['1000-10%\n', '900'], ['200*15%\n', '30'], ['50%\n', '0.5'], ['2+3+4\n', '9'], ['1000-10%+5\n', '905'], ['8*2\n3+1\n', '4'], ['9+1\n*3\n', '30'], ['2.5*2\n', '5'], ['1250*12\n', '15,000']];
for (const [t, want] of sums) { await pg.keyboard.press('c'); await typed(t); ok(await shown() === want, JSON.stringify(t) + ' gives ' + want, await shown()) }
await pg.keyboard.press('c'); await typed('5/0\n');
ok(/divide/i.test(await shown()), 'dividing by 0 says so', await shown());
await typed('7+1\n'); ok(await shown() === '8', 'and the next sum starts clean', await shown());
await pg.keyboard.press('c'); await typed('1234'); await pg.keyboard.press('Backspace'); await wait(50);
ok(await shown() === '123', 'Backspace takes off a figure', await shown());
await pg.keyboard.press('c'); await typed('1..5\n'); ok(await shown() === '1.5', 'a second point is ignored', await shown());
await pg.keyboard.press('c'); await typed('12345678901234567890');
ok((await shown()).replace(/,/g, '').length <= 14, 'it stops at 14 figures', await shown());
await pg.keyboard.press('c'); await typed('5+\n'); ok(await shown() === '5', 'an operator with nothing after it does no harm', await shown());

// nothing reaches the till
ok(await lines() === 1 && (await q() || '') === '', 'nothing typed went on the bill or in the item box', JSON.stringify(await q()));
await pg.keyboard.press('F10'); await wait(400);
ok(await pg.evaluate(() => !document.getElementById('payModal') && !!document.getElementById('calcNow')) && (await pg.evaluate(() => window._printed.length)) === 0, 'F10 does not take the bill to payment behind it');
await pg.keyboard.press('Escape'); await wait(250);
ok(await shown() === null, 'Esc closes it');
ok(await lines() === 1, 'and the bill is still there: Esc did not clear it', String(await lines()));
ok(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'csQ'), 'the cursor is back in the item box');
await pg.keyboard.type('xy'); await wait(100);
ok((await q()) === 'xy', 'and keys go to the till again', await q());
await pg.evaluate(() => { document.getElementById('csQ').value = ''; document.getElementById('csQ').dispatchEvent(new Event('input', { bubbles: true })) }); await wait(150);

// closing by the X and by a click outside; a redraw behind it
await open(); await typed('42'); await pg.evaluate(() => window.eval('render')()); await wait(150);
ok(await shown() === '42', 'a redraw of the till behind it leaves the sum alone', await shown());
await pg.evaluate(() => document.getElementById('calcClose').click()); await wait(150);
ok(await shown() === null, 'the X closes it');
await open(); await pg.evaluate(() => document.querySelector('.modal.calcbox').click()); await wait(150);
ok(await shown() === null, 'a click outside closes it');
await pg.keyboard.type('7'); await wait(100);
ok((await q()) === '7', 'and the keys are the till\'s again after that', await q());
await pg.evaluate(() => { document.getElementById('csQ').value = ''; document.getElementById('csQ').dispatchEvent(new Event('input', { bubbles: true })) }); await wait(150);
await open(); ok(await pg.evaluate(() => document.querySelectorAll('.modal.calcbox').length === 1), 'one calculator, not two');
await pg.evaluate(() => document.querySelector('[data-act="csCalc"]')?.click()); await wait(150);
ok(await pg.evaluate(() => document.querySelectorAll('.modal.calcbox').length <= 1), 'pressing the button again does not stack another');
await pg.keyboard.press('Escape'); await wait(200);

// the other till layouts
for (const [till, sel] of [['quick', '.qpos'], ['pos', '.pos']]) {
  await pg.evaluate(k => { window.eval('prefs')().till = k; window.eval('render')() }, till); await wait(400);
  ok(await pg.evaluate(c => !!document.querySelector(c + ' [data-act="csCalc"]'), sel), `the ${till} till has it`);
  await open(); await typed('6*7\n'); ok(await shown() === '42', `${till} till: it works`, String(await shown()));
  await pg.keyboard.press('Escape'); await wait(200);
  ok(await shown() === null && await lines() === 1, `${till} till: Esc closes it and the bill stays`);
}
await pg.evaluate(() => { window.eval('prefs')().till = 'classic'; window.eval('render')() }); await wait(300);

// the other look, and small windows
await pg.evaluate(() => { window.eval('prefs')().tillLook = 'regal'; window.eval('render')() }); await wait(400);
ok(await pg.evaluate(() => !document.querySelector('.till.sp-look') && !!document.querySelector('.till-out [data-act="csCalc"]')), 'the other till look has it too');
await pg.evaluate(() => { delete window.eval('prefs')().tillLook; window.eval('render')() }); await wait(300);
for (const [w, h] of [[1024, 600], [390, 780]]) {
  await pg.setViewport({ width: w, height: h }); await wait(400);
  const f = await pg.evaluate(() => { const k = document.querySelector('[data-act="csCalc"]'); if (!k) return { on: false }; const r = k.getBoundingClientRect(); return { on: r.left >= 0 && r.right <= innerWidth + 1 && r.width > 0, over: document.documentElement.scrollWidth - innerWidth } });
  ok(f.on, `${w}x${h}: the button is on the screen`, JSON.stringify(f));
  await open();
  ok(await pg.evaluate(() => { const r = document.querySelector('.calcbox .box').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.top >= 0 && r.width <= 290 && r.height < 500 }), `${w}x${h}: the calculator is small and fits`);
  ok(await pg.evaluate(() => { const p = document.querySelector('.ph-bar'); if (!p) return true; const r = p.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(e && e.closest('.modal.calcbox')) }), `${w}x${h}: nothing behind it can be pressed`);
  if (OUT && w === 390) await pg.screenshot({ path: OUT + '/till-calc-phone.png' });
  await pg.keyboard.press('Escape'); await wait(200);
}
ok(errs.length === 0, 'no errors in the page', errs.join(' | '));
await pg.evaluate(() => { window.eval('S').pos.lines = []; window.eval('render')() });
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
