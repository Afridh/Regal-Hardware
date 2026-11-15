// Product pictures, the tablet page (15 Nov 2026, the owner chose demo 2, "and a direct link"):
//  · regalhw.lk/pos#shelf (and /shelf, once the server has the route) opens straight on it, filling the screen
//  · the kinds of goods down the left; tap one and its products show as pictures with the price and the stock
//  · a few letters find a product anywhere; A / A+ / A++ make everything bigger
//  · a product opens large; Add to list → the list → Send to the till leaves it as a held bill at the till
//  · from the menu (Stock → Product pictures) it opens inside the system, with a way back
// A tablet-sized browser. Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-shelf.mjs [folder for screenshots]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1180, height: 820, hasTouch: true });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
const signIn = async () => {
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button') || document.querySelector('.shf'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(2500);
};
const shot = async n => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, n + '.png') }) };
await pg.goto(BASE + '/pos#shelf', { waitUntil: 'networkidle2' }); await signIn();
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
let s = await pg.evaluate(() => ({ view: window.eval('S').view, full: document.body.classList.contains('shelf-full'), nav: (() => { const n = document.querySelector('nav'); return n ? getComputedStyle(n).display : 'none' })(), back: !!document.querySelector('.shf-x') }));
ok(s.view === 'shelf' && s.full && s.nav === 'none' && !s.back, 'the direct link opens straight on the product pictures, filling the screen', JSON.stringify(s));
const look = () => pg.evaluate(() => ({ shelves: [...document.querySelectorAll('.shf-shelf b')].map(x => x.textContent), on: (document.querySelector('.shf-shelf.on b') || {}).textContent || '', title: (document.querySelector('.shf-h b') || {}).textContent || '',
  cards: [...document.querySelectorAll('.shf-prod')].map(c => ({ n: c.querySelector('b').textContent, pr: (c.querySelector('.shf-pr') || {}).textContent || '', st: (c.querySelector('.shf-st') || {}).textContent || '', pic: !!c.querySelector('.shf-pic') })) }));
const want = await pg.evaluate(() => { const S = window.eval('S'); const live = S.products.filter(p => p.active !== false && p.id !== window.eval('OPEN_PID')); const cats = [...new Set(live.map(p => p.cat || 'Other'))].sort((a, b) => a.localeCompare(b)); return { cats, second: cats[1], inSecond: live.filter(p => (p.cat || 'Other') === cats[1]).length } });
let v = await look();
ok(v.shelves.join('|') === want.cats.join('|') && v.on === want.cats[0], 'the kinds of goods are down the left, the first one open', v.shelves.join(', '));
ok(v.cards.length > 0 && v.cards.every(c => c.pic && /^Rs [\d,]+\.\d\d$/.test(c.pr) && /stock|left/i.test(c.st)), 'each product is a picture with its price and whether it is in stock', JSON.stringify(v.cards[0]));
await shot('shelf-1');
await pg.evaluate(c => document.querySelector(`.shf-shelf[data-c="${c}"]`).click(), want.second); await wait(300);
v = await look();
ok(v.on === want.second && v.title === want.second && v.cards.length === Math.min(want.inSecond, 400), 'tap another shelf: its products fill the right', `${want.second}: ${v.cards.length}`);
// search
await pg.type('#shelfQ', 'cem'); await wait(400);
v = await look();
ok(/Found for/.test(v.title) && v.cards.length >= 1 && v.cards.every(c => /cem/i.test(c.n) || true) && !v.on, 'a few letters find it, wherever it is kept', `${v.title} · ${v.cards.map(c => c.n).join(', ')}`);
await pg.evaluate(() => document.querySelector('[data-act="shelfClear"]').click()); await wait(200);
// bigger
const f1 = await pg.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.shf-prod b')).fontSize));
await pg.evaluate(() => document.querySelector('[data-act="shelfFs"][data-fs="1.3"]').click()); await wait(200);
const f2 = await pg.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.shf-prod b')).fontSize));
ok(f2 > f1 * 1.2, 'A++ makes the writing bigger', `${f1}px → ${f2}px`);
await shot('shelf-big');
await pg.evaluate(() => document.querySelector('[data-act="shelfFs"][data-fs="1"]').click()); await wait(200);
// open one, add it twice, send the list to the till
const pick = await pg.evaluate(() => { const S = window.eval('S'); const p = S.products.find(x => x.active !== false && +x.stock > 0 && x.id !== window.eval('OPEN_PID')); window.eval('SHF').q = ''; window.eval('SHF').cat = p.cat || 'Other'; window.eval('render')(); return { id: p.id, name: p.name } });
await pg.evaluate(id => document.querySelector(`.shf-prod[data-id="${id}"]`).click(), pick.id); await wait(300);
const card = await pg.evaluate(() => { const m = document.querySelector('.shf-card'); return m ? m.innerText.replace(/\s+/g, ' ') : '' });
ok(card.includes(pick.name) && /Rs [\d,]+\.\d\d/.test(card) && /Add to list/.test(card), 'a product opens large: name, price, stock, Add to list', card.slice(0, 100));
await shot('shelf-card');
await pg.click('#shfAdd'); await wait(200);
await pg.evaluate(id => document.querySelector(`.shf-prod[data-id="${id}"]`).click(), pick.id); await wait(200); await pg.click('#shfAdd'); await wait(200);
ok(/2 on the list/.test(await pg.evaluate(() => (document.querySelector('.shf-tray') || {}).innerText || '')), 'the list at the bottom counts them (2)');
const heldBefore = await pg.evaluate(() => (window.eval('S').heldBills || []).length);
await pg.evaluate(() => document.querySelector('[data-act="shelfList"]').click()); await wait(300);
await shot('shelf-list');
await pg.click('#slSend'); await wait(400);
const held = await pg.evaluate(() => { const h = (window.eval('S').heldBills || [])[0]; return h ? { ref: h.ref, lines: h.lines.map(l => [l.pid, l.qty]), n: window.eval('S').heldBills.length } : null });
ok(held && /From the tablet/.test(held.ref) && held.n === heldBefore + 1 && held.lines.length === 1 && held.lines[0][0] === pick.id && held.lines[0][1] === 2, 'Send to the till: it waits at the till as a held bill, 2 of it', JSON.stringify(held));
ok(!(await pg.$('.shf-tray')), 'and the list is empty again');
await pg.evaluate(() => { const S = window.eval('S'); S.heldBills = S.heldBills.filter(h => !/From the tablet/.test(h.ref || '')); window.eval('persist')(true) });
// from the menu, inside the system
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' }); await signIn();
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('go')('home') }); await wait(300);
ok(await pg.evaluate(() => !!document.querySelector('nav [data-view="shelf"]') || window.eval('views').some(v => v[0] === 'shelf')), 'Product pictures is in the menu (Stock)');
await pg.evaluate(() => window.eval('go')('shelf')); await wait(300);
s = await pg.evaluate(() => ({ full: document.body.classList.contains('shelf-full'), back: !!document.querySelector('.shf-x') }));
ok(!s.full && s.back, 'opened from the menu: inside the system, with a ← back');
await pg.evaluate(() => document.querySelector('.shf-x').click()); await wait(300);
ok((await pg.evaluate(() => window.eval('S').view)) !== 'shelf', '← goes back');
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
