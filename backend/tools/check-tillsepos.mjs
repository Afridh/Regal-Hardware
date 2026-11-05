// The SePOS look on the till (3 Nov 2026): the classic till underneath, the old SePOS screen on top.
//  · a new user gets the SePOS look by default; My settings → How the till looks switches it per user
//  · product details show the item on the entry row (or the line picked on the bill)
//  · the paid amount shows the balance and the credit as it is typed; Enter opens the payment window with it
//  · the key strip does what the keys do: Hold, Un hold, Print (the payment window), Bill copy (the last bill, marked Copy)
//  · the panel beside the bill never scrolls, however short the window
//  · Regal red brings back the old look, with Hold / Clear / Held at the top
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-tillsepos.mjs        (SHOT=<folder> to keep screenshots)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010', SHOT = process.env.SHOT || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 768 });
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
// the default: a user with no choice saved gets SePOS
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const p = window.eval('prefs')(); delete p.tillLook; p.till = 'classic';
  window._printed = []; window.printPaper = (html, f, no) => { window._printed.push({ html: String(html), f, no }) }; window.eval('S').pos.lines = []; window.eval('go')('pos') });
await wait(600);
ok(await pg.evaluate(() => !!document.querySelector('.till.sp-look')), 'a user with no choice saved gets the SePOS look');
ok(await pg.evaluate(() => getComputedStyle(document.querySelector('.till-hold')).display === 'none' && !!document.querySelector('.sp-keys [data-act="hold"]')), 'Hold / Clear / Held have moved to the key strip');
// key a line the classic way
const pid = await pg.evaluate(() => { const p = window.eval('S').products.find(x => x.active !== false && x.stock > 10 && x.retail > 100 && !(x.tiers || []).length && !x.serialised); return { code: String(p.num || p.code), name: p.name, retail: p.retail } });
await pg.click('#csQ'); await pg.keyboard.type(pid.code); await pg.keyboard.press('Enter'); await wait(300);
ok(await pg.evaluate(n => (document.querySelector('.sp-pdb b') || {}).textContent === n, pid.name), 'product details show the item on the entry row', pid.name);
for (let i = 0; i < 4; i++) { await pg.keyboard.press('Enter'); await wait(120); }
await wait(400);
const st = await pg.evaluate(() => ({ lines: window.eval('S').pos.lines.length, net: window.eval('csTotals')().net, paid: (document.getElementById('spPaid') || {}).value }));
ok(st.lines === 1 && Math.abs(+st.paid - st.net) < 0.01, 'the line is on the bill and the paid amount starts at the net total', JSON.stringify(st));
if (SHOT) await pg.screenshot({ path: SHOT + '/till-sepos.png' });
// the paid amount: balance and credit as it is typed
await pg.click('#spPaid', { clickCount: 3 }); await pg.keyboard.type(String(Math.ceil(st.net / 1000) * 1000 + 1000)); await wait(150);
const bal = await pg.evaluate(() => ({ bal: document.getElementById('spBal').textContent, cr: document.getElementById('spCr').textContent }));
ok(bal.cr === '0.00' && bal.bal !== '0.00', 'more than the total: the balance (change) shows, no credit', JSON.stringify(bal));
await pg.evaluate(() => { const i = document.getElementById('spPaid'); i.value = ''; i.focus() }); await pg.keyboard.type('10'); await wait(150);
const cr = await pg.evaluate(() => document.getElementById('spCr').textContent);
ok(cr !== '0.00', 'less than the total: the credit shows', cr);
await pg.keyboard.press('Enter'); await wait(400);
const pw = await pg.evaluate(() => ({ open: !!document.querySelector('.payw'), amt: (document.getElementById('payAmt') || {}).value }));
ok(pw.open && +pw.amt === 10, 'Enter on the paid amount opens the payment window with that amount', JSON.stringify(pw));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove())); await wait(200);
// the key strip
await pg.click('.sp-keys [data-act="hold"]'); await wait(500);
await pg.evaluate(() => { const m = [...document.querySelectorAll('.modal button')].find(x => /put aside|hold/i.test(x.textContent) && !/quotation/i.test(x.textContent)); if (m) m.click() }); await wait(400);
const held = await pg.evaluate(() => ({ lines: window.eval('S').pos.lines.length, held: (window.eval('S').heldBills || []).length }));
ok(held.lines === 0 && held.held >= 1, 'HOLD on the strip puts the bill aside', JSON.stringify(held));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await pg.click('.sp-keys [data-act="showHeld"]'); await wait(400);
ok(await pg.evaluate(() => !!document.querySelector('.modal')), 'UN HOLD opens the held bills');
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('recallHeldBill')(0) }); await wait(400);
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await pg.click('.sp-keys .print'); await wait(400);
ok(await pg.evaluate(() => !!document.querySelector('.payw')), 'PRINT on the strip opens the payment window');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// G is the warranty, W in the price box is wholesale (3 Nov 2026: W did both)
await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines = []; window.eval('posSetLevel')('retail'); window.eval('render')() }); await wait(300);
await pg.click('#csQ'); await pg.keyboard.type(pid.code); await pg.keyboard.press('Enter'); await wait(300);
await pg.keyboard.press('g'); await wait(400);
ok(await pg.evaluate(() => !!document.querySelector('.modal') && /warrant/i.test(document.querySelector('.modal').innerText)), 'G in the qty box opens the warranty');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await pg.focus('#csPrice'); await pg.keyboard.press('w'); await wait(300);
ok(await pg.evaluate(() => window.eval('posLevel')() === 'wholesale' && !document.querySelector('.modal')), 'W in the price box switches to wholesale, no warranty window');
await pg.evaluate(() => { window.eval('posSetLevel')('retail') }); await wait(200);
await pg.focus('#csPrice'); await pg.keyboard.press('g'); await wait(400);
ok(await pg.evaluate(() => !!document.querySelector('.modal') && /warrant/i.test(document.querySelector('.modal').innerText)), 'G in the price box opens the warranty too');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// End: the whole bill in cash, printed
await pg.focus('#csDisc'); await pg.keyboard.press('Enter'); await wait(400);
const before = await pg.evaluate(() => ({ lines: window.eval('S').pos.lines.length, sales: window.eval('S').sales.length, net: window.eval('csTotals')().net }));
ok(await pg.evaluate(() => !document.querySelector('.sp-keys [data-act="quickCash"]') && !!document.querySelector('.sp-keys [data-act="spBillCopy"]')), 'the key strip has BILL COPY in place of CASH; the End key still takes exact cash');
await pg.keyboard.press('End'); await wait(800);
// the shop's end-of-bill questions (the customer's number, who sold it), when they are switched on: Enter for each
for (let i = 0; i < 5 && await pg.evaluate(() => window.eval('S').pos.lines.length > 0 && document.querySelectorAll('.modal').length > 1); i++) { await pg.keyboard.press('Enter'); await wait(700); }
await wait(800);
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const after = await pg.evaluate(() => { const S = window.eval('S'), s = S.sales.at(-1); return { lines: S.pos.lines.length, sales: S.sales.length, total: s && s.total, paid: s && s.paid, bal: s && s.balance, cash: s && (s.pays || []).some(p => p.method === 'CASH') } });
ok(before.lines === 1 && after.lines === 0 && after.sales === before.sales + 1 && Math.abs(after.total - before.net) < 0.01 && after.bal < 0.005 && after.cash,
  'End: the bill is paid in full in cash and done', JSON.stringify({ before, after }));
