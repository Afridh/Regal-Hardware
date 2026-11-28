// A bill that used the customer's own credit held with the shop (an advance, or a return kept as credit) prints that line,
// so Net Total = Amount Paid + From their credit + On Credit (28 Nov 2026: bill 20406 showed 4,365 net and 3,279 outstanding, the 1,086 unexplained).
//   node backend/tools/run-e2e.mjs --keep ;  node backend/tools/check-usedcredit.mjs [shot.png]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1100, height: 800 });
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
const r = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'), base = S.sales.find(x => +x.balance > 0.005 && x.customerId !== 1);
  // as the till saves it: 4,365 net, nothing paid at the till, 1,086 from their credit, 3,279 on credit
  const inv = { ...base, total: 4365, paid: 1086, balance: 3279, credit0: 3279, paid0: 0, usedCredit: 1086, prevOut: 0, pays: [{ method: 'CREDIT', amount: 3279 }], type: 'CREDIT' };
  const tx = h => { const d = document.createElement('div'); d.innerHTML = h; document.body.appendChild(d); const s = d.innerText; d.remove(); return s };
  const a5 = window.eval('billHtml')(inv, 'a5'), r80 = window.eval('billHtml')(inv, 'r80');
  const cash = window.eval('billHtml')({ ...inv, balance: 0, credit0: 0, paid: 4365, paid0: 3279, pays: [{ method: 'CASH', amount: 3279 }], type: 'CASH' }, 'r80');
  const box = document.createElement('div'); box.id = 'ucShot'; box.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:99999;overflow:auto;padding:10px'; box.innerHTML = a5; document.body.appendChild(box);
  return { style: (window.eval('CFG').bill || {}).a5Style || 'classic', a5: tx(a5), r80: tx(r80), cash: tx(cash) };
});
ok(/From their credit\s*1,086\.00/.test(r.a5) && /(On Credit|This bill on credit)\s*3,279\.00/.test(r.a5) && /(Amount Paid|Paid now)\s*0\.00/.test(r.a5), 'A5 (' + r.style + '): paid 0 + from their credit 1,086 + on credit 3,279 = 4,365', (r.a5.match(/Amount Paid[\s\S]{0,80}/) || [''])[0].replace(/\s+/g, ' '));
ok(/From their credit Rs\.\s*:?\s*1,086\.00/.test(r.r80) && /Credit Rs\.\s*:?\s*3,279\.00/.test(r.r80), '80mm credit bill shows the line too');
ok(/From their credit Rs\.\s*:?\s*1,086\.00/.test(r.cash), '80mm cash bill that used some credit shows it');
if (process.argv[2]) await pg.screenshot({ path: process.argv[2] });
const other = await pg.evaluate(() => { const B = window.eval('CFG').bill, was = B.a5Style; B.a5Style = 'sepos';
  const S = window.eval('S'), base = S.sales.find(x => +x.balance > 0.005 && x.customerId !== 1);
  const inv = { ...base, total: 4365, paid: 1086, balance: 3279, credit0: 3279, paid0: 0, usedCredit: 1086, prevOut: 0, pays: [{ method: 'CREDIT', amount: 3279 }], type: 'CREDIT' };
  const d = document.createElement('div'); d.innerHTML = window.eval('billHtml')(inv, 'a5'); document.body.appendChild(d); const s = d.innerText; d.remove(); B.a5Style = was; return { style: 'sepos, the shop’s own', s } });
ok(/From their credit\s*1,086\.00/.test(other.s), 'and the other A5 layout (' + other.style + ') shows it too', (other.s.match(/(Amount Paid|Paid now)[\s\S]{0,90}/) || [''])[0].replace(/\s+/g, ' '));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
