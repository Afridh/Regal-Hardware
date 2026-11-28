// Tradesmen (28 Nov 2026, the owner asked): plumbers, electricians, carpenters with their details, found by trade and
//   area, and the shop's offers texted to them from Send to many.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-tradesmen.mjs [shot-folder]
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
await pg.evaluate(() => { window.eval('persist=()=>{}'); window.__sms = []; window.eval('sms=(to,body,aud)=>{ window.__sms.push({to,body:window.eval("letter")(aud,body),aud}) }'); const S = window.eval('S'); S.trades = []; window.eval('go')('trades') });
await pg.waitForSelector('[data-act="tradeNew"]');
const add = async (o) => {
  await pg.$eval('[data-act="tradeNew"]', e => e.click()); await pg.waitForSelector('#teOk');
  await pg.evaluate(o => { const s = (i, v) => { const e = document.getElementById(i); if (e.type === 'checkbox') e.checked = v; else e.value = v };
    for (const [k, v] of Object.entries(o)) if (k !== 'teK') s(k, v);
    // the trades: tick the ones in the list, type the others in
    for (const k of [].concat(o.teK || [])) { const cb = [...document.querySelectorAll('#teKs input')].find(c => c.value === k);
      if (cb) cb.checked = true; else { document.getElementById('teKNew').value = k; document.getElementById('teKAdd').click() } } }, o);
  await pg.$eval('#teOk', e => e.click()); await wait(250);
};
await add({ teN: 'Sunil Perera', teK: 'Plumber', teP: '0771234501', teP2: '0712345601', teBoth: true, teArea: 'Kaduruwela', teAd: '12 Lake Rd', teBd: '1985-03-14', teNo: 'big housing jobs' });
await add({ teN: 'Kamal Silva', teK: ['Electrician', 'Plumber'], teP: '0771234502', teArea: 'Hingurakgoda' });
await add({ teN: 'Nimal Fernando', teK: 'Carpenter', teP: '0771234503', teArea: 'Kaduruwela' });
await add({ teN: 'Ruwan Jayasuriya', teK: 'Plumber', teP: '0771234504', teArea: 'Hingurakgoda', teO: false });
await add({ teN: 'Ajith Kumara', teK: 'Aluminium fitter', teP: '0771234505', teArea: 'Kaduruwela' });
await add({ teN: 'Dup Person', teK: 'Mason', teP: '0771234501' });
const noK = await pg.evaluate(() => { const m = document.getElementById('teMsg'); return m ? m.textContent : '' }); await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await add({ teN: 'No Trade', teP: '0771234599' });
const noT = await pg.evaluate(() => (document.getElementById('teMsg') || {}).textContent || '');
const st = await pg.evaluate(() => { const S = window.eval('S'), x = S.trades.find(t => t.name === 'Sunil Perera'), msg = document.getElementById('teMsg'); const r = { n: S.trades.length, x }; document.querySelectorAll('.modal').forEach(m => m.remove()); return r });
st.dup = noK + ' / ' + noT; ok(st.n === 5 && /already has/.test(st.dup) && /at least one trade/.test(st.dup), 'five added; the same mobile twice is refused; no trade ticked is refused too', st.dup);
ok(st.x.phone2 === '0712345601' && st.x.phone2Sms && st.x.area === 'Kaduruwela' && st.x.address === '12 Lake Rd' && st.x.birthday === '1985-03-14' && st.x.notes === 'big housing jobs', 'their details are kept');
ok(await pg.evaluate(() => window.eval('tradeCfg')().kinds.includes('Aluminium fitter')), 'a trade typed in is in the list next time');
let txt = await pg.evaluate(() => document.querySelector('#main').innerText);
ok(/Plumber 3/.test(txt) && /Electrician 1/.test(txt) && /Carpenter 1/.test(txt), 'the page counts them by trade');
await pg.$eval('[data-act="tradeKind"][data-k="Plumber"]', e => e.click()); await wait(200);
txt = await pg.evaluate(() => document.querySelector('#main').innerText);
ok(/Sunil Perera/.test(txt) && /Ruwan/.test(txt) && /Kamal/.test(txt) && !/Nimal/.test(txt), 'Plumber shows the plumbers, Kamal too: he does both');
ok(await pg.evaluate(() => JSON.stringify(window.eval('S').trades.find(x => x.name === 'Kamal Silva').kinds) === '["Electrician","Plumber"]'), 'Kamal is kept as an electrician and a plumber');
await pg.$eval('[data-act="tradeKind"][data-k=""]', e => e.click()); await wait(200);
await pg.type('#trQ', 'hingura'); await wait(250);
txt = await pg.evaluate(() => document.querySelector('#main').innerText);
ok(/Kamal/.test(txt) && /Ruwan/.test(txt) && !/Sunil/.test(txt) && await pg.evaluate(() => document.activeElement.id === 'trQ'), 'searching by area, the box keeps the typing');
await pg.evaluate(() => { window.eval("tradeQ=''"); window.eval('render')() });
if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await wait(5000); await pg.screenshot({ path: path.join(SHOTS, 'trades-page.png') }) }
// offers to every plumber, then to everyone in Kaduruwela
await pg.$eval('[data-act="tradeKind"][data-k="Plumber"]', e => e.click()); await wait(200);
await pg.$eval('[data-act="tradeSms"]', e => e.click()); await pg.waitForSelector('#bkText');
let sum = await pg.evaluate(() => document.querySelector('.bk-sum').innerText);
ok(/^2 will get it/.test(sum.trim()), 'Plumbers: Kamal too; the one who asked for no offers is left out', sum.trim().slice(0, 40));
await pg.type('#bkText', 'Hi {name}, PVC fittings 10% off this week at {shop}.'); await wait(150);
if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'trades-sms.png') });
await pg.$eval('#bkGo', e => e.click()); await wait(900);
let sent = await pg.evaluate(() => window.__sms);
ok(sent.length === 2 && sent[0].to === '0771234501' && sent[0].aud === 'trade' && /^Dear Friend,\nHi Sunil, PVC fittings 10% off/.test(sent[0].body), 'the plumber gets it, by first name, greeted as a tradesman', JSON.stringify(sent[0] && sent[0].body.slice(0, 50)));
await pg.evaluate(() => { window.__sms = []; window.eval("BK.kind=''; BK.area='Kaduruwela'; BK.body='New stock in'"); document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('bulkSmsModal')() }); await wait(200);
await pg.$eval('#bkGo', e => e.click()); await wait(1200);
sent = await pg.evaluate(() => window.__sms.map(x => x.to).sort());
ok(JSON.stringify(sent) === JSON.stringify(['0771234501', '0771234503', '0771234505']), 'Kaduruwela: every trade there', JSON.stringify(sent));
ok(await pg.evaluate(() => window.eval('msgAudience')('0771234502') === 'trade' && window.eval('ph2Of')('0771234501') === '0712345601'), 'a text typed to one of them greets them as a tradesman; the second number gets it too');
// the Tradesmen tab beside Customers and Suppliers; switched off, it takes the Super Admin to where it is switched on
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('go')('customers') }); await wait(400);
await pg.$eval('.pt-kind [data-act="tradesTab"]', e => e.click()); await wait(300);
ok(await pg.evaluate(() => window.eval('S').view === 'trades'), 'Customers → the Tradesmen tab opens the tradesmen');
await pg.evaluate(() => { window.eval('CFG').features = { ...(window.eval('CFG').features || {}), trades: false }; window.eval('go')('suppliers') }); await wait(400);
await pg.$eval('.pt-kind [data-act="tradesTab"]', e => e.click()); await wait(300);
ok(await pg.evaluate(() => window.eval('S').view === 'settings' && !!document.querySelector('[data-feat="trades"]')), 'switched off: the tab takes the Super Admin to Features, to tick it');
await pg.evaluate(() => { delete window.eval('CFG').features.trades });
ok(!errs.length, 'no errors on the page', errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
