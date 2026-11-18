// Other break at the till (18 Nov 2026, the owner asked): besides breakfast, lunch and tea, a staff member can go on
//   another break with why (Prayer, Bank, … or typed) — the same as the staff clock's Other (shift.html).
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-otherbreak.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', SHOTS = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 860 });
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
const st = () => pg.evaluate(() => { const S = window.eval('S'), ds = window.eval('D(today)'), e = S.employees.find(x => x.active !== false); return { id: e.id, r: JSON.parse(JSON.stringify((S.shift.days[ds] || {})[e.id] || null)) } });
// someone checked in, nobody else on a break
const id = await pg.evaluate(() => { const S = window.eval('S'), ds = window.eval('D(today)'), e = S.employees.find(x => x.active !== false);
  S.shift.days[ds] = {}; window.eval('setRec')(ds, e.id, { status: 'work', in: '08:00', out: null, sessions: [{ in: '08:00', out: null }], breaks: [] }); return e.id });
// the buttons: on the staff member's own card and on the board
const html = await pg.evaluate(id => { const S = window.eval('S'), ds = window.eval('D(today)'), e = S.employees.find(x => x.id === id), r = window.eval('recFor')(ds, id);
  let own = ''; try { own = window.eval('salesmanPortalToday')(e, 'working', window.eval('dayFigures') ? window.eval('dayFigures')(ds, id) : {}) } catch (er) { own = 'ERR ' + er.message }
  return own }, id);
ok(/data-act="otherBreak"/.test(html), 'the staff card has an Other break button', html.startsWith('ERR') ? html : '');
await pg.evaluate(id => window.eval('otherBreakAsk')(id), id); await wait(200);
ok(!!(await pg.$('.modal [data-ow="Prayer"]')) && !!(await pg.$('.modal #obWhy')), 'Other break asks why: Prayer, Bank, … or typed');
await pg.$eval('.modal [data-ow="Prayer"]', e => e.click()); await wait(200);
let s = await st(); let open = s.r && (s.r.breaks || []).find(b => !b.end);
ok(open && open.id === 'other' && open.name === 'Other · Prayer' && !(await pg.$('.modal')), 'Prayer starts the break, named "Other · Prayer"', JSON.stringify(open));
// it counts as on a break for the one-at-a-time rule, and ends like any break
ok(await pg.evaluate(() => window.eval('onBreakNow')(-1).length === 1), 'they count as on a break');
await pg.evaluate(id => window.eval('endMeal')(id), id); await wait(100);
s = await st(); ok(s.r.breaks.length === 1 && !!s.r.breaks[0].end, 'Back ends it');
// typed why
await pg.evaluate(id => window.eval('otherBreakAsk')(id), id); await wait(200);
await pg.type('.modal #obWhy', 'collecting a delivery'); await pg.keyboard.press('Enter'); await wait(200);
s = await st(); open = s.r.breaks.find(b => !b.end);
ok(open && open.name === 'Other · collecting a delivery', 'a typed why is kept', JSON.stringify(open));
await pg.evaluate(id => window.eval('endMeal')(id), id);
// not checked in: refused
await pg.evaluate(id => { const ds = window.eval('D(today)'); window.eval('setRec')(ds, id, { status: 'done', out: '10:00' }) }, id);
await pg.evaluate(id => window.eval('otherBreakAsk')(id), id); await wait(150);
ok(!(await pg.$('.modal #obWhy')), 'not at work: no Other break');
await pg.evaluate(() => { const S = window.eval('S'); S.shift.days[window.eval('D(today)')] = {} });
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
