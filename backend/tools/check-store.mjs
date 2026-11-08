// The front page (store.html, the new design, 8 Nov 2026): it shows the till's products and prices, searches them, takes
// a basket through the mobile code sign-in to an order that lands in Online orders, and tracks it. The page it replaced
// is still at /classic.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-store.mjs [screenshot-dir]
// Nothing here reaches a printer; texts are not sent (the test server has no SMS gateway).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.argv[2] || '';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (pg, n) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await pg.screenshot({ path: path.join(OUT, n + '.png') }) } };

// the till's books: the site sells everything, takes orders, and one product carries a quantity break
const tok = (await (await fetch(BASE + '/api/books/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'Afridh', password: 'Afridh123' }) })).json()).token;
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
const got = await (await fetch(BASE + '/api/books/regal', { headers: H })).json();
const data = got.data; const S = data.S;
S.web = S.web || {}; S.web.settings = Object.assign(S.web.settings || {}, { open: true, listMode: 'all', delivery: 600, freeOver: 0, minOrder: 1000, zones: [], promos: [], pays: { cod: true, counter: true, bank: true, card: false } });
const sellable = S.products.filter(p => p.active !== false && !p.hidden && p.web !== false && +p.retail > 0);
// plenty in stock: orders from earlier runs that no till took in yet hold some of it
const P1 = sellable[0]; P1.retail = 1500; P1.webPrice = 0; P1.tiers = [{ min: 10, price: 1400 }]; P1.stock = 100000;
await fetch(BASE + '/api/books/regal', { method: 'PUT', headers: H, body: JSON.stringify({ data, rev: got.rev }) });
const cat = await (await fetch(BASE + '/api/shop/catalog')).json();
ok(cat.products.length > 0, 'the catalogue lists the till\'s products', cat.products.length);

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
for (const [n, W, H2, mob] of [['d', 1440, 900, false], ['m', 390, 844, true]]) {
  const pg = await b.newPage(); await pg.setViewport({ width: W, height: H2, isMobile: mob, hasTouch: mob });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.setRequestInterception(true);
  pg.on('request', rq => { const u = rq.url(); if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u) || /wa\.me/.test(u)) return rq.abort(); rq.continue() });
  await pg.goto(BASE + '/', { waitUntil: 'networkidle2' }); await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle2' }); await wait(1800);
  const home = await pg.evaluate(() => ({ title: document.title, hero: !!document.getElementById('stage'), tiles: document.querySelectorAll('.tile').length, cards: document.querySelectorAll('.card').length, text: document.getElementById('depts').innerText }));
  ok(home.hero && /regal hardware/i.test(home.title), n + ': the front page is the new design', home.title);
  ok(home.cards > 0 && /products online/.test(home.text), n + ': it shows the till\'s products', `${home.cards} cards`);
  await shot(pg, n + '-1home');
  // search
  const word = P1.name.split(/\s+/).find(w => w.length > 3) || P1.name.split(/\s+/)[0];
  await pg.click('#q'); await pg.keyboard.type(word); await wait(400);
  const sugg = await pg.evaluate(() => document.getElementById('sugg').innerText);
  ok(sugg.length > 0 && !/Not online yet/.test(sugg), n + ': search suggests while typing', word);
  await pg.keyboard.press('Enter'); await wait(900);
  ok(await pg.evaluate(() => document.querySelectorAll('#grid .card').length) > 0, n + ': and lists the results');
  await shot(pg, n + '-2results');
  // product page, quantity break, basket
  await pg.evaluate(id => location.hash = '#/p/' + id, P1.id); await wait(900);
  const pp = await pg.evaluate(() => ({ h: (document.querySelector('.info h1') || {}).innerText || '', price: (document.getElementById('pprice') || {}).innerText || '', tiers: /or more/.test(document.querySelector('.info').innerText) }));
  ok(/1,500/.test(pp.price) && pp.tiers, n + ': the product page shows the till\'s price and its quantity break', pp.price);
  for (let i = 0; i < 9; i++) await pg.evaluate(() => document.querySelector('#pqty [data-d="1"]').click());
  ok(/1,400/.test(await pg.evaluate(() => document.getElementById('pprice').innerText)), n + ': at 10 the price drops to the break price');
  await shot(pg, n + '-3product');
  await pg.evaluate(() => document.getElementById('padd').click()); await wait(1300);
  const basket = await pg.evaluate(() => JSON.parse(localStorage.getItem('rh_cart') || '[]'));
  ok(basket.length === 1 && basket[0].qty === 10, n + ': 10 go into the basket', JSON.stringify(basket));
  // checkout: the mobile code, then the order
  await pg.evaluate(() => location.hash = '#/checkout'); await wait(1200);
  await pg.evaluate(() => document.getElementById('placeb').click()); await wait(500);
  ok(/Sign in with your mobile/.test(await pg.evaluate(() => document.getElementById('ephone').innerText)), n + ': sending before signing in asks for the mobile');
  const phone = n === 'd' ? '0771112233' : '0771112244';
  await pg.type('#fphone', phone); await pg.evaluate(() => document.getElementById('otpsend').click()); await wait(1500);
  const msg = await pg.evaluate(() => document.querySelector('#coform .note') ? document.querySelector('#coform').innerText : '');
  const code = (msg.match(/code is (\d{6})/) || [])[1];
  ok(!!code, n + ': a code is sent (shown here, as the test server has no texts)', code || msg.slice(0, 80));
  await pg.type('#fcode', code || '000000'); await pg.evaluate(() => document.getElementById('otpgo').click()); await wait(1300);
  if (await pg.$('#fname')) { await pg.type('#fname', 'Test Customer ' + n); await pg.evaluate(() => document.getElementById('otpgo').click()); await wait(1300) }
  ok(await pg.evaluate(() => !!localStorage.getItem('rh_token') && !!document.querySelector('.who')), n + ': signed in with the code');
  await pg.type('#faddr', '12, Lake Road, Kaduruwela'); await wait(1500);
  const sum = await pg.evaluate(() => document.querySelector('.osum').innerText);
  ok(/14,000/.test(sum) && /600/.test(sum) && /14,600/.test(sum), n + ': the total is the server\'s: 14,000 + 600 delivery', (sum.match(/Total[^\n]*\n?[^\n]*/) || [''])[0]);
  await shot(pg, n + '-4checkout');
  await pg.evaluate(() => document.getElementById('placeb').click());
  await pg.waitForFunction(() => location.hash === '#/done', { timeout: 20000 }).catch(() => {});
  await wait(900);
  const done = await pg.evaluate(() => document.querySelector('.done') ? document.querySelector('.done').innerText : '');
  const no = (done.match(/ONL-\d+/) || [])[0];
  ok(!!no, n + ': the order goes through', no || await pg.evaluate(() => (document.getElementById('eplace') || {}).innerText || ''));
  await shot(pg, n + '-5done');
  // it is waiting for the till
  const inbox = await (await fetch(BASE + '/api/books/regal', { headers: H })).json();
  const pending = (await (await fetch(BASE + '/api/shop/catalog')).json()).pendingOnline;
  ok(pending > 0 || (inbox.data.S.web.orders || []).some(o => o.no === no), n + ': it is waiting in Online orders for the till', 'pending ' + pending);
  // tracking
  await pg.evaluate(no => location.hash = '#/track?no=' + no, no); await wait(1800);
  const tr = await pg.evaluate(() => (document.getElementById('trout') || {}).innerText || '');
  ok(tr.includes(no) && /Received|Accepted/.test(tr), n + ': tracking finds it', tr.split('\n')[0]);
  await shot(pg, n + '-6track');
  ok(errs.length === 0, n + ': no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
}
const classic = await (await fetch(BASE + '/classic')).text();
ok(/Regal Hardware Engine/.test(classic), 'the old page is still at /classic');
const front = await (await fetch(BASE + '/')).text();
ok(/store-photos\.js/.test(front), '/ is the new page');
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
