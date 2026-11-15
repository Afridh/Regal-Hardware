// Every 80mm slip keeps clear of the left edge, like the bill (15 Nov 2026: an 80mm quotation printed with its left
// side cut off). Checks the inner margin box on each 80mm slip as it goes to the paper, and the quotation's left edge
// against the bill's when drawn the way the print helper draws an 80mm receipt. Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-r80margin.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
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
await pg.waitForFunction(() => window.eval('S').sales.length > 0, { timeout: 30000 }); await wait(1200);
await wait(1000);
const docs = await pg.evaluate(() => {
  const S = window.eval('S'), P = window.eval('printDocument');
  const sale = S.sales.find(s => +s.total > 0 && !s.returnOf && !s.cancelled && (s.lines || []).length);
  const doc = { no: 'Q-TEST', kind: 'QUOTE', date: sale.date, customerId: sale.customerId, lines: sale.lines.map(l => ({ ...l })), billDisc: 0, total: sale.total, valid: 14, by: 'Admin', status: 'open' };
  const dn = { ...doc, no: 'DN-TEST', kind: 'DN' };
  const out = { bill: P(window.eval('billHtml')(sale, 'r80'), 'r80'), quote: P(window.eval('docPaperHtml')(doc, 'r80'), 'r80') };
  try { out.dnote = P(window.eval('docPaperHtml')(dn, 'r80'), 'r80') } catch (e) { out.dnoteErr = e.message }
  return out;
});
const look = async (html) => {
  const p2 = await b.newPage(); await p2.setViewport({ width: 576, height: 800 }); await p2.setContent(html, { waitUntil: 'load' }); await p2.emulateMediaType('print');
  const r = await p2.evaluate(() => {
    document.body.classList.add('direct-print'); document.body.style.margin = '0';
    const p = document.querySelector('#printArea .print'); const sc = +p.dataset.scale || 1;      // as the print helper draws an 80mm receipt
    p.style.width = (302 / sc) + 'px'; p.style.border = '0'; p.style.padding = '2px 4px'; p.style.boxSizing = 'border-box'; p.style.zoom = String(576 / 302 * sc);
    const inner = p.querySelector(':scope > .sb-inner');
    const left = Math.min(...[...p.querySelectorAll('.sb-kv span, .sb-items td.l, .sb-items td')].map(e => e.getBoundingClientRect().left).filter(x => x > 0));
    return { one: p.children.length === 1 && !!inner, inner: !!inner, kids: p.children.length, left: Math.round(left) };
  });
  await p2.close(); return r;
};
const bl = await look(docs.bill), ql = await look(docs.quote);
ok(bl.inner, 'the 80mm bill has its inner margin', JSON.stringify(bl));
ok(ql.one, 'the 80mm quotation has it too, with everything inside it', JSON.stringify(ql));
ok(Math.abs(ql.left - bl.left) <= 2 && ql.left >= 20, 'the quotation\'s left edge is where the bill\'s is, clear of the paper\'s edge', `quote ${ql.left}px · bill ${bl.left}px`);
if (docs.dnote) { const dl = await look(docs.dnote); ok(dl.one, 'the 80mm delivery note has it too', JSON.stringify(dl)); }
const twice = await pg.evaluate(() => { const P = window.eval('printDocument'), h = P(P('<div class="print r80 sb80"><b>x</b></div>', 'r80'), 'r80'); return (h.match(/class="sb-inner"/g) || []).length });
ok(twice === 1, 'printed twice over, it is not boxed twice', String(twice));
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
