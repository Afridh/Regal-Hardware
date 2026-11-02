// Quotations by link, and the MRP on the quotation.
//  · a quotation saved from the till gets its own link (regalhw.lk/q/…)
//  · the Quotes page has Text link / WhatsApp / To another number; Text link texts the link to the customer
//  · the link opens the quotation page: "Quotation", every item with its MRP and our price, the quoted total,
//    what they save against the MRP, and the day it holds good until — no payment or feedback parts
//  · the printed A5 quotation has the MRP column with the MRP of each item, even with the bill's MRP column off
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-quotelink.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const SHOT = process.env.SHOTS || '.';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
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
// a quotation for a customer: two items, one below its MRP
const q = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  window.printPaper = () => {}; window.eval('CFG').bill.showMrp = false;      // the bill's MRP column switched off
  const S = window.eval('S'); const ps = S.products.filter(p => p.active !== false && p.mrp > p.retail + 1).slice(0, 2);
  const c = S.customers.find(x => x.id !== 1 && /^0\d{9}$/.test(x.phone || ''));
  S.pos.lines = ps.map(p => ({ pid: p.id, qty: 2, price: p.retail, disc: 0 })); S.pos.customer = c.id;
  window.eval('saveDoc')('QUOTE'); document.querySelectorAll('.modal').forEach(m => m.remove());
  const d = S.docs[S.docs.length - 1]; window.eval('persist')(true);
  return { no: d.no, link: d.link, total: d.total, cid: c.id, phone: c.phone, items: ps.map(p => ({ name: p.name, mrp: p.mrp, price: p.retail })) } });
ok(/\/q\/[a-z0-9]{6,}$/.test(q.link || ''), 'the quotation is saved with its own link', q.link);
await wait(2500);
// the Quotes page: the buttons, and Text link
await pg.evaluate(no => { window.eval("docKind='all'; docState='open'"); window.eval('docSel=' + JSON.stringify(no)); window.eval('go')('docs') }, q.no); await wait(300);
const btns = await pg.evaluate(no => ['quoteSms', 'quoteWa', 'quoteOther'].map(k => !!document.querySelector(`[data-act="${k}"][data-no="${no}"]`)), q.no);
ok(btns.every(Boolean), 'the Quotes page: Text link, WhatsApp, To another number', JSON.stringify(btns));
const n0 = await pg.evaluate(() => window.eval('S').messages.length);
await pg.click(`[data-act="quoteSms"][data-no="${q.no}"]`); await wait(300);
const sent = await pg.evaluate(n0 => { const S = window.eval('S'); return S.messages.slice(0, S.messages.length - n0)[0] }, n0);
ok(sent && sent.to === q.phone && sent.body.includes(q.link) && /hold good until/.test(sent.body), 'Text link: the customer gets the quotation link, and the day it holds until', sent && sent.body.replace(/\s+/g, ' ').slice(0, 160));
// the link
const qp = await b.newPage(); await qp.setViewport({ width: 390, height: 844 }); qp.on('pageerror', e => errs.push('quote: ' + e.message));
await qp.goto(BASE + '/q/' + q.link.split('/').pop(), { waitUntil: 'networkidle2' }); await wait(2500);
const t = await qp.evaluate(() => document.body.innerText);
const m2 = n => 'Rs ' + (+n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
ok(/QUOTATION/i.test(t) && t.includes(q.no), 'the link opens the quotation', t.slice(0, 120).replace(/\s+/g, ' '));
ok(q.items.every(it => t.includes('MRP') && t.includes(m2(it.mrp))), 'every item with its MRP', q.items.map(it => m2(it.mrp)).join(', '));
ok(/Quoted total/.test(t) && t.includes(m2(q.total)) && /Prices hold good until/.test(t), 'the quoted total, and the day it holds good until');
ok(/You save/.test(t) && /against the MRP/.test(t), 'what they save against the MRP');
ok(!/Still to pay|How was your visit|Your account/.test(t), 'no payment, account or feedback parts on a quotation');
await qp.screenshot({ path: SHOT + '/quote-link.png', fullPage: true });
// the printed A5 quotation: the MRP column, with the bill's MRP column off
const a5 = await pg.evaluate(no => { const S = window.eval('S'); const d = S.docs.find(x => x.no === no);
  const inv = { ...d, docKind: 'QUOTE', sub: d.lines.reduce((a, l) => a + l.qty * l.price - (l.disc || 0), 0), paid: 0, balance: 0, pays: [], terminal: '', time: '' };
  const h = window.eval('billHtml')(inv, 'a5'); const div = document.createElement('div'); div.innerHTML = h;
  const head = [...div.querySelectorAll('.x-tbl th')].map(x => x.textContent.trim()); const cells = [...div.querySelectorAll('.x-tbl td.mrp')].map(x => x.textContent.trim());
  return { head, cells } }, q.no);
ok(a5.head.includes('MRP') && a5.cells.length === q.items.length && a5.cells.every(c => /\d/.test(c)), 'the printed A5 quotation: the MRP column, each item\'s MRP (even with the bill\'s MRP column off)', JSON.stringify(a5));
await pg.evaluate(() => { window.eval('CFG').bill.showMrp = true; window.eval('persist')(true) }); await wait(800);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
