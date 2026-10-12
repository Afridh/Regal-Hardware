// Drives the Day book in a real browser: the morning figures, cash between the drawer and
// the bank, and money lent to and borrowed from people outside the trade.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1400, height: 1000 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));

let pass = 0, fail = 0;
const ok = (c, what, extra = '') => { if (c) { pass++; console.log('PASS ' + what + (extra ? '  ' + extra : '')); } else { fail++; console.log('FAIL ' + what + (extra ? '  ' + extra : '')); } };

await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForSelector('#lockScreen', { timeout: 15000 });
if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
await pg.type('#lockPw', 'Afridh123');
await pg.click('#lockGo');
await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 15000 });
await new Promise(r => setTimeout(r, 800));

// start from a clean circle: the list, and anything the journal remembers of one
await pg.evaluate(() => { S.circle = []; S.trail = [];
  S.journal = S.journal.filter(j => !j.lines.some(l => l.party && l.party.type === 'X'));
  /* Books carried over from the old system start with an empty drawer on purpose — the cash and
     bank figures were never reconciled there, so they are keyed in here from the real count. This
     check is about moving money, not about where it came from, so it puts a float in the same way
     an opening balance is posted (3100 is the account the import uses for them). */
  const yday = addDays(D(today), -1);
  if (bal('1010', D(today)) < 50000) post(yday, 'Opening float for this check', 'OPEN-TEST',
    [{ ac: '1010', dr: 50000 }, { ac: '3100', cr: 50000 }]);
  dayTab = 'start'; go('cashup'); });

// the morning page shows every account
const morning = await pg.evaluate(() => {
  const h = document.body.innerHTML;
  return { tiles: document.querySelectorAll('.daytile').length,
    banks: S.banks.every(b => h.includes(b.name)),
    cash: h.includes('In the drawer'),
    toPass: h.includes('Cheques to put in today'),
    toCheck: h.includes('Check these against the bank') };
});
ok(morning.tiles === 4 && morning.banks && morning.cash, 'the morning shows the drawer and every bank', JSON.stringify(morning));
ok(morning.toPass && morning.toCheck, 'the cheques to pass and the ones to check with the bank are both there');

// cash into the bank, and back out
const moved = await pg.evaluate(() => {
  const d = D(today), b1 = S.banks[0];
  const cash0 = bal('1010', d), bank0 = bal(b1.ac, d);
  cashToBank(b1.id, 5000, d, 'the usual Monday deposit');
  const mid = { cash: bal('1010', d), bank: bal(b1.ac, d) };
  bankToCash(b1.id, 1200, d, 'change for the drawer');
  return { cash0, bank0, mid, end: { cash: bal('1010', d), bank: bal(b1.ac, d) } };
});
ok(moved.mid.cash === moved.cash0 - 5000 && moved.mid.bank === moved.bank0 + 5000,
   'putting cash into the bank moves it out of the drawer', JSON.stringify(moved.mid));
ok(moved.end.cash === moved.cash0 - 5000 + 1200 && moved.end.bank === moved.bank0 + 5000 - 1200,
   'drawing cash back brings it the other way', JSON.stringify(moved.end));

// more cash than there is cannot go to the bank
const tooMuch = await pg.evaluate(() => {
  try { cashToBank(S.banks[0].id, bal('1010', D(today)) + 1, D(today)); return 'let through' }
  catch (e) { return e.message }
});
ok(/Only /.test(tooMuch), 'the bank cannot be given cash the drawer has not got', tooMuch);

// somebody in the circle lends the shop money
const borrow = await pg.evaluate(() => {
  const d = D(today);
  const p = circleAdd('Ranjith uncle', '0771234567', 'next door, shoe shop');
  const cash0 = bal('1010', d);
  circleMove({ pid: p.id, dir: 'in', amount: 30000, method: 'CASH', why: 'to make up the bank deposit', date: d });
  return { id: p.id, bal: circleBal(p.id), cash: +(bal('1010', d) - cash0).toFixed(2),
    owedOut: circleOwedToThem(), owedIn: circleOwedToUs() };
});
ok(borrow.bal === 30000 && borrow.cash === 30000,
   'money taken from the circle comes into the drawer and is owed back', JSON.stringify(borrow));
ok(borrow.owedOut === 30000 && borrow.owedIn === 0, 'the shop is shown as owing it');

// paying half of it back
const partly = await pg.evaluate((pid) => {
  circleMove({ pid, dir: 'out', amount: 12000, method: 'CASH', why: 'part of it back', date: D(today) });
  return { bal: circleBal(pid), owedOut: circleOwedToThem() };
}, borrow.id);
ok(partly.bal === 18000 && partly.owedOut === 18000, 'paying some back leaves the rest owing', JSON.stringify(partly));

