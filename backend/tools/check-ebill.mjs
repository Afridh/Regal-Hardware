// The customer's e-bill (the /b/… link texted with a bill) and the rating from it.
//  · it carries the shop as on its own bill: the logo, the name in both languages, the address and phone
//  · the bill lands with its lines, the total, what they saved and the Paid stamp
//  · the customer rates the visit: the stars, a few words, sent once — a second try is "already"
//  · the till takes it in: on the bill, on the Customer feedback report, and a word in the bell
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-ebill.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/:41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});

// a paid bill with a line under its MRP, a logo, and the link it would be texted with
const made = await pg.evaluate(async () => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'), CFG = window.eval('CFG');
  CFG.shop.logo = '/favicon-192.png'; CFG.shop.sinhala = CFG.shop.sinhala || 'රීගල් හාඩ්වෙයාර්';
  const p = S.products.find(x => x.active !== false && +x.retail > 100);
  p.mrp = +p.retail + 50;
  const c = S.customers.find(x => x.id !== 1);
  const inv = window.eval('completeSale')({ lines: [{ pid: p.id, name: p.name, qty: 2, price: +p.retail, disc: 0 }], customerId: c.id, pays: [{ method: 'CASH', amount: 2 * p.retail }] });
  inv.link = window.eval('billLinkFor')(); window.eval('persist')(true);
  return { no: inv.no, id: inv.link.split('/').pop(), cust: c.name, total: inv.total };
});
await wait(2500);

// the customer opens it on a phone
const ph = await b.newPage(); await ph.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const perrs = []; ph.on('pageerror', e => perrs.push(e.message));
await ph.goto(BASE + '/b/' + made.id, { waitUntil: 'networkidle2' }); await wait(4000);
const view = await ph.evaluate(() => ({ name: document.querySelector('#shopName').textContent, si: document.querySelector('#shopSi').textContent,
  logo: !!document.querySelector('#logo img'), chips: document.querySelectorAll('#chips .chip').length, stamp: (document.querySelector('.stamp') || {}).textContent,
  amt: document.querySelector('#amt').textContent, saved: (document.querySelector('.saved') || {}).textContent || '', items: document.querySelectorAll('.item').length,
  hi: document.querySelector('#hi').textContent, stars: document.querySelectorAll('.star').length, wide: document.documentElement.scrollWidth > innerWidth + 1 }));
ok(view.logo && view.si && view.chips >= 2, 'the shop as on its bill: logo, both names, address and phone', JSON.stringify({ name: view.name, chips: view.chips }));
ok(view.stamp === 'Paid' && view.items === 1 && +view.amt.replace(/,/g, '') === made.total, 'the bill: its line, the total counted up to, the Paid stamp', JSON.stringify({ amt: view.amt, total: made.total, stamp: view.stamp, items: view.items }));
ok(/You saved Rs 100\.00/.test(view.saved), 'what they saved against the MRP', view.saved);
ok(view.hi.includes(made.cust), 'thanked by name', view.hi);
ok(!view.wide, 'nothing runs off the side of a phone');
await ph.screenshot({ path: process.env.SHOT || 'ebill.png', fullPage: true });

// they rate it
await ph.click('.star[data-s="5"]'); await wait(500);
const after = await ph.evaluate(() => ({ say: document.querySelector('#say').textContent, open: document.querySelector('#more').classList.contains('open'), tags: document.querySelectorAll('.tg').length }));
ok(after.say === 'Loved it!' && after.open && after.tags >= 4, 'five stars: the face, the words, and things to tick open up', JSON.stringify(after));
await ph.click('.tg'); await ph.type('#note', 'Very helpful at the paint counter'); await ph.click('#send'); await wait(1200);
const done = await ph.evaluate(() => (document.querySelector('#fb .thanks') || {}).innerText || '');
ok(/Thank you/.test(done), 'sent: thank you', done.split('\n')[0]);
await ph.screenshot({ path: process.env.SHOT2 || 'ebill-thanks.png' });
const again = await (await fetch(BASE + '/api/my/b/' + made.id + '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stars: 1 }) })).json();
ok(again.already, 'one rating a bill: a second is not taken');
const bad = await fetch(BASE + '/api/my/b/' + made.id + '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stars: 9 }) });
ok(bad.status === 400 || bad.status === 200, 'a rating that is not 1 to 5 is refused (or already)', String(bad.status));
await ph.reload({ waitUntil: 'networkidle2' }); await wait(1500);
ok(/You have rated/.test(await ph.evaluate(() => (document.querySelector('#fb') || {}).innerText || '')), 'opened again, it says it was rated');

// the till takes it in
let got = null;
for (let i = 0; i < 10 && !got; i++) { await pg.evaluate(() => window.regalBridge && regalBridge.pull && regalBridge.pull(true)); await wait(2500);
  got = await pg.evaluate(no => { const S = window.eval('S'); const inv = S.sales.find(s => s.no === no); return inv && inv.feedback ? { fb: inv.feedback, list: (S.feedback || []).length, bell: (S.notif || []).some(n => /★★★★★/.test(n.text) && n.text.includes(no)) } : null }, made.no) }
ok(got && got.fb.stars === 5 && /paint counter/.test(got.fb.note), 'the till has it on the bill, with their words', JSON.stringify(got && got.fb));
ok(got && got.bell, 'and a word in the bell');
const rep = await pg.evaluate(() => { window.eval("repKey='feedback'; repFrom=''; repTo=''"); window.eval('go')('reports'); return document.querySelector('#main').innerText });
ok(/Customer feedback/.test(rep) && /paint counter/.test(rep) && /5\.0 ★/.test(rep), 'the Customer feedback report shows it, with the average');
ok(!errs.length && !perrs.length, 'no script errors', errs.concat(perrs).slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
