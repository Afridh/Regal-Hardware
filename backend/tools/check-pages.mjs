// Every page of the till, every Settings tab and every report, opened as the Super Admin: none may throw a
// script error or come up as "This page could not be shown". The side menu has its headings, each page under one.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-pages.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 860 });
let errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.dismiss());
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
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'); window.__role = S.user.role; S.user.role = 'Super Admin' });
const drawn = async (what) => {
  await wait(250);
  const r = await pg.evaluate(() => { const t = (document.querySelector('#main') || {}).innerText || ''; document.querySelectorAll('.modal').forEach(m => m.remove());
    return { broken: /This page could not be shown/.test(t) ? t.split('\n').slice(0, 4).join(' / ') : '', empty: t.trim().length < 5 } });
  ok(!r.broken && !r.empty && !errs.length, what, r.broken || (r.empty ? 'blank' : '') || errs.slice(0, 2).join(' | ')); errs = [];
};

// the menu: headings, and every page under one of them
const menu = await pg.evaluate(() => { window.eval("prefs().navFold=[]"); window.eval('render')();
  return [...document.querySelectorAll('#nav .navlist > *')].map(e => e.classList.contains('grp') ? '# ' + e.dataset.g : e.dataset.view).filter(Boolean) });
const views = await pg.evaluate(() => window.eval('views').filter(v => v[0] !== 'grp').map(v => v[0]));
const groups = menu.filter(x => x.startsWith('# '));
ok(groups.length >= 6, 'the side menu has its headings', groups.join(', '));
const dup = views.filter((v, i) => views.indexOf(v) !== i); ok(!dup.length, 'each page is in the menu once', dup.join(','));
await pg.screenshot({ path: process.env.SHOT || 'menu.png', clip: { x: 0, y: 0, width: 300, height: 860 } });
console.log('menu: ' + menu.join(' · '));

// every page
for (const v of views) { await pg.evaluate(v => { window.eval('go')(v) }, v); await drawn('page ' + v) }
// the pages reached from elsewhere
for (const v of ['inventory', 'serials', 'recall', 'transfers', 'vouchers', 'issues', 'shopmanage']) { await pg.evaluate(v => { window.eval('S').view = v; window.eval('render')() }, v); await drawn('page ' + v + ' (not in the menu)') }
// every Settings tab
const tabs = await pg.evaluate(() => window.eval('settingsTabs')().map(t => t[0]));
for (const t of tabs) { await pg.evaluate(t => { window.eval(`setTab=${JSON.stringify(t)}`); window.eval('go')('settings') }, t); await drawn('settings → ' + t) }
// every report
const reps = await pg.evaluate(() => window.eval('REPORTS').flatMap(g => g[1]).map(r => r[0]));
for (const k of reps) { await pg.evaluate(k => { window.eval(`repKey=${JSON.stringify(k)}`); window.eval('go')('reports') }, k); await drawn('report ' + k) }
// the Approvals tabs and the inventory tabs
for (const t of ['pending', 'mine', 'done', 'all']) { await pg.evaluate(t => { window.eval(`apTab=${JSON.stringify(t)}`); window.eval('go')('approvals') }, t); await drawn('approvals → ' + t) }
// the tills
for (const w of ['quick', 'classic', 'phone']) { await pg.evaluate(w => { window.eval(`prefs().till=${JSON.stringify(w)}`); try { window.eval(`CFG.till=${JSON.stringify(w)}`) } catch (e) {} window.eval('go')('pos') }, w); await drawn('till ' + w) }
// a customer's, a supplier's and a product's page
await pg.evaluate(() => { const S = window.eval('S'); window.eval('custSel=' + S.customers.find(c => c.id !== 1).id); window.eval('go')('customers') }); await drawn('a customer');
await pg.evaluate(() => { const S = window.eval('S'); window.eval('supSel=' + S.suppliers[0].id); window.eval('go')('suppliers') }); await drawn('a supplier');
await pg.evaluate(() => { const S = window.eval('S'); window.eval('billSel=' + JSON.stringify(S.sales.slice(-1)[0].no)); window.eval('go')('bills') }); await drawn('a bill');

await pg.evaluate(() => { const S = window.eval('S'); S.user.role = window.__role; window.eval('go')('pos') });
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
