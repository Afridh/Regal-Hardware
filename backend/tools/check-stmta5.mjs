// A customer's statement prints on A5 in one go (28 Nov 2026): F8 / Statement opens the A5 paper, Enter sends it to the
// A5 printer, a long one page by page, the period can be changed on it.
//   node backend/tools/run-e2e.mjs --keep ;  node backend/tools/check-stmta5.mjs [shot-dir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', OUT = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.dismiss());
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url()) || (rq.method() === 'PUT' && /books/.test(rq.url()))) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
const id = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'); window._sent = []; window.printPaperOne = (html, f, no, fb, sent) => { window._sent.push({ f, no, rows: (html.match(/<tr[ >]/g) || []).length }); sent && sent() };
  const c = S.customers.find(x => x.id !== 1 && window.eval('partyBal')('C', x.id) > 0) || S.customers.find(x => x.id !== 1);
  window.eval('custStmtRange = "all"'); window.eval('go')('customers'); window.eval('statement')(c.id, 'print'); return c.id });
await wait(500);
const v = await pg.evaluate(() => { const s = document.querySelector('.modal .print.a5.st5'); return { sheet: !!s, txt: s ? s.innerText : '', w: s ? Math.round(s.getBoundingClientRect().width) : 0, focus: document.activeElement && document.activeElement.id } });
ok(v.sheet && /STATEMENT OF ACCOUNT/.test(v.txt) && /BALANCE DUE/.test(v.txt), 'the statement opens as the A5 paper', v.w + 'px');
ok(v.focus === 'st5Go', 'Print is ready for Enter');
if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await pg.screenshot({ path: path.join(OUT, 'stmt-a5.png') }) }
await pg.keyboard.press('Enter'); await wait(2500);
let s = await pg.evaluate(() => window._sent);
ok(s.length === 1 && s[0].f === 'a5' && /^Statement/.test(s[0].no), 'Enter sends it straight to the A5 printer', JSON.stringify(s));
// a long account: many rows go out page by page
await pg.evaluate(cid => { const S = window.eval('S'); window._sent = []; document.querySelectorAll('.modal').forEach(m => m.remove());
  const keep = window.eval('custLedger'); window.custLedger = id => { const r = keep(id); const out = []; let run = 0; for (let i = 0; i < 70; i++) { const dr = 1000 + i, cr = i % 3 ? 0 : 500; run += dr - cr; out.push({ date: '2026-10-' + String(1 + i % 28).padStart(2, '0'), desc: 'Bill ' + i, ref: 'T' + i, dr, cr, run }) } return out };
  window.eval('statement')(cid, 'print') }, id);
await wait(400); await pg.click('#st5Go'); await wait(4000);
s = await pg.evaluate(() => window._sent);
ok(s.length >= 2 && s.every(x => x.f === 'a5') && /page 1/.test(s[0].no), 'a long statement goes out page by page', s.map(x => x.no + ':' + x.rows).join(', '));
// the period on it
await pg.evaluate(() => { document.querySelector('[data-st5r="1m"]').click() }); await wait(400);
const p = await pg.evaluate(() => ({ n: document.querySelectorAll('.modal .st5-box').length, r: window.eval('custStmtRange'), t: (document.querySelector('.st5-kv') || {}).innerText || '' }));
ok(p.n === 1 && p.r === '1m' && / to /.test(p.t), 'the period changes on it, one window still', JSON.stringify(p));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
