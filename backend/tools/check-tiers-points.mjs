// Prices by quantity, and loyalty points per product.
//  · "1044 Orange Brown": under 50 bills at 75, 50 and over at 71.50 — set as price breaks on the product
//    (from 1 → 75, from 50 → 71.50), followed by the till as the quantity changes, both ways
//  · a product carries its own points (so many each). A bill earns them only: paid in full (none on credit),
//    at the price the till set (the selling price or a break) — not a price typed in, not a line or bill discount
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-tiers-points.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
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
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''") });

// 1. the product: breaks and points, through its own form
const pid = await pg.evaluate(() => { const S = window.eval('S'); const p = S.products.find(x => x.active !== false && x.stock > 200 && +x.retail > 50) || S.products.find(x => x.active !== false);
  p.stock = Math.max(p.stock, 500); p.retail = 71.5; p.mrp = 85.65; p.cost = 70.5; delete p.tiers; delete p.points; window.eval('go')('products'); return p.id });
await pg.evaluate(id => window.eval('productModal')(id), pid); await wait(300);
const form = await pg.$('#ppoints');
ok(!!form, 'the product form has "Loyalty points (each)" and the price breaks');
if (form) {
  await pg.$eval('#ptAdd', x => x.click()); await pg.$eval('#ptAdd', x => x.click()); await wait(100);
  await pg.evaluate(() => { const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change')) };
    set('[data-tmin="0"]', '1'); set('[data-tprice="0"]', '75'); set('[data-tmin="1"]', '50'); set('[data-tprice="1"]', '71.5'); document.querySelector('#ppoints').value = '2' });
  await pg.$eval('#psave', x => x.click()); await wait(500);
  // an approval may be needed for a price change: the owner here applies it straight away
}
const prod = await pg.evaluate(id => { const p = window.eval('P')(id); return { tiers: p.tiers, points: p.points } }, pid);
ok(JSON.stringify(prod.tiers) && prod.tiers.length === 2 && prod.points === 2, 'saved: from 1 → 75, from 50 → 71.50, and 2 points each', JSON.stringify(prod));

// 2. the till follows the quantity, both ways
const till = await pg.evaluate(id => { const S = window.eval('S'), P = window.eval('P'), priceFor = window.eval('priceFor');
  document.querySelectorAll('.modal').forEach(m => m.remove());   // the product updater stays open after a save
  window.eval('go')('pos'); S.pos.lines = []; window.eval('qAdd')(id); const l = S.pos.lines[0];
  const at1 = l.price; l.qty = 10; l.price = priceFor(P(id), l.qty); const at10 = l.price;
  return { at1, at10, p49: priceFor(P(id), 49), p50: priceFor(P(id), 50), p60: priceFor(P(id), 60), back: priceFor(P(id), 20) } }, pid).catch(e => ({ err: e.message }));
ok(till.at1 === 75 && till.p49 === 75 && till.p50 === 71.5 && till.p60 === 71.5 && till.back === 75, 'the till: 1 → 75, 49 → 75, 50 → 71.50, 60 → 71.50, and back to 20 → 75', JSON.stringify(till));
// the + and − keys on the till carry the price over the break, both ways; a price typed in stays
const key = async (k) => { await pg.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur() }); await pg.keyboard.press(k === '+' ? 'NumpadAdd' : 'NumpadSubtract'); await wait(150) };
await pg.evaluate(id => { const S = window.eval('S'); S.pos.lines = [{ pid: id, qty: 49, price: 75, disc: 0 }]; S.pos.sel = 0; window.eval('render')() }, pid);
await key('+'); const up = await pg.evaluate(() => { const l = window.eval('S').pos.lines[0]; return { qty: l.qty, price: l.price } });
await key('-'); const down = await pg.evaluate(() => { const l = window.eval('S').pos.lines[0]; return { qty: l.qty, price: l.price } });
ok(up.qty === 50 && up.price === 71.5 && down.qty === 49 && down.price === 75, '+ from 49: 50 at 71.50 · − back: 49 at 75', JSON.stringify({ up, down }));
await pg.evaluate(id => { const S = window.eval('S'); S.pos.lines = [{ pid: id, qty: 49, price: 74, disc: 0, auto: false }]; S.pos.sel = 0; window.eval('render')() }, pid);
await key('+'); const typed = await pg.evaluate(() => { const l = window.eval('S').pos.lines[0]; return { qty: l.qty, price: l.price } });
ok(typed.qty === 50 && typed.price === 74, 'a price typed in by hand (74) stays when the quantity changes', JSON.stringify(typed));
// the phone till: the same item again follows the breaks
const ph = await pg.evaluate(id => { const S = window.eval('S'); S.pos.lines = [{ pid: id, qty: 49, price: 75, disc: 0 }]; window.eval('addLine')(id); return { qty: S.pos.lines[0].qty, price: S.pos.lines[0].price } }, pid);
ok(ph.qty === 50 && ph.price === 71.5, 'the phone till, the 50th added: 71.50', JSON.stringify(ph));

// 3. points: a cash bill at the till's price earns 2 each
const cust = await pg.evaluate(() => { const S = window.eval('S'); const c = S.customers.find(x => x.id !== 1); c.points = 0; c.limit = 1e8; delete c.list; return c.id });
const sell = (lines, opts = {}) => pg.evaluate(([id, cid, lines, opts]) => { try { const C = window.eval('C'), c = C(cid), before = +c.points || 0;
  const tot = lines.reduce((a, l) => a + l.qty * l.price - (l.disc || 0), 0) - (opts.billDisc || 0);
  const inv = window.eval('completeSale')({ lines: lines.map(l => ({ pid: id, disc: 0, ...l })), customerId: cid, billDisc: opts.billDisc || 0, pays: opts.credit ? [] : [{ method: 'CASH', amount: +tot.toFixed(2) }], toAccount: !!opts.credit });
  return { earned: +(c.points - before).toFixed(2), inv: inv.pointsEarned || 0, type: inv.type } } catch (e) { return { err: e.message } } }, [pid, cust, lines, opts]);
let r = await sell([{ qty: 10, price: 75 }]);
ok(r.earned === 20, 'a cash bill, 10 at the till\'s price: 20 points', JSON.stringify(r));
r = await sell([{ qty: 60, price: 71.5 }]);
ok(r.earned === 120, '60 at the break price: 120 points', JSON.stringify(r));
r = await sell([{ qty: 10, price: 73 }]);
ok(r.earned === 0, 'a price typed in (73): no points', JSON.stringify(r));
r = await sell([{ qty: 10, price: 75, disc: 10 }]);
ok(r.earned === 0, 'a discount on the line: no points', JSON.stringify(r));
r = await sell([{ qty: 10, price: 75 }], { billDisc: 20 });
ok(r.earned === 0, 'a discount on the whole bill: no points', JSON.stringify(r));
r = await sell([{ qty: 10, price: 75 }], { credit: true });
ok(r.earned === 0 && r.type === 'CREDIT', 'a credit bill: no points', JSON.stringify(r));
await pg.evaluate(() => { window.eval('S').pos.lines = []; window.eval('persist')(true) });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
