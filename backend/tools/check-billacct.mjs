// The e-bill link of a credit bill: the customer's whole account, and the way into it.
//  · the bill shows "Still to pay on this bill" and, under it, the customer's TOTAL outstanding (what the
//    books say they owe — every bill, not just this one) and how many bills are unpaid
//  · "See every bill and payment": their own page, signed in with their mobile and a texted code — open for
//    a credit customer even though the shop never switched their page on; not for one switched off by hand
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
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
// a customer who owes on more than one bill, their page never switched on; a credit bill with a link
const c = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'); const cs = S.customers.filter(x => x.id !== 1 && x.active !== false && /^0\d{9}$/.test(x.phone || '') && S.sales.filter(s => s.customerId === x.id && s.balance > 0.005).length >= 1);
  const x = cs[0]; x.portal = false; delete x.portalOff;
  const inv = S.sales.filter(s => s.customerId === x.id && s.balance > 0.005).slice(-1)[0];
  if (!inv.link) inv.link = window.eval('billLinkFor')();
  window.eval('persist')(true);
  return { id: x.id, name: x.name, phone: x.phone, owes: window.eval('partyBal')('C', x.id), open: S.sales.filter(s => s.customerId === x.id && s.balance > 0.005).length, no: inv.no, bal: inv.balance, link: inv.link } });
await wait(2500);
const bp = await b.newPage(); await bp.setViewport({ width: 390, height: 844 }); bp.on('pageerror', e => errs.push('bill: ' + e.message));
const path = '/b/' + c.link.split('/').pop();
await bp.goto(BASE + path, { waitUntil: 'networkidle2' }); await wait(2500);
const shown = await bp.evaluate(() => ({ txt: document.body.innerText, go: !!document.querySelector('.acct-go'), href: (document.querySelector('.acct-go') || {}).getAttribute && document.querySelector('.acct-go').getAttribute('href') }));
const m2 = n => 'Rs ' + (+n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
ok(/Still to pay on this bill/.test(shown.txt) && shown.txt.includes(m2(c.bal)), 'the bill: "Still to pay on this bill" ' + m2(c.bal));
ok(/Total outstanding/.test(shown.txt) && shown.txt.includes(m2(c.owes)), `under it: their TOTAL outstanding ${m2(c.owes)}, as the books say`, shown.txt.match(/Total outstanding[\s\S]{0,60}/)?.[0]?.replace(/\s+/g, ' '));
ok(new RegExp(c.open + ' unpaid bill').test(shown.txt), `and ${c.open} unpaid bill(s)`);
await bp.evaluate(() => document.querySelector('.acct') && document.querySelector('.acct').scrollIntoView());
await bp.screenshot({ path: SHOT + '/billacct.png', fullPage: true });
ok(shown.go && /^\/my/.test(shown.href || ''), 'a "See every bill and payment" button to their own page', shown.href);
// into their page: mobile and the texted code (texting is not on here, so the test server shows the code)
await bp.click('.acct-go'); await bp.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}); await wait(1500);
const onMy = await bp.evaluate(() => ({ url: location.pathname, phone: !!document.querySelector('#phone') && document.querySelector('#phone').offsetParent !== null, txt: document.body.innerText.slice(0, 400) }));
ok(/^\/my/.test(onMy.url), 'their own page opens to sign in', onMy.url);
const otp = await bp.evaluate(async ph => { const r = await fetch('/api/my/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph }) }); return { s: r.status, j: await r.json() } }, c.phone);
ok(otp.s === 200, 'a credit customer whose page was never switched on can ask for a sign-in code', JSON.stringify(otp).slice(0, 160));
if (otp.j.code) {
  const li = await bp.evaluate(async (ph, code) => { const r = await fetch('/api/my/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph, code }) }); return { s: r.status, j: await r.json() } }, c.phone, otp.j.code);
  ok(li.s === 200 && li.j.token, 'the code signs them in to their account', JSON.stringify({ s: li.s, name: li.j.name }));
  const me = await bp.evaluate(async t => { const r = await fetch('/api/my/me', { headers: { Authorization: 'Bearer ' + t } }); return r.json() }, li.j.token);
  ok(me && (me.ok || me.customer), 'their account opens: bills and payments', JSON.stringify(me).slice(0, 120));
} else ok(false, 'the test server should show the code when texting is off', JSON.stringify(otp.j));
// switched off by hand: not even from the bill
await pg.bringToFront(); await pg.evaluate(id => { const x = window.eval('C')(id); window.eval('custPortalSet')(x, false); window.eval('persist')(true) }, c.id); await wait(2500);
const off = await bp.evaluate(async ph => (await fetch('/api/my/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph }) })).status, c.phone);
ok(off === 403, 'a customer whose page the shop switched off by hand cannot sign in', off);
await bp.goto(BASE + path, { waitUntil: 'networkidle2' }); await wait(2000);
const off2 = await bp.evaluate(() => ({ go: !!document.querySelector('.acct-go'), owe: /Total outstanding/.test(document.body.innerText) }));
ok(!off2.go && off2.owe, 'their bill still shows the total outstanding, but no sign-in button', JSON.stringify(off2));
await pg.evaluate(id => { const x = window.eval('C')(id); delete x.portalOff; window.eval('persist')(true) }, c.id); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
