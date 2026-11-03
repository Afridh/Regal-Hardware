// The answer to an approval, in front of the one who asked; and stock on the till.
//  · a Cashier asks (stock added on an item); an Admin approves; back on the Cashier's screen a card says
//    "Approved" with what it was, once — OK closes it and it does not come back
//  · turned down: a card says "Turned down", with the note
//  · the till shows stock in the item search and on every bill line — even with the website's
//    "count stock for the website" switched off
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-appop.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
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
const s0 = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.persist = () => {};
  const S = window.eval('S'); window.__keep = JSON.stringify({ products: S.products, journal: S.journal, movements: S.movements, stocktakes: S.stocktakes, approvals: S.approvals || [], notif: S.notif, cfgStock: window.eval('CFG').stock }); window.__user = S.user;
  try { Object.keys(localStorage).filter(k => k.startsWith('apSeen:')).forEach(k => localStorage.removeItem(k)) } catch (e) {}
  const p = S.products.find(x => x.active !== false && x.stock > 10 && !x.serialised); return { pid: p.id } });
const as = (role) => pg.evaluate((role) => { const S = window.eval('S'); S.user = role ? { ...window.__user, name: 'Pop Tester', role, perms: ['receive'] } : window.__user; window.eval('render')(); window.eval('drawBell')() }, role);
const pops = () => pg.evaluate(() => [...document.querySelectorAll('#apPops .ap-pop')].map(d => ({ cls: d.className, text: d.innerText.replace(/\s+/g, ' ') })));
// 1. asked, approved
await as('Cashier');
await pg.evaluate(id => window.eval('stockAddModal')(id), s0.pid); await wait(300);
await pg.type('#saQty', '2'); await pg.click('#saOk'); await wait(300);
const apId = await pg.evaluate(() => window.eval('S').approvals[0].id);
await as(null); await wait(200);
ok((await pops()).length === 0, 'the Admin, deciding, gets no card');
await pg.evaluate(id => window.eval('decideApproval')(id, true, ''), apId); await wait(200);
await as('Cashier'); await wait(300);
let p = await pops();
ok(p.length === 1 && /ok/.test(p[0].cls) && /Approved/.test(p[0].text) && /Add 2/.test(p[0].text), 'back on the Cashier\'s screen: "Approved — Add 2 …"', JSON.stringify(p));
await pg.click('#apPops [data-x]'); await wait(400);
await pg.evaluate(() => window.eval('drawBell')()); await wait(200);
ok((await pops()).length === 0, 'OK closes it, and it does not come back');
// 2. turned down
await pg.evaluate(id => window.eval('stockAddModal')(id), s0.pid); await wait(300);
await pg.type('#saQty', '7'); await pg.click('#saOk'); await wait(300);
const ap2 = await pg.evaluate(() => window.eval('S').approvals[0].id);
await as(null); await pg.evaluate(id => window.eval('decideApproval')(id, false, 'count it again'), ap2); await wait(200);
await as('Cashier'); await wait(300);
p = await pops();
ok(p.length === 1 && /bad/.test(p[0].cls) && /Turned down/.test(p[0].text) && /count it again/.test(p[0].text), 'turned down: "Turned down", with the note', JSON.stringify(p));
await pg.evaluate(() => document.querySelectorAll('#apPops .ap-pop').forEach(d => d.remove()));
// 3. stock on the till, even with the website's count switched off
await as(null);
const till = await pg.evaluate(async (pid) => { const C = window.eval('CFG'), S = window.eval('S'); C.stock = { ...(C.stock || {}), track: false };
  window.eval('go')('pos'); S.pos.lines = [{ pid, qty: 1, price: window.eval('P')(pid).retail, disc: 0 }]; window.eval('render')(); await new Promise(r => setTimeout(r, 200));
  const line = (document.querySelector('.ln-stk') || {}).innerText || '';
  const CS = window.eval('CS'); CS.q = window.eval('P')(pid).name.slice(0, 6); const f = document.getElementById('csQ'); if (f) { f.value = CS.q; f.dispatchEvent(new Event('input', { bubbles: true })) } await new Promise(r => setTimeout(r, 300));
  const head = [...document.querySelectorAll('th')].some(t => t.textContent.trim() === 'STOCK');
  S.pos.lines = []; return { line, head } }, s0.pid);
ok(/stock \d/.test(till.line), 'every bill line shows the stock', till.line);
ok(till.head, 'the item search shows the STOCK column, even with the website\'s count off');
await pg.evaluate(() => { const S = window.eval('S'); const k = JSON.parse(window.__keep); Object.assign(S, { products: k.products, journal: k.journal, movements: k.movements, stocktakes: k.stocktakes, approvals: k.approvals, notif: k.notif }); window.eval('CFG').stock = k.cfgStock; S.user = window.__user; window.eval('render')() });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
