// Prepare a payment, split by the amount: two cheques (or cheque and cash) for one payment.
//  · one part to start with, its amount following the amount to pay
//  · + Add another: the new part takes what is still to place; the line says when the parts add up
//  · parts that do not add up, a cheque with no number, two cheques with the same number: refused
//  · prepared: the list says each cheque with its amount; the slip lists every part
//  · issued: every cheque goes out as written (two cheques in Cheques out, with their numbers), the books once
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-suppaysplit.mjs
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
const sup = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {};
  const S = window.eval('S'); const s = S.suppliers.find(x => window.eval('prOwingBills')(x.id).length); window.eval('go')('payreqs'); window.eval('prPrepareNew')(s.id);
  return { id: s.id, owed: window.eval('partyBal')('S', s.id) } });
await wait(300);
const setA = (sel, v) => pg.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }, String(v));
await setA('#ppA', '30000');
let st = await pg.evaluate(() => ({ n: document.querySelectorAll('#ppParts tr').length, a0: document.querySelector('[data-pp="0.amount"]').value }));
ok(st.n === 1 && st.a0 === '30000', 'one part to start with, its amount following the amount to pay', JSON.stringify(st));
await pg.$eval('[data-pp="0.amount"]', el => { el.removeAttribute('readonly') });
await pg.click('#ppAdd'); await wait(150);
await setA('[data-pp="0.amount"]', '20000'); await pg.evaluate(() => document.querySelector('[data-pp="0.amount"]').dispatchEvent(new Event('change', { bubbles: true })));
await setA('[data-pp="1.amount"]', '5000');
st = await pg.evaluate(() => ({ n: document.querySelectorAll('#ppParts tr').length, sum: document.getElementById('ppSum').textContent }));
ok(st.n === 2 && /still to place/.test(st.sum), '+ Add another: a second part; the line says what is still to place', JSON.stringify(st));
await setA('[data-pp="0.no"]', '100201'); await setA('[data-pp="1.no"]', '100201');
await pg.click('#ppGo'); await wait(200);
ok(/add up/.test(await pg.$eval('#ppM', el => el.textContent)), 'parts that do not add up: refused');
await setA('[data-pp="1.amount"]', '10000');
ok(/✓ 2 parts add up/.test(await pg.$eval('#ppSum', el => el.textContent)), 'the line says when they add up');
await pg.click('#ppGo'); await wait(200);
ok(/same number/.test(await pg.$eval('#ppM', el => el.textContent)), 'two cheques with the same number: refused');
await setA('[data-pp="1.no"]', '100202');
await pg.screenshot({ path: SHOT + '/suppay-split.png' });
await pg.click('#ppGo'); await wait(400);
const r = await pg.evaluate(sid => { const S = window.eval('S'); const r = S.payReqs.filter(x => x.sid === sid && x.source === 'shop').pop();
  return { id: r.id, status: r.status, parts: (r.prep.parts || []).map(p => p.no + ':' + p.amount), what: window.eval('prepWhat')(r.prep) } }, sup.id);
ok(r.status === 'ready' && r.parts.join() === '100201:20000,100202:10000', 'prepared in 2 parts: cheque 100201 for Rs 20,000 and 100202 for Rs 10,000', JSON.stringify(r));
ok(/100201.*20,000.*\+.*100202.*10,000/.test(r.what), 'it says each cheque with its amount', r.what);
await pg.evaluate(id => window.eval('prSlip')(window.eval('payReqs')().find(x => x.id === id)), r.id); await wait(300);
const slip = await pg.evaluate(() => (document.querySelector('.modal .voucher') || {}).innerText || '');
ok(/Part 1/.test(slip) && /Part 2/.test(slip) && /100201/.test(slip) && /100202/.test(slip) && /30,000/.test(slip), 'the slip lists both cheques, and the Rs 30,000 together');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// issue: both cheques out, the books once
const before = await pg.evaluate(sid => window.eval('partyBal')('S', sid), sup.id);
await pg.evaluate(id => window.eval('prIssue')(window.eval('payReqs')().find(x => x.id === id)), r.id); await wait(300);
const iss = await pg.evaluate(() => (document.querySelector('.modal') || {}).innerText || '');
ok(/2 parts/.test(iss) && /100201/.test(iss) && /100202/.test(iss), 'Issue it: the window lists both parts as written');
await pg.click('#piGo'); await wait(500);
const done = await pg.evaluate((id, sid, before) => { const S = window.eval('S'); const r = S.payReqs.find(x => x.id === id);
  const chq = S.cheques.filter(c => c.dir === 'ISSUED' && ['100201', '100202'].includes(c.no)).map(c => c.no + ':' + c.amount + ':' + c.status);
  return { status: r.status, chq, fell: before - window.eval('partyBal')('S', sid) } }, r.id, sup.id, before);
ok(done.status === 'issued' && done.chq.length === 2 && Math.abs(done.fell - 30000) < 0.01, 'issued: two cheques in Cheques out with their own numbers, what is owed falls by Rs 30,000', JSON.stringify(done));
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('persist')(true) }); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
