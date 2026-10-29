// Deliveries: planned from a bill (a charge on an account customer's account), the driver's own page on a
// "phone" (on the way texts the customer; delivered with a photo, a signature and the cash), the till sees it,
// and the cash handed in settles the bills. A wrong link sees nothing.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-dlv.mjs [screenshot-dir] [a-jpeg]
// Texts go to a stand-in gateway on this PC; printers are stopped.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const JPEG = process.argv[3];
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const got = [];
const gw = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { got.push(Object.fromEntries(new URLSearchParams(b))); res.setHeader('Content-Type', 'application/json'); res.end('{"success":true}') }) });
await new Promise(r => gw.listen(4019, '127.0.0.1', r));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) return rq.abort(); rq.continue() });
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
  CFG.msg = { ...CFG.msg, apiUrl: 'http://127.0.0.1:4019/send', apiKey: 'test', sender: 'TEST', provider: 'test', testOnly: '' };
  CFG.dlv = { charge: 300, slots: ['Morning', 'Afternoon', 'Evening'], sms: true };
  S.deliveries = []; S.drivers = [{ id: 'drT', name: 'Nuwan', phone: '0775550001', key: 'testkeyabcdefghjk', active: true }];
  const c = S.customers.find(x => x.id !== 1 && x.phone); c.limit = 10000000; c.address = '12 Temple Road, Polonnaruwa';
  const inv = window.eval('completeSale')({ lines: [{ pid: window.eval('OPEN_PID'), name: 'Cement 10 bags', qty: 1, price: 23500, disc: 0, open: true }], customerId: c.id, pays: [{ method: 'CREDIT', amount: 0 }], override: true });
  window.eval('persist')(true);
  return { cid: c.id, no: inv.no, phone: c.phone };
});

// plan it from the bill
await pg.evaluate(no => window.eval('dlvNew')(no), set.no); await wait(300);
await pg.select('#dvR', 'drT');
await pg.click('#dvOk'); await wait(500);
const d0 = await pg.evaluate(() => window.eval('S').deliveries[0]);
ok(d0 && d0.status === 'planned' && d0.cod === 23800 && d0.address === '12 Temple Road, Polonnaruwa' && d0.driver === 'drT', 'planned from the bill: their address, to Nuwan, 23,500 unpaid + 300 charge to collect', d0 && `${d0.no} · collect ${d0.cod}`);
ok(!!d0.chargeBill, 'the delivery charge is a small bill on their account');
await wait(2500);

// the driver's phone
const ph = await b.newPage(); await ph.setViewport({ width: 390, height: 780, isMobile: true, hasTouch: true });
ph.on('dialog', d => d.accept());
const bad = await (await fetch(BASE + '/api/dlv/driver?k=wrongkeywrongkey')).json();
ok(/not for a driver/.test(bad.error || ''), 'a wrong link sees nothing');
await ph.goto(BASE + '/driver?k=testkeyabcdefghjk', { waitUntil: 'networkidle2' }); await wait(800);
const pText = await ph.evaluate(() => document.body.innerText);
ok(/Nuwan/.test(pText) && /12 Temple Road/.test(pText) && /Collect Rs 23,800\.00/.test(pText), 'Nuwan\'s phone shows the stop, the address and what to collect');
await ph.screenshot({ path: OUT + '/driver-phone.png' });
await ph.click('[data-out]'); await wait(1500);
ok(got.some(g => /on the way with Nuwan/.test(g.text || '') && /23,800/.test(g.text)), 'On the way: the customer is texted, with the amount to keep ready');

// delivered: photo, signature, cash
await ph.click('[data-done]'); await wait(400);
if (JPEG) { const inp = await ph.$('#ph'); await inp.uploadFile(JPEG); await wait(800); }
const box = await ph.$eval('#sg', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } });
await ph.mouse.move(box.x + 20, box.y + 40); await ph.mouse.down(); await ph.mouse.move(box.x + 120, box.y + 90, { steps: 8 }); await ph.mouse.move(box.x + 220, box.y + 50, { steps: 8 }); await ph.mouse.up();
await ph.type('#rb', 'Mrs Perera');
await ph.screenshot({ path: OUT + '/driver-done.png' });
await ph.click('#ok'); await wait(2000);

// the till sees it
await pg.evaluate(() => regalBridge.pull && regalBridge.pull(true)); await wait(2500);
const d1 = await pg.evaluate(() => window.eval('S').deliveries[0]);
ok(d1.status === 'delivered' && d1.collected === 23800 && d1.receiver === 'Mrs Perera', 'the till sees it delivered, to Mrs Perera, 23,800 collected', d1.status);
ok(!!d1.sign && (!JPEG || !!d1.photo), 'with the signature and the photo kept', `${d1.photo ? 'photo ' : ''}${d1.sign ? 'signature' : ''}`);
await pg.evaluate(() => { window.eval('dlvDay = null'); window.eval('go')('dlv') }); await wait(600);
await pg.screenshot({ path: OUT + '/dlv-board.png' });

// the cash handed in settles both bills
await pg.evaluate(id => window.eval('dlvHandIn')(id), d1.id); await wait(500);
const after = await pg.evaluate((no, cb) => { const S = window.eval('S'); return { a: S.sales.find(x => x.no === no).balance, b: S.sales.find(x => x.no === cb).balance, hi: !!S.deliveries[0].handedIn } }, set.no, d1.chargeBill);
ok(after.a === 0 && after.b === 0 && after.hi, 'Handed in: the bill and the delivery charge are paid', JSON.stringify(after));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · the stand-in gateway got ${got.length} text(s)`);
await b.close(); gw.close();
