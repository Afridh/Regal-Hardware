// Sending a bill to another number, and putting a wrong number right.
//  · "To another number…" on a bill: the box starts empty, Send the text / WhatsApp go to what is typed,
//    the customer's card is left as it is unless "also make it their mobile" is ticked
//  · ticked: the card takes the new number, and the ordinary Text e-bill goes there from then on
//  · a number that is not a mobile is refused in the box
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billother.mjs
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
const info = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'); const inv = S.sales.filter(s => s.customerId !== 1 && !window.eval('isBF')(s) && s.lines.length).slice(-1)[0]; const c = window.eval('C')(inv.customerId);
  c.phone = '0773333333'; window.__sent = []; window.sms = (to, msg) => window.__sent.push({ to, msg }); window.wa = (to) => window.__sent.push({ to, wa: true }); window.sendBillView = () => {};
  window.eval('billSel=' + JSON.stringify(inv.no)); window.eval("billQ=''; billType='all'"); window.eval('go')('bills'); return { no: inv.no, cid: c.id } });
const btn = await pg.$(`[data-act="billOther"][data-no="${info.no}"]`);
ok(!!btn, 'the bill has "To another number…"');
// 1. send once to another number, the card stays
await btn.click(); await wait(250);
const box = await pg.evaluate(() => ({ v: document.querySelector('#anPhone').value, wa: !!document.querySelector('#anWa'), txt: !!document.querySelector('#anOk'), keep: document.querySelector('#anKeep') && document.querySelector('#anKeep').checked, label: (document.querySelector('label.chk') || {}).innerText || '' }));
ok(box.v === '' && box.wa && box.txt && box.keep === false && /0773333333/.test(box.label), 'the box starts empty, offers text and WhatsApp, and leaves the card alone by default', JSON.stringify(box));
await pg.type('#anPhone', '0712'); await pg.click('#anOk'); await wait(150);
const bad = await pg.evaluate(() => ({ open: !!document.querySelector('#anPhone'), msg: document.querySelector('#anMsg').textContent, sent: window.__sent.length }));
ok(bad.open && /not a mobile/.test(bad.msg) && bad.sent === 0, 'a short number is refused in the box', JSON.stringify(bad));
await pg.$eval('#anPhone', el => { el.value = '0714444444' }); await pg.click('#anOk'); await wait(200);
const r1 = await pg.evaluate(c => ({ sent: window.__sent.slice(), card: window.eval('C')(c).phone }), info.cid);
ok(r1.sent[0] && r1.sent[0].to === '0714444444' && /\nStill to pay|http|Bill/i.test(r1.sent[0].msg || 'x') && r1.card === '0773333333', 'the text goes to the number typed; the card keeps its own', JSON.stringify({ to: r1.sent[0] && r1.sent[0].to, card: r1.card }));
// the ordinary Text e-bill still goes to the card's number
await pg.evaluate(no => { window.__sent = []; document.querySelector(`[data-act="billSms"][data-no="${no}"]`).click() }, info.no); await wait(150);
ok((await pg.evaluate(() => window.__sent[0] && window.__sent[0].to)) === '0773333333', 'Text e-bill afterwards still goes to the card\'s number');
// 2. a wrong number on the card put right from the box, by WhatsApp
await pg.evaluate(no => { window.__sent = []; document.querySelector(`[data-act="billOther"][data-no="${no}"]`).click() }, info.no); await wait(250);
await pg.type('#anPhone', '0755555555'); await pg.click('#anKeep'); await pg.click('#anWa'); await wait(200);
const r2 = await pg.evaluate(c => ({ sent: window.__sent.slice(), card: window.eval('C')(c).phone }), info.cid);
ok(r2.sent[0] && r2.sent[0].wa && r2.sent[0].to === '0755555555' && r2.card === '0755555555', 'ticked: WhatsApp goes there and the card takes the new number', JSON.stringify(r2));
await pg.evaluate(no => { window.__sent = []; document.querySelector(`[data-act="billSms"][data-no="${no}"]`).click() }, info.no); await wait(150);
ok((await pg.evaluate(() => window.__sent[0] && window.__sent[0].to)) === '0755555555', 'and Text e-bill goes to the corrected number from then on');
// the message has its line break (not a broken string)
ok(/\n/.test(r1.sent[0].msg || ''), 'the text reads as before (line breaks intact)', JSON.stringify((r1.sent[0].msg || '').slice(0, 80)));
await pg.evaluate(() => window.eval('persist')(true)); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
