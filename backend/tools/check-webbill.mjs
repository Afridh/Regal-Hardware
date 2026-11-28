// An online order turned into a bill at the till (28 Nov 2026). The website no longer charges delivery — the shop calls
// the customer with it — so billing a delivery asks for the charge agreed, and puts it on the bill as its own line;
// "No charge" leaves it off; an order to collect is loaded with no question.
//   node backend/tools/run-e2e.mjs --keep ;  node backend/tools/check-webbill.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.dismiss());
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url()) || (rq.method() === 'PUT' && /books/.test(rq.url()))) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
const mk = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'), p = S.products.find(x => x.active !== false && +x.retail > 0), c = S.customers.find(x => x.id !== 1);
  S.web = S.web || {}; S.web.orders = S.web.orders || []; S.web.settings = S.web.settings || {}; S.web.settings.delivery = 450;
  const base = { date: '2026-11-28', time: '10:00', cid: c.id, lines: [{ pid: p.id, qty: 2, price: +p.retail }], off: 0, status: 'accepted', pay: 'cod', events: [] };
  S.web.orders.push({ ...base, no: 'ONL-T1', deliver: true, address: '1 Lake Rd', del: 0, total: 2 * p.retail },
                    { ...base, no: 'ONL-T2', deliver: true, address: '2 Lake Rd', del: 0, total: 2 * p.retail },
                    { ...base, no: 'ONL-T3', deliver: false, del: 0, total: 2 * p.retail });
  return { price: +p.retail } });
// a delivery: the charge is asked for, the shop's usual one put in to start
await pg.evaluate(() => window.eval('webBill')('ONL-T1')); await wait(300);
const ask = await pg.evaluate(() => ({ m: !!document.getElementById('wbDel'), v: (document.getElementById('wbDel') || {}).value, f: document.activeElement && document.activeElement.id }));
ok(ask.m && ask.v === '450' && ask.f === 'wbDel', 'billing a delivery asks for the charge agreed, the usual one to start', JSON.stringify(ask));
await pg.evaluate(() => { document.getElementById('wbDel').value = '600' }); await pg.focus('#wbDel'); await pg.keyboard.press('Enter'); await wait(500);
const t1 = await pg.evaluate(() => { const S = window.eval('S'); return { view: S.view, lines: S.pos.lines.map(l => (l.name || l.pid) + ':' + l.price), from: S.pos.fromWeb, ev: (S.web.orders.find(o => o.no === 'ONL-T1').events || []).map(e => e.what || e.text || '').join('|') } });
ok(t1.view === 'pos' && t1.from === 'ONL-T1' && t1.lines.some(x => /Delivery charge:600/.test(x)), 'Enter puts it on the bill as its own line', JSON.stringify(t1.lines));
ok(/Delivery charge agreed/.test(t1.ev), 'and the order notes the charge agreed', t1.ev);
// no charge
await pg.evaluate(() => { window.eval('S').pos.lines = []; window.eval('webBill')('ONL-T2') }); await wait(300);
await pg.click('#wbNone'); await wait(400);
const t2 = await pg.evaluate(() => window.eval('S').pos.lines.map(l => l.name || l.pid));
ok(t2.length === 1 && !t2.some(x => /Delivery/.test(String(x))), '"No charge" leaves it off', JSON.stringify(t2));
// to collect: no question
await pg.evaluate(() => { window.eval('S').pos.lines = []; window.eval('webBill')('ONL-T3') }); await wait(300);
const t3 = await pg.evaluate(() => ({ asked: !!document.getElementById('wbDel'), n: window.eval('S').pos.lines.length }));
ok(!t3.asked && t3.n === 1, 'an order to collect loads with no question', JSON.stringify(t3));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
await pg.evaluate(() => { const S = window.eval('S'); S.web.orders = S.web.orders.filter(o => !/^ONL-T\d$/.test(o.no)); S.pos.lines = []; S.pos.fromWeb = null });
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
