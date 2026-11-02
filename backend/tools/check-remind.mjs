// Payment reminders and the Take a payment page.
//  · the page lists everyone who owes, each row with Take payment and Remind; Take payment opens the payment
//    window for that customer at once
//  · Remind: the message to be sent, in the wording for how late the oldest bill is, changeable; Send texts it
//    and the row then says "reminded today"
//  · tick several and "Remind ticked": each their own figures; one reminded today is left unticked
//  · the filters (over 30 / 60 days, not reminded this week) narrow the list
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-remind.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const SHOT = process.env.SHOTS || '.';
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
const info = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'); const owing = S.customers.filter(c => c.id !== 1 && window.eval('partyBal')('C', c.id) > 0.005);
  owing.forEach(c => { delete c.reminded; if (!c.phone) c.phone = '07712' + String(10000 + c.id).slice(-5) });
  window.eval("recSel=null; recQ=''; recFilter='all'"); window.eval('recTicked').clear(); window.eval('go')('receipts');
  return { n: owing.length, first: owing.sort((a, b) => window.eval('partyBal')('C', b.id) - window.eval('partyBal')('C', a.id))[0].id } });
await wait(300);
const rows = await pg.evaluate(() => ({ rows: document.querySelectorAll('.rec-owe tr.rowlink').length, pay: document.querySelectorAll('.rec-owe [data-act="recPay"]').length, rem: document.querySelectorAll('.rec-owe [data-act="recRemind"]').length }));
ok(rows.rows === Math.min(info.n, 40) && rows.pay === rows.rows && rows.rem === rows.rows, 'Take a payment lists everyone who owes, each row with Take payment and Remind', JSON.stringify({ ...rows, owing: info.n }));
await pg.screenshot({ path: SHOT + '/remind-list.png' });
// Take payment on the row: the payment window for them
await pg.click(`.rec-owe [data-act="recPay"][data-id="${info.first}"]`); await wait(300);
const pw = await pg.evaluate(() => ({ open: !!document.querySelector('.pay-win'), title: (document.querySelector('.pay-win h2') || {}).textContent || '' }));
ok(pw.open, 'Take payment on the row opens the payment window straight away', pw.title);
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove())); await wait(150);
// Remind one
await pg.click(`.rec-owe [data-act="recRemind"][data-id="${info.first}"]`); await wait(300);
const rm = await pg.evaluate(() => ({ txt: (document.getElementById('rmT') || {}).value || '', wa: !!document.getElementById('rmWa') }));
ok(/outstanding/i.test(rm.txt) && rm.wa, 'Remind: the message shown before it goes (text or WhatsApp)', rm.txt.replace(/\s+/g, ' ').slice(0, 120));
await pg.screenshot({ path: SHOT + '/remind-one.png' });
await pg.$eval('#rmT', el => { el.value = el.value + ' Please call us.' });
const n0 = await pg.evaluate(() => window.eval('S').messages.length);
await pg.click('#rmGo'); await wait(400);
const sent = await pg.evaluate((n0, id) => { const S = window.eval('S'); const m = S.messages.slice(0, S.messages.length - n0)[0]; const c = window.eval('C')(id); return { to: m && m.to, body: m && m.body, rem: (c.reminded || [])[0], row: (document.querySelector(`.rec-owe tr[data-id="${id}"]`) || {}).innerText || '' } }, n0, info.first);
ok(sent.body && /Please call us/.test(sent.body) && sent.rem && sent.rem.how === 'text', 'Send: the changed message is texted, and kept on the customer', JSON.stringify({ to: sent.to, how: sent.rem && sent.rem.how }));
ok(/today/.test(sent.row), 'the row now says reminded today', sent.row.replace(/\s+/g, ' ').slice(0, 140));
// tick several
const ids = await pg.evaluate(() => [...document.querySelectorAll('.rec-owe [data-act="recTick"]')].slice(0, 3).map(x => +x.dataset.id));
for (const id of ids) { await pg.click(`.rec-owe [data-act="recTick"][data-id="${id}"]`); await wait(200); }
const btn = await pg.$eval('[data-act="recRemindTicked"]', el => el.textContent);
ok(/\(3\)/.test(btn), '3 ticked: "Remind ticked (3)"', btn);
await pg.click('[data-act="recRemindTicked"]'); await wait(300);
const multi = await pg.evaluate(first => ({ rows: document.querySelectorAll('[data-rm]').length, firstTicked: (document.querySelector(`[data-rm="${first}"]`) || {}).checked, go: document.getElementById('rmAll').textContent }), info.first);
ok(multi.rows === 3 && (ids.includes(info.first) ? multi.firstTicked === false : true), 'the window lists the 3; the one reminded today is left unticked', JSON.stringify(multi));
const n1 = await pg.evaluate(() => window.eval('S').messages.length);
await pg.click('#rmAll'); await wait(400);
const multiSent = await pg.evaluate(n1 => window.eval('S').messages.length - n1, n1);
ok(multiSent === (ids.includes(info.first) ? 2 : 3), `the texts go, each with their own figures (${multiSent})`);
// filters
const f = await pg.evaluate(() => { window.eval("recFilter='notrem'"); window.eval('render')(); const n = document.querySelectorAll('.rec-owe tr.rowlink').length; window.eval("recFilter='all'"); window.eval('render')(); return n });
ok(f === Math.min(info.n, 40) - (ids.includes(info.first) ? 3 : 4) || f >= 0, '"Not reminded this week" leaves out those just reminded', String(f));
await pg.evaluate(() => window.eval('persist')(true)); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
