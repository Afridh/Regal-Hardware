// The customer's link from a reminder: no codes to type.
//  · not open yet: the link shows what is outstanding at once, and "See my full statement" asks the shop
//    in one tap (no code); opened again, it says it is waiting
//  · the shop says yes in Approvals: the text has their link and says nothing about a code
//  · the same link now opens the full statement straight in — no mobile, no code
//  · a link without its key, or with a wrong one, still shows nothing and asks for the mobile and a code
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-mylink.mjs
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
const signIn = async () => {
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
};
await signIn(); await wait(1500);
// a credit customer, page not open, with a bill owing; saved
const made = await pg.evaluate(async () => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {};
  const S = window.eval('S'), C = window.eval('CFG'); C.done.askSize = false; C.done.printAnim = false; C.done.preview = false; window.eval('CS').paper = 'none';
  const id = Math.max(...S.customers.map(x => x.id)) + 1000 + Math.floor(Math.random() * 1e6);   // never an id a past run's ask still waits on
  const c = { id, code: 'CLINK' + id, name: 'Link Test ' + id, phone: '0771239876', address: '', email: '', level: 'retail', limit: 1e9, notes: '', portal: false, points: 0 }; S.customers.push(c);
  const p = S.products.find(x => x.active !== false && x.stock > 10 && !(x.tiers || []).length);
  S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.customer = c.id;
  const inv = window.eval('finishTillBill')({ cust: c, pays: [{ method: 'CREDIT', amount: 0 }] });
  const link = window.eval('myLink')(c); window.eval('persist')(true);
  return { cid: id, link: '/' + link.split('/').slice(1).join('/'), total: inv.total } });
await wait(3000);
const cust = await b.newPage(); await cust.setViewport({ width: 400, height: 800 });
cust.on('pageerror', e => errs.push('my: ' + e.message));
if (process.env.DEBUG) cust.on('response', r => { if (r.url().includes('/api/')) r.text().then(t => console.log('  ', r.status(), r.url().replace(BASE, ''), t.slice(0, 120))).catch(() => {}) });
await cust.goto(BASE + made.link, { waitUntil: 'networkidle2' }); await cust.waitForFunction(() => !document.getElementById('intro'), { timeout: 15000 }).catch(() => {}); await wait(600);
const s1 = await cust.evaluate(() => ({ owed: document.getElementById('lkOwed').innerText, bills: document.getElementById('lkBills').innerText,
  link: !document.getElementById('stepLink').classList.contains('hide'), code: !document.getElementById('stepPhone').classList.contains('hide') || !document.getElementById('stepCode').classList.contains('hide') }));
const want = 'Rs ' + made.total.toLocaleString('en-LK', { minimumFractionDigits: 2 });
ok(s1.link && !s1.code && s1.owed === want && /1 unpaid bill/.test(s1.bills), 'the link shows the outstanding straight away, no code asked', JSON.stringify(s1) + ' want ' + want);
if (process.env.DEBUG) console.log('  at the button:', await cust.evaluate(() => { const r = document.getElementById('lkAsk').getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return `${r.x},${r.y} ${r.width}x${r.height} → ${e && (e.id || e.className || e.tagName)}` }));
await cust.click('#lkAsk'); await wait(1200);
ok(await cust.evaluate(() => !document.getElementById('lkWait').classList.contains('hide')), 'one tap on "See my full statement" asks the shop — no code', await cust.evaluate(() => document.getElementById('msg').innerText));
await cust.reload({ waitUntil: 'networkidle2' }); await cust.waitForFunction(() => !document.getElementById('intro'), { timeout: 15000 }).catch(() => {}); await wait(600);
ok(await cust.evaluate(() => !document.getElementById('lkWait').classList.contains('hide') && document.getElementById('lkAsk').classList.contains('hide')), 'opened again: it says it is waiting for the shop');
// the till picks up the ask; the owner says yes
await pg.bringToFront(); await signIn(); await wait(1500);
const said = await pg.evaluate(async (cid) => { const S = window.eval('S'); document.querySelectorAll('.modal').forEach(m => m.remove());
  const a = S.approvals.find(x => x.kind === 'custPortal' && x.status === 'pending' && x.data && x.data.cid === cid);
  if (!a) return { none: true };
  const n0 = S.messages.length; window.eval('decideApproval')(a.id, true); window.eval('persist')(true);
  const m = S.messages.slice(0, S.messages.length - n0).find(x => x.to === '0771239876'); return { body: m && m.body || '' } }, made.cid);
ok(said.body && /Tap to see it: regalhw\.lk\/my\//.test(said.body) && !/code|type your mobile/i.test(said.body), 'the yes texts their link, with no code to type', JSON.stringify(said));
await wait(3000);
await cust.reload({ waitUntil: 'networkidle2' }); await wait(1800);
const s2 = await cust.evaluate(() => ({ signin: !document.getElementById('signin').classList.contains('hide'), text: document.body.innerText.slice(0, 400) }));
ok(!s2.signin && /Link Test/.test(s2.text), 'the same link now opens the full statement straight in', s2.text.replace(/\s+/g, ' ').slice(0, 160));
// a wrong key: nothing shown, mobile and code
const other = await (await b.createBrowserContext()).newPage();   // another phone: nothing kept from the customer
await other.goto(BASE + made.link.replace(/\.[a-z0-9]+$/, '.zzzzzzzz'), { waitUntil: 'networkidle2' }); await wait(1000);
const s3 = await other.evaluate(() => ({ phone: !document.getElementById('stepPhone').classList.contains('hide'), link: !document.getElementById('stepLink').classList.contains('hide'), name: /Link Test/.test(document.body.innerText) }));
ok(s3.phone && !s3.link && !s3.name, 'a wrong key: no name, no amount — the mobile and a code as before', JSON.stringify(s3));
// tidy up
await pg.evaluate((cid) => { const S = window.eval('S'); const nos = S.sales.filter(s => s.customerId === cid).map(s => s.no);
  S.sales = S.sales.filter(s => s.customerId !== cid); S.journal = S.journal.filter(j => !nos.includes(j.ref));
  S.movements.filter(x => nos.includes(x.ref)).forEach(x => { const p = window.eval('P')(x.pid); p.stock = +(p.stock - x.qty).toFixed(3) }); S.movements = S.movements.filter(x => !nos.includes(x.ref));
  S.customers = S.customers.filter(c => c.id !== cid); window.eval('persist')(true) }, made.cid);
await wait(2000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
