// Where does a bill actually go when it is printed?
//   npm start            (in server/)  — then:
//   node tools/drive-print-route.mjs
//
// A bill can reach paper three ways: the helper on this machine, the shop's queue that the
// counter PC takes from, or this browser's own print box. The setting says which is tried
// first. Nothing is really printed here — each of the three is stood in for and the order
// they are tried in is what is checked, because that order IS the feature.
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

/* stand in for the three ways out, and write down which was tried and in what order */
const run = (where, canThisMachine, canCounter) => pg.evaluate(async ({ where, canThisMachine, canCounter }) => {
  CFG.bill.printTo = where;
  const tried = [];
  const keep = { a: window.agentPrint, q: window.queuePrint, b: window.printHere };
  window.agentPrint = async () => { tried.push('this machine'); return canThisMachine };
  window.queuePrint = async () => { tried.push('the counter'); return canCounter };
  window.printHere = () => { tried.push('the print box') };   // it asks first now, and prints on a press
  printBill({ no: 'INV-TEST', total: 100, lines: [], balance: 0, customerId: 1, date: D(today) }, 'r80');
  await new Promise(r => setTimeout(r, 120));
  Object.assign(window, { agentPrint: keep.a, queuePrint: keep.q, printHere: keep.b });
  return tried;
}, { where, canThisMachine, canCounter });

/* ---------- left as it was: the printer in front of you ---------- */
let t = await run('here', true, true);
ok(t[0] === 'this machine', 'set to this machine, it goes to the printer beside the person');
ok(t.length === 1, 'and stops there — the counter is not troubled with it');

t = await run('here', false, true);
ok(t.join(' → ') === 'this machine → the counter', 'with no printer on this machine it goes to the counter');

t = await run('here', false, false);
ok(t.join(' → ') === 'this machine → the counter → the print box',
   'and with neither, the person is given the print box rather than losing the bill');

/* ---------- what was asked for: always the counter ---------- */
t = await run('main', true, true);
ok(t[0] === 'the counter', 'set to the main counter, it goes there FIRST');
ok(t.length === 1 && !t.includes('this machine'),
   'even though this machine has a printer of its own — which is the whole point');

t = await run('main', true, false);
ok(t.join(' → ') === 'the counter → this machine',
   'if the shop server cannot be reached it falls back to the printer in front of the person');

t = await run('main', false, false);
ok(t.join(' → ') === 'the counter → this machine → the print box',
   'and with nothing reachable at all, the print box — a bill is never silently lost');

/* ---------- the setting is remembered, and is what the screen shows ---------- */
await pg.evaluate(() => { CFG.bill.printTo = 'main'; go('settings'); setTab = 'bill'; render() });
await new Promise(r => setTimeout(r, 600));
ok(await pg.evaluate(() => {
  const s = document.querySelector('[data-set="bill.printTo"]');
  return s && s.value === 'main';
}), 'Settings → Bills shows the choice, set to the main counter');
ok(await pg.evaluate(() => /Always the main counter/.test(document.getElementById('main').textContent)),
   'and says in plain words what that means');

/* ---------- and when nothing will take it, the person is told why ---------- */
await pg.evaluate(() => {
  CFG.bill.printTo = "main";
  window.agentPrint = async () => false;
  // the very words the shop server sends when the counter helper has never started
  window.queuePrint = async () => ({ ok: false, why: "The shop printer has never asked for work — start the print helper on the PC the printers are on" });
  printBill({ no: "INV-TEST", total: 100, lines: [], balance: 0, customerId: 1, date: D(today) }, "r80");
});
await new Promise(r => setTimeout(r, 700));
const said = await pg.evaluate(() => { const m = document.querySelector(".modal"); return m ? m.textContent.replace(/\s+/g, " ").trim() : "" });
ok(/did not take it/i.test(said), "a bill nothing would print puts the reason on the screen");
ok(/start the print helper/i.test(said), "in the shop server's own words — " + said.slice(0, 90));
ok(/is made and saved/.test(said), "and says the bill itself is safe, which is the first worry");
ok(await pg.evaluate(() => !!document.querySelector("#pfHere")), "with printing here offered as a choice, not done behind their back");
ok(await pg.evaluate(() => !!document.querySelector('.modal [data-view="printq"]')), "and a way through to Printing");
await pg.screenshot({ path: (process.argv[2] || ".") + "/print-refused.png" });
await pg.evaluate(() => { const m = document.querySelector(".modal"); if (m) m.remove() });

ok(errs.length === 0, errs.length ? 'the page threw: ' + errs.join(' | ') : 'nothing threw along the way');
await b.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
