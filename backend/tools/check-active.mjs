// Active and inactive customers and suppliers.
//  · "Make inactive" on their page (with a reason): off the list and the till's pickers, under "Inactive" on
//    the list with a count, their page saying so — bills and balance left on the books
//  · making active again: someone who may approve does it at once; anyone else asks, and the yes brings it back
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-active.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
// every browser dialog dismissed at once — as the Regal POS app does, and a browser once "no more dialogs" is ticked: nothing here may depend on them
pg.on('dialog', d => d.dismiss());
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
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); window.__me = { role: S.user.role, perms: S.user.perms };
  window.asRole = (r) => { S.user.role = r; S.user.perms = ['sell'] }; window.asMe = () => { S.user.role = window.__me.role; S.user.perms = window.__me.perms } });

// 1. a supplier made inactive, from their page
const sup = await pg.evaluate(() => { const S = window.eval('S'); const s = S.suppliers.find(x => x.active !== false); window.eval('supSel=' + s.id); window.eval("supFilter='all'; supTab='details'"); window.eval('go')('suppliers'); return { id: s.id, name: s.name, n: S.suppliers.filter(x => x.active !== false).length } });
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await pg.$eval(`[data-act="partyOff"][data-pk="S"][data-id="${sup.id}"]`, x => x.click()); await pg.waitForSelector('#abGo'); await pg.$eval('#abT', (el, v) => { el.value = v }, "closed down"); await pg.$eval('#abGo', x => x.click()); await wait(400);
let st = await pg.evaluate(id => { const S = window.eval('S'), s = window.eval('SU')(id); return { active: s.active, why: s.inactiveWhy, by: s.inactiveBy, filter: window.eval('supFilter'),
  chip: (document.querySelector('[data-supfilter="inactive"]') || {}).innerText || '', band: /Inactive/.test(document.querySelector('#main').innerText) && /closed down/.test(document.querySelector('#main').innerText) } }, sup.id);
ok(st.active === false && st.why === 'closed down' && st.by, 'Make inactive: kept as inactive, with why and by whom', JSON.stringify({ a: st.active, why: st.why }));
ok(/Inactive\s*1/.test(st.chip) && st.filter === 'inactive' && st.band, 'it sits under "Inactive 1" on the list, its page saying so', st.chip);
const normal = await pg.evaluate(id => { window.eval("supFilter='all'"); return window.eval('supList')().some(x => x.id === id) }, sup.id);
ok(!normal, 'not on the ordinary list');
// 2. someone who does not approve (Accounts) asks to make it active again; the yes brings it back
const ask = await pg.evaluate(id => { window.asRole('Accounts'); window.eval("supFilter='inactive'"); window.eval('supSel=' + id); window.eval('go')('suppliers');
  const btn = document.querySelector(`[data-act="partyOn"][data-pk="S"][data-id="${id}"]`); const txt = btn && btn.textContent; btn && btn.click();
  const a = window.eval('S').approvals.find(x => x.kind === 'partyActive' && x.status === 'pending'); return { txt, a: !!a, still: window.eval('SU')(id).active } }, sup.id);
ok(/Ask/.test(ask.txt || '') && ask.a && ask.still === false, 'Accounts (opens suppliers, does not approve): "Ask to make active again" — it waits for approval, still inactive', JSON.stringify(ask));
const yes = await pg.evaluate(id => { window.asMe(); const a = window.eval('S').approvals.find(x => x.kind === 'partyActive' && x.status === 'pending'); window.eval('decideApproval')(a.id, true); return window.eval('SU')(id).active }, sup.id);
ok(yes === true, 'the yes on Approvals makes it active again');

// 3. a customer: made inactive, gone from the till's search; an approver brings it straight back
const cus = await pg.evaluate(() => { const S = window.eval('S'); const c = S.customers.find(x => x.id !== 1 && x.active !== false && window.eval('partyBal')('C', x.id) < 0.01) || S.customers.find(x => x.id !== 1 && x.active !== false);
  window.eval('custSel=' + c.id); window.eval("custFilter='all'; custTab='details'"); window.eval('go')('customers'); return { id: c.id, name: c.name } });
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await pg.$eval(`[data-act="partyOff"][data-pk="C"][data-id="${cus.id}"]`, x => x.click()); await pg.waitForSelector('#abGo'); await pg.$eval('#abT', (el, v) => { el.value = v }, "closed down"); await pg.$eval('#abGo', x => x.click()); await wait(400);
const gone = await pg.evaluate(c => { return { active: window.eval('C')(c.id).active, inList: window.eval('custList')().some(x => x.id === c.id), chip: (document.querySelector('[data-custfilter="inactive"]') || {}).innerText || '' } }, cus);
ok(gone.active === false && /Inactive\s*1/.test(gone.chip), 'a customer made inactive: under "Inactive 1"', JSON.stringify(gone));
const back = await pg.evaluate(id => { window.eval("custFilter='inactive'"); window.eval('custSel=' + id); window.eval('go')('customers');
  const btn = document.querySelector(`[data-act="partyOn"][data-pk="C"][data-id="${id}"]`); const txt = btn && btn.textContent; btn && btn.click(); return { txt } }, cus.id);
await pg.waitForSelector('#abGo'); await pg.$eval('#abGo', x => x.click()); await wait(400);
back.active = await pg.evaluate(id => window.eval('C')(id).active, cus.id);
ok(/Make active again/.test(back.txt || '') && back.active === true, 'an approver: "Make active again" brings them straight back', JSON.stringify(back));
await pg.evaluate(() => window.eval('persist')(true)); await wait(1500);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
