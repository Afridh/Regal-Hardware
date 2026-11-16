// The cost code as the old SePOS "Price Code Updater" made it (16 Nov 2026, the owner sent its screen):
//   1 2 3 4 5 6 7 8 9 0 → B L A C K N I G H T, double digit X, extra digit T, "after original digit" unticked:
//   1,500 → BKXT (the X in front of the repeated digit) · ticked → BKTX · cost 950 with MRP 1,500 → T + HKT
//   every code reads back to its number, both ways; the settings page shows the boxes, the examples and the tick.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-costcode.mjs [folder for a screenshot]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 860 });
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
await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(1000);
const r = await pg.evaluate(() => {
  const C = window.eval('CFG'), cc = window.eval('costCode'), dec = window.eval('costDecode'), lab = window.eval('labelCostCode');
  C.cost.word = 'BLACKNIGHT'; C.cost.repeat = 'X'; C.cost.pad = 'T'; delete C.cost.front;          // a shop that never set it: the old way
  const front = { 1500: cc(1500), 1000: cc(1000), 950: cc(950), 1100: cc(1100), 2345: cc(2345), 1500.4: cc(1500.4) };
  const label = lab({ cost: 950 }, 1500);
  const rt = n => dec(cc(n)) === window.eval('fmt')(n);
  const nums = [1, 10, 11, 100, 101, 110, 111, 1000, 1100, 1500, 9999, 12000, 45550, 100000, 3030, 988];
  const rtFront = nums.filter(n => !rt(n));
  C.cost.front = false; const back = { 1500: cc(1500), 1000: cc(1000) }; const rtBack = nums.filter(n => !rt(n)); delete C.cost.front;
  return { front, label, back, rtFront, rtBack, decFront: dec('BKXT') };
});
ok(r.front[1500] === 'BKXT', '1,500 → BKXT (double digit letter in front, as the old system)', r.front[1500]);
ok(r.front[1000] === 'BXTT' && r.front[1100] === 'XBXT', '1,000 → BXTT, 1,100 → XBXT', r.front[1000] + ' ' + r.front[1100]);
ok(r.front[950] === 'HKT' && r.front[2345] === 'LACK' && r.front['1500.4'] === 'BKXT', '950 → HKT, 2,345 → LACK, rupees only', JSON.stringify(r.front));
ok(r.label === 'THKT', 'extra digit: cost 950 with MRP 1,500 prints THKT', r.label);
ok(r.back[1500] === 'BKTX' && r.back[1000] === 'BTXT', 'ticked "after original digit": 1,500 → BKTX, 1,000 → BTXT', JSON.stringify(r.back));
ok(!r.rtFront.length && !r.rtBack.length && /1,500.00/.test(r.decFront), 'every code reads back to its number, both ways', JSON.stringify([r.rtFront, r.rtBack, r.decFront]));
// the settings page
await pg.evaluate(() => { window.eval('go')('settings'); window.eval('setTab = "cost"'); window.eval('render')() }); await wait(400);
const pgv = await pg.evaluate(() => ({ boxes: [...document.querySelectorAll('[data-cw]')].map(i => i.value).join(''), dbl: (document.querySelector('[data-set="cost.repeat"]') || {}).value, pad: (document.querySelector('[data-set="cost.pad"]') || {}).value,
  ex: (document.querySelector('.pcu-ex') || {}).innerText, tick: (document.getElementById('costBack') || {}).checked }));
ok(pgv.boxes === 'BLACKNIGHT' && pgv.dbl === 'X' && pgv.pad === 'T' && pgv.tick === false, 'the page: ten letter boxes, Double digit X, Extra digit T, the tick off', JSON.stringify(pgv));
ok(/BKXT/.test(pgv.ex) && /BKTX/.test(pgv.ex) && /THKT/.test(pgv.ex.replace(/\s/g, '')), 'its examples: front BKXT, back BKTX, cost THKT', JSON.stringify(pgv.ex));
if (SHOTS) { const el = await pg.$('.pcu'); if (el) await el.screenshot({ path: path.join(SHOTS, 'costcode.png') }) }
// typing a letter in a box changes the word; the tick changes the code
await pg.click('[data-cw="0"]'); await pg.keyboard.type('Z'); await pg.keyboard.press('Tab'); await wait(300);
const w1 = await pg.evaluate(() => window.eval('CFG').cost.word);
await pg.evaluate(() => { const C = window.eval('CFG'); C.cost.word = 'BLACKNIGHT'; window.eval('render')() }); await wait(200);
await pg.click('#costBack'); const f1 = await pg.evaluate(() => [window.eval('CFG').cost.front, window.eval('costCode')(1500)]);
await pg.evaluate(() => { delete window.eval('CFG').cost.front; window.eval('render')() });
ok(w1 === 'ZLACKNIGHT', 'typing in the 1 box changes that letter', w1);
ok(f1[0] === false && f1[1] === 'BKTX', 'ticking the box puts the double digit letter after', JSON.stringify(f1));
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
