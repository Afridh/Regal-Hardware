// The e-bill link of a credit bill: the customer's whole account, and the way into it — by the shop's leave.
//  · the bill shows "Still to pay on this bill" and the customer's TOTAL outstanding (every bill)
//  · "See every bill and payment" when their page is not open: asks the shop; the bill then says it is waiting;
//    no sign-in code is given until the shop says yes
//  · the shop says yes in Approvals: their page opens and a text says "Approval granted" — sign in with the
//    mobile and a code; then they sign in, and their balance is the one the books have
//  · a sign-in kept on the phone for another customer is not used on this customer's link
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billacct.mjs
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
const signIn = async () => {
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await wait(1500); await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
};
await signIn();
// a customer who owes, their page off; a credit bill with a link
const c = await pg.evaluate(() => {
  const S = window.eval('S'); const cs = S.customers.filter(x => x.id !== 1 && x.active !== false && /^0\d{9}$/.test(x.phone || '') && S.sales.some(s => s.customerId === x.id && s.balance > 0.005));
  const x = cs[0]; x.portal = false; delete x.portalOff; S.approvals = (S.approvals || []).filter(a => !(a.kind === 'custPortal' && a.data && a.data.cid === x.id));
  const other = S.customers.find(y => y.id !== 1 && y.id !== x.id && /^0\d{9}$/.test(y.phone || '')); other.portal = true;
  const inv = S.sales.filter(s => s.customerId === x.id && s.balance > 0.005).slice(-1)[0];
  if (!inv.link) inv.link = window.eval('billLinkFor')();
  window.eval('myLink')(x); window.eval('persist')(true);
  return { id: x.id, phone: x.phone, code: x.code, owes: window.eval('partyBal')('C', x.id), no: inv.no, bal: inv.balance, link: inv.link, other: { id: other.id, phone: other.phone } } });
await wait(2500);
const bp = await b.newPage(); await bp.setViewport({ width: 390, height: 844 }); bp.on('pageerror', e => errs.push('bill: ' + e.message));
const path = '/b/' + c.link.split('/').pop();
const m2 = n => 'Rs ' + (+n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
await bp.goto(BASE + path, { waitUntil: 'networkidle2' }); await wait(2500);
let t = await bp.evaluate(() => document.body.innerText);
ok(/Still to pay on this bill/.test(t) && t.includes(m2(c.bal)), 'the bill: "Still to pay on this bill" ' + m2(c.bal));
ok(/Total outstanding/.test(t) && t.includes(m2(c.owes)), `and their TOTAL outstanding ${m2(c.owes)}`);
// 1. not open: the button asks the shop
ok(!!(await bp.$('#askOpen')) && /Ask the shop to open your account/.test(t), '"See every bill and payment" asks the shop (their page is not open)');
const before = await bp.evaluate(async ph => (await fetch('/api/my/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph }) })).status, c.phone);
ok(before === 403, 'no sign-in code before the shop says yes', before);
await bp.click('#askOpen'); await wait(1200);
t = await bp.evaluate(() => document.body.innerText);
ok(/Asked — waiting for the shop/.test(t), 'pressed: "Asked — waiting for the shop … we will text you"');
await bp.screenshot({ path: SHOT + '/billacct-asked.png', fullPage: true });
await bp.reload({ waitUntil: 'networkidle2' }); await wait(2000);
ok(/Asked — waiting for the shop/.test(await bp.evaluate(() => document.body.innerText)) && !(await bp.$('#askOpen')), 'opened again: still waiting, not asked twice');
// 2. the shop: the ask is in Approvals; yes opens the page and texts them
await pg.bringToFront(); await signIn(); await wait(1500);
const ap = await pg.evaluate(id => { const a = (window.eval('S').approvals || []).find(x => x.kind === 'custPortal' && x.status === 'pending' && x.data && x.data.cid === id); return a && { id: a.id, title: a.title, inbox: !!a.custInbox } }, c.id);
ok(ap && ap.inbox && /asks to open their page/.test(ap.title), 'the shop sees it in Approvals', ap && ap.title);
const after = await pg.evaluate((apid, cid) => { const S = window.eval('S'); const n0 = S.messages.length; window.eval('decideApproval')(apid, true); const x = window.eval('C')(cid);
  const msg = S.messages.slice(0, S.messages.length - n0).find(m => m.to === x.phone); return { portal: x.portal, msg: msg && msg.body } }, ap.id, c.id);
ok(after.portal === true && /Approval granted/.test(after.msg || '') && /code we text you/.test(after.msg || ''), 'yes: their page opens, and a text says "Approval granted … sign in with the code we text you"', (after.msg || '').replace(/\s+/g, ' ').slice(0, 160));
await pg.evaluate(() => window.eval('persist')(true)); await wait(2500);
// 3. the customer signs in with the mobile and a code, and sees the balance the books have
await bp.bringToFront(); await bp.goto(BASE + path, { waitUntil: 'networkidle2' }); await wait(2000);
const go = await bp.evaluate(() => { const a = document.querySelector('a.acct-go'); return a && a.getAttribute('href') });
ok(/^\/my/.test(go || ''), 'the bill now leads to sign in', go);
const otp = await bp.evaluate(async ph => { const r = await fetch('/api/my/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph }) }); return { s: r.status, j: await r.json() } }, c.phone);
ok(otp.s === 200, 'now a sign-in code is given', JSON.stringify(otp).slice(0, 100));
if (otp.j.code) {
  await bp.goto(BASE + go, { waitUntil: 'networkidle2' }); await wait(1500);
  const shownSignin = await bp.evaluate(() => !!document.querySelector('#signin') && getComputedStyle(document.querySelector('#signin')).display !== 'none');
  ok(shownSignin, 'their page asks them to sign in (nothing shown before)');
  const li = await bp.evaluate(async (ph, code) => { const r = await fetch('/api/my/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph, code }) }); return r.json() }, c.phone, otp.j.code);
  const me = await bp.evaluate(async t2 => (await fetch('/api/my/me', { headers: { Authorization: 'Bearer ' + t2 } })).json(), li.token);
  ok(li.token && Math.abs(me.owed - c.owes) < 0.01, `signed in: their balance ${m2(me.owed)} is the books' ${m2(c.owes)}`);
  // 4. a sign-in on this phone for someone else is not used on this link
  const otp2 = await bp.evaluate(async ph => (await (await fetch('/api/my/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph }) })).json()), c.other.phone);
  const li2 = await bp.evaluate(async (ph, code) => (await (await fetch('/api/my/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph, code }) })).json()), c.other.phone, otp2.code);
  await bp.evaluate(tk => localStorage.setItem('regal_my_token', tk), li2.token);
  await bp.goto(BASE + go, { waitUntil: 'networkidle2' }); await wait(2000);
  const wrong = await bp.evaluate(() => ({ signin: !!document.querySelector('#signin') && getComputedStyle(document.querySelector('#signin')).display !== 'none', acct: !!document.querySelector('#account') && getComputedStyle(document.querySelector('#account')).display !== 'none' }));
  ok(wrong.signin && !wrong.acct, 'another customer\'s sign-in on this phone is not used here — it asks to sign in', JSON.stringify(wrong));
} else ok(false, 'the test server should show the code when texting is off', JSON.stringify(otp.j));
await pg.bringToFront(); await pg.evaluate(id => { const x = window.eval('C')(id); x.portal = false; window.eval('persist')(true) }, c.id); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
