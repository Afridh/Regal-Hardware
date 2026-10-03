// Bills put on hold: are they the shop's, and can the right one be picked up?
//   npm start            (in server/)  — then:
//   node tools/drive-held.mjs
//
// Two halves. First, without a browser: a held bill has to be part of the books the tills
// share, or it cannot appear anywhere but the machine it was keyed on — that is checked
// against regal-bridge.js itself. Then, in the demo, that the right bill comes back when
// the list has moved under the person holding the window open.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) };

/* ---------- 1. what the tills share, and what stays on one machine ---------- */
const bridge = fs.readFileSync('app/regal-bridge.js', 'utf8');
const keys = (bridge.match(/var LOCAL_KEYS = \[([^\]]*)\]/) || [])[1];
ok(!!keys, 'regal-bridge.js says what stays on one machine');
const local = (keys || '').split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

ok(!local.includes('heldBills'), 'bills on hold are NOT kept to one machine — every till sees them');
ok(!local.includes('held'), 'nor is the last one held');
ok(local.includes('pos'), 'the bill being keyed right now still is — half a bill must not appear on the next till');
ok(local.includes('user') && local.includes('terminal'), 'and so are who is signed in and which till this is');

/* strip() is what gets saved: it drops the local keys and keeps everything else */
ok(/LOCAL_KEYS\.forEach\(function \(k\) \{ delete d\.S\[k\]; \}\)/.test(bridge),
   'what is saved to the shop is everything except those');

/* ---------- 1b. and the OTHER list, for books coming the other way ----------
   There are two, one per direction: the bridge decides what is SAVED to the shop, and the
   till decides what is KEPT when books arrive. They have to agree. They did not once — held
   bills were taken off the bridge's list and left on the till's, so a bill held on a phone
   reached the server and was then thrown away by every till as it came back, which from the
   counter looked exactly like no sync at all. Checking only one list is what let that
   through, so both are checked here. */
const app = fs.readFileSync('app/index.html', 'utf8');
const tillList = /const LOCAL_KEYS\s*=([\s\S]*?);\r?\n/.exec(app);
ok(!!tillList, 'the till keeps a list of its own, for books arriving from the shop');
const tillSrc = tillList ? tillList[1] : '';
ok(/window\.regalBridge/.test(tillSrc),
   'and it takes the bridge’s list as its source, so the two cannot drift apart');
for (const k of ['heldBills', 'held'])
  ok(!tillSrc.includes(`'${k}'`), `and "${k}" is not written into its fallback either`);
ok(tillSrc.includes("'pos'"), 'while the bill being keyed right now still is');

/* ---------- 2. the behaviour, in the demo ---------- */
if (!exe) { console.log('\n  (no browser to drive; the rest needs one)'); process.exit(fail ? 1 : 0) }
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

/* three bills on hold, each a different thing */
const ids = await pg.evaluate(() => {
  go('pos');
  S.heldBills = [];
  const out = [];
  for (const [pid, ref] of [[1, 'gone for the van'], [13, 'back after lunch'], [15, 'waiting on his son']]) {
    S.pos = { lines: [{ pid, qty: 2, price: P(pid).retail, disc: 0 }], customer: null, billDisc: 0, sel: 0, entry: null, lastBill: S.pos.lastBill };
    holdCurrentBill(false, ref);
    out.push({ id: S.heldBills[0].id, ref, pid });
  }
  return out;
});
ok(ids.length === 3 && await pg.evaluate(() => S.heldBills.length) === 3, 'three bills go on hold');
ok(await pg.evaluate(() => S.heldBills.every(b => b.id && b.terminal)),
   'each one records what it is and which till it was held at');

/* the one at the BOTTOM of the list, picked up by what it is */
const last = ids[0];                                   // held first, so it is last in the list
const got = await pg.evaluate(id => {
  recallHeldBill(id);
  return { pid: (S.pos.lines[0] || {}).pid, left: S.heldBills.length, stillThere: S.heldBills.some(b => b.id === id) };
}, last.id);
ok(got.pid === last.pid, 'picking one up by what it is brings back that one, not whatever sits at that position');
ok(got.left === 2 && !got.stillThere, 'and it comes off the list');

/* the list moves under somebody with the window open */
const moved = await pg.evaluate(ids => {
  S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill };
  const want = ids[1];                                  // what this person is looking at
  // another till holds one, which goes on the front and shifts everything down
  S.pos = { lines: [{ pid: 2, qty: 1, price: P(2).retail, disc: 0 }], customer: null, billDisc: 0, sel: 0, entry: null, lastBill: S.pos.lastBill };
  holdCurrentBill(false, 'held at the other till');
  S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill };
  recallHeldBill(want.id);
  return { pid: (S.pos.lines[0] || {}).pid, want: want.pid };
}, ids);
ok(moved.pid === moved.want, 'and still brings back the right one after the list has shifted');

/* one that somebody else already took */
const gone = await pg.evaluate(id => {
  S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill };
  const before = JSON.stringify(S.pos.lines);
  const ret = recallHeldBill(id);                       // already picked up earlier
  return { ret, lines: S.pos.lines.length, same: JSON.stringify(S.pos.lines) === before };
}, last.id);
ok(gone.ret === false && gone.lines === 0, 'asking for one that has already been picked up loads nothing');

/* and the button in the window carries the bill, not a position */
await pg.evaluate(() => { showHeldBillsModal() });
await new Promise(r => setTimeout(r, 500));
const btn = await pg.evaluate(() => {
  const el = document.querySelector('[data-hb-recall]');
  return el ? el.dataset.hbRecall : null;
});
ok(btn && /^hb_/.test(btn), `the Recall button carries the bill itself (${btn})`);

ok(errs.length === 0, errs.length ? 'the page threw: ' + errs.join(' | ') : 'nothing threw along the way');
await b.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