// BILL COPY: the last bill, marked Copy, printed; whatever is on the till stays
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'), p = S.products.find(x => x.active !== false && x.stock > 10 && x.retail > 100); S.pos.lines = [{ pid: p.id, qty: 2, price: p.retail, disc: 0 }]; window._printed = []; window._billCopyAt = 0; window.eval('render')() }); await wait(400);
const lastNo = await pg.evaluate(() => window.eval('S').sales.at(-1).no);
ok(await pg.$eval('.sp-keys [data-act="spBillCopy"]', e => e.innerText).then(x => x.includes('BILL COPY') && x.includes(lastNo)), 'BILL COPY says which bill it will print', lastNo);
const nSales = await pg.evaluate(() => window.eval('S').sales.length);
ok(await pg.evaluate(() => { const b = document.querySelector('.sp-keys [data-act="spBillCopy"]'), r = b.getBoundingClientRect(), sv = document.querySelector('.saved'); return !!sv && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2).closest('[data-act="spBillCopy"]') === b }), 'right after a bill, with "bill saved" still showing, the key can be pressed');
await pg.click('.sp-keys [data-act="spBillCopy"]'); await wait(700);
const cp = await pg.evaluate(() => ({ n: window._printed.length, no: (window._printed[0] || {}).no, copy: /Copy|COPY/.test((window._printed[0] || {}).html || ''), lines: window.eval('S').pos.lines.length, qty: window.eval('S').pos.lines[0].qty, sales: window.eval('S').sales.length, focus: document.activeElement.id, modal: !!document.querySelector('.modal') }));
ok(cp.n === 1 && cp.no === lastNo && cp.copy, 'one press: that bill goes to the printer, marked Copy, no window to click through', JSON.stringify({ n: cp.n, no: cp.no, copy: cp.copy }));
ok(cp.lines === 1 && cp.qty === 2 && cp.sales === nSales && !cp.modal, 'the bill on the till stays, and no new bill is made', JSON.stringify(cp));
ok(cp.focus === 'csQ', 'the cursor is back in the code box for the next scan', cp.focus);
await pg.click('.sp-keys [data-act="spBillCopy"]'); await wait(300);
ok(await pg.evaluate(() => window._printed.length === 1), 'a double press does not print it twice');
const whichBill = await pg.evaluate(() => { const S = window.eval('S'), f = window.eval('lastBillHere'), keep = S.sales, t = S.terminal, mk = o => ({ no: 'X', lines: [{ pid: 1 }], total: 100, terminal: t, ...o });
  S.sales = [mk({ no: 'A' }), mk({ no: 'B', terminal: 'OTHER' }), mk({ no: 'R', returnOf: 'A', total: -100 }), mk({ no: 'O', lines: [] })]; const here = f().no;
  S.sales = [mk({ no: 'B', terminal: 'OTHER' })]; const other = f().no; S.sales = []; const none = f(); S.sales = keep; return { here, other, none: !!none } });
