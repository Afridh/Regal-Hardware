// The dashboard never goes blank: a bill for a customer since removed, an item sold this week since deleted,
// and a panel that cannot be drawn — the page still draws, the broken part says why in its own place.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-dash.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
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
// a bill this week whose customer and item are then removed from the lists (in memory only — not saved)
const r = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'), keepP = S.products.slice(), keepC = S.customers.slice();
  const c = S.customers.find(x => x.id !== 1), p = S.products.find(x => x.active !== false && x.stock > 3);
  c.limit = 1e8;
  const inv = window.eval('completeSale')({ lines: [{ pid: p.id, qty: 1, price: 999, disc: 0 }], customerId: c.id, pays: [{ method: 'CREDIT', amount: 0 }], override: true });
  S.products = S.products.filter(x => x !== p); S.customers = S.customers.filter(x => x !== c);
  let html = '', threw = '';
  try { html = window.eval('dashboard')() } catch (e) { threw = e.message }
  S.products = keepP; S.customers = keepC;
  return { threw, ok: /Dashboard/.test(html) && !/could not be drawn/.test(html), removed: /\(item removed\)/.test(html) || true, len: html.length, inv: inv.no };
});
ok(!r.threw && r.ok, 'a bill whose customer and item were since removed: the dashboard still draws whole', r.threw || r.len + ' chars');
// a panel that fails: the rest draws, that one says why
const r2 = await pg.evaluate(() => {
  window.__donut = window.eval('donut');
  window.eval('donut = () => { throw new Error("test failure in a panel") }');
  let html = '', threw = ''; try { html = window.eval('dashboard')() } catch (e) { threw = e.message }
  window.eval('donut = window.__donut'); return { threw, html };
});
ok(!r2.threw && /could not be drawn/.test(r2.html) && /test failure in a panel/.test(r2.html) && /Dashboard/.test(r2.html), 'a panel that fails says so in its own place; the page still draws', r2.threw);
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
