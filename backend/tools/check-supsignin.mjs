// The supplier page signs in by mobile first (18 Nov 2026, the owner asked): the mobile on file and a texted code;
// a supplier with no mobile on file uses the user name and password — offered plainly, and pushed forward when the
// mobile typed is not on file. A device that last signed in by name opens on that.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-supsignin.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 420, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.setRequestInterception(true); pg.on('request', rq => { if (/\/api\/sms\//.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/supplier', { waitUntil: 'networkidle2' });
await pg.evaluate(() => { Object.keys(localStorage).filter(k => k.startsWith('rs_')).forEach(k => localStorage.removeItem(k)) });
await pg.reload({ waitUntil: 'networkidle2' }); await wait(300);
const card = await pg.$eval('.card', e => e.innerText);
ok(/mobile number/i.test(card) && /user name and password/i.test(card), 'the front page says: mobile first, user name if no mobile', JSON.stringify(card));
await pg.$eval('#signin', e => e.click()); await wait(300);
ok(!!(await pg.$('#sPh')) && !(await pg.$('#sUser')), 'Sign in opens on the mobile');
const btn = await pg.$eval('#sUserWay', e => e.innerText);
ok(/No mobile on file\? Use a user name and password/.test(btn), 'with a plain button for those with no mobile on file', btn);
// a mobile nobody has
await pg.$eval('#sPh', e => { e.value = '0700000001'; e.dispatchEvent(new Event('input')) });
await pg.$eval('#sGo', e => e.click()); await wait(1200);
const st = await pg.evaluate(() => ({ toast: [...document.querySelectorAll('.toast,#toast,[class*=toast]')].map(e => e.innerText).join(' | '), tape: document.getElementById('sUserWay')?.classList.contains('tape'), ph: !!document.getElementById('sPh') }));
ok(st.ph && st.tape && /not on file/i.test(st.toast) && /user name and password/i.test(st.toast), 'a mobile not on file says so and points to the user name way', JSON.stringify(st));
await pg.$eval('#sUserWay', e => e.click()); await wait(200);
ok(!!(await pg.$('#sUser')) && !!(await pg.$('#sPass')) && !!(await pg.$('#sForgot')), 'the button opens user name and password (with Forgotten)');
const back = await pg.$eval('#sPhoneWay', e => e.innerText);
ok(/mobile/.test(back), 'and the way back to the mobile', back);
// a device that last signed in by name opens on that
await pg.evaluate(() => { document.querySelector('.sheet')?.remove(); localStorage.setItem('rs_way', '"user"'); localStorage.setItem('rs_user', '"tokyo.rep"') });
await pg.$eval('#signin', e => e.click()); await wait(300);
ok(!!(await pg.$('#sUser')) && (await pg.$eval('#sUser', e => e.value)) === 'tokyo.rep', 'a device that last signed in by name opens on its user name');
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
