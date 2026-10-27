// A bill on the Bills page: large and small print in one press, keys for each, and the camera from the
// moment the bill was made.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-billacts.mjs [screenshot-dir] [a-jpeg-to-stand-in-for-the-recorder]
// Nothing reaches the printers or the cameras on this PC: the print helper and the camera helper are
// both answered here — prints are counted, and the camera answers with the picture given.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const JPEG = process.argv[3] && fs.existsSync(process.argv[3]) ? fs.readFileSync(process.argv[3]) : Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
const prints = []; let played = [], oldHelper = false;
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url();
  // the pictures kept with a bill on the shop's server — three stand-ins
  if (/\/api\/cams\/shots\//.test(u)) return rq.respond({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ shots: [0, 1, 2].map(k => ({ url: '/kept-shot-' + k + '.jpg', at: new Date().toISOString() })) }) });
  if (/\/kept-shot-\d\.jpg$/.test(u)) return rq.respond({ status: 200, contentType: 'image/jpeg', body: JPEG });
  if (/^https?:\/\/(localhost|127\.0\.0\.1):4101\//.test(u)) {           // the camera helper, answered here
    const p = new URL(u);
    if (p.pathname === '/health') return rq.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, helper: 'camera', live: true, cameras: 2, ...(oldHelper ? {} : { playback: true }) }) });
    if (p.pathname === '/playback') { played.push(Object.fromEntries(p.searchParams)); return rq.respond({ status: 200, contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: JPEG }) }
    return rq.respond({ status: 404, body: '' });
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u)) { if (/\/(print|label)\b/.test(u)) prints.push(JSON.parse(rq.postData() || '{}').format); return rq.abort() }
  if (/\/api\/print\b/.test(u) && rq.method() === 'POST') { prints.push('queue:' + JSON.parse(rq.postData() || '{}').format);
    return rq.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }) }   // taken, as the shop's queue would — nothing is queued
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
const no = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'); S.cameras = [{ id: 'c1', name: 'Counter', channel: 101 }, { id: 'c2', name: 'Store', channel: 201 }];
  const s = S.sales.filter(x => x.time && x.lines && x.lines.length).slice(-1)[0];
  window.eval('billSel = ' + JSON.stringify(s.no)); window.eval('go')('bills'); return s.no });
await wait(600);
const tiles = await pg.$$eval('.bl-tile b', e => e.map(x => x.textContent));
ok(tiles.join() === 'Large bill,Small bill,Look first,Camera', 'four tiles: large, small, look first, camera', tiles.join(' · '));
ok(await pg.evaluate(() => new Set([...document.querySelectorAll('.bl-tile')].map(e => Math.round(e.getBoundingClientRect().top))).size === 1), 'all four on one line');
ok(await pg.evaluate(() => [...document.querySelectorAll('.bl-more > div > span')].map(e => e.textContent).join()) === 'Send,Change', 'the rest in one small row: Send, Change');
ok(await pg.evaluate(() => !!document.querySelector('[data-act="billPrint"][data-f="a5"]') && !!document.querySelector('[data-act="billPrint"][data-f="r80"]')), 'Large bill and Small bill are buttons of their own');
await pg.screenshot({ path: OUT + '/bill-acts.png' });
const lay = await pg.evaluate(() => [...document.querySelectorAll('.bl-tile, .bl-more .btn')].every(b => b.getBoundingClientRect().height < 64));
ok(lay, 'no button breaks over two lines');

// print in one press, and by key
const before = prints.length;
await pg.click('[data-act="billPrint"][data-f="a5"]'); await wait(700);
ok(prints.length === before + 1 && /a5/.test(prints.at(-1)) && !(await pg.$('.modal')), 'Large bill goes straight to the A5 printer — no preview to click through', prints.slice(before).join(','));
await pg.click('[data-act="billPrint"][data-f="r80"]'); await wait(700);
ok(prints.length === before + 2 && /r80/.test(prints.at(-1)), 'Small bill goes straight to the 80mm printer');
await pg.keyboard.down('Alt'); await pg.keyboard.press('KeyL'); await pg.keyboard.up('Alt'); await wait(700);
ok(prints.length === before + 3 && /a5/.test(prints.at(-1)), 'Alt+L prints the large bill');
await pg.keyboard.down('Alt'); await pg.keyboard.press('KeyS'); await pg.keyboard.up('Alt'); await wait(700);
ok(prints.length === before + 4 && /r80/.test(prints.at(-1)), 'Alt+S prints the small bill');
await pg.keyboard.down('Alt'); await pg.keyboard.press('KeyP'); await pg.keyboard.up('Alt'); await wait(700);
ok(!!(await pg.$('.modal')) && prints.length === before + 4, 'Alt+P shows it first, without printing');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// the camera
const inv = await pg.evaluate(n => { const s = window.eval('S').sales.find(x => x.no === n); return { date: s.date, time: s.time } }, no);
await pg.keyboard.down('Alt'); await pg.keyboard.press('KeyC'); await pg.keyboard.up('Alt'); await wait(1200);
ok(!!(await pg.$('.modal #bcImg')), 'Alt+C opens the bill\'s camera');
ok(await pg.evaluate(() => { const r = document.querySelector('.modal .box').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 }), 'the camera window fits a 1366×768 screen — nothing to scroll');
const p1 = played.at(-1) || {};
const m = String(inv.time).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?/i); let h = +m[1]; if (/p/i.test(m[4] || '') && h < 12) h += 12; if (/a/i.test(m[4] || '') && h === 12) h = 0;
const billAt = new Date(+inv.date.slice(0, 4), +inv.date.slice(5, 7) - 1, +inv.date.slice(8, 10), h, +m[2], +(m[3] || 0));
const want = new Date(billAt.getTime() - 30000);
const stamp = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
ok(p1.start === stamp(want), 'it plays from 30 seconds before the bill', `${inv.date} ${inv.time} → ${p1.start}`);
ok(await pg.evaluate(() => document.getElementById('bcMsg').style.display === 'none'), 'and the picture is showing');
await pg.screenshot({ path: OUT + '/bill-cam.png' });
await pg.evaluate(() => document.querySelector('[data-j="120"]').click()); await wait(500);
ok((played.at(-1) || {}).start === stamp(new Date(want.getTime() + 120000)), '+ 2 min moves it on two minutes');
await pg.evaluate(() => document.querySelector('[data-cam="c2"]').click()); await wait(500);
ok((played.at(-1) || {}).ch === '201', 'picking the other camera plays that one', 'ch ' + (played.at(-1) || {}).ch);
ok(await pg.evaluate(() => localStorage.getItem('regal_bill_cam')) === 'c2', 'and it is the one that comes up next time on this till');
await pg.keyboard.press('Escape'); await wait(800);
ok(await pg.evaluate(() => !document.querySelector('#bcImg')), 'Esc closes it (and lets the recorder go)');
// a helper from before playback: straight to the pictures kept with the bill, and how to put it right
oldHelper = true;
await pg.evaluate(() => { window.eval('camHelper = null') });
await pg.evaluate(n => window.eval('billCam')(n), no); await wait(1200);
ok(await pg.evaluate(() => document.querySelectorAll('.bc-thumbs img').length) === 3, 'an old camera helper: it opens on the 3 pictures kept with the bill');
await pg.screenshot({ path: OUT + '/bill-cam-old.png' });
await pg.evaluate(() => document.querySelector('[data-mode="rec"]').click()); await wait(300);
ok(/needs a restart/.test(await pg.evaluate(() => document.getElementById('bcMsg').innerText)), 'and Recording says the helper needs a restart, and how');
await pg.keyboard.press('Escape'); await wait(300);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
