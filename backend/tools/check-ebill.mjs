// The customer's e-bill (the /b/… link texted with a bill) and the rating from it.
//  · it carries the shop as on its own bill: the logo, the name in both languages, the address and phone
//  · the bill lands with its lines, the total, what they saved and the Paid stamp
//  · the customer rates the visit: the stars, a few words, sent once — a second try is "already"
//  · the till takes it in: on the bill, on the Customer feedback report, and a word in the bell
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-ebill.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import http from 'node:http';
// a stand-in text gateway: what would go to the owner's phone comes here instead
const texts = []; const gw = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { texts.push(Object.fromEntries(new URLSearchParams(b))); res.setHeader('Content-Type', 'application/json'); res.end('{"success":true}') }) });
await new Promise(r => gw.listen(4019, '127.0.0.1', r));
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Rang them, sorry given' : undefined));
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

// a paid bill with a line under its MRP, and the link it would be texted with — no logo set in the
// till, as in the shop: the page shows the shop's own (regal-logo.png)
const made = await pg.evaluate(async () => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'), CFG = window.eval('CFG');
  CFG.shop.logo = ''; CFG.shop.sinhala = CFG.shop.sinhala || 'රීගල් හාඩ්වෙයාර්';
  window.__msg = JSON.parse(JSON.stringify(CFG.msg || {})); window.__owner = CFG.shop.owner;
  CFG.msg = { ...CFG.msg, live: true, apiUrl: 'http://127.0.0.1:4019/send', apiKey: 'test', provider: 'test', testOnly: '', fbOwner: true }; CFG.shop.owner = '0770000009';
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
// the owner is texted as it comes in
const toOwner = texts.find(x => x.to === '94770000009' && /★★★★★/.test(x.text || '') && (x.text || '').includes(made.no));
ok(toOwner && /paint counter/.test(toOwner.text) && /^Dear Owner,/.test(toOwner.text), 'the owner is texted the rating, with their words', toOwner ? toOwner.text.split('\n').slice(1, 3).join(' / ') : `${texts.length} text(s), none to the owner`);
// and it waits in the Action centre's Decisions tray until someone has looked
const ac = await pg.evaluate(no => { window.eval("inTab='decide'; actCat='all'; actQ=''"); window.eval('go')('actions');
  const row = [...document.querySelectorAll('.ib-list .act-item')].find(r => r.innerText.includes(no) && /New feedback/.test(r.innerText));
  return { row: !!row, seen: !!(row && row.querySelector('[data-act="fbSeen"]')), badge: (document.querySelector('#nav [data-view="actions"] .nbadge') || {}).textContent || '' } }, made.no);
ok(ac.row && ac.seen && +ac.badge > 0, 'the Action centre shows it under Decisions, with Seen, and the menu counts it', JSON.stringify(ac));
await pg.evaluate(no => [...document.querySelectorAll('.ib-list .act-item')].find(r => r.innerText.includes(no) && /New feedback/.test(r.innerText)).querySelector('[data-act="fbSeen"]').click(), made.no); await wait(300);
ok(await pg.evaluate(no => ![...document.querySelectorAll('.ib-list .act-item')].some(r => r.innerText.includes(no) && /New feedback/.test(r.innerText)), made.no), 'Seen: it leaves the tray');
const rep = await pg.evaluate(() => { window.eval("repKey='feedback'; repFrom=''; repTo=''"); window.eval('go')('reports'); return document.querySelector('#main').innerText });
ok(/Customer feedback/.test(rep) && /paint counter/.test(rep) && /\d\.\d ★/.test(rep), 'the Customer feedback report shows it, with the average');
// its own page, under Customers: the average, the spread, what they ticked, who served them, the list
const page = await pg.evaluate(() => { window.eval("fbShow='all'; fbQ=''"); window.eval('go')('feedback');
  return { menu: !!document.querySelector('#nav [data-view="feedback"]'), text: document.querySelector('#main').innerText, items: document.querySelectorAll('.fb-item').length } });
ok(page.menu && /Average rating/i.test(page.text) && /paint counter/.test(page.text) && /Friendly staff/.test(page.text) && /By who served them/.test(page.text) && page.items >= 1,
  'Customers → Customer feedback: the average, the spread, the ticks, by who served, and each rating', JSON.stringify({ menu: page.menu, items: page.items }));
await pg.screenshot({ path: process.env.SHOT3 || 'feedback.png', fullPage: true });
// an unhappy one is followed up from there
const low = await pg.evaluate(() => { const S = window.eval('S'); S.feedback.unshift({ id: 'fbT1', no: S.sales[0].no, who: 'Test buyer', stars: 1, tags: ['Slow service'], note: 'waited 40 minutes', by: 'Afridh', at: '2026-10-30 10:00' });
  window.eval("fbShow='open'"); window.eval('render')(); return document.querySelectorAll('[data-act="fbDone"]').length });
const top = await pg.evaluate(() => { const x = window.eval('actionItems')().find(i => i.key === 'fbT1'); return x && { pri: x.pri, tag: x.tag, decide: x.decide } });
ok(top && top.pri === 1 && top.decide && /Unhappy/.test(top.tag), 'an unhappy one is at the top of the Action centre, to be followed up', JSON.stringify(top));
await pg.$eval('[data-act="fbDone"][data-id="fbT1"]', b => b.click()); await wait(400);
const fu = await pg.evaluate(() => window.eval('S').feedback.find(x => x.id === 'fbT1').done);
ok(low === 1 && fu && fu.note === 'Rang them, sorry given', 'an unhappy one: "Followed up", with what was done', JSON.stringify(fu));
await pg.evaluate(() => { const S = window.eval('S'), CFG = window.eval('CFG'); S.feedback = S.feedback.filter(x => x.id !== 'fbT1');
  CFG.msg = window.__msg; CFG.shop.owner = window.__owner; window.eval('persist')(true) }); await wait(2500);
gw.close();
ok(!errs.length && !perrs.length, 'no script errors', errs.concat(perrs).slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