ok(whichBill.here === 'A' && whichBill.other === 'B' && !whichBill.none, "the last bill is this till's own, not a return or an opening balance; another till's if this one has none", JSON.stringify(whichBill));
await pg.evaluate(() => { const S = window.eval('S'); S.pos.lines = []; window.eval('render')() });
// Ctrl+M: a credit customer's payment
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); S.pos.lines = []; S.pos.customer = null; window.eval('render')() }); await wait(300);
const owes = await pg.evaluate(() => { const S = window.eval('S'), pb = window.eval('partyBal'); const c = S.customers.filter(x => x.id !== 1 && x.active !== false).sort((a, b) => pb('C', b.id) - pb('C', a.id))[0]; return { id: c.id, name: c.name, owe: pb('C', c.id) } });
await pg.keyboard.down('Control'); await pg.keyboard.press('m'); await pg.keyboard.up('Control'); await wait(400);
const pick = await pg.evaluate(() => { const m = document.querySelector('.modal'); return m && { title: m.querySelector('h2').innerText, first: (m.querySelector('tr.on b') || {}).textContent } });
ok(pick && /Customer payment/.test(pick.title) && pick.first === owes.name, 'Ctrl+M on a walk-in bill: the ones who owe, the most first', JSON.stringify({ pick, owes }));
await pg.keyboard.type(owes.name.split(' ')[0]); await wait(200); await pg.keyboard.press('Enter'); await wait(500);
ok(await pg.evaluate(n => { const h = document.querySelector('.modal h2'); return !!h && h.innerText.includes('Payment from ' + n) }, owes.name), 'type a name, Enter: their payment window', owes.name);
// type the amount, Enter: taken in cash and done (3 Nov 2026: Enter added it and asked for the rest)
const pBefore = await pg.evaluate(id => ({ owe: window.eval('partyBal')('C', id), n: window.eval('S').payments.length }), owes.id);
await pg.evaluate(() => { const r = document.getElementById('ra'); r.value = ''; r.focus() }); await pg.keyboard.type('1000'); await pg.keyboard.press('Enter'); await wait(900);
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const pAfter = await pg.evaluate(id => ({ owe: window.eval('partyBal')('C', id), n: window.eval('S').payments.length, last: window.eval('S').payments.at(-1) }), owes.id);
ok(pAfter.n === pBefore.n + 1 && Math.abs(pBefore.owe - pAfter.owe - 1000) < 0.01 && pAfter.last.method === 'CASH', 'a part payment: type 1000, Enter, and it is recorded (no second Enter, no F12)', JSON.stringify({ before: pBefore.owe, after: pAfter.owe }));
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
await pg.evaluate(id => { window.eval('S').pos.customer = id; window.eval('render')() }, owes.id); await wait(300);
await pg.click('.sp-keys [data-act="credPay"]'); await wait(500);
ok(await pg.evaluate(n => { const h = document.querySelector('.modal h2'); return !!h && h.innerText.includes('Payment from ' + n) }, owes.name), 'CREDIT PAY with a customer on the bill: straight to their payment window');
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('S').pos.customer = null; window.eval('go')('dashboard') }); await wait(500);
await pg.keyboard.down('Control'); await pg.keyboard.press('m'); await pg.keyboard.up('Control'); await wait(400);
ok(await pg.evaluate(() => /Customer payment/.test((document.querySelector('.modal h2') || {}).innerText || '')), 'Ctrl+M works from another screen too (the dashboard)');
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('go')('pos') }); await wait(400);
// Esc clears: with the cursor in the code box (where it always is), as CLEAR does (3 Nov 2026: Esc did nothing there)
const putLine = () => pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); const p = S.products.find(x => x.active !== false && x.stock > 10 && x.retail > 100); S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.customer = null; window.eval('go')('pos') });
await putLine(); await wait(400); await pg.focus('#csQ'); await pg.keyboard.type('abc'); await wait(150);
await pg.keyboard.press('Escape'); await wait(300);
ok(await pg.evaluate(() => document.getElementById('csQ').value === '' && window.eval('S').pos.lines.length === 1 && !document.querySelector('.modal')), 'Esc with something typed: wipes the typing, the bill stays');
await pg.keyboard.press('Escape'); await wait(400);
ok(await pg.evaluate(() => /Clear this bill/.test((document.querySelector('.modal') || {}).innerText || '')), 'Esc on the empty code box: "Clear this bill?"');
await pg.keyboard.press('Enter'); await wait(400);
ok(await pg.evaluate(() => window.eval('S').pos.lines.length === 0 && document.activeElement.id === 'csQ'), 'Enter: the bill is cleared, the cursor back in the code box');
await putLine(); await wait(400);
await pg.click('.sp-keys [data-act="csClear"]'); await wait(400); await pg.keyboard.press('Enter'); await wait(400);
ok(await pg.evaluate(() => window.eval('S').pos.lines.length === 0), 'CLEAR on the key strip, Enter: cleared');
// a short window (the Regal POS window on a 1366 x 768 screen): the small row shows its names, nothing scrolls
await pg.setViewport({ width: 1366, height: 698 });
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); const ps = S.products.filter(p => p.active !== false && p.retail > 100).slice(0, 3);
  S.pos.lines = ps.map(p => ({ pid: p.id, qty: 1, price: p.retail, disc: 0, name: 'A LONG NAME FOR A LINE ON THE BILL TO SEE IT WRAP AND NOT PUSH THE BUTTONS OFF' })); window.eval('render')() }); await wait(500);
