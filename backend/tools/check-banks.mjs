// Bank accounts: more than one at the same bank and branch, told apart by the account number.
//  · a second account at "Commercial Bank Polonnaruwa" with its own number goes in, with its opening balance
//  · the same name with no number — or the same number twice — is refused, and says why
//  · in the books the two carry the last four figures of their numbers, so a report never shows two alike
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-banks.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
const NAME = 'Commercial Bank Polonnaruwa';
await pg.evaluate(n => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); S.banks = S.banks.filter(x => x.name !== n); window.eval("setTab='banks'"); window.eval('go')('settings') }, NAME);
// fill the form as a person would
const add = async (no, open) => { await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
  await pg.evaluate(() => window.eval('bankModal')(null)); await wait(250);
  const ids = await pg.evaluate(() => [...document.querySelectorAll('.modal input')].map(i => i.id));
  await pg.evaluate(([n, no, open, ids]) => { const set = (i, v) => { const el = document.getElementById(i); if (el) { el.value = v; el.dispatchEvent(new Event('input')) } };
    set(ids[0], n); set(ids[1], no); if (open && document.getElementById('bkOpen')) set('bkOpen', open) }, [NAME, no, open, ids]);
  const toastBefore = await pg.evaluate(() => document.querySelectorAll('.toast').length);
  await pg.evaluate(() => { const btn = [...document.querySelectorAll('.modal button')].find(x => /Save|Add/i.test(x.textContent) && !/Cancel/.test(x.textContent)); btn.click() }); await wait(400);
  return pg.evaluate(n => ({ n: window.eval('S').banks.filter(x => x.name === n).length, msg: [...document.querySelectorAll('.toast')].map(t => t.innerText).join(' | ') }), NAME) };
let r = await add('8012345678', '250000');
ok(r.n === 1, 'the first account at the branch goes in', JSON.stringify(r));
r = await add('8098765432', '40000');
ok(r.n === 2, 'a second account at the same bank and branch, with its own number, goes in', JSON.stringify(r));
r = await add('', '');
ok(r.n === 2 && /account at Commercial Bank Polonnaruwa/.test(r.msg), 'the same name with no number: refused, and told to put the number in', r.msg.slice(-120));
r = await add('80-1234-5678', '');
ok(r.n === 2 && /already on the list/.test(r.msg), 'the same number again (written differently): refused', r.msg.slice(-80));
const lab = await pg.evaluate(n => { const S = window.eval('S'), GL = window.eval('GL'); window.eval('syncBankNames')(); return S.banks.filter(x => x.name === n).map(x => ({ label: GL[x.ac], bal: window.eval('bal')(x.ac) })) }, NAME);
ok(lab.length === 2 && lab[0].label !== lab[1].label && /·5678/.test(lab.map(x => x.label).join()) && /·5432/.test(lab.map(x => x.label).join()), 'in the books they read apart: …·5678 and …·5432', JSON.stringify(lab));
ok(lab.some(x => Math.abs(x.bal - 250000) < 0.01) && lab.some(x => Math.abs(x.bal - 40000) < 0.01), 'each with its own opening balance', JSON.stringify(lab.map(x => x.bal)));
await pg.evaluate(n => { const S = window.eval('S'); window.eval('persist')(true) }, NAME);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
