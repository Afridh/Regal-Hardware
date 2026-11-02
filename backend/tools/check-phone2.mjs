// A second mobile for a customer or a supplier.
//  · the customer form takes a second mobile and "send texts to both numbers"; the card shows both
//  · the customer is found by either number
//  · ticked, a text to their main number goes to the second one too; not ticked, only the main one
//  · "send the bill to another number" offers both numbers as one-tap buttons
//  · a supplier takes a second phone the same way, found by either
//  · the account page signs in with the second mobile too
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-phone2.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
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
const A = '0771110201', B2 = '0771110202', SA = '0771110301', SB = '0771110302';
await pg.evaluate((A, SA) => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S');
  S.customers = S.customers.filter(x => x.name !== 'Two Number Test'); S.suppliers = S.suppliers.filter(x => x.name !== 'Two Phone Traders'); window.eval('go')('customers'); window.eval('custModal')() }, A, SA);
await wait(300);
ok(!!(await pg.$('#cmPhone2')) && !!(await pg.$('#cmBoth')), 'the customer form has a second mobile and "send texts to both numbers"');
await pg.type('#cmName', 'Two Number Test'); await pg.type('#cmPhone', A); await pg.type('#cmPhone2', B2); await pg.click('#cmBoth'); await pg.click('#cmOk'); await wait(400);
const c = await pg.evaluate(() => { const c = window.eval('S').customers.find(x => x.name === 'Two Number Test'); return c && { id: c.id, phone: c.phone, phone2: c.phone2, both: c.phone2Sms } });
ok(c && c.phone === A && c.phone2 === B2 && c.both === true, 'saved with both numbers', JSON.stringify(c));
const head = await pg.evaluate(() => document.body.innerText);
ok(head.includes(B2) && /texts to both/.test(head), 'their card shows the second mobile');
const found = await pg.evaluate(B2 => { const cm = window.eval('custMatch'); const c = window.eval('S').customers.find(x => x.name === 'Two Number Test'); return [cm(c, B2.slice(-6)), cm(c, '0771110201')] }, B2);
ok(found[0] && found[1], 'found by either number');
// texts
const sent = await pg.evaluate((A, B2) => { const S = window.eval('S'); const n0 = S.messages.length; window.eval('sms')(A, 'Hello from the shop', 'customer');
  const both = S.messages.slice(0, S.messages.length - n0).map(m => m.to);
  const c = S.customers.find(x => x.name === 'Two Number Test'); c.phone2Sms = false; const n1 = S.messages.length; window.eval('sms')(A, 'Hello again', 'customer');
  const one = S.messages.slice(0, S.messages.length - n1).map(m => m.to); c.phone2Sms = true; return { both, one } }, A, B2);
ok(sent.both.length === 2 && sent.both.includes(A) && sent.both.includes(B2), 'ticked: a text to the main number goes to the second one too', JSON.stringify(sent.both));
ok(sent.one.length === 1 && sent.one[0] === A, 'not ticked: only the main number', JSON.stringify(sent.one));
const owner = await pg.evaluate(A => { const S = window.eval('S'); const n0 = S.messages.length; window.eval('sms')(A, 'For the owner', 'owner'); return S.messages.length - n0 }, A);
ok(owner === 1, 'a text marked for the owner is not copied');
// send to another number: both one tap away
const btns = await pg.evaluate(cid => { const inv = { no: 'TEST-P2', total: 100, balance: 0, date: '', customerId: cid, lines: [] }; window.eval('billOther')(inv);
  const bs = [...document.querySelectorAll('[data-anp]')].map(x => x.dataset.anp); const b = document.querySelector('[data-anp]:last-child'); b && b.click();
  const v = document.getElementById('anPhone').value; document.querySelectorAll('.modal').forEach(m => m.remove()); return { bs, v } }, c.id);
ok(btns.bs.includes(A) && btns.bs.includes(B2) && btns.v === B2, '"send to another number" offers both numbers', JSON.stringify(btns));
// supplier
await pg.evaluate(() => { window.eval('go')('suppliers'); window.eval('supModal')() }); await wait(300);
ok(!!(await pg.$('#smPhone2')), 'the supplier form has a second phone');
await pg.type('#smName', 'Two Phone Traders'); await pg.type('#smPhone', SA); await pg.type('#smPhone2', SB); await pg.click('#smOk'); await wait(400);
const s = await pg.evaluate(SB => { const s = window.eval('S').suppliers.find(x => x.name === 'Two Phone Traders'); return s && { phone2: s.phone2, both: !!s.phone2Sms, found: window.eval('custMatch')(s, SB) } }, SB);
ok(s && s.phone2 === SB && !s.both && s.found, 'supplier saved with a second phone and found by it', JSON.stringify(s));
// the same number twice is refused
await pg.evaluate(id => window.eval('custModal')(id), c.id); await wait(300);
await pg.evaluate(A => { const i = document.getElementById('cmPhone2'); i.value = A }, A); await pg.click('#cmOk'); await wait(200);
const msg = await pg.evaluate(() => (document.getElementById('cmMsg') || {}).textContent || '');
ok(/same as the first/.test(msg), 'the same number twice is refused', msg);
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// sign in on the account page with the second mobile
await pg.evaluate(cid => { const S = window.eval('S'), C = window.eval('CFG'); const c = S.customers.find(x => x.id === cid); c.portal = true; c.pageOpen = true; window.eval('persist')(true) }, c.id);
await wait(2500);
const otp = await pg.evaluate(async B2 => { const r = await fetch('/api/my/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: B2 }) }); return { s: r.status, j: await r.json() } }, B2);
let signed = otp;
if (otp.s === 200 && otp.j.code) signed = await pg.evaluate(async (B2, code) => { const r = await fetch('/api/my/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: B2, code }) }); return { s: r.status, j: await r.json() } }, B2, otp.j.code);
ok(otp.s === 200 && signed.s === 200 && signed.j.name === 'Two Number Test', 'the account page signs in with the second mobile', JSON.stringify({ otp: otp.s, otpErr: otp.j.error, login: signed.s, name: signed.j && signed.j.name }));
// tidy up
await pg.evaluate(() => { const S = window.eval('S'); S.customers = S.customers.filter(x => x.name !== 'Two Number Test'); S.suppliers = S.suppliers.filter(x => x.name !== 'Two Phone Traders'); S.messages = S.messages.filter(m => !/Hello from the shop|Hello again|For the owner/.test(m.body)); window.eval('persist')(true) }); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
