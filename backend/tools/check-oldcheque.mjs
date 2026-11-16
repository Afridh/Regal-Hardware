// Cheques given to suppliers before they were on the system (16 Nov 2026, the owner asked):
//   Cheques out → "+ A cheque given before": not cleared + still owed → a payment, the balance comes down, it waits in
//   Cheques out (Cleared / Bounced work); already taken off → the balance stays; already cleared → for the record.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-oldcheque.mjs
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
const setup = await pg.evaluate(() => {
  const S = window.eval('S'); const sp = S.suppliers[0], b = S.banks[0];
  S.cheques = S.cheques.filter(c => !/^9990\d\d$/.test(c.no));
  return { sid: sp.id, name: sp.name, bank: b.id, owe: window.eval('partyBal')('S', sp.id), held: window.eval('bal')(b.ac) };
});
const fill = async (no, amt, st, off) => {
  await pg.select('#ocSup', String(setup.sid)); await pg.select('#ocBank', String(setup.bank));
  await pg.$eval('#ocNo', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')) }, no);
  await pg.$eval('#ocAmt', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')) }, amt);
  await pg.select('#ocSt', st); await pg.select('#ocOff', off);
};
await pg.evaluate(() => { window.eval('go')('chequesOut') }); await wait(400);
await pg.click('[data-act="oldChq"]'); await wait(300);
ok(!!(await pg.$('#ocNo')), 'Cheques out has "+ A cheque given before" and it opens the form');
await fill('999001', '10000', 'OUT', 'no'); await wait(100);
const say = await pg.$eval('#ocSay', e => e.innerText);
ok(/After this/.test(say), 'the form says what they will be owed after', say);
await pg.click('#ocMore'); await wait(400);
await fill('999002', '5000', 'OUT', 'yes'); await pg.click('#ocMore'); await wait(400);
await fill('999003', '2500', 'CLEARED', 'no'); await pg.click('#ocMore'); await wait(400);
await fill('999001', '1', 'OUT', 'no'); await pg.click('#ocOk'); await wait(400);
const r = await pg.evaluate((s) => {
  const S = window.eval('S'), pb = window.eval('partyBal'), bal = window.eval('bal');
  const c = n => S.cheques.find(x => x.no === n && x.dir === 'ISSUED');
  return { owe: pb('S', s.sid), held: bal(S.banks[0].ac), c1: c('999001'), c2: c('999002'), c3: c('999003'), dup: S.cheques.filter(x => x.no === '999001').length,
    list: document.getElementById('main').innerText.includes('999002'), out: -bal('2110') };
}, setup);
ok(Math.abs(r.owe - (setup.owe - 12500)) < 0.01, 'what is owed comes down by the two cheques still owed (10,000 + 2,500), not the one already off', `${setup.owe} → ${r.owe}`);
ok(r.c1 && r.c1.status === 'PRINTED' && r.c1.old && /^P/.test(r.c1.ref), 'not cleared, still owed: a payment, waiting to clear', JSON.stringify(r.c1 && [r.c1.status, r.c1.ref]));
ok(r.c2 && r.c2.status === 'PRINTED' && r.c2.ref === 'Given before', 'already taken off: the cheque only', JSON.stringify(r.c2 && [r.c2.status, r.c2.ref]));
ok(r.c3 && r.c3.status === 'CLEARED' && Math.abs(r.held - setup.held) < 0.01, 'already cleared: kept for the record, the bank figure untouched', JSON.stringify(r.c3 && r.c3.status));
ok(r.dup === 1, 'the same cheque number cannot go on twice');
ok(r.list, 'they show in Cheques out');
// clearing one now takes it from the bank
await pg.evaluate(() => { const S = window.eval('S'); window.eval('chequeStatus')(S.cheques.find(x => x.no === '999002'), 'CLEARED') });
const held2 = await pg.evaluate(() => window.eval('bal')(window.eval('S').banks[0].ac));
ok(Math.abs(held2 - (setup.held - 5000)) < 0.01, 'marking one Cleared takes it from the bank', `${setup.held} → ${held2}`);
// the supplier's own Cheques tab has the button too
const tab = await pg.evaluate((s) => { window.eval('supCheques'); return window.eval('supCheques')(window.eval('SU')(s.sid), window.eval('S').cheques.filter(c => c.supplierId === s.sid)) }, setup);
ok(/data-act="oldChq"/.test(tab) && /given before/.test(tab), "the supplier's Cheques tab has the button and marks them");
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
