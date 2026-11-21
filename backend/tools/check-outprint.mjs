// Print outstanding (21 Nov 2026, the owner asked): a button on Customers and on Suppliers that prints the
//   outstanding summary — everyone who owes / is owed, aged, with the total — on one A4 landscape sheet.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-outprint.mjs [shot-folder]
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
// the print window: keep what it was given, never call the real print box
await pg.evaluate(() => { window.__w = []; window.open = () => { const d = { html: '', write(h) { this.html += h }, close() {} }; const w = { document: d, print() {} }; window.__w.push(w); return w } });

for (const [kind, view, word] of [['C', 'customers', 'customer'], ['S', 'suppliers', 'supplier']]) {
  await pg.evaluate(v => { window.eval('S').view = v; window.eval('render')() }, view); await wait(400);
  const btn = await pg.$(`[data-act="outPrint"][data-kind="${kind}"]`);
  ok(!!btn, `${view}: the Print outstanding button is there`);
  const want = await pg.evaluate(k => { const S = window.eval('S'), pb = window.eval('partyBal');
    const list = k === 'C' ? S.customers.filter(x => x.id !== 1 && x.active !== false) : S.suppliers.filter(x => x.active !== false);
    const o = list.map(x => pb(k, x.id)).filter(v => v > 0.005); return { n: o.length, tot: o.reduce((a, v) => a + v, 0) } }, kind);
  const before = await pg.evaluate(() => window.__w.length);
  // whatever is over the page first (the welcome rays) must be gone before a click reaches the button
  if (btn) { await pg.waitForFunction(k => { const e = document.querySelector(`[data-act="outPrint"][data-kind="${k}"]`), r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + 5, r.y + 5)) }, { timeout: 15000 }, kind).catch(() => {}); await btn.click(); await wait(300) }
  const got = await pg.evaluate(n => window.__w.length > n ? window.__w[window.__w.length - 1].document.html : '', before);
  if (!want.n) { ok(!got, `${view}: nobody owing → no sheet, a note instead`); continue }
  ok(/@page\{size:A4 landscape/.test(got), `${view}: the sheet is A4 landscape`);
  const rows = (got.match(/<tbody>([\s\S]*?)<\/tbody>/) || ['', ''])[1].split('<tr>').length - 1;
  ok(rows === want.n, `${view}: one row for each ${word} with a balance`, `${rows} of ${want.n}`);
  const money2 = await pg.evaluate(v => window.eval('money2')(v), want.tot);
  const foot = (got.match(/<tfoot>([\s\S]*?)<\/tfoot>/) || ['', ''])[1];
  ok(foot.includes(money2), `${view}: the total is the list's own outstanding`, money2);
  // the age columns add up to the bills; with "Other" they add up to the balance
  const ageOk = await pg.evaluate(h => { const d = new DOMParser().parseFromString(h, 'text/html'); const num = s => +String(s).replace(/,/g, '') || 0;
    return [...d.querySelectorAll('tbody tr')].every(tr => { const td = [...tr.children].map(x => x.textContent.trim()); const head = [...d.querySelectorAll('thead th')].map(x => x.textContent.trim());
      const i0 = head.indexOf('0 – 30'), iO = head.indexOf('Outstanding'), iL = head.indexOf('Limit'), iP = head.indexOf('Last payment');
      const end = [iL, iP].filter(i => i > 0).sort((a, b) => a - b)[0];
      let s = 0; for (let i = i0; i < end; i++) s += num(td[i]); return Math.abs(s - num(td[iO])) < 1 }) }, got);
  ok(ageOk, `${view}: on every row the age columns (and Other) add up to the outstanding`);
  const zeroPay = /\d{4}-\d\d-\d\d · 0\.00</.test(got), anyPay = /\d{4}-\d\d-\d\d · [\d,]+\.\d\d</.test(got);
  ok(!zeroPay, `${view}: the last payment shows what was paid, not 0.00`, anyPay ? '' : '(no payments here)');
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); const p2 = await b.newPage(); await p2.setContent(got.replace(/<script>[\s\S]*?<\/script>/, ''));
    await p2.pdf({ path: path.join(SHOTS, `outstanding-${kind}.pdf`), preferCSSPageSize: true }); await p2.setViewport({ width: 1050, height: 720 }); await p2.screenshot({ path: path.join(SHOTS, `outstanding-${kind}.png`) }); await p2.close() }
}
ok(!errs.length, 'no errors on the page', errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
