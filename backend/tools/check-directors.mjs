// The directors' report: Settings → Directors' report, and the live page on a director's own link.
//  · add a director: their link is made; the page on it shows the shop's figures (the same sales total as the
//    till's own summary of the day), what customers owe and what is owed to suppliers
//  · the range buttons change the days; profit hidden for a director who is not to see it
//  · a link switched off, or replaced by a new one, stops working; a made-up link never works
//  · Send now: email and text are reported back person by person (not set up here, so "not sent — why")
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-directors.mjs
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
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const C = window.eval('CFG'); C.directors = { list: [] }; window.eval("setTab='directors'"); window.eval('go')('settings') });
await wait(300);
ok(!!(await pg.$('[data-act="dirAdd"]')), 'Settings → Directors\' report is there for the owner');
// 1. add a director
await pg.click('[data-act="dirAdd"]'); await wait(250);
await pg.type('#dnN', 'Mr. Test Director'); await pg.type('#dnP', '0771112223'); await pg.type('#dnE', 'director@example.com');
await pg.click('#dnOk'); await wait(2500);   // the list reaches the server
const d = await pg.evaluate(() => { const l = window.eval('CFG').directors.list; return l[0] && { id: l[0].id, key: l[0].key, code: l[0].code, link: window.eval('dirLink')(l[0]) } });
ok(d && d.key && d.key.length >= 20 && /\/d\?k=/.test(d.link) && /^\d{2}$/.test(d.code || ''), 'the director is added with a private link and a user code of their own', d && (d.link + ' · ' + d.code));
// the till's own figures for today, to set the page against
const till = await pg.evaluate(() => { const S = window.eval('S'), t = window.eval('D')(window.eval('today')); const s = S.sales.filter(x => x.date === t && !window.eval('isBF')(x));
  return { total: +s.reduce((a, x) => a + (+x.total || 0), 0).toFixed(2), owe: +S.customers.filter(c => c.id !== 1).reduce((a, c) => a + Math.max(0, window.eval('partyBal')('C', c.id)), 0).toFixed(2),
    sup: +S.suppliers.reduce((a, x) => a + Math.max(0, window.eval('partyBal')('S', x.id)), 0).toFixed(2) } });
// 2. the page on the link: first the sign-in — the user code and a PIN they make
const dp = await b.newPage(); await dp.setViewport({ width: 1366, height: 900 }); dp.on('pageerror', e => errs.push('page: ' + e.message));
const st = async (k, tok) => (await dp.evaluate(async (k, tok) => (await fetch('/api/directors/report?k=' + k, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} })).status, k, tok));
await dp.goto(d.link, { waitUntil: 'networkidle2' }); await wait(1500);
const first = await dp.evaluate(() => ({ form: !!document.getElementById('lg'), again: !!document.getElementById('lp2'), txt: document.body.innerText.slice(0, 300) }));
ok(first.form && first.again && /make a PIN/i.test(first.txt), 'the link opens on a sign-in: the user code and a PIN to make (twice)', first.txt.replace(/\s+/g, ' ').slice(0, 120));
await dp.screenshot({ path: SHOT + '/directors-signin.png' });
ok(await st(d.key) === 401, 'the figures are not given without signing in');
const tryIt = async (code, p1, p2) => { await dp.$eval('#lc', (el, v) => { el.value = v }, code); await dp.$eval('#lp', (el, v) => { el.value = v }, p1);
  if (await dp.$('#lp2')) await dp.$eval('#lp2', (el, v) => { el.value = v }, p2 ?? p1); await dp.click('#lb'); await wait(900);
  return dp.evaluate(() => ({ msg: (document.getElementById('lm') || {}).textContent || '', inside: !!document.querySelector('.headline') })) };
