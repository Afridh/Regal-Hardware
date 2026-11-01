// Settings: picking a section in the list on the left does not throw the page — or the list — back to the top.
// The list scrolls by itself inside the screen and keeps its place; the new section opens at its own top.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-settings-scroll.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 680 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(2000);
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("setTab='shop'"); window.eval('go')('settings') }); await wait(600);
const fit = await pg.evaluate(() => { const sn = document.querySelector('.subnav'), r = sn.getBoundingClientRect(); return { h: Math.round(r.height), vh: innerHeight, own: sn.scrollHeight > sn.clientHeight } });
ok(fit.h <= fit.vh && fit.own, 'the section list fits the screen and scrolls by itself', JSON.stringify(fit));
// down to the last section, and pick it
const pick = await pg.evaluate(() => { const sn = document.querySelector('.subnav'); sn.scrollTop = sn.scrollHeight; const btns = [...sn.querySelectorAll('[data-settab]')]; const last = btns[btns.length - 1]; return { top: sn.scrollTop, tab: last.dataset.settab } });
await pg.$eval(`[data-settab="${pick.tab}"]`, x => x.click()); await wait(700);
const after = await pg.evaluate(t => { const sn = document.querySelector('.subnav'), btn = sn.querySelector(`[data-settab="${t}"]`), r = btn.getBoundingClientRect();
  return { top: sn.scrollTop, on: btn.classList.contains('on'), seen: r.top >= 0 && r.bottom <= innerHeight, main: document.querySelector('#main').scrollTop, setTab: window.eval('setTab') } }, pick.tab);
ok(after.on && after.setTab === pick.tab, `the last section opens (${pick.tab})`);
ok(Math.abs(after.top - pick.top) < 4 && after.seen, 'the list stays where it was — the button just pressed is still on the screen', JSON.stringify({ before: pick.top, after: after.top, seen: after.seen }));
ok(after.main === 0, 'the new section shows from its own top');
// and once more, a section in the middle
const mid = await pg.evaluate(() => { const sn = document.querySelector('.subnav'); sn.scrollTop = Math.round(sn.scrollHeight / 3); const btns = [...sn.querySelectorAll('[data-settab]')].filter(x => { const r = x.getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight }); return { top: sn.scrollTop, tab: btns[Math.floor(btns.length / 2)].dataset.settab } });
await pg.$eval(`[data-settab="${mid.tab}"]`, x => x.click()); await wait(700);
const m2 = await pg.evaluate(() => document.querySelector('.subnav').scrollTop);
ok(Math.abs(m2 - mid.top) < 4, 'and again from the middle: the list does not move', `${mid.top} → ${m2}`);
// on a phone the list wraps across the top, as before
await pg.setViewport({ width: 420, height: 800, isMobile: true }); await pg.evaluate(() => window.eval('go')('settings')); await wait(500);
const phone = await pg.evaluate(() => { const sn = document.querySelector('.subnav'); return sn ? getComputedStyle(sn).position : 'no list on the phone' });
ok(phone === 'static' || phone === 'no list on the phone', 'on a phone the list sits across the top as before', phone);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
