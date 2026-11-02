// Changing what Accounts and Management may do.
//  · Users & permissions → Roles: Accounts and Management have "Change what it may do"
//  · the window: pages ticked page by page (a section whole with one box) and the abilities; saved, it is
//    kept in the books — still there after a reload — and the people in the role get the abilities
//  · someone in the role then opens exactly the pages ticked: a page taken off is shut, one added opens
//  · "Back to the original" brings the built-in role back
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-roles.mjs
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
const signIn = async () => {
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await wait(1500); await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
};
await signIn();
// a Management person to watch
await pg.evaluate(() => { const S = window.eval('S'); S.roles = (S.roles || []).filter(r => !['Management', 'Accounts'].includes(r.name));
  if (!S.users.some(u => u.name === 'RoleTest')) S.users.push({ name: 'RoleTest', role: 'Management', uid: 'RT', perms: ['sell', 'discount', 'cost'] });
  window.eval("userTab='roles'"); window.eval('go')('users') });
await wait(300);
const btns = await pg.evaluate(() => ['Accounts', 'Management'].map(n => !!document.querySelector(`[data-act="roleEdit"][data-r="${n}"]`)));
ok(btns.every(Boolean), 'Roles: Accounts and Management have "Change what it may do"', JSON.stringify(btns));
// change Management: no Customers section, no Online orders; add Expenses; no discounts or cost
await pg.click('[data-act="roleEdit"][data-r="Management"]'); await wait(300);
await pg.screenshot({ path: SHOT + '/roles-edit.png' });
await pg.evaluate(() => { const m = document.querySelector('.rl-box');
  const sec = m.querySelector('[data-secall="Customers"]'); if (sec.checked) sec.click(); else { sec.click(); sec.click() }
  const web = m.querySelector('[data-page="weborders"]'); if (web && web.checked) web.click();
  const exp = m.querySelector('[data-page="expenses"]'); if (!exp.checked) exp.click();
  ['discount', 'cost'].forEach(k => { const x = m.querySelector(`[data-perm="${k}"]`); if (x.checked) x.click() }) });
const cust = await pg.evaluate(() => [...document.querySelectorAll('.rl-box [data-of="Customers"]')].every(x => !x.checked));
ok(cust, 'the Customers section box clears all its pages at once');
await pg.click('#rlSave'); await wait(400);
const saved = await pg.evaluate(() => { const S = window.eval('S'); const r = S.roles.find(x => x.name === 'Management'); const u = S.users.find(x => x.name === 'RoleTest'); return { pages: r && r.pages, perms: r && r.perms, user: u.perms } });
ok(saved.pages && saved.pages.includes('expenses') && !saved.pages.includes('customers') && !saved.pages.includes('weborders'), 'saved: the pages as ticked', JSON.stringify(saved.pages));
ok(!saved.user.includes('discount') && !saved.user.includes('cost') && saved.user.includes('sell'), 'and the person in the role has the new abilities (no discounts, no cost)', JSON.stringify(saved.user));
await pg.evaluate(() => window.eval('persist')(true)); await wait(2500);
// a reload: still there
await signIn();
const after = await pg.evaluate(() => { const r = (window.eval('S').roles || []).find(x => x.name === 'Management'); return r && r.pages && r.pages.includes('expenses') });
ok(after, 'after a reload the change is still there (it is kept in the books)');
// as a Management person: exactly the pages ticked
const asMgmt = await pg.evaluate(() => { const S = window.eval('S'); const me = { role: S.user.role, perms: S.user.perms };
  S.user.role = 'Management'; S.user.perms = S.users.find(u => u.name === 'RoleTest').perms; const al = window.eval('allowed'), can = window.eval('can');
  const r = { pos: al('pos'), customers: al('customers'), receipts: al('receipts'), expenses: al('expenses'), weborders: al('weborders'), products: al('products'), discount: can('discount'), sell: can('sell') };
  S.user.role = me.role; S.user.perms = me.perms; return r });
ok(asMgmt.pos && asMgmt.products && asMgmt.expenses && !asMgmt.customers && !asMgmt.receipts && !asMgmt.weborders, 'a Management person: billing, products and Expenses open; Customers and Online orders shut', JSON.stringify(asMgmt));
ok(asMgmt.sell && !asMgmt.discount, 'and may bill, but not give discounts');
// the list says it was changed; back to the original
await pg.evaluate(() => { window.eval("userTab='roles'"); window.eval('go')('users') }); await wait(200);
const tag = await pg.evaluate(() => /changed/.test([...document.querySelectorAll('#main tr')].find(tr => /Management/.test(tr.innerText)).innerText));
ok(tag, 'the roles list marks Management as changed');
await pg.click('[data-act="roleEdit"][data-r="Management"]'); await wait(300);
await pg.click('#rlReset'); await wait(300);
const back = await pg.evaluate(() => { const S = window.eval('S'); const me = S.user.role; S.user.role = 'Management'; const c = window.eval('allowed')('customers'); S.user.role = me; return { gone: !(S.roles || []).some(r => r.name === 'Management'), customers: c } });
ok(back.gone && back.customers, '"Back to the original": Management opens Customers again', JSON.stringify(back));
// Accounts too
await pg.click('[data-act="roleEdit"][data-r="Accounts"]'); await wait(300);
await pg.evaluate(() => { const x = document.querySelector('.rl-box [data-page="pos"]'); if (!x.checked) x.click() }); await pg.click('#rlSave'); await wait(300);
const acc = await pg.evaluate(() => { const S = window.eval('S'); const me = S.user.role; S.user.role = 'Accounts'; const r = { pos: window.eval('allowed')('pos'), cheques: window.eval('allowed')('chequesIn') }; S.user.role = me; S.roles = S.roles.filter(x => x.name !== 'Accounts'); S.users = S.users.filter(u => u.name !== 'RoleTest'); window.eval('persist')(true); return r });
ok(acc.pos && acc.cheques, 'Accounts changed the same way: POS billing added, its money pages kept', JSON.stringify(acc));
await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
