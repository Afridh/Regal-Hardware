// A customer who only gave their mobile at the end of a bill is a normal customer, not a credit customer:
//  · their e-bill has no "Your account" box, and they have no credit limit
//  · the box still shows for a customer the shop gave credit, and for anyone who really does owe
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billplain.mjs [screenshot-dir]
// The till here never reaches the print helper on this PC: its printers are the shop's.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010', OUT = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.dismiss());
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
const signIn = async () => {
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await wait(1500);
  await pg.evaluate(() => { window.eval("CFG.print.agent=''"); window.printPaper = () => {}; document.querySelectorAll('.modal').forEach(m => m.remove()) });
};
await signIn();

// five customers, each with a bill paid in full; planted in the test shop and taken out at the end
const made = await pg.evaluate(() => {
  const S = window.eval('S'), base = S.sales.filter(s => s.lines && s.lines.length && s.total > 0).slice(-1)[0];
  const top = Math.max(...S.customers.map(c => c.id));
  const kinds = [
    { k: 'number', name: 'Customer 0711000001', phone: '0711000001', limit: 0, byNumber: true },
    { k: 'named', name: 'Sunil', phone: '0711000002', limit: 0, byNumber: true },
    { k: 'old', name: 'Customer 0711000003', phone: '0711000003', limit: 25000 },
    { k: 'credit', name: 'Nimal Builders', phone: '0711000004', limit: 25000 },
    { k: 'raised', name: 'Customer 0711000005', phone: '0711000005', limit: 50000, byNumber: true },
    { k: 'owes', name: 'Customer 0711000006', phone: '0711000006', limit: 0, byNumber: true },
  ];
  const out = {};
  kinds.forEach((x, i) => {
    const id = top + 1 + i, { k, ...c } = x;
    S.customers.push({ id, code: 'TPL' + i, level: 'retail', address: '', portal: false, lastLogin: null, ...c });
    const link = window.eval('billLinkFor')();
    S.sales.push({ ...base, no: 'TPL-' + i, customerId: id, link, balance: 0, paid: base.total });
    out[k] = { id, path: '/b/' + link.split('/').pop() };
  });
  S.journal.push({ id: 'TPLJ', date: base.date, memo: 'test', lines: [{ ac: '1100', dr: 400, cr: 0, party: { type: 'C', id: out.owes.id } }, { ac: '4000', dr: 0, cr: 400 }] });
  window.eval('persist')(true);
  return out;
});
await wait(3000);

const bp = await b.newPage(); await bp.setViewport({ width: 390, height: 844 }); bp.on('pageerror', e => errs.push('bill: ' + e.message));
const see = async k => { await bp.goto(BASE + made[k].path, { waitUntil: 'networkidle2' }); await wait(1800); return bp.evaluate(() => ({ box: !!document.querySelector('.acct'), text: document.body.innerText, bill: /Settled|Subtotal/.test(document.body.innerText), pdf: /PDF/.test(document.body.innerText) })) };

let r = await see('number');
ok(r.bill && !r.box && !/Your account|All clear|waiting for the shop|See every bill/.test(r.text), 'mobile only: the e-bill has no account box');
ok(r.pdf, 'and everything else on it is still there');
if (OUT) await bp.screenshot({ path: OUT + '/bill-plain.png', fullPage: true });
r = await see('named');
ok(r.bill && !r.box, 'mobile with a name typed: no account box either');
r = await see('old');
ok(r.bill && !r.box, 'one added before this change (no name, the old Rs 25,000): no account box');
r = await see('credit');
ok(r.box && /All clear/.test(r.text), 'a customer the shop added for credit: the box is there');
r = await see('raised');
ok(r.box, 'a mobile-only customer the shop then gave a limit: the box is there');
r = await see('owes');
ok(r.box && /Total outstanding/.test(r.text), 'a mobile-only customer who really does owe: they are told');

// the till: the old ones lose the limit when the books load, the shop's own do not
await pg.bringToFront(); await signIn();
const lim = await pg.evaluate(m => { const C = window.eval('C'); return { old: +C(m.old.id).limit, oldFlag: !!C(m.old.id).byNumber, credit: +C(m.credit.id).limit, raised: +C(m.raised.id).limit } }, made);
ok(lim.old === 0 && lim.oldFlag, 'the till: an old no-name one no longer has the Rs 25,000', JSON.stringify(lim));
ok(lim.credit === 25000 && lim.raised === 50000, 'the till: limits the shop gave are left alone', JSON.stringify(lim));

// the real thing: a new mobile keyed at the end of a bill
const mob = '07110' + String(Date.now()).slice(-5);
const c = await pg.evaluate(ph => { const S = window.eval('S'); window.eval("CFG.done.askCustomer=true"); return S.customers.length }, mob);
const added = await pg.evaluate(ph => new Promise(res => { const S = window.eval('S');
  window.eval('askBillCustomer')(() => res(S.pos.customer));
  setTimeout(() => { const q = document.getElementById('bqQ'); q.value = ph; q.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), 100) }, 200);
  setTimeout(() => res(null), 3000) }), mob);
const nw = await pg.evaluate(ph => { const x = window.eval('S').customers.find(y => y.phone === ph); return x ? { limit: x.limit, byNumber: x.byNumber, name: x.name, id: x.id } : null }, mob);
ok(nw && nw.limit === 0 && nw.byNumber === true, 'a new mobile at the end of a bill: no credit limit, marked as normal', JSON.stringify(nw));

ok(errs.length === 0, 'no errors in the page', errs.join(' | '));
await pg.evaluate((m, ph) => { const S = window.eval('S'), ids = Object.values(m).map(x => x.id);
  S.customers = S.customers.filter(x => !ids.includes(x.id) && x.phone !== ph); S.sales = S.sales.filter(s => !/^TPL-/.test(s.no)); S.journal = S.journal.filter(j => j.id !== 'TPLJ'); S.pos.customer = 1; window.eval('persist')(true) }, made, mob);
await wait(2500);
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
