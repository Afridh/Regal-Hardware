// The online shop's checkout, the mobile number (28 Nov 2026, the owner: "some fault while typing the phone number"):
// the order total coming back while the number is being typed does not move the cursor or lose digits; Enter in the
// mobile box texts the code, the 6 digits confirm by themselves; a number typed without the 0 or with +94 is taken;
// the order goes through and the slip comes out of the till on the thank-you page.
//   node backend/tools/run-e2e.mjs --keep ;  node backend/tools/check-checkoutphone.mjs [shot-dir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', OUT = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (pg, n) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await pg.screenshot({ path: path.join(OUT, n + '.png') }) } };
// the shop takes orders
const tok = (await (await fetch(BASE + '/api/books/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'Afridh', password: 'Afridh123' }) })).json()).token;
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
const got = await (await fetch(BASE + '/api/books/regal', { headers: H })).json();
const data = got.data, S = data.S;
S.web = S.web || {}; S.web.settings = Object.assign(S.web.settings || {}, { open: true, listMode: 'all', minOrder: 0, zones: [], promos: [], pays: { cod: true, counter: true } });
const P1 = S.products.find(p => p.active !== false && !p.hidden && p.web !== false && +p.retail > 0); P1.stock = 100000;
await fetch(BASE + '/api/books/regal', { method: 'PUT', headers: H, body: JSON.stringify({ data, rev: got.rev }) });

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
for (const [n, W, H2, mob] of [['d', 1440, 900, false], ['m', 390, 844, true]]) {
  const pg = await b.newPage(); await pg.setViewport({ width: W, height: H2, isMobile: mob, hasTouch: mob });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  // the order total is slow to come back, as on a weak line
  let slow = true;
  await pg.setRequestInterception(true);
  pg.on('request', async rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /wa\.me/.test(u)) return rq.abort(); if (slow && /\/api\/shop\/quote/.test(u)) { await wait(1200); } rq.continue() });
  await pg.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await pg.evaluate(id => { localStorage.clear(); localStorage.setItem('rh_cart', JSON.stringify([{ pid: id, qty: 2 }])) }, P1.id);
  await pg.goto(BASE + '/#/checkout', { waitUntil: 'networkidle2' }); await pg.reload({ waitUntil: 'networkidle2' }); await wait(500);
  await pg.waitForSelector('#fphone');
  // type the number slowly, the total arriving half way through
  // the page asks for the total as it opens (slowed to 1.2 s here); typing starts at once
  await pg.click('#fphone');
  for (const ch of '077 1234 567') { await pg.keyboard.type(ch); await wait(150) }
  await wait(1500);
  const v = await pg.evaluate(() => ({ v: document.getElementById('fphone').value, f: document.activeElement && document.activeElement.id }));
  ok(v.v === '077 1234 567' && v.f === 'fphone', n + ': the number comes out as typed, with the total arriving in the middle of it', JSON.stringify(v));
  // a mistake in the middle: the cursor stays where it was put when the page is drawn again
  await pg.evaluate(() => { const i = document.getElementById('fphone'); i.setSelectionRange(3, 3) });
  await pg.evaluate(() => document.getElementById('fpromo').dispatchEvent(new Event('change', { bubbles: true }))); await wait(1600);   // asks for the total again, as a code typed does
  const sel = await pg.evaluate(() => { const i = document.getElementById('fphone'); return [i.selectionStart, document.activeElement === i] });
  ok(sel[0] === 3 && sel[1], n + ': the cursor keeps its place in the number when the page is drawn again', JSON.stringify(sel));
  slow = false;
  // Enter in the mobile box texts the code
  await pg.evaluate(() => { const i = document.getElementById('fphone'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })) });
  await pg.click('#fphone'); await pg.keyboard.type(n === 'd' ? '+94 77 555 0101' : '775550102'); await pg.keyboard.press('Enter'); await wait(1500);
  const st = await pg.evaluate(() => ({ code: !!document.getElementById('fcode'), opening: !!document.querySelector('.fl.opening'), err: (document.getElementById('ephone') || {}).innerText || '', msg: document.getElementById('coform').innerText }));
  ok(st.code && !/Sign in with/.test(st.err), n + ': Enter in the mobile box texts the code (number typed ' + (n === 'd' ? 'with +94' : 'without the 0') + ')', st.err);
  ok(st.opening, n + ': the code box opens under it');
  await shot(pg, n + '-code');
  const code = (st.msg.match(/code is (\d{6})/) || [])[1];
  await pg.click('#fcode'); await pg.keyboard.type(code || '000000'); await wait(1800);
  if (await pg.$('#fname')) { await pg.type('#fname', 'Phone Test ' + n); await pg.keyboard.press('Enter'); await wait(1500) }
  const si = await pg.evaluate(() => ({ tok: !!localStorage.getItem('rh_token'), who: (document.querySelector('.who') || {}).innerText || '' }));
  ok(si.tok && /0775550/.test(si.who), n + ': the 6 digits sign in by themselves', si.who);
  await shot(pg, n + '-signedin');
  const radios = await pg.$$('input[name=how]'); await radios[1].click(); await wait(400);   // collect
  await pg.evaluate(() => document.getElementById('placeb').click());
  await pg.waitForFunction(() => location.hash === '#/done', { timeout: 20000 }).catch(() => {});
  await wait(500); await shot(pg, n + '-done-printing');
  await wait(1800);
  const dn = await pg.evaluate(() => ({ t: (document.querySelector('.done') || {}).innerText || '', slip: !!document.querySelector('.done .slot') && !!document.querySelector('.done .slip .box') }));
  ok(/ONL-\d+/.test(dn.t) && dn.slip, n + ': the order goes through, its slip out of the till', (dn.t.match(/ONL-\d+/) || [''])[0]);
  await shot(pg, n + '-done');
  ok(!errs.length, n + ': no page errors', errs.slice(0, 2).join(' | '));
  await pg.close();
}
// less motion asked for: nothing moves
{ const pg = await b.newPage(); await pg.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await pg.goto(BASE + '/', { waitUntil: 'networkidle2' }); await pg.evaluate(() => { window.__last = { no: 'ONL-TEST', total: 100, how: 'collect', pay: 'cod', name: 'A', phone: '0771234567' }; location.hash = '#/done' }); await wait(500);
  const an = await pg.evaluate(() => getComputedStyle(document.querySelector('.done .slip .box')).animationName);
  ok(an === 'none', 'less motion asked for: the slip just shows', an); await pg.close() }
