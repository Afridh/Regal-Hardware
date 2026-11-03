// A customer payment: the texts, the voucher printing once, and No print.
//  · a payment in two parts (cash + card): ONE text to the customer for the whole of it, and the owner's own copy
//  · "text the receipt" unticked: no text to the customer, the owner still gets theirs
//  · the voucher prints once; its window opens on Close, so Enter closes it rather than printing again
//  · No print: nothing printed, and the box stays ticked the next time on this till
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-paytexts.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
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
await wait(1500);
const setup = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'), CFG = window.eval('CFG'); CFG.shop.owner = '0779990000'; CFG.msg.autoReceipt = true; CFG.msg.ownerPays = true; CFG.msg.ownerPayMin = 0;
  try { localStorage.removeItem('regal.noPrint') } catch (e) {}
  window.__printed = []; window.printPaper = (h, f, no) => window.__printed.push(no); window.payGate = () => false;
  const c = S.customers.find(x => x.id !== 1 && x.active !== false && window.eval('partyBal')('C', x.id) > 3000); c.phone = '0771230000';
  return { cid: c.id, owes: window.eval('partyBal')('C', c.id) } });
const pay = async (smsOn, noPrint) => {
  await pg.evaluate(c => { window.__msgs0 = window.eval('S').messages.length; window.eval('custPayModal')(c) }, setup.cid); await wait(300);
  if (noPrint !== undefined) await pg.$eval('.np-chk', (el, v) => { if (el.checked !== v) el.click() }, noPrint);
  if (!smsOn) await pg.$eval('#rsms', el => { if (el.checked) el.click() });
  // card 500 first, then cash 1,000 and Enter, which finishes (3 Nov 2026: Enter takes the cash and completes)
  await pg.keyboard.press('F9'); await wait(200); await pg.$eval('#sfAmt', el => { el.value = '500' }); await pg.click('#sfOk'); await wait(200);          // card 500
  await pg.$eval('#ra', el => { el.value = '1000'; el.dispatchEvent(new Event('input')) }); await pg.focus('#ra'); await pg.keyboard.press('Enter'); await wait(500);   // cash 1,000, done
  return pg.evaluate(() => ({ msgs: window.eval('S').messages.slice(0, window.eval('S').messages.length - window.__msgs0).map(m => ({ to: m.to, body: m.body })), printed: window.__printed.slice(),
    focus: document.activeElement && document.activeElement.className, voucher: !!document.querySelector('.voucher') }));
};
// 1. two parts, text on
const r1 = await pay(true);
const toCust = r1.msgs.filter(m => m.to === '0771230000'), toOwner = r1.msgs.filter(m => m.to === '0779990000');
ok(toCust.length === 1 && /1,500/.test(toCust[0].body), 'one text to the customer for the whole Rs 1,500 (not one per part)', JSON.stringify(toCust.map(m => m.body.slice(0, 120))));
ok(toOwner.length === 1 && /1,500/.test(toOwner[0].body) && /(cash \+ card|card \+ cash)/.test(toOwner[0].body), "the owner's own copy: amount, from whom, cash + card", JSON.stringify(toOwner.map(m => m.body.slice(0, 200))));
ok(r1.printed.length === 1 && r1.voucher && /vclose/.test(r1.focus || ''), 'the voucher printed once, its window on Close', JSON.stringify({ printed: r1.printed, focus: r1.focus }));
await pg.keyboard.press('Enter'); await wait(300);
const after = await pg.evaluate(() => ({ printed: window.__printed.length, open: !!document.querySelector('.voucher') }));
ok(after.printed === 1 && !after.open, 'Enter closes the voucher — no second copy', JSON.stringify(after));
// 2. text unticked
await pg.evaluate(() => { window.__printed = [] });
const r2 = await pay(false);
ok(!r2.msgs.some(m => m.to === '0771230000') && r2.msgs.some(m => m.to === '0779990000'), '"text the receipt" unticked: nothing to the customer, the owner still told', JSON.stringify(r2.msgs.map(m => m.to)));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// 3. No print, and it stays ticked
await pg.evaluate(() => { window.__printed = [] });
const r3 = await pay(true, true);
ok(r3.printed.length === 0 && !r3.voucher, 'No print: the payment is saved and nothing prints', JSON.stringify({ printed: r3.printed, voucher: r3.voucher }));
await pg.evaluate(c => { window.eval('custPayModal')(c) }, setup.cid); await wait(300);
const sticky = await pg.$eval('.np-chk', el => el.checked);
ok(sticky, 'the next payment window has No print still ticked');
await pg.$eval('.np-chk', el => el.click()); await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
ok(await pg.evaluate(() => localStorage.getItem('regal.noPrint')) === '0', 'unticked, it stays unticked');
// the owner's switch in Settings
const sw = await pg.evaluate(() => { window.eval("setTab='msg'"); window.eval('go')('settings'); return !!document.querySelector('[data-set="msg.ownerPays"]') && document.querySelector('[data-set="msg.ownerPays"]').checked });
ok(sw, 'Settings → Messages: "Text me each customer payment taken, too" — on');
await pg.evaluate(() => window.eval('persist')(true)); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
