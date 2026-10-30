// Every approval in one place, and the Super Admin's feature switches.
//  · a stock take closed by someone who does not decide waits on Approvals, and moves the stock once approved
//  · phone stock entries and leave asked for show on the Approvals page for the one who decides
//  · Settings → Features (Super Admin only): Deliveries off takes its page, its bill button and the
//    driver's page; Not delivered off takes the till's button; back on brings them back
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-feat.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Aisle 3' : undefined));
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
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const role = await pg.evaluate(() => window.eval('S').user.role);

// 1. a stock take by a cashier waits for approval
const st = await pg.evaluate(() => {
  const S = window.eval('S'), p = S.products.find(x => x.active !== false && x.stock > 10), was = p.stock, role = S.user.role;
  const perms = S.user.perms; S.user.role = 'Cashier'; S.user.perms = (perms || []).filter(k => k !== 'approve'); const needs = window.eval('needsApproval')('stockAdj');
  window.eval('stkCount')[p.id] = String(was - 2); window.eval('postStockTake')();
  const after = p.stock, ap = (S.approvals || []).filter(a => a.kind === 'stockAdj' && a.status === 'pending').slice(-1)[0];
  S.user.role = role; S.user.perms = perms;
  return { pid: p.id, was, after, needs, ap: ap && { id: ap.id, title: ap.title } };
});
ok(st.needs && st.after === st.was && st.ap, 'a cashier closing a stock take: nothing moves, it waits on Approvals', JSON.stringify(st));
if (!st.ap) process.exit(1);
await pg.evaluate(() => { window.eval("apTab='pending'"); window.eval('go')('approvals') }); await wait(400);
await pg.$eval(`[data-act="apOk"][data-id="${st.ap.id}"]`, b => b.click()); await wait(500);
ok(await pg.evaluate(pid => window.eval('P')(pid).stock, st.pid) === st.was - 2, 'approved: the stock take is posted (2 short)');

// 2. phone entries and a leave request show on the Approvals page
await pg.evaluate(() => { const S = window.eval('S'), p = S.products.find(x => x.active !== false && x.stock > 5);
  S.phoneCounts = [{ id: 'pcT1', who: 'skT', by: 'Kamal', pid: p.id, name: p.name, unit: p.unit, mode: 'remove', qty: 1, reason: 'Damaged', book: p.stock, at: '2026-10-30 10:00', status: 'pending' }];
  S.leaves = (S.leaves || []).concat([{ id: 'lvT1', who: 'Nimal', from: '2026-11-20', to: '2026-11-20', type: 'casual', reason: 'wedding', status: 'pending', by: 'Nimal (shift clock)', at: '2026-10-30 09:00' }]);
  window.eval('go')('approvals') }); await wait(400);
const apText = await pg.evaluate(() => document.querySelector('#main').innerText);
ok(/Kamal sent 1 stock entry/.test(apText) && /Nimal asks for leave/.test(apText), 'Approvals shows phone stock entries and leave asked for', '');
await pg.screenshot({ path: process.env.SHOT || 'approvals.png' });
await pg.$eval('[data-act="stkPhPostWho"][data-who="Kamal"]', b => b.click()); await wait(400);
ok(await pg.evaluate(() => window.eval('S').phoneCounts[0].status) === 'posted', 'Post them from the Approvals page posts the phone entries');
await pg.$eval('[data-act="lvYes"][data-id="lvT1"]', b => b.click()); await wait(400);
ok(await pg.evaluate(() => window.eval('S').leaves.find(l => l.id === 'lvT1').status) === 'approved', 'the leave approved from the Approvals page');

// 3. the features: only a Super Admin sees them
const tabs = await pg.evaluate(() => window.eval('settingsTabs')().map(t => t[0]));
ok(tabs.includes('features') === /super ?admin/i.test(role), `Settings → Features is there for the Super Admin only (signed in as ${role})`);
await pg.evaluate(() => { const S = window.eval('S'); S.__role = S.user.role; S.user.role = 'Super Admin'; window.eval("setTab='features'"); window.eval('go')('settings') }); await wait(500);
await pg.$eval('[data-feat="dlv"]', el => { el.checked = false; el.dispatchEvent(new Event('change')) }); await wait(300);
await pg.$eval('[data-feat="undelivered"]', el => { el.checked = false; el.dispatchEvent(new Event('change')) }); await wait(1500);
const off = await pg.evaluate(() => { const S = window.eval('S'); const inv = S.sales.slice(-1)[0];
  window.eval("billType='all'"); window.eval('billSel=' + JSON.stringify(inv.no)); window.eval('go')('bills');
  const bill = !!document.querySelector('[data-act="dlvNew"]'); window.eval('go')('pos');
  return { allowed: window.eval('allowed')('dlv'), navDlv: !!document.querySelector('#nav [data-view="dlv"]'), bill, pill: !!document.querySelector('[data-act="csDlvToggle"]') } });
ok(!off.allowed && !off.navDlv && !off.bill, 'Deliveries off: no page, nothing in the menu, no Deliver on a bill', JSON.stringify(off));
ok(!off.pill, 'Not delivered off: its button is gone from the till');
await wait(2500);
const drv = await (await fetch(BASE + '/api/dlv/driver?k=whateverwhatever1')).json();
ok(/switched off/.test(drv.error || ''), "the driver's page says deliveries are switched off", drv.error);
await pg.evaluate(() => { window.eval("setTab='features'"); window.eval('go')('settings') }); await wait(400);
await pg.screenshot({ path: process.env.SHOT2 || 'features.png' });
await pg.$eval('[data-feat="dlv"]', el => { el.checked = true; el.dispatchEvent(new Event('change')) });
await pg.$eval('[data-feat="undelivered"]', el => { el.checked = true; el.dispatchEvent(new Event('change')) }); await wait(300);
const on = await pg.evaluate(() => { window.eval('go')('pos'); return { allowed: window.eval('allowed')('dlv'), pill: !!document.querySelector('[data-act="csDlvToggle"]') } });
ok(on.allowed && on.pill, 'back on: they come back', JSON.stringify(on));
await pg.evaluate(() => { const S = window.eval('S'); S.user.role = S.__role; delete S.__role; window.eval('persist')(true) });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
