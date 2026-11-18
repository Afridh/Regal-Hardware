// Bills → To another number… (18 Nov 2026, the owner asked): a customer's name typed finds them; picking one puts their
//   mobile in, and someone else's number is not put on this bill's customer. A number typed still sends as before.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billsendname.mjs
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
const setup = await pg.evaluate(() => { const S = window.eval('S'); const id = Math.max(...S.customers.map(c => c.id)) + 1;
  S.customers.push({ id, code: 'CZ' + id, name: 'Zafrin Testname', phone: '0771112223', phone2: '0714445556', level: 'retail', limit: 0, address: 'Kaduruwela' });
  const inv = S.sales.filter(s => !s.cancelled && s.lines && s.lines.length).at(-1); return { id, no: inv.no, cust: inv.customerId } });
const sent = await pg.evaluate((no) => { window._sent = []; const inv = window.eval('S').sales.find(s => s.no === no);
  window.eval('askNumber')(inv, 'any', { text: to => window._sent.push(['text', to]), whatsapp: to => window._sent.push(['wa', to]) }); return 1 }, setup.no);
await wait(200);
await pg.type('#anPhone', 'zafrin'); await wait(200);
let rows = await pg.$$eval('#anList .bq-row', e => e.map(x => x.innerText.replace(/\s+/g, ' ')));
ok(rows.length === 1 && /Zafrin Testname/.test(rows[0]) && /0771112223/.test(rows[0]) && /0714445556/.test(rows[0]), 'typing a name lists the customer with both numbers', JSON.stringify(rows));
await pg.keyboard.press('Enter'); await wait(150);
let st = await pg.evaluate(() => ({ v: document.getElementById('anPhone').value, msg: document.getElementById('anMsg').textContent, list: document.getElementById('anList').innerHTML, keep: (document.getElementById('anKeep') || {}).checked }));
ok(st.v === '0771112223' && /Zafrin/.test(st.msg) && !st.list, 'Enter picks them: their mobile goes in, the box says who', JSON.stringify(st));
ok(st.keep !== true, "someone else's number is not ticked to go on this bill's customer", JSON.stringify(st.keep));
await pg.keyboard.press('Enter'); await wait(200);
let s = await pg.evaluate(() => window._sent);
ok(s.length === 1 && s[0][0] === 'text' && s[0][1] === '0771112223', 'Enter again sends it to that number', JSON.stringify(s));
// the second number by its button
await pg.evaluate((no) => { window._sent = []; window.eval('askNumber')(window.eval('S').sales.find(s => s.no === no), 'any', { text: to => window._sent.push(['text', to]), whatsapp: to => window._sent.push(['wa', to]) }) }, setup.no);
await wait(200); await pg.type('#anPhone', 'Testname'); await wait(200);
await pg.$eval('#anList button[data-ph="0714445556"]', e => e.click()); await wait(100);
ok(await pg.$eval('#anPhone', e => e.value) === '0714445556', 'their second number can be picked by its button');
await pg.$eval('#anWa', e => e.click()); await wait(200);
s = await pg.evaluate(() => window._sent);
ok(s.length === 1 && s[0][0] === 'wa' && s[0][1] === '0714445556', 'WhatsApp goes to it', JSON.stringify(s));
// a typed number still works, and no list shows for digits
await pg.evaluate((no) => { window._sent = []; window.eval('askNumber')(window.eval('S').sales.find(s => s.no === no), 'any', { text: to => window._sent.push(['text', to]) }) }, setup.no);
await wait(200); await pg.type('#anPhone', '0759998887'); await wait(150);
const lst = await pg.$eval('#anList', e => e.innerHTML); await pg.keyboard.press('Enter'); await wait(200);
s = await pg.evaluate(() => window._sent);
ok(!lst && s.length === 1 && s[0][1] === '0759998887', 'a number typed sends as before', JSON.stringify(s));
await pg.evaluate((id) => { const S = window.eval('S'); S.customers = S.customers.filter(c => c.id !== id); window.eval('closeModals')() }, setup.id);
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
