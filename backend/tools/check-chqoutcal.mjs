// Cheques given, as a calendar (25 Nov 2026, the owner asked): on Cheques out, what falls on each day, week and bank; a day
//   picked shows its cheques; the month prints on A4 landscape.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-chqoutcal.mjs [shot-folder]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 900 });
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
await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(2500);
// next month's cheques, so nothing of the sample shop is in the way (never saved)
const mk = await pg.evaluate(() => {
  window.eval('persist=()=>{}');
  const S = window.eval('S'), D = window.eval('D'), t = window.eval('today'), mk = D(new Date(t.getFullYear(), t.getMonth() + 7, 1)).slice(0, 7), [b1, b2] = S.banks;
  const add = (no, d, amount, bank, status) => S.cheques.push({ dir: 'ISSUED', no, bankId: bank.id, bank: bank.name, date: mk + '-' + d, payee: 'Payee ' + no, party: 'Payee ' + no, amount, status });
  add('910001', '01', 10000, b1, 'ISSUED'); add('910002', '10', 20000, b1, 'PRINTED'); add('910003', '10', 5000, b2, 'ISSUED');
  add('910004', '15', 7000, b1, 'CLEARED'); add('910005', '15', 99000, b1, 'CANCELLED'); add('910006', '28', 4000, b2, 'BOUNCED');
  add('910007', '28', 1500, b2, 'ISSUED'); window.eval('go')('chequesOut'); return mk });
await pg.waitForSelector('#coCal', { timeout: 8000 });
ok(true, 'Cheques out shows the calendar');
ok(await pg.evaluate(() => document.querySelector('#coCal').textContent.includes(window.eval('today').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))), 'it opens on this month');
for (let i = 0; i < 7; i++) { await pg.$eval('#coCal [data-act="coStep"][data-d="1"]', e => e.click()); await wait(120) }
const read = () => pg.evaluate(() => { const o = {}; document.querySelectorAll('#coCal .chq-cal-d.has').forEach(e => { o[e.dataset.d.slice(8)] = e.querySelector('b').textContent + '/' + e.querySelector('i').textContent }); return { o, wk: [...document.querySelectorAll('#coCal .co-wk b')].reduce((a, e) => a + +e.textContent.replace(/,/g, ''), 0), t: document.querySelector('#coCal').textContent, days: document.querySelectorAll('#coCal .chq-cal-d:not(.co-out):not(.co-wk)').length } });
let r = await read();
const dim = new Date(+mk.slice(0, 4), +mk.slice(5), 0).getDate();
ok(r.days === dim, 'every day of the month is there', `${r.days} of ${dim}`);
ok(JSON.stringify(r.o) === JSON.stringify({ '01': '10,000/1 cheque', 10: '25,000/2 cheques', 28: '1,500/1 cheque' }) || (r.o['01'] === '10,000/1 cheque' && r.o['10'] === '25,000/2 cheques' && r.o['28'] === '1,500/1 cheque' && Object.keys(r.o).length === 3), 'each day: what falls on it, not the cleared, cancelled or bounced', JSON.stringify(r.o));
ok(r.wk === 36500 && /36,500/.test(r.t), 'the weeks add up to the month', r.wk);
await pg.$eval('#coCal [data-d$="-10"][data-act="coDay"]', e => e.click()); await wait(200);
r = await read();
ok(/910002/.test(r.t) && /910003/.test(r.t) && !/910001/.test(r.t), 'a day picked shows its cheques');
if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await wait(6000); await pg.screenshot({ path: path.join(SHOTS, 'chqoutcal.png') }) }
await pg.$eval('#coCal [data-act="coWhich"][data-k="all"]', e => e.click()); await wait(200);
r = await read();
ok(r.o['15'] === '7,000/1 cheque' && r.wk === 43500, 'All: the cleared ones too, never the cancelled', JSON.stringify([r.o['15'], r.wk]));
const html = await pg.evaluate(() => { let h = ''; window.open = () => ({ document: { write(x) { h += x }, close() {} } }); window.eval('coPrint')(); return h });
ok(/A4 landscape/.test(html) && /910004/.test(html) && !/910005/.test(html) && /43,500\.00/.test(html), 'it prints on A4 landscape, with every cheque and the total');
if (SHOTS) { const p2 = await b.newPage(); await p2.setContent(html.replace(/<script>[\s\S]*?<\/script>/, '')); await p2.setViewport({ width: 1050, height: 720 }); await p2.screenshot({ path: path.join(SHOTS, 'chqoutcal-print.png') }); await p2.close() }
await pg.setViewport({ width: 390, height: 800 }); await wait(500);
ok(await pg.evaluate(() => document.querySelector('#coCal').getBoundingClientRect().right <= innerWidth + 1), 'on a phone it stays inside the screen');
ok(!errs.length, 'no errors on the page', errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
