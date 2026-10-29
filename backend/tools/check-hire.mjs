// Tool hire: out with a deposit (held, not takings), back with a bill for the days, the deposit set
// against it — give back or take; late ones flagged.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-hire.mjs [screenshot-dir]
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
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'); S.hireItems = []; S.hires = []; window.eval("hireTab = 'items'"); window.eval('go')('hire') });
await wait(500);

// something to hire
await pg.click('[data-act="hireItem"]'); await wait(250);
await pg.type('#hiN', 'Concrete mixer (half bag)');
await pg.evaluate(() => { document.querySelector('#hiU').value = '3'; document.querySelector('#hiR').value = '1500'; document.querySelector('#hiD').value = '5000' });
await pg.click('#hiOk'); await wait(300);
ok(await pg.evaluate(() => window.eval('S').hireItems.length === 1), 'a mixer is added to what we hire (3 of them, 1,500 a day, 5,000 deposit)');

// out: two of them, for 2 days, deposit 10,000 held — not takings
const j0 = await pg.evaluate(() => window.eval('S').journal.length);
await pg.click('[data-act="hireNew"]'); await wait(300);
await pg.evaluate(() => { document.querySelector('#hnU').value = '2'; document.querySelector('#hnU').dispatchEvent(new Event('input')); document.querySelector('#hnDays').value = '2'; document.querySelector('#hnDays').dispatchEvent(new Event('input')) });
await pg.type('#hnW', 'Kamal Builders'); await pg.type('#hnP', '0771112223');
const dep = await pg.evaluate(() => document.querySelector('#hnDep').value);
ok(dep === '10000', 'the deposit fills in from the item (2 × 5,000)');
await pg.click('#hnOk'); await wait(400);
const h = await pg.evaluate(() => { const S = window.eval('S'); const x = S.hires[0], j = S.journal.slice(-1)[0]; return { x, j: j && j.lines } });
ok(h.x && h.x.status === 'out' && h.x.units === 2 && /^HIRE-\d{5}$/.test(h.x.no), 'hired out, numbered', h.x && h.x.no);
ok(h.j && h.j.some(l => l.ac === '2070' && l.cr === 10000) && h.j.some(l => l.ac === '1010' && l.dr === 10000), 'the deposit is held in 2070 Hire deposits held, not counted as takings');
await pg.evaluate(() => { window.eval("hireTab = 'out'"); window.eval('render')() }); await wait(300);
await pg.screenshot({ path: OUT + '/hire-out.png' });

// back after 3 days (one day late): 3 × 1,500 × 2 = 9,000 against a 10,000 deposit → give back 1,000
await pg.evaluate(() => { const x = window.eval('S').hires[0]; x.outAt = new Date(Date.now() - 2.5 * 864e5).toISOString(); x.due = window.eval('ago')(1); window.eval('render')() });
await wait(300);
ok(await pg.evaluate(() => /late/.test(document.getElementById('main').innerText)), 'past its day it shows as late');
await pg.evaluate(id => window.eval('hireBack')(id), h.x.id); await wait(300);
const win = await pg.evaluate(() => document.querySelector('.modal').innerText);
ok(/Give back (Rs )?1,000\.00/.test(win), 'back after 3 days: 9,000 charged, give back 1,000 of the deposit', win.split('\n').filter(l => /Give|Take/.test(l))[0]);
await pg.screenshot({ path: OUT + '/hire-back.png' });
await pg.click('.modal .np-chk'); await pg.click('#hbOk'); await wait(600);
const done = await pg.evaluate(() => { const S = window.eval('S'), x = S.hires[0], inv = S.sales.find(s => s.no === x.bill); return { x, inv: inv && { total: inv.total, line: inv.lines[0].name, paid: inv.paid } } });
ok(done.x.status === 'back' && done.x.days === 3 && done.x.charge === 9000, 'marked back: 3 days, 9,000');
ok(done.inv && done.inv.total === 9000 && /Hire — Concrete mixer/.test(done.inv.line), 'the charge is a bill like any other', done.inv && done.inv.line);
ok(await pg.evaluate(() => window.eval('S').journal.some(j => j.ref && /-D$/.test(j.ref) && j.lines.some(l => l.ac === '2070' && l.dr === 10000))), 'the deposit leaves 2070 when it comes back');

// more than the deposit: take the difference
await pg.evaluate(() => { const S = window.eval('S'), it = S.hireItems[0];
  S.hires.push({ id: 'hrT2', no: 'HIRE-T2', item: it.id, itemName: it.name, units: 1, rate: 1500, who: 'Walk-in Sunil', cid: null, phone: '', outAt: new Date(Date.now() - 4.2 * 864e5).toISOString(), due: window.eval('ago')(2), deposit: 5000, status: 'out' }) });
await pg.evaluate(() => window.eval('hireBack')('hrT2')); await wait(300);
ok(/Take (Rs )?2,500\.00 more/.test(await pg.evaluate(() => document.querySelector('.modal').innerText)), '5 days on a 5,000 deposit: take 2,500 more');
await pg.keyboard.press('Escape'); await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
