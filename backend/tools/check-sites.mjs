// Site accounts: a site added in the credit panel, the bill on it, the site's own limit, the Sites tab
// and its statement (shown, not printed).
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-sites.mjs [screenshot-dir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
let prints = 0;
await pg.setRequestInterception(true);
pg.on('request', rq => { if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(rq.url()) || (/\/api\/print\b/.test(rq.url()) && rq.method() === 'POST')) { prints++; return rq.abort() } rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
const cid = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  const S = window.eval('S'), c = S.customers.find(x => x.id !== 1); c.sites = []; c.limit = 10000000; window.eval('go')('pos'); return c.id });
const put = (q) => pg.evaluate((q, id) => { const S = window.eval('S'), p = S.products.find(x => x.retail > 100 && x.stock > 50 && !x.open);
  S.pos.lines = [{ pid: p.id, qty: q, price: p.retail, disc: 0 }]; S.pos.customer = id; window.eval('CS').paper = 'none'; window.eval('render')(); return q * p.retail }, q, cid);

// a new site straight from the credit panel
await put(3);
await pg.keyboard.press('F6'); await wait(400);
ok(!!(await pg.$('[data-cp="sitenew"]')), 'the credit panel offers "+ New site"');
await pg.click('[data-cp="sitenew"]'); await wait(150);
await pg.type('#cpSiteNew', 'Kandy Rd house'); await pg.keyboard.press('Enter'); await wait(300);
ok(await pg.evaluate(() => !!document.querySelector('.cp-sites .btn.on') && /Kandy Rd house/.test(document.querySelector('.cp-sites .btn.on').innerText)), 'typed and Enter: the site is made and picked');
await pg.screenshot({ path: OUT + '/sites-panel.png' });
await pg.click('[data-cp="save"]'); await wait(900);
const inv = await pg.evaluate(() => { const s = window.eval('S').sales.slice(-1)[0]; return { no: s.no, site: s.site, note: s.note, bal: s.balance } });
const sid = await pg.evaluate(id => window.eval('C')(id).sites[0].id, cid);
ok(inv.site === sid && /Site: Kandy Rd house/.test(inv.note || ''), 'the bill goes to the site, and says so on the bill', inv.note);

// the site's own limit
await pg.evaluate((id, sid) => { window.eval('C')(id).sites[0].limit = 100 }, cid, sid);
await put(1);
await pg.keyboard.press('F6'); await wait(400);
await pg.evaluate(sid => document.querySelector(`[data-cp-site="${sid}"]`).click(), sid); await wait(200);
const warn = await pg.evaluate(() => document.querySelector('.cp-sheet').innerText);
ok(/Over the site's own limit/.test(warn) && await pg.evaluate(() => document.querySelector('.cp-save').disabled), 'over the site\'s own limit: it says so and Save waits for an allow');
await pg.keyboard.press('Escape'); await wait(200);
await pg.evaluate((id) => { window.eval('C')(id).sites[0].limit = 0; const S = window.eval('S'); S.pos.lines = []; window.eval('render')() }, cid);

// the Sites tab and its statement
await pg.evaluate(id => { window.eval('custSel = ' + id); window.eval('custTab = "sites"'); window.eval('go')('customers') }, cid); await wait(700);
const tab = await pg.evaluate(() => document.getElementById('main').innerText);
ok(/Kandy Rd house/.test(tab) && /1 bill/.test(tab), 'the customer\'s Sites tab shows the site with its bill and balance');
await pg.screenshot({ path: OUT + '/sites-tab.png' });
const p0 = prints;
await pg.click('[data-act="siteStmt"]'); await wait(700);
const st = await pg.evaluate(() => (document.querySelector('.modal .voucher') || {}).innerText || '');
ok(/SITE STATEMENT/i.test(st) && /Kandy Rd house/.test(st) && new RegExp(inv.no).test(st), 'Statement shows the site\'s unpaid bills', st.split('\n').slice(0, 2).join(' / '));
ok(prints === p0, 'and only shows it — Print is there for paper');
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
