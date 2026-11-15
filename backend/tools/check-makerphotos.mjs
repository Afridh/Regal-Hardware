// The makers' own photos, fast-moving goods first, and the shelf by supplier (15 Nov 2026, the owner: "Kevilton switches
// have images but are not showing — find them; show the fast moving goods first; a place on the side to search by supplier"):
//  · Kevilton's catalogue (maker-photos/kevilton.json, from kevilton.lk) is served with the app
//  · our products are matched to the right Kevilton product: gang and way, poles and kA, the finish (Teak, Ivory …)
//  · the review lists them ticked; Use the ticked fetches each photo from kevilton.lk and keeps it as the product's photo
//  · on the shelf, what sold most in the last three months comes first, marked 🔥 Sells fast
//  · the Suppliers tab: find a supplier, tap it, its goods show
// Needs the internet (it fetches Kevilton's photos). Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-makerphotos.mjs [folder for screenshots]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { const u = rq.url(); if (/:41\d\d/.test(u) || /\/api\/sms\//.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(1500);
const shot = async n => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, n + '.png') }) };
// the catalogue
const cat = await pg.evaluate(async () => { const r = await fetch('/maker-photos/kevilton.json'); const j = r.ok ? await r.json() : {}; return { status: r.status, n: (j.products || []).length, fins: [...new Set((j.products || []).map(p => p.finish).filter(Boolean))].sort().join(',') } });
ok(cat.status === 200 && cat.n >= 200 && /chrome/.test(cat.fins) && /teak/.test(cat.fins), "Kevilton's catalogue is served with the app", JSON.stringify(cat));
// three Kevilton products of ours, no photos yet
const mine = await pg.evaluate(async () => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval("CFG.print.agent=''"); window.eval('CFG').msg.autoBill = false;
  const S = window.eval('S'), tag = 'MK' + Date.now().toString(36).slice(-4).toUpperCase(); let id = Math.max(...S.products.map(p => p.id));
  const mk = (name) => { const p = { id: ++id, code: tag + id, num: String(90000 + id % 1000), name, cat: 'Electrical', unit: 'pcs', retail: 450, wholesale: 420, mrp: 480, cost: 300, stock: 50, min: 5, active: true }; S.products.push(p); return p };
  const a = mk('Kevilton 2G 1W Switch ' + tag), bb = mk('Kevilton 1 Gang 2 Way Switch Teak ' + tag), c = mk('Kevilton MCB 10kA 1 Pole ' + tag);
  return { tag, a: a.id, b: bb.id, c: c.id };
});
const m = await pg.evaluate(async (ids) => { await window.eval('makerLoad')(); const R = window.eval('mkMatches')().filter(x => [ids.a, ids.b, ids.c].includes(x.pid)); return R.map(x => ({ pid: x.pid, on: x.on, name: x.it && x.it.name, fin: x.it && x.it.finish, page: x.it && x.it.page })) }, mine);
const of = id => m.find(x => x.pid === id) || {};
ok(of(mine.a).on && of(mine.a).name === '2 GANG 1 WAY' && of(mine.a).fin === 'white', '"2G 1W Switch" → Kevilton 2 GANG 1 WAY (white), sure', JSON.stringify(of(mine.a)));
ok(of(mine.b).on && of(mine.b).name === '1 GANG 2 WAY' && of(mine.b).fin === 'teak', '"1 Gang 2 Way Switch Teak" → 1 GANG 2 WAY in Teak, sure', JSON.stringify(of(mine.b)));
ok(of(mine.c).on && /MCB 10kA 1/i.test(of(mine.c).name || ''), '"MCB 10kA 1 Pole" → MCB 10kA 1 - POLE, sure', JSON.stringify(of(mine.c)));
// the window, the review, Use the ticked
await pg.evaluate(() => { window.eval('go')('shelf'); window.eval('SHF').by = 'cat'; window.eval('SHF').cat = 'Electrical'; window.eval('render')() }); await wait(300);
await pg.click('[data-act="shelfPics"]'); await wait(400);
await pg.click('[data-wph="maker"]'); await pg.waitForSelector('[data-wph="use"]', { timeout: 15000 });
const rv = await pg.evaluate(ids => [...document.querySelectorAll('.wph-row.mk')].map(r => ({ t: r.innerText.replace(/\s+/g, ' '), ck: (r.querySelector('input') || {}).checked })).filter(r => r.t.includes(ids.tag)), mine);
ok(rv.length === 3 && rv.every(r => r.ck), 'the review lists the three, ticked, beside the maker\'s product and photo', JSON.stringify(rv.map(r => r.t.slice(0, 70))));
await shot('mk-review');
// only ours: untick everything else, then Use the ticked
await pg.evaluate((tag) => document.querySelectorAll('.wph-row.mk').forEach(r => { const c = r.querySelector('input'); if (c && c.checked && !r.innerText.includes(tag)) { c.checked = false; c.dispatchEvent(new Event('change')) } }), mine.tag);
await pg.click('[data-wph="use"]');
await pg.waitForFunction(ids => [ids.a, ids.b, ids.c].every(id => window.eval('hasPic')('p:' + id)), { timeout: 60000 }, mine).catch(() => {});
const got = await pg.evaluate(ids => [ids.a, ids.b, ids.c].map(id => window.eval('hasPic')('p:' + id)), mine);
ok(got.every(Boolean), "Use the ticked: Kevilton's own photo is on each of the three", JSON.stringify(got));
await shot('mk-done');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// fast-moving first
const fast = await pg.evaluate(async (ids) => {
  const S = window.eval('S'); const pc = S.products.find(p => p.id === ids.c); pc.stock = 1000; (pc.locStock ? Object.keys(pc.locStock).forEach(k => pc.locStock[k] = 1000) : 0); for (let i = 0; i < 6; i++) window.eval('completeSale')({ lines: [{ pid: ids.c, qty: 40, price: 450, disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: 18000 }], override: true });
  window.eval('SHF').by = 'cat'; window.eval('SHF').cat = 'Electrical'; window.eval('SHF').q = ''; window.eval('render')(); await new Promise(r => setTimeout(r, 400));
  const cards = [...document.querySelectorAll('.shf-prod')]; return { first: +cards[0].dataset.id, hot: !!cards[0].querySelector('.shf-hot'), img: !!(cards[0].querySelector('img')) };
}, mine);
ok(fast.first === mine.c && fast.hot, 'on the shelf, what sold most comes first, marked 🔥 Sells fast', JSON.stringify(fast));
ok(fast.img, "and it shows Kevilton's photo");
await shot('mk-shelf');
// by supplier
const sup = await pg.evaluate(async () => {
  const S = window.eval('S'); const s = S.suppliers.find(x => window.eval('supplierItems')(x.id).size > 0); if (!s) return null;
  document.querySelector('[data-act="shelfBy"][data-by="sup"]').click(); await new Promise(r => setTimeout(r, 200));
  const q = document.getElementById('shelfSupQ'); q.value = s.name.slice(0, 4); window.eval('shelfSupType')(q); await new Promise(r => setTimeout(r, 200));
  const btns = [...document.querySelectorAll('[data-act="shelfSup"]')].map(b => +b.dataset.id);
  document.querySelector(`[data-act="shelfSup"][data-id="${s.id}"]`).click(); await new Promise(r => setTimeout(r, 300));
  const items = window.eval('supplierItems')(s.id), cards = [...document.querySelectorAll('.shf-prod')].map(c => +c.dataset.id);
  return { name: s.name, listed: btns.includes(s.id), title: document.querySelector('.shf-h b').textContent, n: cards.length, allHis: cards.every(id => items.has(id)) };
});
ok(sup && sup.listed && sup.title === sup.name && sup.n > 0 && sup.allHis, 'Suppliers tab: find a supplier by a few letters, tap it, only its goods show', JSON.stringify(sup));
await shot('mk-sup');
// tidy: the test photos off, the test products out
await pg.evaluate(async ids => { for (const id of [ids.a, ids.b, ids.c]) await fetch('/api/shop/media/' + encodeURIComponent('p:' + id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + regalBridge.token() } });
  const S = window.eval('S'); S.products.filter(p => [ids.a, ids.b, ids.c].includes(p.id)).forEach(p => { p.active = false }); window.eval('SHF').by = 'cat'; window.eval('render')(); window.eval('persist')(true) }, mine); await wait(2500);
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
