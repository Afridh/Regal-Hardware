// The customer statement says which bills were cancelled, changed or brought back (15 Nov 2026, the owner):
//  · a cancelled bill's line is marked CANCELLED, and the line that takes it back "Cancelled — taken back"
//  · a changed bill: the first version "Changed later — as it was first", the current one "CHANGED — was …"
//  · a return: RETURN of bill …
//  · under the statement, three short lists: Cancelled bills (amount, when, by whom, why), Changed bills (was → now), Returns
//  · the same on the printed statement; an ordinary bill is not marked
// Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-stmtmarks.mjs [folder for screenshots]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
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
await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(1500);
const shot = async n => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, n + '.png') }) };
const r = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval("CFG.print.agent=''"); window.eval('CFG').msg.autoBill = false;
  const S = window.eval('S'), CS = window.eval('completeSale'), tag = 'SM' + Date.now().toString(36).slice(-4).toUpperCase();
  const c = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: tag, name: tag + ' Builders', phone: '0700000061', level: 'retail', limit: 9999999 }; S.customers.push(c);
  const p = S.products.find(x => +x.retail > 100 && x.id !== window.eval('OPEN_PID')); p.stock = Math.max(+p.stock || 0, 200);
  const bill = (q) => CS({ lines: [{ pid: p.id, qty: q, price: 1000, disc: 0 }], customerId: c.id, pays: [], type: 'CREDIT', override: true });
  const plain = bill(1), gone = bill(2), changed = bill(3);
  window.eval('billCancelNow')(gone.no, 'keyed twice', 'Afridh');
  // the changed bill: opened again and made 5 instead of 3, as the till does it
  S.pos.editing = changed.no; S.pos.editWhy = 'wrong quantity';
  const rr = window.eval('retireBill')(changed.no);
  const fresh = CS({ lines: [{ pid: p.id, qty: 5, price: 1000, disc: 0 }], customerId: c.id, pays: [], type: 'CREDIT', override: true, no: changed.no });
  window.eval('finishRemake')(rr, fresh); S.pos.editing = null;
  const back = CS({ lines: [{ pid: p.id, qty: -1, price: 1000, disc: 0, fromLine: 0 }], customerId: c.id, pays: [], toAccount: true, override: true, returnOf: plain.no, returnWhy: 'damaged' });
  window.eval('custSel=' + c.id); window.eval('custTab="statement"'); window.eval('custStmtRange="all"'); window.eval('go')('customers');
  return { cid: c.id, plain: plain.no, gone: gone.no, changed: changed.no, back: back.no };
});
await wait(500);
const tab = await pg.evaluate(() => [...document.querySelectorAll('.cu-tbl.stmt tr')].map(t => ({ cls: t.className, text: t.innerText.replace(/\s+/g, ' ') })));
const lineOf = (no, re) => tab.filter(t => t.text.includes(no) && (!re || re.test(t.text)));
ok(lineOf(r.gone).some(t => /CANCELLED/.test(t.text) && t.cls.includes('cx')), 'the cancelled bill is marked CANCELLED (and struck through)', JSON.stringify(lineOf(r.gone).map(t => t.text)));
ok(lineOf(r.gone).some(t => /Cancelled — taken back/.test(t.text)), 'the line taking it back says so');
ok(lineOf(r.changed).some(t => /CHANGED — was (Rs )?3,000\.00/.test(t.text)) && lineOf(r.changed).some(t => /as it was first/.test(t.text)) && lineOf(r.changed).some(t => /old bill taken back/.test(t.text)), 'the changed bill: the first version, the taking back, and "CHANGED — was 3,000.00"', JSON.stringify(lineOf(r.changed).map(t => t.text)));
ok(lineOf(r.back).some(t => new RegExp('RETURN of bill ' + r.plain).test(t.text)), 'the return is marked RETURN of bill ' + r.plain);
ok(!lineOf(r.plain).filter(t => !t.text.includes(r.back)).some(t => /CANCELLED|CHANGED|RETURN/.test(t.text)), 'an ordinary bill is not marked');
const lists = await pg.evaluate(() => [...document.querySelectorAll('.cu-panel .stl')].map(x => x.innerText.replace(/\s+/g, ' ')));
ok(lists.length === 3 && /Cancelled bills \(1\)/.test(lists[0]) && /2,000\.00/.test(lists[0]) && /keyed twice/.test(lists[0]) && /Afridh/.test(lists[0]), 'the list of cancelled bills: amount, who and why', lists[0]);
ok(/Changed bills \(1\)/.test(lists[1]) && /was (Rs )?3,000\.00 → now (Rs )?5,000\.00/.test(lists[1]) && /wrong quantity/.test(lists[1]), 'the list of changed bills: was → now, and why', lists[1]);
ok(/Returns \(1\)/.test(lists[2]) && /1,000\.00 back/.test(lists[2]) && new RegExp('from bill ' + r.plain).test(lists[2]), 'the list of returns', lists[2]);
await shot('stmt-tab');
// the printed statement
await pg.evaluate(id => window.eval('statement')(id, 'print'), r.cid); await wait(400);
const prt = await pg.evaluate(() => { const m = [...document.querySelectorAll('.modal')].pop(); return m ? m.innerText.replace(/\s+/g, ' ') : '' });
ok(/CANCELLED/.test(prt) && /CHANGED — was (Rs )?3,000\.00/.test(prt) && /RETURN of bill/.test(prt) && /Cancelled bills \(1\)/.test(prt) && /Changed bills \(1\)/.test(prt) && /Returns \(1\)/.test(prt), 'the printed statement says the same');
await shot('stmt-print');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
