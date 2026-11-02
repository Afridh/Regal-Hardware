// After adding a product or adjusting stock up, the till asks to print labels.
//  · a new product with opening stock 6: "Print labels?" with 6 labels for it; Print sends 6 to the label printer
//  · a stock take where one item came up by 3 and another went down: only the one that came up, 3 labels
//  · "Add to the label list" keeps them on the Labels page; Not now does nothing
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-asklabels.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept(d.type() === 'prompt' ? 'test count' : undefined));
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
await pg.evaluate(() => { window.eval('CFG').prodForm = 'simple' });   // this check drives the one-product form (the updater has check-produpd)
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.__sent = []; window.labelSheet = l => window.__sent.push(l.map(x => ({ pid: x.pid, copies: x.copies }))) });

// 1. a new product, opening stock 6
await pg.evaluate(() => { window.eval("invTab='products'"); window.eval('go')('inventory'); window.eval('productModal')() }); await wait(300);
await pg.type('#pname', 'Label Test Hinge 3in'); await pg.type('#pretail', '120'); await pg.type('#pcost', '90');
await pg.$eval('#popen', el => { el.value = '6' });
await pg.click('#psave'); await wait(400);
const a1 = await pg.evaluate(() => { const m = document.querySelector('.al-modal'); return m ? { n: m.querySelector('[data-aln="0"]').value, txt: m.innerText.slice(0, 200), go: m.querySelector('#alGo').textContent } : null });
ok(a1 && a1.n === '6' && /Label Test Hinge/.test(a1.txt), 'a new product with 6 in stock: "Print labels?" with 6 labels', JSON.stringify(a1));
await pg.click('#alGo'); await wait(200);
const s1 = await pg.evaluate(() => { const S = window.eval('S'); const p = S.products.find(x => x.name === 'Label Test Hinge 3in'); return { sent: window.__sent[0], pid: p.id } });
ok(s1.sent && s1.sent.length === 1 && s1.sent[0].pid === s1.pid && s1.sent[0].copies === 6, 'Print sends its 6 labels to the label printer', JSON.stringify(s1));

// 2. a stock take: one up by 3, one down by 2
const st = await pg.evaluate(() => { const S = window.eval('S'); const [x, y] = S.products.filter(p => p.active !== false && p.stock > 5 && p.name !== 'Label Test Hinge 3in').slice(0, 2);
  const held = window.eval('heldMap')(); window.eval('stkCount={}'); const sc = window.eval('stkCount');
  sc[x.id] = String(x.stock + (held[x.id] || 0) + 3); sc[y.id] = String(y.stock + (held[y.id] || 0) - 2);
  window.eval('postStockTakeNow')('test count'); return { up: x.id, down: y.id } });
await wait(300);
const a2 = await pg.evaluate(() => { const m = document.querySelector('.al-modal'); return m ? { rows: m.querySelectorAll('[data-aln]').length, n: m.querySelector('[data-aln="0"]').value } : null });
ok(a2 && a2.rows === 1 && a2.n === '3', 'a stock take: asks for the item that came up (3 labels), not the one that went down', JSON.stringify(a2));
// 3. add to the label list instead
const q0 = await pg.evaluate(() => window.eval('LAB').queue.length);
await pg.click('#alList'); await wait(200);
const q1 = await pg.evaluate(id => { const q = window.eval('LAB').queue; const last = q[q.length - 1]; return { n: q.length, pid: last && last.pid, copies: last && last.copies, open: !!document.querySelector('.al-modal') } }, st.up);
ok(q1.n === q0 + 1 && q1.pid === st.up && q1.copies === 3 && !q1.open, '"Add to the label list" keeps them for the Labels page', JSON.stringify(q1));
// 4. untick and change the number
await pg.evaluate(id => window.eval('askLabels')([{ pid: id, qty: 4 }], 'test'), st.up); await wait(200);
await pg.$eval('[data-aln="0"]', el => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })) });
const btn = await pg.$eval('#alGo', el => el.textContent);
await pg.click('#alNo'); await wait(150);
ok(/Print 2 labels/.test(btn) && !(await pg.$('.al-modal')) && (await pg.evaluate(() => window.__sent.length)) === 1, 'the number can be changed (button says "Print 2 labels"); Not now prints nothing', btn);
await pg.evaluate(() => { const S = window.eval('S'); S.products = S.products.filter(x => x.name !== 'Label Test Hinge 3in'); window.eval('LAB').queue = []; window.eval('persist')(true) }); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
