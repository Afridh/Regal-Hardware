// Taking a customer payment: the amount is typed, never filled in for you.
//  · the window opens with the amount box empty — what they owe shows in grey; Enter on it adds nothing
//  · a typed amount and Enter: that much, as cash, recorded and done in one press (3 Nov 2026)
//  · a card part first, then the cash and Enter: both, done
//  · "Pay it all": the whole of what is left goes in, and Enter then takes it
//  · the cheque / card / bank form starts empty too
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-payamount.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
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
await wait(1500);
const c = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.payGate = () => false;
  const S = window.eval('S'); const x = S.customers.find(y => y.id !== 1 && window.eval('partyBal')('C', y.id) > 2000); window.eval('custPayModal')(x.id); return { id: x.id, owes: window.eval('partyBal')('C', x.id) } });
await wait(300);
const parts = () => pg.evaluate(() => [...document.querySelectorAll('.pay-part b')].map(x => x.textContent));
const box = await pg.evaluate(() => ({ v: document.getElementById('ra').value, ph: document.getElementById('ra').placeholder, full: !!document.querySelector('[data-full="ra"]'), focus: document.activeElement && document.activeElement.id }));
ok(box.v === '' && /to pay/.test(box.ph), 'the amount box opens empty — what they owe in grey', JSON.stringify(box));
await pg.keyboard.press('Enter'); await wait(250);
ok((await parts()).length === 0, 'Enter on the empty box adds nothing (it used to take the whole outstanding)');
const pays = () => pg.evaluate(id => window.eval('S').payments.filter(p => p.customerId === id && p.dir === 'IN').map(p => ({ m: p.method, a: p.amount })), c.id);
const owing = () => pg.evaluate(id => window.eval('partyBal')('C', id), c.id);
const open = async () => { await pg.evaluate(id => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('custPayModal')(id) }, c.id); await wait(300) };
const winOpen = () => pg.evaluate(() => !!document.querySelector('.pay-win'));
const n0 = (await pays()).length;
await pg.type('#ra', '750'); await pg.keyboard.press('Enter'); await wait(600);
let ps = await pays();
ok(ps.length === n0 + 1 && ps.at(-1).m === 'CASH' && Math.abs(ps.at(-1).a - 750) < 0.01 && !(await winOpen()), 'a typed 750 and Enter: Rs 750 cash, recorded and done in one press', JSON.stringify(ps.slice(n0)));
ok(Math.abs((await owing()) - (c.owes - 750)) < 0.01, 'what they owe is down by 750');
// a card part first, then the cash and Enter: both, done
await open();
await pg.evaluate(() => [...document.querySelectorAll('[data-pm="CARD"]')].forEach(b2 => b2.click())); await wait(250);
await pg.$eval('#sfAmt', el => { el.value = '200' }); await pg.click('#sfOk'); await wait(250);
ok((await parts()).length === 1 && await winOpen(), 'a card part is added and the window waits');
await pg.$eval('#ra', el => { el.value = '' }); await pg.type('#ra', '300'); await pg.keyboard.press('Enter'); await wait(600);
ps = await pays();
ok(ps.length === n0 + 3 && !(await winOpen()), 'then cash 300 and Enter: card and cash both recorded, done', JSON.stringify(ps.slice(n0 + 1)));
// Pay it all, then Enter: the whole of what is left, done
await open();
await pg.click('[data-full="ra"]'); await wait(150);
const filled = await pg.$eval('#ra', el => el.value);
ok(Math.abs(+filled - (await owing())) < 0.01, 'Pay it all: the rest goes in the box', filled);
await pg.keyboard.press('Enter'); await wait(700);
ok(Math.abs(await owing()) < 0.01 && !(await winOpen()), 'and Enter takes it: nothing owing, done');
await open();
// the card form starts empty too
await pg.evaluate(() => { document.querySelectorAll('.pay-part .x').forEach(x => x.click()) }); await wait(200);
await pg.evaluate(() => { const ps = document.querySelectorAll('[data-px]'); ps.forEach(() => {}); });
await pg.evaluate(() => [...document.querySelectorAll('[data-pm="CARD"]')].forEach(b2 => b2.click())); await wait(250);
const card = await pg.evaluate(() => ({ v: (document.getElementById('sfAmt') || {}).value, full: !!document.querySelector('[data-full="sfAmt"]') }));
const left0 = await owing();
ok(card.v === '' && (card.full || left0 < 0.01), 'the card form: amount empty, with Pay it all while anything is owing', JSON.stringify({ ...card, owing: left0 }));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