// 28 Nov 2026 (the live checkout blinked, a database error on it): the server failing the total and the order.
// The page asks for the total once, not round and round; the customer is told plainly what to do, never the error itself.
{ const pg = await b.newPage(); await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  let quotes = 0;
  await pg.setRequestInterception(true);
  pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u)) return rq.abort();
    if (/\/api\/shop\/(quote|order)/.test(u)) { if (/quote/.test(u)) quotes++; return rq.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: "You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '>>'$.code') = upper('')' at line 1" }) }) }
    rq.continue() });
  await pg.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await pg.evaluate(id => { localStorage.clear(); localStorage.setItem('rh_cart', JSON.stringify([{ pid: id, qty: 1 }])); localStorage.setItem('rh_token', JSON.stringify('x')); localStorage.setItem('rh_name', JSON.stringify('Blink Test')); localStorage.setItem('rh_phone', JSON.stringify('0771234567')) }, P1.id);
  await pg.goto(BASE + '/#/checkout', { waitUntil: 'networkidle2' }); await pg.reload({ waitUntil: 'networkidle2' });
  // count how often the page is drawn again over 4 seconds
  await pg.evaluate(() => { window._draws = 0; new MutationObserver(() => window._draws++).observe(document.getElementById('app'), { childList: true }) });
  await wait(4000);
  const draws = await pg.evaluate(() => window._draws);
  ok(quotes <= 2 && draws <= 2, 'the total failing does not set the page blinking', `asked ${quotes} times, drawn ${draws} times in 4 s`);
  const radios = await pg.$$('input[name=how]'); if (radios[1]) { await radios[1].click(); await wait(300) }
  await pg.evaluate(() => document.getElementById('placeb').click()); await wait(1200);
  const said = await pg.evaluate(() => (document.getElementById('eplace') || {}).innerText || '');
  ok(/could not take this just now/.test(said) && /call us/.test(said) && !/SQL|MariaDB/.test(said), 'the order failing tells the customer what to do, not the database error', said);
  ok(!errs.length, 'no page errors', errs.slice(0, 2).join(' | '));
  await pg.close() }
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
