// A fresh start, then the old SePOS lists brought in.
//  · "Start fresh" (Settings → Shop details, the Super Admin, typing CLEAR): products, customers (bar Walk-in),
//    suppliers and every record go; the shop's details, the logins, the staff and the bank accounts stay;
//    bill numbers start again; on the server the portal sign-ins and messages waiting are cleared
//  · then the three files from SePOS (db/sepos-to-excel.js) go in through "Many at once (from Excel)"
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-fresh.mjs [folder with sepos-products.csv, sepos-customers.csv, sepos-suppliers.csv]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg0 from 'pg';
const BASE = process.env.BASE || 'http://localhost:4010';
const DIR = process.argv[2] || 'C:/Users/Semicolans/Desktop/SePOS export';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
// the test database, to put something in the server's side and see it cleared
const here = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.join(here, '../.env'), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }));
const url = new URL(env.DATABASE_URL); url.pathname = '/sepos_e2e';
const db = new pg0.Client({ connectionString: url.href }); await db.connect();
await db.query(`INSERT INTO cust_inbox (cid, kind, data) VALUES (2, 'paid', '{"amount":1}')`).catch(() => {});

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
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
await wait(1500);

// before: what is there, and what must stay
const before = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'), CFG = window.eval('CFG');
  S.calls = (S.calls || []).concat([{ id: 'x', cid: 2, outcome: 'note' }]); CFG.shop.name = CFG.shop.name || 'REGAL HARDWARE';
  return { products: S.products.length, sales: S.sales.length, users: S.users.length, staff: (S.employees || []).length, banks: S.banks.length, shop: CFG.shop.name, logo: CFG.shop.logo || '', tpl: JSON.stringify(CFG.tpl || {}).length } });
ok(before.products > 0, 'before: a shop with products', JSON.stringify({ p: before.products, s: before.sales }));

// the button, as the owner presses it
await pg.evaluate(() => { window.eval("setTab='shop'"); window.eval('go')('settings') }); await wait(500);
const card = await pg.evaluate(() => { const el = document.querySelector('#clearWord'); return el ? el.closest('.card').innerText : '' });
ok(/Stays:/.test(card) && /logins/.test(card) && /bank accounts/.test(card), 'the card says what goes and what stays');
await pg.type('#clearWord', 'CLEAR'); await pg.$eval('[data-act="clearShop"]', x => x.click()); await wait(3500);
const after = await pg.evaluate(() => { const S = window.eval('S'), CFG = window.eval('CFG');
  return { products: S.products.length, customers: S.customers.map(c => c.name), suppliers: S.suppliers.length, sales: S.sales.length, journal: S.journal.length, calls: (S.calls || []).length, held: (S.heldBills || []).length,
    users: S.users.length, staff: (S.employees || []).length, banks: S.banks.length, bankBal: S.banks.reduce((a, b0) => a + Math.abs(window.eval('bal')(b0.ac)), 0), shop: CFG.shop.name, logo: CFG.shop.logo || '', tpl: JSON.stringify(CFG.tpl || {}).length,
    nextBill: window.eval('next')('INV'), view: S.view } });
