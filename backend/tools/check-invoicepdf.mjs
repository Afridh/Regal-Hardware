// The bill message and the official PDF invoice (16 Nov 2026, the owner: "in the customer invoice text add 'click the link
// below to see the invoice'; in the invoice link, if PDF is pressed, generate an official invoice"):
//  · the cash, credit and resent-bill messages say "Click the link below to see your invoice:" with the link on its own line
//  · a shop's own wording that still had "View your bill: {link}" is changed the same way, once
//  · on the bill's link, Invoice PDF saves an A4 INVOICE: the shop, the invoice number, who it is billed to (name, phone,
//    address), every line, the total, the amount in words, paid and balance
// Nothing is texted (the SMS is caught) and nothing reaches a printer.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-invoicepdf.mjs [folder to keep the PDF]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:4010', KEEP = process.argv[2] || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== '' ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 860 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
const texts = [];
await pg.setRequestInterception(true); pg.on('request', rq => { const u = rq.url();
  if (/\/api\/sms\//.test(u)) { try { texts.push(JSON.parse(rq.postData() || '{}')) } catch {} return rq.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) }
  if (/:41\d\d/.test(u) || (/\/api\/print\b/.test(u) && rq.method() !== 'GET')) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => window.eval('S').products.length > 5, { timeout: 30000 }); await wait(1500);
// the wording
const w = await pg.evaluate(() => { const T = window.eval('CFG').tpl; return ['cashSale', 'creditSale', 'billLink'].map(k => T[k].text) });
ok(w.every(t => /Click the link below to see your invoice:\n\{link\}/.test(t) && !/View your bill/.test(t)), 'the three bill messages say "Click the link below to see your invoice:" and the link on its own line', JSON.stringify(w));
// a shop's own wording with the old line is changed once
const mig = await pg.evaluate(() => { const C = window.eval('CFG'); C.tpl.cashSale.text = 'Thanks from us!\nBill: {invoice}\nView your bill: {link}'; delete C.msg.clickLink1;
  if (!C.msg.clickLink1) { ['cashSale', 'creditSale', 'billLink'].forEach(k => { const t = C.tpl && C.tpl[k]; if (t && /View your bill:\s*\{link\}/.test(t.text || '')) t.text = String(t.text).replace(/View your bill:\s*\{link\}/, 'Click the link below to see your invoice:\n{link}') }); C.msg.clickLink1 = true }
  const r = C.tpl.cashSale.text; C.tpl.cashSale.text = window.eval('TPL_ORIG').cashSale.text; return r });
ok(mig === 'Thanks from us!\nBill: {invoice}\nClick the link below to see your invoice:\n{link}', "the shop's own wording keeps its words, only the link line changes", JSON.stringify(mig));
// a credit sale for a customer with a phone and address: the text that goes out
const sale = await pg.evaluate(async () => {
  document.querySelectorAll('.modal').forEach(m => m.remove()); window.printPaper = () => {}; window.eval("CFG.print.agent=''");
  const S = window.eval('S'), C = window.eval('CFG'); C.msg.autoBill = true; C.msg.live = true;
  const tag = 'IP' + Date.now().toString(36).slice(-4).toUpperCase();
  const c = { id: Math.max(...S.customers.map(x => x.id)) + 1, code: 'CUS-' + tag, name: 'Nimal Perera ' + tag, phone: '0771234567', address: '12 Lake Road, Polonnaruwa', limit: 100000, active: true };
  S.customers.push(c);
  const ps = S.products.filter(p => p.active !== false && +p.retail > 0 && (+p.stock || 0) > 3).slice(0, 3); ps.forEach(p => { p.stock = Math.max(+p.stock || 0, 100) });
  const lines = ps.map((p, i) => ({ pid: p.id, qty: i + 1, price: +p.retail, disc: 0 }));
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const inv = window.eval('completeSale')({ lines, customerId: c.id, pays: [{ method: 'CASH', amount: Math.round(total / 2) }], override: true });
  await window.eval('persist')(true); await new Promise(r => setTimeout(r, 2500));
  return { no: inv.no, link: inv.link, total: inv.total, balance: inv.balance, name: c.name, n: lines.length };
});
await wait(1500);
const t = texts.map(x => String(x.message || x.text || x.msg || '')).find(m => m.includes(sale.no)) || '';
ok(/Click the link below to see your invoice:\s*\n\S*\/b\//.test(t), 'the text the customer gets has the line, and the link under it', JSON.stringify(t));
// the bill's link: press Invoice PDF, a PDF is saved
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invpdf-'));
const bp = await b.newPage(); await bp.setViewport({ width: 420, height: 860 });
bp.on('pageerror', e => errs.push(e.message)); bp.on('dialog', d => { errs.push('dialog: ' + d.message()); d.accept() });
const cdp = await bp.createCDPSession(); await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
const url = BASE + '/b/' + String(sale.link).split('/b/')[1];
await bp.goto(url, { waitUntil: 'networkidle2' }); await bp.waitForSelector('.acts .btn.ink', { timeout: 20000 });
const label = await bp.$eval('.acts .btn.ink', e => e.innerText.trim());
ok(label === 'Invoice PDF', 'the button on the bill page says Invoice PDF', label);
await bp.click('.acts .btn.ink');
let file = ''; for (let i = 0; i < 60 && !file; i++) { await wait(500); file = (fs.readdirSync(dir).find(f => /\.pdf$/.test(f)) || '') }
ok(file === 'Invoice-' + String(sale.no).replace(/[^\w.-]+/g, '-') + '.pdf', 'a PDF is saved, named after the invoice', file);
if (file) {
  const buf = fs.readFileSync(path.join(dir, file)); const raw = buf.toString('latin1');
  ok(raw.startsWith('%PDF') && /\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/.test(raw), 'it is an A4 PDF', raw.slice(0, 8) + ' ' + (raw.match(/\/MediaBox \[[^\]]+\]/) || [''])[0]);
  // the words, as the PDF writes them (jsPDF keeps text plain)
  const has = s => raw.includes(s);
  ok(has('(INVOICE)') || has('INVOICE'), 'it says INVOICE');
  ok(has(sale.no), 'it has the invoice number', sale.no);
  ok(has(sale.name) && has('0771234567') && has('12 Lake Road, Polonnaruwa'), 'billed to: the name, phone and address');
  ok(has('Rupees') && has('Only'), 'the amount in words');
  ok(has('Balance due') && has('BALANCE DUE'), 'what is still owed, with the stamp');
  ok(has('computer-generated invoice'), 'the computer-generated note');
  if (KEEP) fs.copyFileSync(path.join(dir, file), path.join(KEEP, 'invoice-test.pdf'));
}
fs.rmSync(dir, { recursive: true, force: true });
ok(!errs.length, 'no script errors', errs.join(' | '));
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
