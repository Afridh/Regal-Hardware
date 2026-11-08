// The Home page (8 Nov 2026): the whole system as big tiles, and where the system opens.
//  · signing in lands on Home; every tile is one this person may open
//  · a tile opens its page; a "+ New" tile opens the add window there; the arrow keys move between tiles
//  · a salesman sees only the tiles open to them
// Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-home.mjs [folder for screenshots]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010', OUT = process.argv[2] || '.';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
async function signIn(user, pass, w = 1366, h = 768) {
  const ctx = await b.createBrowserContext(); const pg = await ctx.newPage(); await pg.setViewport({ width: w, height: h });
  pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
  await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
  if (await pg.$('#lockScreen')) {
    if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
    if (await pg.$('#lockUser')) await pg.type('#lockUser', user);
    await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', pass); await pg.click('#lockGo');
    await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
  }
  await wait(2000); await pg.evaluate(() => document.querySelectorAll('.pin-welcome').forEach(x => x.remove()));
  return pg;
}
const pg = await signIn('Afridh', 'Afridh123');
const v0 = await pg.evaluate(() => ({ view: window.eval('S').view, tiles: document.querySelectorAll('.hm-tile').length, all: window.eval('HOME_TILES').length }));
ok(v0.view === 'home', 'signing in opens on Home', v0.view);
ok(v0.tiles === v0.all, 'the Super Admin sees every tile', `${v0.tiles} of ${v0.all}`);
ok(await pg.evaluate(() => !!document.querySelector('#nav [data-view="home"], [data-view="home"]')), 'Home is in the menu');
await pg.screenshot({ path: OUT + '/home.png' });
ok(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'nothing runs off the side');
// a tile opens its page
await pg.evaluate(() => [...document.querySelectorAll('.hm-tile')].find(t => /Customers$/.test(t.querySelector('.hm-lb').textContent.trim())).click()); await wait(600);
ok(await pg.evaluate(() => window.eval('S').view) === 'customers', 'the Customers tile opens Customers');
await pg.evaluate(() => window.eval('go')('home')); await wait(500);
await pg.evaluate(() => [...document.querySelectorAll('.hm-tile')].find(t => /Add Customer/.test(t.textContent)).click()); await wait(700);
ok(await pg.evaluate(() => window.eval('S').view === 'customers' && !!document.querySelector('.modal')), '"+ Add Customer" opens the new customer window');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await pg.evaluate(() => window.eval('go')('home')); await wait(500);
await pg.evaluate(() => document.querySelector('.hm-tile').focus()); await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowDown');
const at = await pg.evaluate(() => [...document.querySelectorAll('.hm-tile')].indexOf(document.activeElement));
ok(at > 1, 'the arrow keys move between tiles', 'on tile ' + at);
await pg.keyboard.press('Enter'); await wait(600);
ok(await pg.evaluate(() => window.eval('S').view) !== 'home', 'Enter opens the tile');
// pressing a tile: the animation runs, then the page opens
await pg.evaluate(() => window.eval('go')('home')); await wait(500);
const anim = await pg.evaluate(async () => { const t = [...document.querySelectorAll('.hm-tile')].find(x => /^Bills$/.test(x.querySelector('.hm-lb').textContent.trim())); t.click();
  const r = { go: t.classList.contains('go'), wave: !!t.querySelector('.hm-wave'), stepBack: document.querySelector('.hm-grid').classList.contains('going'), still: window.eval('S').view };
  await new Promise(z => setTimeout(z, 600)); r.after = window.eval('S').view; return r });
ok(anim.go && anim.wave && anim.stepBack && anim.still === 'home' && anim.after === 'bills', 'a pressed tile ripples, jumps and flashes, then its page opens', JSON.stringify(anim));
// the Home key, from anywhere
await pg.evaluate(() => { window.eval('go')('products'); document.activeElement && document.activeElement.blur() }); await wait(500);
await pg.keyboard.press('Home'); await wait(500);
ok(await pg.evaluate(() => window.eval('S').view) === 'home', 'the Home key goes to Home');
await pg.evaluate(() => window.eval('go')('customers')); await wait(500);
await pg.evaluate(() => { const i = document.querySelector('#main input[type=text],#main input:not([type]),#main input[type=search]'); if (i) i.focus() });
const typingIn = await pg.evaluate(() => document.activeElement && document.activeElement.tagName);
await pg.keyboard.press('Home'); await wait(300);
const stayed = await pg.evaluate(() => window.eval('S').view);
await pg.keyboard.down('Control'); await pg.keyboard.press('Home'); await pg.keyboard.up('Control'); await wait(500);
ok(typingIn !== 'INPUT' || stayed === 'customers', 'typing in a box, Home stays in the box', typingIn + ' / ' + stayed);
ok(await pg.evaluate(() => window.eval('S').view) === 'home', 'Ctrl+Home goes to Home even while typing');
// opening the system again, after leaving it on another page: Home
await pg.evaluate(() => { window.eval('go')('stock'); window.eval('persist')(true) }); await wait(1500);
await pg.reload({ waitUntil: 'networkidle2' }); await wait(3500);
ok(await pg.evaluate(() => window.eval('S').view) === 'home', 'opening the system again lands on Home, not the page it was left on');
ok(!pg.errs.length, 'no script errors', pg.errs.join(' | '));
// a salesman
const sp = await signIn('Sales1', 'Sales123', 1280, 720);
const sv = await sp.evaluate(() => ({ view: window.eval('S').view, tiles: [...document.querySelectorAll('.hm-tile .hm-lb')].map(x => x.textContent.trim()), ok: [...document.querySelectorAll('.hm-tile')].every(t => window.eval('allowed')(window.eval('HOME_TILES')[+t.dataset.home][0])) }));
ok(sv.view === 'home' && sv.tiles.length > 0 && sv.ok, 'a salesman lands on Home and sees only tiles open to them', sv.tiles.join(', '));
await sp.screenshot({ path: OUT + '/home-sales.png' });
ok(!sp.errs.length, 'no script errors (salesman)', sp.errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