const sh = await pg.evaluate(() => { const s = document.querySelector('.till-sum'), l = document.querySelector('.till-lines');
  const vis = [...document.querySelectorAll('.sum-more button')].filter(b => b.offsetParent).map(b => b.innerText.trim());
  return { vis, panel: s.scrollHeight - s.clientHeight, wide: l.scrollWidth - l.clientWidth } });
ok(sh.vis.includes('Quotation') && sh.vis.every(t => t.length > 2), 'short window: Quotation, Delivery note, Check bill, Brought by show their names', JSON.stringify(sh.vis));
ok(sh.panel <= 1 && sh.wide <= 1, 'short window: the panel and the bill fit, no scrolling', JSON.stringify(sh));
// the panel never scrolls: at any height, and with warnings on it. Everything in it is inside it.
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'), p = S.products.find(x => x.active !== false && x.retail > 100); S.pos.lines = [{ pid: p.id, qty: 1, price: p.retail, disc: 0 }]; S.pos.sel = 0; window.eval('render')() }); await wait(300);
const fits = () => pg.evaluate(() => { const s = document.querySelector('.till-sum'), r = s.getBoundingClientRect(), kids = [...s.querySelectorAll('.sum-net,.sp-paid,.sum-more button,#csBillDisc')].filter(e => e.offsetParent), low = Math.max(...kids.map(e => e.getBoundingClientRect().bottom));
  return { over: s.scrollHeight - s.clientHeight, cut: Math.round(low - r.bottom), bar: getComputedStyle(s).overflowY, zoom: s.style.zoom || '1', keys: Math.round(document.querySelector('.sp-keys').getBoundingClientRect().height) } });
