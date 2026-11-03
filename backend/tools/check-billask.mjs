// The e-bill's way into the customer's own page, whatever way their mobile was typed.
//  · a credit customer whose mobile is kept as "+94 77 …": the bill link still offers "See every bill and
//    payment" (ask the shop to open it), and asking works
//  · a credit customer with no mobile: the account card is still there, saying to give the shop a mobile
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billask.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
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
// two customers and a credit bill each, saved so the server can show the links
const made = await pg.evaluate(async () => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {};
  const S = window.eval('S'), C = window.eval('CFG'); C.done.askSize = false; C.done.printAnim = false; C.done.preview = false; window.eval('CS').paper = 'none';
  const id = Math.max(...S.customers.map(x => x.id));
  const mk = (n, phone) => { const c = { id: n, code: 'CTEST' + n, name: 'Ask Test ' + n, phone, address: '', email: '', level: 'retail', limit: 1e9, notes: '', portal: false, points: 0 }; S.customers.push(c); return c };
  const a = mk(id + 1, '+94 77 123 4511'), z = mk(id + 2, '');
  const p = S.products.find(x => x.active !== false && x.stock > 10 && !(x.tiers || []).length);
  const bill = (c) => { S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.customer = c.id; return window.eval('finishTillBill')({ cust: c, pays: [{ method: 'CREDIT', amount: 0 }] }) };
  const ia = bill(a), iz = bill(z); window.eval('persist')(true);
  return { a: ia.link.split('/').pop(), z: iz.link.split('/').pop(), aid: a.id, zid: z.id } });
await wait(3000);
const api = (id) => pg.evaluate(async id => { const r = await fetch('/api/my/b/' + id); return r.json() }, id);
const ja = await api(made.a);
ok(ja.bill && ja.bill.customer && ja.bill.customer.canAsk === true, 'a mobile kept as "+94 77 123 4511": the bill offers to ask for the account', JSON.stringify(ja.bill && ja.bill.customer));
const p2 = await b.newPage(); await p2.goto(BASE + '/b/' + made.a, { waitUntil: 'networkidle2' }); await wait(1500);
ok(!!(await p2.$('#askOpen')), 'the bill page shows "See every bill and payment"');
await p2.click('#askOpen'); await wait(1500);
ok(/Asked — waiting for the shop/.test(await p2.evaluate(() => document.body.innerText)), 'asking works: "Asked — waiting for the shop"');
const p3 = await b.newPage(); await p3.goto(BASE + '/b/' + made.z, { waitUntil: 'networkidle2' }); await wait(1500);
const zt = await p3.evaluate(() => (document.querySelector('.acct') || {}).innerText || '');
ok(/Your account/.test(zt) && /Give the shop your mobile number/.test(zt), 'no mobile on the card: the account card is there, saying to give the shop a mobile', zt.replace(/\s+/g, ' ').slice(0, 160));
// tidy up: the two test customers and their bills
await pg.evaluate(m => { const S = window.eval('S'); const nos = S.sales.filter(s => s.customerId === m.aid || s.customerId === m.zid).map(s => s.no);
  S.sales = S.sales.filter(s => !nos.includes(s.no)); S.journal = S.journal.filter(j => !nos.includes(j.ref)); S.customers = S.customers.filter(c => c.id !== m.aid && c.id !== m.zid); window.eval('persist')(true) }, made);
await wait(1500);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
