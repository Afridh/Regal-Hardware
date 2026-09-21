// Screenshot the classic till in a real browser (Edge/Chrome via puppeteer-core).
//   node tools/shot.mjs [out.png] [width] [height]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = 'http://localhost:4000';
const out = process.argv[2] || 'till.png', W = +(process.argv[3] || 1366), H = +(process.argv[4] || 768);
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: W, height: H });
const pageErrs = []; pg.on('pageerror', e => pageErrs.push(e.message));
if (/^supplier(:\w+)?$/.test(process.argv[5] || '')) {                 // the suppliers' page, signed in as the first supplier with a mobile; supplier:send / supplier:sent for the other tabs
  const tok = (await (await fetch(BASE + '/api/books/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'admin', password: 'admin123' }) })).json()).token;
  const books = await (await fetch(BASE + '/api/books/regal', { headers: { Authorization: 'Bearer ' + tok } })).json();
  const sup = books.data.S.suppliers.find(s => /^0\d{9}$/.test((s.phone || '').replace(/\D/g, '')));
  const phone = sup.phone.replace(/\D/g, '');
  const otp = await (await fetch(BASE + '/api/sup/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) })).json();
  const login = await (await fetch(BASE + '/api/sup/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: otp.code, rep: 'Silva' }) })).json();
  await pg.goto(BASE + '/supplier', { waitUntil: 'networkidle2' });
  await pg.evaluate((t, p) => { localStorage.setItem('rs_token', JSON.stringify(t)); localStorage.setItem('rs_phone', JSON.stringify(p)); localStorage.setItem('rs_rep', JSON.stringify('Silva')); }, login.token, phone);
  await pg.reload({ waitUntil: 'networkidle2' }); await new Promise(r => setTimeout(r, 800));
  const tab = (process.argv[5].split(':')[1]) || ''; if (tab) { await pg.evaluate(t => { st.tab = t; render(); }, tab); await new Promise(r => setTimeout(r, 300)); }
  await pg.screenshot({ path: out, fullPage: process.argv[6] === 'full' }); await b.close(); console.log('wrote ' + out + (pageErrs.length ? ' ERRORS ' + pageErrs.join(' | ') : '')); process.exit(0);
}
const shopMode = /^shop(cart)?(#.*)?$/.exec(process.argv[5] || '');   // shop, shop#/search?q=nail, shopcart#/checkout (cart seeded with 3 items)
await pg.goto(BASE + (shopMode ? '/' : '/pos'), { waitUntil: 'networkidle2' });
if (shopMode) {
  if (shopMode[1]) {                                                    // seed a basket and a signed-in customer so cart/checkout/account pages have something to show
    const cat = await (await fetch(BASE + '/api/shop/catalog')).json();
    const ids = cat.products.filter(p => p.stock === null || p.stock > 0).slice(0, 3).map(p => p.id);
    const otp = await (await fetch(BASE + '/api/shop/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '0771234567' }) })).json();
    const login = await (await fetch(BASE + '/api/shop/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '0771234567', code: otp.code, name: 'Sunil Perera' }) })).json();
    await pg.evaluate((ids, login) => { localStorage.setItem('rh_cart', JSON.stringify(ids.map((pid, i) => ({ pid, qty: i + 1, sel: true })))); localStorage.setItem('rh_wish', JSON.stringify(ids.slice(0, 2)));
      if (login.token) { localStorage.setItem('rh_token', JSON.stringify(login.token)); localStorage.setItem('rh_name', JSON.stringify(login.name)); localStorage.setItem('rh_phone', JSON.stringify(login.phone)); } }, ids, login);
  }
  if (shopMode[2]) { await pg.goto(BASE + '/' + shopMode[2], { waitUntil: 'networkidle2' }); await pg.reload({ waitUntil: 'networkidle2' }); }   // a hash-only change does not reload, and the seeded storage must be read at boot
  await new Promise(r => setTimeout(r, 1200));
  await pg.screenshot({ path: out, fullPage: process.argv[6] === 'full' }); await b.close(); console.log('wrote ' + out + (pageErrs.length ? ' ERRORS ' + pageErrs.join(' | ') : '')); process.exit(0);
}
await pg.waitForSelector('#lockScreen', { timeout: 15000 });
await pg.click('[data-user="admin"]'); await pg.waitForSelector('#lockPw');
await pg.type('#lockPw', 'admin123'); await pg.click('#lockGo');
await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 15000 });
await new Promise(r => setTimeout(r, 800));
await pg.evaluate(() => { go('pos'); csStart(1); csCommit(); csStart(2); csCommit(); csStart(3); csCommit(); });
await new Promise(r => setTimeout(r, 300));
if ((process.argv[5] || '').startsWith('key:')) {            // key a code at the till, show the matches, press Enter, report what landed
  const code = process.argv[5].slice(4);
  await pg.evaluate(() => { S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill }; go('pos'); });
  await new Promise(r => setTimeout(r, 300));
  await pg.focus('#csQ'); await pg.keyboard.type(code); await new Promise(r => setTimeout(r, 300));
  await pg.screenshot({ path: out });
  await pg.keyboard.press('Enter'); await new Promise(r => setTimeout(r, 300));
  console.log(JSON.stringify(await pg.evaluate(() => ({ picked: CS.pid ? P(CS.pid).name : null, num: CS.pid ? P(CS.pid).num : null, price: CS.price, focus: document.activeElement.id }))));
  await b.close(); console.log('wrote ' + out); process.exit(0);
}
if (process.argv[5] === 'hits') { await pg.focus('#csQ'); await pg.keyboard.type('ce'); await new Promise(r => setTimeout(r, 300)); }
if (process.argv[5] === 'edit') { await pg.evaluate(() => csLineEdit(1)); await new Promise(r => setTimeout(r, 300)); }
if (process.argv[5] === 'approvals') {                      // the owner's approvals page with a couple of requests waiting
  await pg.evaluate(() => { S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill };
    const t = D(today) + ' 09:41';
    S.approvals = [
      { id: 'ap1', kind: 'custPortal', title: 'Switch on the outstanding page for Green Field Electricals', detail: 'Green Field Electricals · 0779876505 · owes Rs 40,800.00', data: { cid: 3, on: true }, by: 'Kasun', at: t, status: 'pending' },
      { id: 'ap2', kind: 'billAdjust', title: 'Take Rs 2,000.00 off bill INVM-T1-AF-00013 for Nimal Constructions — goods returned', detail: '2 bags torn · bill Rs 67,000.00, Rs 67,000.00 owing', data: { no: 'INVM-T1-AF-00013', amount: 2000, why: 'return', note: '2 bags torn' }, by: 'Raslan', at: t, status: 'pending' },
      { id: 'ap3', kind: 'custTerms', title: "Change R. Fernando's terms: limit Rs 25,000.00 → Rs 100,000.00, retail → wholesale prices", detail: 'owes Rs 9,150.00 now', data: { cid: 4, limit: 100000, level: 'wholesale' }, by: 'Kasun', at: D(today) + ' 08:12', status: 'approved', decidedBy: 'Afridh', decidedAt: D(today) + ' 08:30', note: 'ok for this month' },
    ];
    notify('approval', 'Kasun asks: Switch on the outstanding page for Green Field Electricals', 'approvals', { forApprovers: true });
    go('approvals'); });
  await new Promise(r => setTimeout(r, 400));
  await pg.screenshot({ path: out }); await b.close(); console.log('wrote ' + out); process.exit(0);
}
if ((process.argv[5] || '').startsWith('printpdf:')) {       // printpdf:r80 or printpdf:a5 — what the printer would get, as a PDF next to the png
  const f = process.argv[5].slice(9);
  await pg.evaluate(() => { window.__ap = 0; window.addEventListener('afterprint', () => window.__ap++); window.addEventListener('beforeprint', () => window.__bp = (window.__bp || 0) + 1); });
  console.log(await pg.evaluate(f => { try { window.print = () => {}; CFG.print.agent = ''; const inv = S.sales.slice().reverse().find(s => s.lines.length >= 3) || S.sales.at(-1); printBill(inv, f); return 'printBill ok ' + inv.no + ' area=' + !!document.getElementById('printArea'); } catch (e) { return 'ERR ' + e.message + '\n' + e.stack; } }, f));
  await new Promise(r => setTimeout(r, 400)); await pg.emulateMediaType('print');
  await pg.screenshot({ path: out, fullPage: true });
  await pg.pdf({ path: out.replace(/\.png$/, '.pdf'), preferCSSPageSize: true, printBackground: true });
  console.log(JSON.stringify(await pg.evaluate(() => ({ page: (document.getElementById('printPage') || {}).textContent, area: !!document.getElementById('printArea'), visible: !!document.querySelector('#printArea .print') && getComputedStyle(document.querySelector('#printArea')).display, afterprint: window.__ap, beforeprint: window.__bp, directClass: document.body.classList.contains('direct-print') }))));
  await b.close(); console.log('wrote ' + out + ' and .pdf'); process.exit(0);
}
if ((process.argv[5] || '').startsWith('bill:')) {           // bill:a5 or bill:r80 — the printed bill for the latest real sale with lines
  const f = process.argv[5].slice(5);
  await pg.evaluate(f => { const inv = S.sales.slice().reverse().find(s => s.lines.length >= 3) || S.sales.at(-1); document.body.innerHTML = '<div style="padding:16px;background:#888">' + billHtml(inv, f) + '</div>'; }, f);
  await new Promise(r => setTimeout(r, 300));
  await pg.screenshot({ path: out, fullPage: true }); await b.close(); console.log('wrote ' + out); process.exit(0);
}
if (process.argv[5] === 'pay') {                             // the customer payment window with a cash part and the cheque form open
  await pg.evaluate(() => { S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill }; custSel = 2; go('customers'); custPayModal(2); });
  await new Promise(r => setTimeout(r, 300));
  await pg.evaluate(() => { const ra = document.getElementById('ra'); ra.value = '50000'; ra.dispatchEvent(new Event('input')); ra.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await new Promise(r => setTimeout(r, 200));
  await pg.evaluate(() => document.getElementById('ra').dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true })));
  await new Promise(r => setTimeout(r, 300));
  await pg.screenshot({ path: out }); await b.close(); console.log('wrote ' + out); process.exit(0);
}
if ((process.argv[5] || '').startsWith('eval:')) {           // run some JS in the till, then shoot — eval:setPref('collapsed',true);applyLayout();renderNav()
  await pg.evaluate(js => { S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill }; new Function(js)(); }, process.argv[5].slice(5));
  await new Promise(r => setTimeout(r, 500));
  await pg.screenshot({ path: out, fullPage: process.argv[6] === 'full' }); await b.close(); console.log('wrote ' + out + (pageErrs.length ? ' ERRORS ' + pageErrs.join(' | ') : '')); process.exit(0);
}
if ((process.argv[5] || '').startsWith('view:')) {           // any other page, e.g. view:customers
  const v = process.argv[5].slice(5);
  await pg.evaluate(v => { S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill }; const [view, tab] = v.split('/'); if (tab && view === 'customers') custTab = tab; if (tab && view === 'suppliers') supTab = tab; if (tab && view === 'settings') setTab = tab; if (tab && view === 'site') siteTab = tab; go(view); }, v);
  await new Promise(r => setTimeout(r, 500));
  await pg.screenshot({ path: out, fullPage: process.argv[6] === 'full' }); await b.close(); console.log('wrote ' + out); process.exit(0);
}
const m = await pg.evaluate(() => ({ pageScroll: document.documentElement.scrollHeight > window.innerHeight, mainScroll: document.getElementById('main').scrollHeight > document.getElementById('main').clientHeight, list: (() => { const l = document.querySelector('.till-lines'); return l ? l.scrollHeight + '/' + l.clientHeight : '-' })(), sum: document.querySelector('.till-sum')?.getBoundingClientRect().width, header: getComputedStyle(document.querySelector('header')).display }));
console.log(JSON.stringify(m));
await pg.screenshot({ path: out }); await b.close();
console.log('wrote ' + out);