for (const h of [900, 768, 698, 660, 640, 600, 560]) { await pg.setViewport({ width: 1366, height: h }); await wait(250); const r = await fits();
  ok(r.over <= 1 && r.cut <= 0 && r.bar === 'hidden', `${h} high: the whole panel shows, no scrollbar`, JSON.stringify(r)); }
await pg.setViewport({ width: 1366, height: 640 }); await wait(200);
await pg.evaluate(() => { const S = window.eval('S'); S.pos.billDisc = 10; S.pos.undoReprice = true; window.eval('render')() }); await wait(300);
const warn = await fits(); ok(warn.over <= 1 && warn.cut <= 0, 'with a discount and a notice added, it still fits', JSON.stringify(warn));
await pg.evaluate(() => { const S = window.eval('S'); S.pos.billDisc = 0; delete S.pos.undoReprice; window.eval('render')() });
await pg.setViewport({ width: 1366, height: 768 }); await wait(250);
ok(await pg.evaluate(() => !document.querySelector('.till-sum').style.zoom), 'back on a tall window it goes back to full size');
// switching back
await pg.evaluate(() => { window.eval('setPref')('tillLook', 'regal'); window.eval('render')() }); await wait(400);
ok(await pg.evaluate(() => !document.querySelector('.till.sp-look') && getComputedStyle(document.querySelector('.till-hold')).display !== 'none' && !document.querySelector('.sp-keys')), 'Regal red: the old look, Hold / Clear / Held back at the top');
await pg.evaluate(() => { window.eval('setPref')('tillLook', 'sepos'); window.eval('S').pos.lines = []; window.eval('S').heldBills = []; window.eval('render')() });
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