ok(after.products === 0 && after.suppliers === 0 && after.customers.length === 1 && after.customers[0] === 'Walk-in customer' && after.sales === 0 && after.journal === 0 && after.calls === 0, 'gone: products, suppliers, customers (Walk-in stays), bills, ledger, calls', JSON.stringify({ p: after.products, c: after.customers, s: after.sales, j: after.journal }));
ok(after.users === before.users && after.banks === before.banks && after.bankBal < 0.01, 'stay: every login, the bank accounts (at nought)', JSON.stringify({ users: after.users, banks: after.banks }));
ok(after.staff === 0, 'the staff go too', String(after.staff));
// the Getting started guide stands in for the dashboard
const guide = async () => pg.evaluate(() => { window.eval('go')('dashboard'); const el = document.querySelector('.su'); return el ? { steps: el.querySelectorAll('.su-step').length, done: el.querySelectorAll('.su-step.done').length, now: (el.querySelector('.su-step.now .su-t') || {}).textContent || '', text: el.innerText } : null });
let gd = await guide();
ok(gd && gd.steps === 10 && /A fresh start/.test(gd.text) && /Suppliers/.test(gd.now), 'Getting started comes up: ten steps, the shop ticked, suppliers next', JSON.stringify(gd && { steps: gd.steps, done: gd.done, now: gd.now }));
await pg.screenshot({ path: process.env.SHOT || 'startup.png', fullPage: true });
ok(after.shop === before.shop && after.logo === before.logo && after.tpl === before.tpl, "stay: the shop's name, logo and message wording", after.shop);
ok(/1$/.test(String(after.nextBill)), 'bill numbers start again', String(after.nextBill));
const inbox = (await db.query(`SELECT count(*)::int AS n FROM cust_inbox`)).rows[0].n;
ok(inbox === 0, "the server's side cleared: messages waiting gone (portal sign-ins too)", `cust_inbox ${inbox}`);
await wait(2500);
// the books on the server are the fresh ones
const srv = (await db.query(`SELECT data FROM books WHERE key = 'regal'`)).rows[0].data;
ok((srv.S.products || []).length === 0 && (srv.S.sales || []).length === 0, 'the fresh books are saved on the server');

// the three SePOS files, through "Many at once (from Excel)"
const files = ['sepos-suppliers.csv', 'sepos-customers.csv', 'sepos-products.csv'].map(f => path.join(DIR, f));
if (files.every(f => fs.existsSync(f))) {
  const up = async (open, input, go) => { await pg.evaluate(open); await wait(500);
    const el = await pg.$(input); await el.uploadFile(files.shift()); await wait(2500);
    const btn = await pg.evaluate(go => { const b = document.querySelector(go); return b ? { off: b.disabled, txt: b.textContent } : null }, go);
    if (btn && !btn.off) { await pg.$eval(go, x => x.click()); await wait(2500) }
    await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove())); return btn };
  const sb = await up(() => window.eval('bulkPeopleModal')('sup'), '#pbFile', '#pbGo');
  const cb = await up(() => window.eval('bulkPeopleModal')('cust'), '#pbFile', '#pbGo');
  const pb = await up(() => window.eval('bulkProductModal')(), '#bFile', '#bGo');
  const n = await pg.evaluate(() => { const S = window.eval('S'); return { sup: S.suppliers.length, cust: S.customers.length - 1, prod: S.products.length, linked: S.products.filter(p => p.supplierId).length } });
  const rows = f => fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/).filter(l => l.trim()).length - 1;
  ok(n.sup >= rows('sepos-suppliers.csv') * 0.95, `suppliers in: ${n.sup} of ${rows('sepos-suppliers.csv')}`, sb && sb.txt);
  ok(n.cust >= rows('sepos-customers.csv') * 0.95, `customers in: ${n.cust} of ${rows('sepos-customers.csv')}`, cb && cb.txt);
  ok(n.prod >= rows('sepos-products.csv') * 0.95, `products in: ${n.prod} of ${rows('sepos-products.csv')} · ${n.linked} linked to their supplier`, pb && pb.txt);
} else console.log('(the SePOS files are not in ' + DIR + ' — the import part is skipped)');
gd = await guide();
if (gd) { ok(gd.done >= 4 && /6,?4\d\d products/i.test(gd.text) && /158 suppliers/.test(gd.text), 'after the uploads the guide ticks suppliers, customers and products, with the counts', JSON.stringify({ done: gd.done, now: gd.now }));
  await pg.screenshot({ path: process.env.SHOT2 || 'startup-after.png', fullPage: true });
  await pg.evaluate(() => [...document.querySelectorAll('[data-act="suFinish"]')][0].click()); await wait(500);
  ok(await pg.evaluate(() => !document.querySelector('.su') && !!document.querySelector('#main').innerText), 'Finish: the dashboard takes over'); }
await pg.evaluate(() => window.eval('persist')(true)); await wait(2000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await db.end(); await b.close();
