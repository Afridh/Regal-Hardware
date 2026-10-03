// Does the owner get told about the bills they asked to be told about, and only those?
//   npm start            (in server/)  — then:
//   node tools/drive-owner-sms.mjs
//
// Runs against /demo, which is sealed off: no network leaves the page, so every message is
// recorded in the books rather than sent. That is the point — this checks what WOULD go
// out, for every setting, without a single real text.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!exe) { console.error('No Chrome or Edge to drive.'); process.exit(1) }

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) };

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', async d => { await d.accept() });

await pg.goto(BASE + '/demo', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await new Promise(r => setTimeout(r, 1200));

const OWNER = '0777849964';
await pg.evaluate(o => { CFG.shop.owner = o; CFG.msg.autoBill = true; CFG.msg.live = false; }, OWNER);

/* make a bill and report every message it produced */
const bill = (kind, amount, custId) => pg.evaluate(({ kind, amount, custId }) => {
  const before = S.messages.length;
  const p = P(1);
  // keep the shelf full: this is about who gets told, not about running out
  p.stock = 100000; if (p.locs) { for (const k of Object.keys(p.locs)) p.locs[k] = 0; p.locs[S.locId || Object.keys(p.locs)[0]] = 100000; }
  const qty = Math.max(1, Math.round(amount / p.retail));
  const lines = [{ pid: p.id, qty, price: p.retail, disc: 0 }];
  const total = qty * p.retail;
  const pays = kind === 'credit' ? [] : [{ method: 'CASH', amount: total }];
  const inv = completeSale({ lines, customerId: custId, billDisc: 0, pays, override: true });
  const made = S.messages.slice(0, S.messages.length - before);
  return { no: inv.no, total: inv.total, balance: inv.balance,
    msgs: made.map(m => ({ to: String(m.to).replace(/\D/g, ''), body: m.body })) };
}, { kind, amount, custId });

const digits = s => String(s).replace(/\D/g, '');
const toOwner = r => r.msgs.filter(m => m.to.slice(-9) === digits(OWNER).slice(-9));

/* ---------- every bill ---------- */
await pg.evaluate(() => { CFG.msg.ownerBills = 'all'; CFG.msg.ownerMin = 0 });
let r = await bill('cash', 9000, 1);
let own = toOwner(r);
ok(own.length === 1, 'a cash bill tells the owner once');
ok(/CASH bill/i.test(own[0]?.body || ''), `and says it was cash — "${(own[0]?.body || '').slice(0, 80)}"`);
ok((own[0]?.body || '').includes(r.no), 'with the bill number on it');

r = await bill('credit', 20000, 3);
own = toOwner(r);
ok(own.length === 1, 'a credit bill tells the owner too');
ok(/CREDIT bill/i.test(own[0]?.body || ''), 'and says it was on credit');
ok(/now owe/i.test(own[0]?.body || ''), `with what they now owe — "${(own[0]?.body || '').slice(0, 110)}"`);
ok(r.msgs.length === 2, 'the customer still gets their own copy, worded for them');

/* ---------- credit only ---------- */
await pg.evaluate(() => { CFG.msg.ownerBills = 'credit' });
ok(toOwner(await bill('cash', 9000, 1)).length === 0, 'asking for credit bills only, a cash bill says nothing');
ok(toOwner(await bill('credit', 12000, 3)).length === 1, 'and a credit bill still does');

/* ---------- cash only ---------- */
await pg.evaluate(() => { CFG.msg.ownerBills = 'cash' });
ok(toOwner(await bill('cash', 9000, 1)).length === 1, 'asking for cash bills only, a cash bill does');
ok(toOwner(await bill('credit', 12000, 3)).length === 0, 'and a credit bill says nothing');

/* ---------- a floor, so a busy counter is not a text a minute ---------- */
await pg.evaluate(() => { CFG.msg.ownerBills = 'all'; CFG.msg.ownerMin = 50000 });
ok(toOwner(await bill('cash', 9000, 1)).length === 0, 'under the floor, nothing is sent');
ok(toOwner(await bill('cash', 60000, 1)).length === 1, 'over it, the owner is told');

/* ---------- off ---------- */
await pg.evaluate(() => { CFG.msg.ownerBills = 'off'; CFG.msg.ownerMin = 0 });
ok(toOwner(await bill('cash', 9000, 1)).length === 0, 'switched off, nothing is sent at all');

/* ---------- the owner buying from their own shop gets one text, not two ---------- */
await pg.evaluate(o => {
  CFG.msg.ownerBills = 'all';
  const c = S.customers.find(x => x.id !== 1); c.phone = o;           // the customer IS the owner
}, OWNER);
r = await bill('cash', 9000, await pg.evaluate(() => S.customers.find(x => x.id !== 1).id));
ok(r.msgs.length === 1, 'when the customer is the owner, one text goes out, not two');

/* ---------- no owner mobile set, nothing breaks ---------- */
await pg.evaluate(() => { CFG.shop.owner = '' });
r = await bill('cash', 9000, 1);
ok(toOwner(r).length === 0, 'with no owner mobile set, nothing is attempted');
ok(errs.length === 0, errs.length ? 'the page threw: ' + errs.join(' | ') : 'and nothing threw along the way');

await b.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
