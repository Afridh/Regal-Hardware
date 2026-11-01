// Calling customers about what they owe, and their categories.
//  · a customer gets a category (Bazaar, Construction…) from their form — a new one can be made there
//  · "Log a call": what they said — a promise (an amount and a day), call later, no answer… — and a note
//  · the promise comes back on its day (Credit follow-up and the Action centre), is "broken" when the day passes
//    unpaid, and "kept" once the money comes in; the customer's page keeps the history
//  · the outstanding list filters by category, and the collector's list prints for one
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-calls.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Estate' : undefined));
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/:41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''") });

// a customer who owes
const cid = await pg.evaluate(() => { const S = window.eval('S'); const c = S.customers.find(x => x.id !== 1 && window.eval('partyBal')('C', x.id) > 1000); S.calls = (S.calls || []).filter(x => x.cid !== c.id); delete c.cat; return c.id });

// 1. the category, from their form — and a new one made there
await pg.evaluate(id => window.eval('custModal')(id), cid); await wait(300);
await pg.select('#cmCat', 'Construction'); await pg.$eval('#cmOk', x => x.click()); await wait(300);
ok(await pg.evaluate(id => window.eval('C')(id).cat, cid) === 'Construction', 'the customer form gives them a category');
await pg.evaluate(id => window.eval('custModal')(id), cid); await wait(300);
await pg.select('#cmCat', '__new'); await pg.waitForSelector('#abGo'); await pg.$eval('#abT', (el, v) => { el.value = v }, "Estate"); await pg.$eval('#abGo', x => x.click()); await wait(400);
const made = await pg.evaluate(() => document.querySelector('#cmCat').value);
await pg.select('#cmCat', 'Construction'); await pg.$eval('#cmOk', x => x.click()); await wait(300);
ok(made === 'Estate' && await pg.evaluate(() => window.eval('custCats')().includes('Estate')), 'a new category can be made right there', made);

// 2. a call: they promise to pay today
await pg.evaluate(id => { window.eval("custSel=" + id); window.eval('go')('customers') }, cid); await wait(400);
ok(!!(await pg.$(`[data-act="callLog"][data-id="${cid}"]`)), "the customer's page has Log a call");
await pg.$eval(`[data-act="callLog"][data-id="${cid}"]`, x => x.click()); await wait(300);
await pg.$eval('.cl-out[data-o="promise"]', x => x.click());
const today = await pg.evaluate(() => window.eval('D')(window.eval('today')));
await pg.$eval('#clDate', (el, d) => { el.value = d }, today);
await pg.$eval('#clAmt', el => { el.value = '1500' });
await pg.type('#clNote', 'waiting for the site payment');
await pg.screenshot({ path: process.env.SHOT || 'call-log.png' });
await pg.$eval('#clOk', x => x.click()); await wait(400);
const x1 = await pg.evaluate(id => window.eval('callsOf')(id)[0], cid);
ok(x1 && x1.outcome === 'promise' && x1.amount === 1500 && x1.next === today && /site payment/.test(x1.note), 'the call is kept: a promise of Rs 1,500 for today, with the note', JSON.stringify(x1 && { o: x1.outcome, a: x1.amount, n: x1.next }));
const page = await pg.evaluate(() => document.querySelector('.cl-card') ? document.querySelector('.cl-card').innerText : '');
ok(/Will pay on a date/.test(page) && /site payment/.test(page), "the customer's page shows it under Calls & follow-up");

// 3. it comes back today: Credit follow-up and the Action centre
const du = await pg.evaluate(() => { window.eval("callShow='due'; duCat=''"); window.eval('go')('dues'); return document.querySelector('#main').innerText });
ok(/Calls & promises/.test(du) && /waiting for the site payment/.test(du), 'Credit follow-up: it is on today\'s list');
const ac1 = await pg.evaluate(id => window.eval('actionItems')().find(x => x.key && x.key.startsWith('call') && x.who === window.eval('C')(id).name), cid);
ok(ac1 && /promised Rs 1,500.00 today/.test(ac1.title), 'the Action centre: "promised Rs 1,500 today"', ac1 && ac1.title);
await pg.screenshot({ path: process.env.SHOT2 || 'calls-dues.png', fullPage: true });

// 4. the day passes unpaid: broken
await pg.evaluate(id => { const x = window.eval('callsOf')(id)[0]; x.next = window.eval('D')(new Date(Date.now() - 2 * 864e5)) }, cid);
const st2 = await pg.evaluate(id => ({ st: window.eval('promiseState')(window.eval('callsOf')(id)[0]), ac: (window.eval('actionItems')().find(x => x.key && x.key.startsWith('call') && x.who === window.eval('C')(id).name) || {}) }), cid);
ok(st2.st === 'broken' && st2.ac.pri === 1 && /Promise broken/.test(st2.ac.tag), 'the day passes unpaid: "promise broken", at the top of the Action centre', JSON.stringify({ st: st2.st, tag: st2.ac.tag }));

// 5. the money comes in: kept, and off the list
await pg.evaluate(id => { const x = window.eval('callsOf')(id)[0]; x.next = window.eval('D')(window.eval('today'));
  window.eval('receiveCustomer')({ customerId: id, amount: 1500, method: 'CASH' }) }, cid); await wait(200);
const st3 = await pg.evaluate(id => ({ st: window.eval('promiseState')(window.eval('callsOf')(id)[0]), inQ: window.eval('callQueue')().some(r => r.c.id === id) }), cid);
ok(st3.st === 'kept' && !st3.inQ, 'they pay: the promise is kept, and off the list', JSON.stringify(st3));

// 6. call later, no answer: back on the day said; a new call answers the one before
await pg.evaluate(id => window.eval('callLog')(id), cid); await wait(300);
await pg.$eval('.cl-out[data-o="later"]', x => x.click()); await wait(100);
const tomorrow = await pg.evaluate(() => document.querySelector('#clDate').value);
await pg.$eval('#clOk', x => x.click()); await wait(300);
const later = await pg.evaluate(id => { const l = window.eval('callsOf')(id); return { o: l[0].outcome, next: l[0].next, prevClosed: !!l[1].closed, open: (window.eval('callOpen')(id) || {}).id === l[0].id } }, cid);
ok(later.o === 'later' && later.next === tomorrow && later.next > today && later.prevClosed && later.open, '"Call later": back tomorrow, and it answers the call before', JSON.stringify(later));

// 7. the outstanding list by category, and the collector's list
const cat = await pg.evaluate(() => { window.eval("duCat='Construction'"); window.eval('go')('dues');
  const rows = [...document.querySelectorAll('#main table')].find(t => /Last call/.test(t.innerText)); return { chips: !!document.querySelector('[data-act="duCat"][data-k="Construction"]'), rows: rows ? rows.querySelectorAll('tr').length - 1 : -1,
    all: window.eval('S').customers.filter(c => c.cat === 'Construction' && window.eval('custAge')(c.id).n > 0).length } });
ok(cat.chips && cat.rows === cat.all, 'the outstanding list filters to one category', JSON.stringify(cat));
const popup = new Promise(r => b.once('targetcreated', async tg => r(await tg.page())));
await pg.$eval('[data-act="duSheet"]', x => x.click());
const sheet = await popup; await wait(800);
const sh = await sheet.evaluate(() => document.body.innerText);
ok(/collection list: Construction/i.test(sh) && /Collected/.test(sh), "the collector's list for Construction: who, where, how much, and boxes to fill");
await sheet.close();
await pg.evaluate(() => { window.eval("duCat=''"); window.eval('persist')(true) });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
