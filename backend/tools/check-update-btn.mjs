// An update put on the server never loads by itself: a button says "Update made — click to update".
//  · the app's files change on the server while a till is open: the till does NOT reload; the button shows
//  · with a bill on the till, the button asks to finish or hold it first and does not reload
//  · with the till clear, pressing it loads the new version
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-update-btn.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/regal-bridge.js');
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.dismiss());
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(4000);   // the till has heard the server's build once
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.__same = 'this page'; const S = window.eval('S'); S.pos.lines = [] });
// an update lands on the server: the bridge file is touched (its time is what the server calls the build)
const now = new Date(); fs.utimesSync(bridge, now, now);
await wait(9000);
const st = await pg.evaluate(() => ({ same: window.__same, btn: (document.getElementById('updReady') || {}).innerText || '' }));
ok(st.same === 'this page', 'the till did not reload by itself', st.same);
ok(/Update made — click to update/.test(st.btn), 'the button says "Update made — click to update"', st.btn);
// a bill on the till: asked to finish it first
await pg.evaluate(() => { const S = window.eval('S'); const p = S.products.find(x => x.active !== false); S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }] });
await pg.click('#updReady'); await wait(1200);
const busy = await pg.evaluate(() => ({ same: window.__same, toast: [...document.querySelectorAll('.toast,#toasts *')].map(x => x.innerText).join(' ') }));
ok(busy.same === 'this page' && /Finish or hold the bill/.test(busy.toast), 'with a bill on the till it asks to finish or hold it first, and stays', JSON.stringify(busy).slice(0, 200));
// till clear: press it, the new version loads
await pg.evaluate(() => { window.eval('S').pos.lines = [] });
await Promise.all([pg.waitForNavigation({ timeout: 15000 }).catch(() => null), pg.click('#updReady')]);
await wait(1500);
const after = await pg.evaluate(() => ({ same: window.__same || null, btn: !!document.getElementById('updReady') }));
ok(after.same === null && !after.btn, 'pressed with the till clear: the new version loads, the button is gone', JSON.stringify(after));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
