// Saving a quotation: the mobile, then large / small / text / WhatsApp / no print.
//  · saved for a walk-in: the window asks for the mobile; "Text the link" without one is refused; typed, the
//    link is texted to it and the number is kept with the quotation
//  · saved for a customer with a mobile: it is filled in; 1 prints the large A5, 2 the small 80mm, 5 nothing
//  · a quotation whose product or customer has since gone still opens and prints (it used to stop the page)
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-quotefinish.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const SHOT = process.env.SHOTS || '.';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.dismiss());
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
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.__paper = []; window.printPaper = (h, f, no) => window.__paper.push(f); window.wa = () => {} });
const quote = (cid) => pg.evaluate(cid => { const S = window.eval('S'); const p = S.products.find(x => x.active !== false && x.stock > 3); window.eval('go')('pos');
  S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.customer = cid; window.eval('saveDoc')('QUOTE'); return S.docs[S.docs.length - 1].no }, cid);
// 1. a walk-in
const q1 = await quote(null); await wait(300);
const w1 = await pg.evaluate(() => ({ open: !!document.getElementById('qfP'), phone: (document.getElementById('qfP') || {}).value, opts: [...document.querySelectorAll('[data-qf]')].map(b => b.dataset.qf).join(',') }));
ok(w1.open && w1.phone === '' && w1.opts === 'a5,r80,text,wa,none', 'saved for a walk-in: the window asks for the mobile, then large / small / text / WhatsApp / no print', JSON.stringify(w1));
await pg.screenshot({ path: SHOT + '/quote-finish.png' });
await pg.click('[data-qf="text"]'); await wait(200);
ok(/Type their mobile first/.test(await pg.$eval('#qfM', el => el.textContent)) && !!(await pg.$('#qfP')), '"Text the link" with no mobile: it asks for one first');
await pg.type('#qfP', '0774445566'); await pg.keyboard.press('Enter'); await wait(150);
const n0 = await pg.evaluate(() => window.eval('S').messages.length);
await pg.keyboard.press('3'); await wait(300);
const s1 = await pg.evaluate((n0, no) => { const S = window.eval('S'); const m = S.messages.slice(0, S.messages.length - n0)[0]; const d = S.docs.find(x => x.no === no); return { to: m && m.to, hasLink: !!(m && d.link && m.body.includes(d.link)), kept: d.phone, open: !!document.getElementById('qfP') } }, n0, q1);
ok(s1.to === '0774445566' && s1.hasLink && s1.kept === '0774445566' && !s1.open, 'typed, Enter, 3: the link is texted to it, and the number kept with the quotation', JSON.stringify(s1));
// 2. a customer with a mobile: 1 large, 2 small, 5 nothing
const cid = await pg.evaluate(() => { const c = window.eval('S').customers.find(x => x.id !== 1 && /^0\d{9}$/.test(x.phone || '')); return c.id });
for (const [key, want, label] of [['1', 'a5', 'large A5'], ['2', 'r80', 'small 80mm'], ['5', null, 'no print']]) {
  await pg.evaluate(() => { window.__paper = [] });
  await quote(cid); await wait(300);
  const filled = await pg.$eval('#qfP', el => el.value);
  await pg.keyboard.press(key); await wait(400);
  const paper = await pg.evaluate(() => window.__paper.slice());
  ok(/^0\d{9}$/.test(filled) && (want ? paper[0] === want : paper.length === 0) && !(await pg.$('#qfP')), `a customer's quotation: their mobile filled in; ${key} → ${label}`, JSON.stringify({ filled, paper }));
}
// 3. a quotation whose product and customer have gone
const broken = await pg.evaluate(() => { const S = window.eval('S'); const res = [];
  S.docs.push({ no: 'QTN-X1', kind: 'QUOTE', date: window.eval('D')(window.eval('today')), customerId: 999999, lines: [{ pid: 999999, qty: 1, price: 100, disc: 0, mrp: 120 }], billDisc: 0, total: 100, valid: 14, by: 'test', status: 'open', vehicle: '', note: '' });
  for (const [l, fn] of [['window', () => window.eval('docPrint')('QTN-X1', { preview: true, format: 'a5' })], ['80mm', () => window.eval('docPrint')('QTN-X1', { format: 'r80' })], ['A5', () => window.eval('docPrint')('QTN-X1', { format: 'a5' })], ['page', () => { window.eval('docSel="QTN-X1"'); window.eval('go')('docs') }]]) {
    try { fn(); res.push(l + ' ok') } catch (e) { res.push(l + ' ERROR ' + e.message) } document.querySelectorAll('.modal').forEach(m => m.remove()) }
  S.docs = S.docs.filter(d => d.no !== 'QTN-X1'); return res });
ok(broken.every(x => / ok$/.test(x)), 'a quotation whose product and customer have gone still opens and prints', broken.join(' · '));
await pg.evaluate(() => window.eval('persist')(true)); await wait(1000);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