let t1 = await tryIt(d.code === '99' ? '98' : '99', '4826');
ok(/user code is not right/.test(t1.msg), 'a wrong user code is refused', t1.msg);
t1 = await tryIt(d.code.toLowerCase(), '1234');
ok(/Too easy/.test(t1.msg), '1234 is refused as too easy', t1.msg);
t1 = await tryIt(d.code, '4826', '4862');
ok(/not the same/.test(t1.msg), 'two different PINs are refused', t1.msg);
t1 = await tryIt(d.code.toLowerCase(), '4826', '4826');
ok(t1.inside, 'the code (any case) and a good PIN: the report opens', t1.msg);
await wait(1500);
const tok = await dp.evaluate(k => localStorage.getItem('dirTok:' + k), d.key);
const api = await dp.evaluate(async (k, tok) => (await fetch('/api/directors/report?k=' + k, { headers: { Authorization: 'Bearer ' + tok } })).json(), d.key, tok);
ok(api.ok && Math.abs(api.sales.total - till.total) < 0.01, 'the page\'s sales for today agree with the till', `${api.sales.total} vs ${till.total}`);
ok(Math.abs(api.customers.total - till.owe) < 0.01 && Math.abs(api.suppliers.total - till.sup) < 0.01, 'what customers owe and what we owe suppliers agree with the books', JSON.stringify({ c: [api.customers.total, till.owe], s: [api.suppliers.total, till.sup] }));
const shown = await dp.evaluate(() => ({ big: (document.querySelector('.headline .big') || {}).innerText || '', cards: document.querySelectorAll('.card').length, tiles: document.querySelectorAll('.tile').length, who: (document.querySelector('.brand small') || {}).innerText || '' }));
ok(shown.cards >= 8 && shown.tiles === 4 && /Mr\. Test Director/.test(shown.who), 'the page draws: 4 headline tiles, the cards, and whose link it is', JSON.stringify(shown));
// the PIN shows as made in Settings
await pg.bringToFront(); await pg.evaluate(() => { window.eval('dirPinsAt=0'); window.eval('render')() }); await wait(1500);
ok(await pg.evaluate(() => /made/.test((document.querySelector('#main table') || {}).innerText || '')), 'Settings shows their PIN as made');
// signed out: code and PIN; five wrong PINs lock it
await dp.bringToFront(); await dp.click('#so'); await wait(1200);
const again = await dp.evaluate(() => ({ form: !!document.getElementById('lg'), twice: !!document.getElementById('lp2'), code: (document.getElementById('lc') || {}).value }));
ok(again.form && !again.twice && again.code === d.code, 'Sign out: back to the sign-in, now just code and PIN (the code remembered)', JSON.stringify(again));
let w; for (let i = 0; i < 5; i++) w = await tryIt(d.code, '9999');
ok(/locked|Too many/.test(w.msg), 'five wrong PINs lock it', w.msg);
t1 = await tryIt(d.code, '4826');
ok(!t1.inside && /Too many|try again/.test(t1.msg), 'locked: even the right PIN waits', t1.msg);
// Reset PIN in Settings: the lock and the old PIN go; they make a new one with the same code
await pg.bringToFront(); await pg.evaluate(id => { const l = window.eval('CFG').directors.list[0]; l.pinReset = Date.now(); window.eval('persist')(true) }); await wait(2500);
await dp.bringToFront(); await dp.reload({ waitUntil: 'networkidle2' }); await wait(1200);
ok(await dp.evaluate(() => !!document.getElementById('lp2')), 'Reset PIN: next time they make a new PIN');
ok(await st(d.key, tok) === 401, 'and the sign-in made with the old PIN no longer works');
t1 = await tryIt(d.code, '5937', '5937');
ok(t1.inside, 'a new PIN made: the report opens again', t1.msg);
await wait(1500);
await dp.screenshot({ path: SHOT + '/directors-wide.png', fullPage: true });
await dp.click('[data-r="month"]'); await wait(1800);
const mon = await dp.evaluate(() => ({ url: location.search, on: (document.querySelector('.ranges .on') || {}).dataset.r }));
ok(/r=month/.test(mon.url) && mon.on === 'month', 'This month: the days change, and the link remembers it', JSON.stringify(mon));
await dp.setViewport({ width: 390, height: 844 }); await dp.reload({ waitUntil: 'networkidle2' }); await wait(2200);
await dp.screenshot({ path: SHOT + '/directors-phone.png', fullPage: true });
const phoneW = await dp.evaluate(() => document.documentElement.scrollWidth);
ok(phoneW <= 392, 'on a phone it fits the screen, no sideways scroll', phoneW);
// 3. profit hidden
await pg.evaluate(() => { window.eval('CFG').directors.list[0].profit = false; window.eval('persist')(true) }); await wait(2500);
const tok2 = await dp.evaluate(k => localStorage.getItem('dirTok:' + k), d.key);
const np = await dp.evaluate(async (k, tok) => (await fetch('/api/directors/report?k=' + k, { headers: { Authorization: 'Bearer ' + tok } })).json(), d.key, tok2);
ok(np.sales.profit === null, 'a director not to see the profit gets none', String(np.sales.profit));
// 4. Send now: reported person by person
await pg.bringToFront(); await pg.evaluate(() => window.eval('dirSend')(null)); await wait(300);
await pg.click('#dsGo'); await wait(3500);
const sent = await pg.evaluate(() => (document.querySelector('.modal') || {}).innerText || '');
ok(/Mr\. Test Director/.test(sent) && /not sent/.test(sent), 'Send now: each director, with what happened to the email and the text', sent.replace(/\s+/g, ' ').slice(0, 220));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// 5. switched off, new link, made-up link
ok(await st('made-up-link-that-is-long-enough') === 403, 'a made-up link does not open');
await pg.evaluate(() => { const l = window.eval('CFG').directors.list[0]; l.active = false; window.eval('persist')(true) }); await wait(2500);
ok(await st(d.key, tok2) === 403, 'switched off: their link stops working');
await pg.evaluate(() => { const l = window.eval('CFG').directors.list[0]; l.active = true; l.key = window.eval('dirKey')(); window.eval('persist')(true) }); await wait(2500);
ok(await st(d.key, tok2) === 403, 'a new link made: the old one stops working');
const nk = await pg.evaluate(() => window.eval('CFG').directors.list[0].key);
ok(await st(nk, tok2) === 401 && (await dp.evaluate(async k => (await fetch('/api/directors/hello?k=' + k)).status, nk)) === 200, 'the new link opens — and asks them to sign in again', '');
await dp.goto(BASE + '/d?k=nothing-like-a-key-at-all', { waitUntil: 'networkidle2' }); await wait(800);
ok(/not open/i.test(await dp.evaluate(() => document.body.innerText)), 'the page on a bad link says so, nicely');
await pg.evaluate(() => { window.eval('CFG').directors = { list: [] }; window.eval('persist')(true) }); await wait(1200);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
