// A bill changed after it was made keeps one working link.
//  · a credit bill is made (its link L); it is opened in the till, a quantity changed, and saved on account again
//  · every text sent as it is saved again — the owner's copy, the customer's — carries L, and L opens the bill
//    as it is now (the new total)
//  · a link that went out in a text but was never kept on a bill (how re-made bills' texts were before this)
//    still opens the bill that text names
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-remakelink.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
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
const credit = () => pg.evaluate(async cid => { window.eval('creditSale')(); await new Promise(r => setTimeout(r, 300)); window.eval('cpPick')(cid); await new Promise(r => setTimeout(r, 150)); window.eval('cpSave')(); await new Promise(r => setTimeout(r, 900)); document.querySelectorAll('.modal').forEach(m => m.remove()) }, cid0);
const cid0 = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {};
  const S = window.eval('S'), C = window.eval('CFG'); C.shop.owner = '0779990001'; C.msg.ownerBills = 'all'; C.msg.autoBill = true; C.done.askSize = false; C.done.printAnim = false; C.done.preview = false; window.eval('CS').paper = 'none';
  const c = S.customers.find(x => x.id !== 1 && /^0\d{9}$/.test(x.phone || '')); c.limit = 1e9;
  const p = S.products.find(x => x.active !== false && x.stock > 10 && !(x.tiers || []).length); window.eval('go')('pos');
  S.pos.lines = [{ pid: p.id, qty: 2, price: p.retail, disc: 0 }]; S.pos.customer = c.id; return c.id });
await credit();
const first = await pg.evaluate(cid => { const S = window.eval('S'); const inv = S.sales.filter(s => s.customerId === cid).pop(); return { no: inv.no, link: inv.link, total: inv.total } }, cid0);
ok(/\/b\//.test(first.link || ''), 'the credit bill is made with its link', first.no + ' ' + first.link);
// opened in the till, a quantity changed, saved on account again
const n0 = await pg.evaluate(() => window.eval('S').messages.length);
await pg.evaluate(no => window.eval('billToTill')(no), first.no); await wait(300); await pg.click('#ebYes'); await wait(500);
await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines[0].qty = 3; window.eval('render')() });
await credit(); await wait(400);
const after = await pg.evaluate((no, n0) => { const S = window.eval('S'); const inv = S.sales.find(s => s.no === no); const sent = S.messages.slice(0, S.messages.length - n0).filter(m => /\/b\//.test(m.body));
  return { link: inv.link, total: inv.total, links: sent.map(m => (m.body.match(/regalhw\.lk\/b\/[a-z0-9]+/i) || [''])[0]), to: sent.map(m => m.to) } }, first.no, n0);
ok(after.link === first.link && after.total > first.total, 'saved again: the same bill number and the same link, the new total', JSON.stringify({ link: after.link, total: after.total }));
ok(after.links.length >= 1 && after.links.every(l => first.link.endsWith(l.split('/').pop())), 'every text sent as it was saved carries that link (the owner\'s copy and the customer\'s)', JSON.stringify(after));
await wait(2500);
const view = await pg.evaluate(async id => { const r = await fetch('/api/my/b/' + id); return { s: r.status, j: await r.json() } }, first.link.split('/').pop());
ok(view.s === 200 && Math.abs(view.j.bill.total - after.total) < 0.01, 'the link opens the bill as it is now', JSON.stringify({ s: view.s, total: view.j.bill && view.j.bill.total }));
// a link only in a text: found by the bill the text names
const lost = 'zz' + Date.now().toString(36);
await pg.evaluate((no, lost) => { const S = window.eval('S'); S.messages.unshift({ id: 'mtest', to: '0779990001', body: `Dear Owner,\nCredit bill ${no} Rs 7,415.00 — someone, by Afridh\nOn credit: Rs 7,415.00 — see it at regalhw.lk/b/${lost}`, at: '', status: 'Queued' }); window.eval('persist')(true) }, first.no, lost);
await wait(2500);
const rescued = await pg.evaluate(async id => { const r = await fetch('/api/my/b/' + id); return { s: r.status, j: await r.json() } }, lost);
ok(rescued.s === 200 && rescued.j.bill.no === first.no, 'a link that only went out in a text opens the bill the text names', JSON.stringify({ s: rescued.s, no: rescued.j.bill && rescued.j.bill.no }));
await pg.evaluate(() => { const S = window.eval('S'); S.messages = S.messages.filter(m => m.id !== 'mtest'); window.eval('persist')(true) }); await wait(800);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
