// The Bills page, "Money first" (9 Nov 2026): the customer's whole name in the list, figures that fit their boxes,
// every button in the dark bar at the foot. A big credit bill for a customer with a long name, on a 1366×768 till.
// Nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billsview.mjs [folder for the screenshot]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010', OUT = process.argv[2] || '.';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
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
await wait(1500);
const no = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {};
  const S = window.eval('S'), CFG = window.eval('CFG'); CFG.msg.autoBill = false;
  let c = S.customers.find(x => x.name === 'SAMPLE WEDDING HALL & RECEPTION CENTRE');
  if (!c) { c = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: 'SWHR', name: 'SAMPLE WEDDING HALL & RECEPTION CENTRE', phone: '0700000001', level: 'retail', limit: 99999999 }; S.customers.push(c) }
  const ps = S.products.filter(x => x.id !== window.eval('OPEN_PID') && +x.retail > 0).slice(0, 20); ps.forEach(p => p.stock = Math.max(+p.stock || 0, 10000));
  const inv = window.eval('completeSale')({ lines: ps.map((p, i) => ({ pid: p.id, qty: 30 + i * 7, price: 2950 + i * 311, disc: 0, belowCost: true })), customerId: c.id, pays: [{ method: 'CREDIT', amount: 0 }], override: true });
  window.eval('go')('bills'); return inv.no });
await wait(1200);
await pg.evaluate(no => { const r = document.querySelector(`.bl-row[data-no="${no}"]`); if (r) r.click() }, no); await wait(900);
const v = await pg.evaluate(no => {
  const row = document.querySelector(`.bl-row[data-no="${no}"]`), nm = row && row.querySelector('.bl-who b');
  const big = document.querySelector('.bl-big'), dock = document.querySelector('.bl-dock');
  const spill = [...document.querySelectorAll('.bl-big,.bl-legend b,.bl-ckv b,.bl-pills b,.bl-amt b')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim());
  const d = dock && dock.getBoundingClientRect();
  return { name: nm && nm.textContent.trim(), nameCut: nm ? nm.scrollHeight > nm.clientHeight + 2 : null, net: big && big.textContent.trim(), spill,
    dockOnScreen: !!d && d.bottom <= innerHeight + 1 && d.top < innerHeight, tiles: document.querySelectorAll('.bl-dock .bl-tile').length, groups: [...document.querySelectorAll('.bl-more > div > span')].map(e => e.textContent).join() } }, no);
ok(v.name && /RECEPTION CENTRE/.test(v.name) && !v.nameCut, 'the list shows the customer\'s whole name', v.name);
ok(/^Rs\s*[\d,]+\.\d\d$/.test(v.net.replace(/\s+/g, ' ')) && !v.spill.length, 'the net total and every figure fit their boxes', JSON.stringify({ net: v.net, spill: v.spill }));
ok(v.dockOnScreen && v.tiles === 4 && v.groups === 'Send,Change', 'all the buttons are in the dark bar, on screen at the foot', JSON.stringify(v));
await pg.screenshot({ path: OUT + '/bills-money.png' });
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
