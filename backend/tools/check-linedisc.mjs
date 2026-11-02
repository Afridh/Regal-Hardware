// A line put on the bill with a discount can be changed (the classic till, in place).
//  · on with 10 % off the MRP; the line is opened (P) and a new price typed: the DIS % box empties and the
//    line is that price, no discount — before, the 10 % off the MRP brought the old amount straight back
//  · a % typed in the DIS % box comes off the price; 0 takes the discount off
//  · only the quantity changed: the discount the line had stays
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-linedisc.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
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
// an item with an MRP well above cost, put on at 10 % off the MRP
const it = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'), CFG = window.eval('CFG'); CFG.pos.discFromMrp = true; window.eval('setPref') && 0;
  const p = S.products.find(x => x.active !== false && x.mrp > 0 && x.cost > 0 && x.mrp * 0.7 > x.cost && x.stock > 5 && !(x.tiers || []).length);
  S.pos.lines = []; S.pos.customer = null; window.eval('go')('pos');
  return { pid: p.id, mrp: p.mrp, cost: p.cost, till: window.eval('tillNow')() } });
ok(it.till === 'classic', 'the classic till', it.till);
await pg.evaluate(it => { const CS = window.eval('CS'); Object.assign(CS, { pid: it.pid, qty: 2, price: it.mrp, disc: 10 }); window.eval('csCommit')() }, it); await wait(300);
const l0 = await pg.evaluate(() => { const l = window.eval('S').pos.lines[0]; return { price: l.price, disc: l.disc, pct: l.discPct, qty: l.qty } });
const Q = l0.qty;
ok(l0.pct === 10 && Math.abs(l0.disc - it.mrp * Q * 0.1) < 0.02, 'on the bill at 10 % off the MRP', JSON.stringify(l0));
const open = async () => { await pg.evaluate(() => window.eval('csLineEdit')(0, 'price')); await wait(300) };
const line = () => pg.evaluate(() => { const l = window.eval('S').pos.lines[0]; return { price: l.price, disc: l.disc, pct: l.discPct, qty: l.qty, amt: +(l.qty * l.price - l.disc).toFixed(2) } });
// 1. a new price typed
await open();
const box0 = await pg.evaluate(() => ({ d: document.getElementById('lnDisc') && document.getElementById('lnDisc').value }));
ok(box0.d === '10', 'the line opened in place shows DIS % 10 beside the price', JSON.stringify(box0));
const newPrice = Math.round(it.mrp * 0.85);
await pg.focus('#lnPrice'); await pg.keyboard.down('Control'); await pg.keyboard.press('KeyA'); await pg.keyboard.up('Control'); await pg.keyboard.type(String(newPrice));
const mid = await pg.evaluate(() => ({ d: document.getElementById('lnDisc').value, amt: document.getElementById('lnAmt').textContent }));
ok(mid.d === '0', 'typing a new price empties the discount box', JSON.stringify(mid));
await pg.keyboard.press('Enter'); await wait(400);
let l1 = await line();
ok(l1.price === newPrice && l1.disc === 0 && l1.pct === undefined && l1.amt === newPrice * Q, 'saved: the line is the new price, no discount — the price can be changed', JSON.stringify(l1));
// 2. a % typed in the box
await open();
await pg.focus('#lnDisc'); await pg.keyboard.down('Control'); await pg.keyboard.press('KeyA'); await pg.keyboard.up('Control'); await pg.keyboard.type('5'); await pg.keyboard.press('Enter'); await wait(400);
l1 = await line();
ok(l1.pct === 5 && Math.abs(l1.disc - newPrice * Q * 0.05) < 0.02, 'DIS % 5 typed: 5 % comes off the price', JSON.stringify(l1));
// 3. only the quantity: the discount stays
await open();
await pg.focus('#lnQty'); await pg.keyboard.down('Control'); await pg.keyboard.press('KeyA'); await pg.keyboard.up('Control'); await pg.keyboard.type('3');
await pg.evaluate(() => window.eval('csLineDone')(true)); await wait(400);
l1 = await line();
ok(l1.qty === 3 && l1.pct === 5 && Math.abs(l1.disc - newPrice * 3 * 0.05) < 0.02, 'only the quantity changed: the 5 % stays, on 3 now', JSON.stringify(l1));
// 4. 0 takes it off
await open();
await pg.focus('#lnDisc'); await pg.keyboard.down('Control'); await pg.keyboard.press('KeyA'); await pg.keyboard.up('Control'); await pg.keyboard.type('0'); await pg.keyboard.press('Enter'); await wait(400);
l1 = await line();
ok(l1.disc === 0 && l1.pct === undefined && l1.amt === newPrice * 3, 'DIS % 0: the discount is off', JSON.stringify(l1));
await pg.evaluate(() => { window.eval('S').pos.lines = []; window.eval('render')() });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
