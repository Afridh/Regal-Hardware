// Weighing scale: a label from a label scale typed into the till's code box comes up with its weight; a
// price label works out the weight from the price; a real barcode still wins; a scale on a (stand-in)
// serial port is read with K in the quantity box.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-scale.mjs [screenshot-dir]
// Printers are stopped.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
// a stand-in scale on a serial port: it sends "ST,GS,+  1.235kg" every tenth of a second, as counter scales do
await pg.evaluateOnNewDocument(() => {
  const port = { open: async () => {}, writable: new WritableStream({ write() {} }),
    readable: new ReadableStream({ start(c) { setInterval(() => c.enqueue(new TextEncoder().encode('US,GS,+  0.900kg\r\nST,GS,+  1.235kg\r\n')), 100) } }) };
  Object.defineProperty(navigator, 'serial', { value: { getPorts: async () => [], requestPort: async () => port }, configurable: true });
});
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});

const set = await pg.evaluate(() => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'), CFG = window.eval('CFG');
  CFG.scale = { on: true, prefix: '20,21,22,23,24,25,26,27,28,29', plu: 5, digits: 5, price: false, baud: 9600, ask: '' };
  const p = S.products.find(x => x.active !== false && x.num && window.eval('priceFor')(x, 1) > 0); p.plu = '';
  const q = S.products.find(x => x.active !== false && x !== p && x.num); q.plu = '777';
  S.pos.lines = []; window.eval('go')('pos'); window.eval('CS').paper = null;
  return { pid: p.id, num: String(p.num), price: window.eval('priceFor')(p, 1), qid: q.id };
});
await wait(600);
const label = (plu, val, pre = '21') => pre + String(plu).padStart(5, '0') + String(val).padStart(5, '0') + '3';
const key = async (code) => {
  await pg.evaluate(() => { const C = window.eval('CS'); C.pid = null; C.q = ''; window.eval('render')() }); await wait(200);
  await pg.click('#csQ', { clickCount: 3 }); await pg.type('#csQ', code); await pg.keyboard.press('Enter'); await wait(400);
  return pg.evaluate(() => ({ pid: window.eval('CS').pid, qty: +document.querySelector('#csQty')?.value, price: +document.querySelector('#csPrice')?.value }));
};

// 1.250 kg of the item, by its product number
let r = await key(label(set.num, 1250));
ok(r.pid === set.pid && r.qty === 1.25, 'a weight label: the item comes up with 1.250 kg', JSON.stringify(r));
await pg.screenshot({ path: OUT + '/scale-label.png' });
// an item with its own PLU
r = await key(label(777, 500, '20'));
ok(r.pid === set.qid && r.qty === 0.5, 'its own PLU (777): 0.500 kg', JSON.stringify(r));
// a price label: Rs 2×price → quantity 2
await pg.evaluate(() => { window.eval('CFG').scale.price = true });
r = await key(label(set.num, Math.round(set.price * 2)));
ok(r.pid === set.pid && Math.abs(r.qty - 2) < 0.001, 'a price label: the price ÷ the unit price = 2', JSON.stringify(r));
await pg.evaluate(() => { window.eval('CFG').scale.price = false });
// nothing with that number
const toasts = [];
r = await key(label(99999, 1000));
const tmsg = await pg.evaluate(() => [...document.querySelectorAll('.toast,[class*=toast]')].map(x => x.textContent).join(' | '));
ok(!r.pid && /scale number 99999/.test(tmsg), 'an unknown scale number is said plainly', tmsg.slice(0, 120));
// a real barcode that happens to start with 2 still wins
const real = label(set.num, 1250);
await pg.evaluate((code, qid) => { window.eval('P')(qid).barcode = code }, real, set.qid);
r = await key(real);
ok(r.pid === set.qid && r.qty === 1, 'a real barcode on an item wins over the scale reading', JSON.stringify(r));
await pg.evaluate(qid => { window.eval('P')(qid).barcode = '' }, set.qid);

// the scale on the cable: K in the quantity box
await pg.evaluate(pid => { window.eval('csStart')(pid) }, set.pid); await wait(300);
await pg.focus('#csQty'); await pg.keyboard.press('k'); await wait(900);
r = await pg.evaluate(() => ({ qty: +document.querySelector('#csQty').value, cs: window.eval('CS').qty }));
ok(r.qty === 1.235 && +r.cs === 1.235, 'K reads the scale: the steady 1.235 kg (not the unsteady 0.900)', JSON.stringify(r));
ok(await pg.evaluate(() => /K scale/.test(document.querySelector('.f-qty').textContent)), 'the quantity box shows the K hint');

// settings
await pg.evaluate(() => { window.eval("setTab='shop'"); window.eval('go')('settings') }); await wait(600);
ok(!!(await pg.$('[data-set="scale.prefix"]')) && !!(await pg.$('[data-act="scaleTest"]')), 'Settings → Shop details has the weighing scale');
await pg.$eval('[data-act="scaleTest"]', el => el.scrollIntoView({ block: 'center' }));
await pg.screenshot({ path: OUT + '/scale-settings.png' });
await pg.evaluate(() => { window.eval('S').pos.lines = []; window.eval('persist')(true) });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