// paying back more than was owed swings it the other way: now they owe the shop
const swung = await pg.evaluate((pid) => {
  circleMove({ pid, dir: 'out', amount: 20000, method: 'CASH', why: 'and a hand until Friday', date: D(today) });
  return { bal: circleBal(pid), owedOut: circleOwedToThem(), owedIn: circleOwedToUs() };
}, borrow.id);
ok(swung.bal === -2000 && swung.owedIn === 2000 && swung.owedOut === 0,
   'the same person can swing from lender to borrower', JSON.stringify(swung));

// the wording follows the balance rather than the button
// a clean advance to somebody square with the shop
await pg.evaluate((pid) => circleMove({ pid, dir: 'out', amount: 500, method: 'CASH', date: D(today) }), borrow.id);
const words = await pg.evaluate((pid) => circleMoves(pid).map(m => m.desc), borrow.id);
ok(words.some(w => /taken from/.test(w)) && words.some(w => /paid back to/.test(w)) && words.some(w => /given to/.test(w))
   && words.some(w => /given on top/.test(w)),
   'what it is called follows where the balance stood', JSON.stringify(words));

// the books balance and the control account agrees with the people
const books = await pg.evaluate(() => {
  let dr = 0, cr = 0;
  for (const j of S.journal) for (const l of j.lines) { dr += l.dr || 0; cr += l.cr || 0 }
  const control = -bal('2150');                       // credit balance, so flip it: + = owed to the circle
  const people = S.circle.reduce((a, p) => a + circleBal(p.id), 0);
  return { off: +(dr - cr).toFixed(2), control: +control.toFixed(2), people: +people.toFixed(2) };
});
ok(Math.abs(books.off) < 0.005, 'the journal still balances', JSON.stringify(books));
ok(Math.abs(books.control - books.people) < 0.005,
   'the control account agrees with the people in the circle', JSON.stringify(books));

/* Giving out more than there is in the drawer is refused — while the shop is keeping a drawer it
   trusts. The refusal is switched off by CFG.stock.allowNegative, which a shop coming off the old
   system has on, because the drawer there was never counted into the books. So the condition is
   set here rather than assumed, and put back afterwards. */
const short = await pg.evaluate((pid) => {
  const was = (CFG.stock || {}).allowNegative;
  CFG.stock = { ...(CFG.stock || {}), allowNegative: false };
  let r;
  try { circleMove({ pid, dir: 'out', amount: bal('1010', D(today)) + 1, method: 'CASH', date: D(today) }); r = 'let through' }
  catch (e) { r = e.message }
  CFG.stock = { ...(CFG.stock || {}), allowNegative: was };
  return r;
}, borrow.id);
ok(/Only /.test(short), 'the shop cannot give out cash it has not got', short);

// it all goes on the trail
const trail = await pg.evaluate(() => (S.trail || []).filter(t => t.kind === 'circle').map(t => t.what));
ok(trail.length >= 5 && trail.some(t => /Ranjith/.test(t)) && trail.some(t => /put into/.test(t)),
   'every movement is on the trail', String(trail.length) + ' entries');

// the circle tab draws, and so does the close tab, with no shouting
const tabs = await pg.evaluate(() => {
  dayTab = 'circle'; render();
  const circle = { rows: document.querySelectorAll('.circle-row').length, has: document.body.innerHTML.includes('What has passed') };
  dayTab = 'close'; render();
  const close = document.body.innerHTML.includes('Closing count');
  dayTab = 'start'; render();
  return { circle, close, start: document.querySelectorAll('.daytile').length };
});
ok(tabs.circle.rows === 1 && tabs.circle.has, 'the circle tab lists the people and what passed', JSON.stringify(tabs.circle));
ok(tabs.close && tabs.start === 4, 'all three tabs draw', JSON.stringify(tabs));

// somebody taken off the list must not hand their history to the next person added.
// Last, because it empties the list it is testing.
const reuse = await pg.evaluate((pid) => {
  const gone = circleBal(pid);
  S.circle = S.circle.filter(x => x.id !== pid);        // taken off the list; the journal still knows them
  const fresh = circleAdd('Somebody else', '', '');
  return { id: fresh.id, wasId: pid, bal: circleBal(fresh.id), gone };
}, borrow.id);
ok(reuse.id !== reuse.wasId && reuse.bal === 0 && Math.abs(reuse.gone) > 0.005,
   'a new person does not inherit a removed one\'s money', JSON.stringify(reuse));

ok(errs.length === 0, 'no script errors anywhere in the day book', errs.join(' | '));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
