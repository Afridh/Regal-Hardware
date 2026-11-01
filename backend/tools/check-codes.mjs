// One code, one product.
//  · what is typed or scanned is found in this order: barcode, item number, short code, product code — an old
//    SePOS sticker number finds the product it was printed for, even when it is also another product's item number
//  · the products page counts item numbers that are another product's barcode, and Fix renumbers them
//  · the product form refuses a barcode another product already answers to
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-codes.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
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
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

// two products: A's old sticker is 5738, B's item number is 5738
const ids = await pg.evaluate(() => { const S = window.eval('S'); const [a, bb] = S.products.filter(p => p.active !== false).slice(0, 2);
  S.products.forEach(p => { if (p !== a && p.barcode === '5738') p.barcode = 'x' + p.id; if (p !== bb && String(p.num) === '5738') p.num = 'n' + p.id });
  a.barcode = '5738'; bb.num = '5738'; return { a: a.id, b: bb.id, aName: a.name } });
const hit = await pg.evaluate(() => ({ cs: (window.eval('codeExact')('5738')[0] || {}).id, n: window.eval('codeClashes')().length }));
ok(hit.cs === ids.a, 'typing 5738 finds the product whose barcode it is, before the one whose item number it is', JSON.stringify(hit));
ok(hit.n >= 1, 'the clash is counted', hit.n);

// the products page says so; Fix renumbers B
const page = await pg.evaluate(() => { window.eval("invTab='products'"); window.eval('go')('inventory'); return { banner: !!document.querySelector('[data-act="codeFix"]'), txt: document.querySelector('#main').innerText.slice(0, 400) } });
ok(page.banner, 'the products page shows the clash with a Fix button', page.banner ? '' : page.txt);
if (page.banner) await pg.$eval('[data-act="codeFix"]', x => x.click()); await wait(300);
const after = await pg.evaluate(id => { const S = window.eval('S'); const p = S.products.find(x => x.id === id); return { num: p.num, n: window.eval('codeClashes')().length, taken: S.products.filter(x => x.id !== id && window.eval('codesOf')(x).includes(String(p.num).toLowerCase())).length, banner: !!document.querySelector('[data-act="codeFix"]') } }, ids.b);
ok(after.num !== '5738' && after.n === 0 && after.taken === 0 && !after.banner, 'Fix: B gets a number no other product answers to, the banner goes', JSON.stringify(after));

// the form refuses a barcode another product answers to
const refused = await pg.evaluate(async ids => { const S = window.eval('S'); const bb = S.products.find(x => x.id === ids.b), was = bb.barcode;
  window.eval('productModal')(bb.id); await new Promise(r => setTimeout(r, 300)); const m = document.querySelector('.modal');
  m.querySelector('#pbar').value = '5738'; const btn = m.querySelector('#psave'); btn && btn.click();
  await new Promise(r => setTimeout(r, 300)); const t = [...document.querySelectorAll('.toast,#toast')].map(x => x.innerText).join(' ');
  document.querySelectorAll('.modal').forEach(x => x.remove()); return { kept: bb.barcode === was, t, btn: !!btn } }, ids);
ok(refused.btn && refused.kept && /already the barcode of/.test(refused.t), 'the product form refuses 5738 as B\'s barcode: it is A\'s', JSON.stringify(refused));

await pg.evaluate(() => window.eval('persist')(true)); await wait(1200);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
