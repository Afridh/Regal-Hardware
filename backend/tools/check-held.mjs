// Bills on hold: one bill is held once, a kept copy never brings it back, a till handed to somebody
// else keeps each person's bill to them, and the Held Bills window keeps its figures on one line.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-held.mjs [screenshot-dir]
// The till here never reaches the print helper on this PC — its printers are the shop's.
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
let blocked = 0;
pg.on('request', rq => { const u = rq.url(); if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u)) { blocked++; return rq.abort() } rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => { window.eval("CFG.print.agent=''"); document.querySelectorAll('.modal-bg,.modal').forEach(m => m.remove()) });

// a big bill on the till, with an open item named by hand
const draftKey = await pg.evaluate(() => { const S = window.eval('S'), ps = S.products.filter(p => p.retail > 0).slice(0, 6);
  S.heldBills = []; S.held = null; window.eval('go')('pos');
  S.pos.lines = ps.map(p => ({ pid: p.id, qty: 150, price: 1725.5, disc: 0 }));
  S.pos.lines.push({ pid: window.eval('OPEN_PID'), name: 'PVC pipe cut 3m', qty: 4, price: 21500, disc: 0, open: true });
  window.eval('savePosDraft')(); window.eval('render')(); return window.eval('posDraftKey')() });
ok(await pg.evaluate(k => !!localStorage.getItem(k), draftKey), 'the bill being keyed is kept on this PC');

// hold it
await pg.evaluate(() => window.eval('holdCurrentBill')(true)); await wait(300);
await pg.keyboard.press('Enter'); await wait(500);
const after = await pg.evaluate(k => ({ held: window.eval('S').heldBills.length, lines: window.eval('S').pos.lines.length, kept: !!localStorage.getItem(k) }), draftKey);
ok(after.held === 1 && after.lines === 0, 'held: one bill on hold, the till is clear');
ok(!after.kept, 'and the kept copy is gone — it cannot come back at the next sign-in', JSON.stringify(after));

// an old kept copy (left by the earlier version) is not put back when it is on hold already
await pg.evaluate(k => { const h = window.eval('S').heldBills[0]; localStorage.setItem(k, JSON.stringify({ at: Date.now(), lines: h.lines, customer: h.customer })) }, draftKey);
const back = await pg.evaluate(() => window.eval('restorePosDraft')());
ok(!back && await pg.evaluate(() => window.eval('S').pos.lines.length) === 0, 'an old kept copy of a held bill is not put back on the screen');

// keying the same bill again and pressing Hold: told it is on hold already
await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines = JSON.parse(JSON.stringify(S.heldBills[0].lines)); window.eval('render')(); window.eval('holdCurrentBill')(true) }); await wait(300);
ok(/already on hold/i.test(await pg.evaluate(() => (document.querySelector('.modal') || {}).innerText || '')), 'holding the same bill again says it is already on hold');
await pg.screenshot({ path: OUT + '/held-twin.png' });
await pg.keyboard.press('Enter'); await wait(400);
const twin = await pg.evaluate(() => ({ held: window.eval('S').heldBills.length, lines: window.eval('S').pos.lines.length }));
ok(twin.held === 1 && twin.lines === 0, 'Enter clears the till; still one on hold', JSON.stringify(twin));
// "Hold another copy" is still possible on purpose
await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines = JSON.parse(JSON.stringify(S.heldBills[0].lines)); window.eval('holdCurrentBill')(true) }); await wait(300);
await pg.click('#hbCopy'); await wait(400);
ok(await pg.evaluate(() => window.eval('S').heldBills.length) === 2, '"Hold another copy" makes a second one when that is wanted');

// somebody else signs in at a locked till with a bill on the screen
const hand = await pg.evaluate(() => { const S = window.eval('S'), ps = S.products.filter(p => p.retail > 0);
  S.pos.lines = [{ pid: ps[7].id, qty: 2, price: ps[7].retail, disc: 0 }];
  const other = S.users.find(u => u.active !== false && u.name !== S.user.name);
  if (!other) return { skip: true };
  const me = S.user.name; localStorage.removeItem('regal_pos_draft:' + other.name.toLowerCase());
  window.eval('tillHandover').call(null, (S.user = { ...S.user, name: other.name }, me));
  const mine = JSON.parse(localStorage.getItem('regal_pos_draft:' + me.toLowerCase()) || 'null');
  const r = { other: other.name, screen: S.pos.lines.length, keptForMe: !!(mine && mine.lines.length === 1) };
  S.user = { ...S.user, name: me }; return r });
ok(hand.skip || (hand.screen === 0 && hand.keptForMe), 'a different person signing in does not get the last person\'s bill; it is kept for them', JSON.stringify(hand));
await pg.evaluate(() => { window.eval('clearPosDraft')(); const S = window.eval('S'); S.pos.lines = []; window.eval('render')() });

// the window
await pg.evaluate(() => window.eval('showHeldBillsModal')(0)); await wait(500);
await pg.screenshot({ path: OUT + '/held-window.png' });
const lay = await pg.evaluate(() => {
  const one = el => el && el.getClientRects().length === 1 && el.scrollWidth <= el.clientWidth + 1;
  const amts = [...document.querySelectorAll('.hb-c-amt, .hb-p-sum-row b')];
  const top = document.querySelector('.hb-c-top'), num = top.querySelector('.hb-c-num'), time = top.querySelector('.hb-c-time');
  return { oneLine: amts.every(e => e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).fontSize) * 1.8), n: amts.length,
    gap: time.getBoundingClientRect().left - num.getBoundingClientRect().right,
    open: [...document.querySelectorAll('.hb-p-tbl b')].some(b => b.textContent === 'PVC pipe cut 3m') };
});
ok(lay.oneLine, 'every amount sits on one line (no "Rs" above the number)', lay.n + ' amounts');
ok(lay.gap >= 4, 'the number and the time on a card are apart', lay.gap.toFixed(1) + 'px');
ok(lay.open, 'an open item shows the name typed for it');
await pg.setViewport({ width: 1024, height: 700 }); await wait(300);
await pg.screenshot({ path: OUT + '/held-window-1024.png' });
ok(await pg.evaluate(() => [...document.querySelectorAll('.hb-c-amt, .hb-p-sum-row b')].every(e => e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).fontSize) * 1.8)), 'and on a smaller screen too');
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · ${blocked} calls to the print helper blocked`);
await b.close();
