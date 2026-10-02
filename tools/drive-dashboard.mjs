// Drive the dashboard in a real browser and check it shows the day's work.
//   npm start            (in server/)  — then:
//   node tools/drive-dashboard.mjs [out-dir]
//
// Runs against /demo, which is sealed off from the shop and needs no database, so it never
// touches real books. It seeds a day with something in every corner — cash lent out, a
// cheque in, a bill on hold, an open quotation, a repair job — and then checks the board
// actually says so, because a panel that draws nothing when it has nothing is only right
// if it draws something when it has something.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!exe) { console.error('No Chrome or Edge to drive.'); process.exit(1) }

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) };

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1.1 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', async d => { await d.accept() });

await pg.goto(BASE + '/demo', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
  await pg.waitForSelector('#lockPw');
  await pg.type('#lockPw', 'Afridh123');
  await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await new Promise(r => setTimeout(r, 1200));

/* a day with something in every corner */
const seeded = await pg.evaluate(() => {
  const out = {};
  const t = D(today);
  // a bill paid by cheque today, so a cheque comes in
  go('pos');
  const lines = [{ pid: 1, qty: 8, price: P(1).retail, disc: 0 }];
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
  completeSale({ lines, customerId: 1, billDisc: 0,
    pays: [{ method: 'CHEQUE', amount: total, ref: '551234', bankName: 'BOC', date: t }] });
  out.cheque = total;
  // cash lent to somebody outside the trade
  const p = circleAdd('K. Bandara', '0771234567', 'the lorry driver');
  circleMove({ pid: p.id, dir: 'out', amount: 15000, method: 'CASH', why: 'lorry advance' });
  out.lent = 15000;
  // a bill left on hold
  S.pos = { lines: [{ pid: 13, qty: 2, price: P(13).retail, disc: 0 }], customer: null, billDisc: 0, sel: 0, entry: null, lastBill: S.pos.lastBill };
  holdCurrentBill(false, 'gone for the van');
  out.held = (S.heldBills || []).length;
  // a quotation left open
  S.pos = { lines: [{ pid: 15, qty: 20, price: P(15).retail, disc: 0 }], customer: 3, billDisc: 0, sel: 0, entry: null, lastBill: S.pos.lastBill };
  try { saveDoc('QUOTE', 'site at Kaduruwela') } catch (e) { out.quoteErr = e.message }
  out.quotes = (S.docs || []).filter(x => x.kind === 'QUOTE' && x.status === 'open').length;
  S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill };
  go('dashboard');
  return out;
});
await new Promise(r => setTimeout(r, 900));
console.log('  --   seeded: ' + JSON.stringify(seeded));

const text = () => pg.$eval('#main', e => e.textContent.replace(/\s+/g, ' '));
let main = await text();

ok(/Where the day stands/.test(main), 'the board says where the day stands');
ok(/The float counted|The drawer counted/.test(main), 'with the float and the drawer on it');
ok(/Cheques/.test(main), 'the board has the cheques');
ok(/Came in today/.test(main), 'including what came in today');
ok(/In the drawer, not banked/.test(main), 'and what is waiting to be banked');
ok(/Cash lent and borrowed/.test(main), 'the board shows cash lent and borrowed');
ok(/K\. Bandara/.test(main), 'naming who has it');
ok(/Waiting on somebody/.test(main), 'the board gathers what is waiting on a person');
ok(/bill on hold|bills on hold/.test(main), 'including bills left on hold');
ok(/Who is in today/.test(main), 'the board says who is in');
ok(/Out with customers/.test(main), 'and what paper is out with customers');
ok(/Quotations still open/.test(main), 'with the quotations on it');

await pg.screenshot({ path: `${OUT}/dash-full.png`, fullPage: true });
console.log('  --   shot dash-full.png');

/* the panels are still a board the owner arranges */
ok(await pg.$('[data-act="dashSet"]') !== null, 'and it can still be arranged');

ok(errs.length === 0, errs.length ? 'the page threw: ' + errs.join(' | ') : 'nothing threw along the way');
await b.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
