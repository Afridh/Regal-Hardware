// Headless end-to-end run of the Regal app against the live server (jsdom).
//   node tools/e2e.mjs            (server must be running on :4000, books cleared)
import jsdom from 'jsdom';
const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

const BASE = process.env.E2E_BASE || 'http://localhost:4000';
let failures = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 50) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await sleep(step); } return null; }

// only our own server is fetched; Google Fonts etc. get an empty response
const localOnly = requestInterceptor(request => (request.url.startsWith(BASE) ? undefined : new Response('', { headers: { 'Content-Type': 'text/css' } })));
async function openTill(label, token) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/not implemented/i.test(e.message)) errors.push(e.message); });
  vc.on('error', m => errors.push(String(m)));
  const html = await (await fetch(BASE + '/pos')).text();
  const dom = new JSDOM(html, {
    url: BASE + '/pos', runScripts: 'dangerously', resources: { interceptors: [localOnly] }, pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (u, o) => fetch(new URL(String(u), BASE), o);
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      window.print = () => {}; window.confirm = () => true; window.prompt = (_m, d) => d ?? 'ok'; window.alert = () => {};
      window.HTMLCanvasElement.prototype.getContext = () => null;
      window.scrollTo = () => {}; window.Element.prototype.scrollIntoView = () => {};
      window.addEventListener('error', e => errors.push(e.message));
      if (token) window.localStorage.setItem('regal_token', token);
    },
  });
  await until(() => dom.window.S && dom.window.regalBridge, 10000);
  await sleep(300);
  return { dom, w: dom.window, d: dom.window.document, errors, label };
}

// ---------------------------------------------------------------- till A: first ever sign-in
const A = await openTill('A');
const { w, d } = A;
ok('A: app booted', !!w.S && typeof w.completeSale === 'function', `${w.S.products.length} products seeded`);
const lock = await until(() => d.getElementById('lockScreen'));
ok('A: lock screen shown first (server build)', !!lock);
if (d.getElementById('lockUser')) {
  d.getElementById('lockUser').value = 'Afridh';
  d.getElementById('lockUser').dispatchEvent(new w.Event('input'));
} else if (lock.querySelector('[data-user="Afridh"]')) {
  lock.querySelector('[data-user="Afridh"]').click();
}
await until(() => d.getElementById('lockPw'));
d.getElementById('lockPw').value = 'Afridh123';
d.getElementById('lockGo').click();
ok('A: signed in', !!(await until(() => !d.getElementById('lockScreen'))), `as ${w.S.user.name} (${w.S.user.role})`);
ok('A: bridge holds a token', w.regalBridge.online());
await sleep(1200);                                          // bootstrap persist (50ms) + debounce (400ms)
const tok = w.localStorage.getItem('regal_token');
const rev = await (await fetch(BASE + '/api/books/regal/rev', { headers: { Authorization: 'Bearer ' + tok } })).json();
ok('A: seed books pushed to PostgreSQL', rev.rev >= 1, `rev ${rev.rev} by ${rev.updated_by}`);

// menu + new screens render
ok('A: new menu items present', !!d.querySelector('[data-view="vouchers"]') && !!d.querySelector('[data-view="transfers"]'));
for (const v of ['dashboard', 'pos', 'vouchers', 'transfers', 'customers', 'settings', 'inventory', 'payroll', 'reports']) {
  w.go(v); await sleep(30);
  ok(`A: view ${v} renders`, d.getElementById('main').innerHTML.length > 500 && !A.errors.length, A.errors[0] || '');
}
// ---------------------------------------------------------------- customers page
{
  const key = (el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = (v) => { const q = d.getElementById('custQ'); q.value = v; q.dispatchEvent(new w.Event('input')); };
  const rows = () => [...d.querySelectorAll('.cu-row')].map(r => r.querySelector('.nm b').textContent);
  const selName = () => (d.querySelector('.cu-row.sel .nm b') || {}).textContent;
  w.go('customers'); await sleep(30);
  ok('C: list shows every customer with avatar and balance', rows().length === w.S.customers.filter(c => c.id !== 1).length && d.querySelectorAll('.cu-row .av').length === rows().length);
  ok('C: search box is focused on opening', d.activeElement && d.activeElement.id === 'custQ');
  type('gf'); ok('C: initials find "Green Field"', rows().length === 1 && rows()[0].startsWith('Green Field'), rows().join(', '));
  type('0765'); ok('C: digits find by mobile', rows().length === 1 && /Fernando/.test(rows()[0]), rows().join(', '));
  type('n c'); ok('C: word starts find "Nimal Constructions"', rows().some(r => r.startsWith('Nimal')), rows().join(', '));
  type(''); const all = rows(); key(d.getElementById('custQ'), 'ArrowDown'); await sleep(20);
  ok('C: ↓ moves the selection', selName() === all[1], selName());
  key(d.getElementById('custQ'), 'ArrowUp'); await sleep(20); ok('C: ↑ moves back', selName() === all[0]);
  const c2 = w.eval('C')(2); w.eval('custSel=2'); w.render(); await sleep(20);
  ok('C: header shows the customer with actions', /Nimal Constructions/.test(d.querySelector('.cu-head h2').textContent) && !!d.querySelector('[data-act="custEdit"]') && !!d.querySelector('[data-act="custBill"]'));
  ok('C: outstanding KPI matches the ledger', d.querySelector('.kpi .v').textContent.replace(/[^\d.]/g, '') === w.partyBal('C', 2).toFixed(2).replace(/[^\d.]/g, ''));
  for (const t of ['bills', 'payments', 'statement', 'details']) { d.querySelector(`[data-custtab="${t}"]`).click(); await sleep(20); ok(`C: ${t} tab renders`, d.querySelector('.cu-tabs button.on').dataset.custtab === t && d.querySelectorAll('.cu-tbl').length > 0 && !A.errors.length, A.errors[0] || ''); }
  d.querySelector('[data-custtab="statement"]').click(); await sleep(20);
  d.querySelector('[data-custrange="all"]').click(); await sleep(20);
  const last = [...d.querySelectorAll('.cu-tbl.stmt tr')].pop();
  ok('C: statement running balance ends at what they owe', !!last && last.textContent.replace(/[^\d.]/g, '').endsWith(w.partyBal('C', 2).toFixed(2).replace(/[^\d.]/g, '')), last && last.textContent.trim().slice(-30));
  const ledger = w.custLedger(2);
  ok('C: ledger debits − credits = balance', Math.abs(ledger.reduce((a, r) => a + r.dr - r.cr, 0) - w.partyBal('C', 2)) < 0.01);
  // add a customer from the page
  d.querySelector('[data-act="custNew"]').click(); await sleep(20);
  d.getElementById('cmName').value = 'Test Builders'; d.getElementById('cmPhone').value = '0711111111'; d.getElementById('cmLimit').value = '50000'; d.getElementById('cmLevel').value = 'wholesale';
  d.getElementById('cmOk').click(); await sleep(30);
  const nc = w.S.customers.find(c => c.name === 'Test Builders');
  ok('C: new customer added and selected', !!nc && nc.limit === 50000 && nc.level === 'wholesale' && w.eval('custSel') === nc.id && !d.querySelector('.modal'));
  d.querySelector('[data-act="custEdit"]').click(); await sleep(20);
  d.getElementById('cmAddr').value = 'Hingurakgoda'; d.getElementById('cmOk').click(); await sleep(20);
  ok('C: edit saves', nc.address === 'Hingurakgoda' && !d.querySelector('.modal'));
  d.querySelector('[data-act="custNew"]').click(); await sleep(20);
  d.getElementById('cmName').value = 'Dup'; d.getElementById('cmPhone').value = '0711111111'; d.getElementById('cmOk').click(); await sleep(20);
  ok('C: duplicate mobile refused', /already has/.test(d.getElementById('cmMsg').textContent)); w.closeModals();
  // taking a payment happens in place, not on another page
  // taking a payment happens in place, not on another page — in parts, like the old till
  w.eval('custSel=2; custTab="overview"'); w.render(); await sleep(20);
  const owedBefore = w.partyBal('C', 2), payN = w.S.payments.length;
  d.querySelector('.cu-acts [data-act="custPay"]').click(); await sleep(30);
  ok('C: Take a payment opens the window on the customers page', !!d.querySelector('.modal #ra') && w.S.view === 'customers' && d.activeElement.id === 'ra');
  ok('C: cash asks for nothing but the amount', !d.querySelector('.modal #sfNo') && !d.querySelector('.modal #rm'));
  d.getElementById('ra').value = '5000'; d.getElementById('ra').dispatchEvent(new w.Event('input'));
  const tick = d.querySelector('[data-pick]'); tick.checked = true; tick.dispatchEvent(new w.Event('change')); await sleep(20);
  ok('C: ticking a bill sets the amount to that bill', +d.getElementById('ra').value === w.S.sales.find(s => s.no === tick.dataset.pick).balance);
  d.getElementById('ra').value = '5000'; d.getElementById('ra').dispatchEvent(new w.Event('input'));
  key(d.getElementById('ra'), 'Enter'); await sleep(20);
  ok('C: Enter adds a cash part', d.querySelectorAll('.pay-part').length === 1 && /Cash/.test(d.querySelector('.pay-part').textContent));
  d.getElementById('rok').click(); await sleep(50); w.closeModals();
  ok('C: payment recorded and still on the customers page', w.S.payments.length === payN + 1 && Math.abs(w.partyBal('C', 2) - (owedBefore - 5000)) < 0.01 && w.S.view === 'customers' && /Nimal/.test(d.querySelector('.cu-head h2').textContent));
  // keys: F7 opens, Enter = cash for the amount, F12 completes; cheque only asks when chosen; several parts on one payment
  const keyDoc = (k, extra = {}) => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  const owed2 = w.partyBal('C', 2), payN2 = w.S.payments.length, chqN = w.S.cheques.length;
  keyDoc('F7'); await sleep(30);
  ok('C: F7 opens the payment window for the customer on screen', !!d.querySelector('.modal #ra') && /Nimal/.test(d.querySelector('.modal h2').textContent) && d.activeElement.id === 'ra');
  d.getElementById('ra').value = '2500'; d.getElementById('ra').dispatchEvent(new w.Event('input'));
  key(d.getElementById('ra'), 'Enter'); await sleep(20);
  ok('C: Enter on amount = cash part, cursor back on amount for the rest', d.querySelectorAll('.pay-part').length === 1 && d.activeElement.id === 'ra');
  const mk = (k) => d.querySelector('.modal').dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  d.getElementById('ra').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'F8', bubbles: true, cancelable: true })); await sleep(20);
  ok('C: F8 opens the cheque form, cursor on cheque number', !!d.getElementById('sfNo') && !!d.getElementById('sfDate') && !!d.getElementById('sfBank') && d.activeElement.id === 'sfNo');
  d.getElementById('sfAmt').value = '10000'; d.getElementById('sfNo').value = '556201';
  key(d.getElementById('sfNo'), 'Enter'); ok('C: Enter walks cheque no → date', d.activeElement.id === 'sfDate');
  key(d.getElementById('sfDate'), 'Enter'); ok('C: → bank', d.activeElement.id === 'sfBank');
  d.getElementById('sfBank').value = 'HNB Kaduruwela'; key(d.getElementById('sfBank'), 'Enter'); await sleep(20);
  ok('C: Enter on the last box adds the cheque part', d.querySelectorAll('.pay-part').length === 2 && /556201/.test(d.querySelectorAll('.pay-part')[1].textContent) && !d.getElementById('sfNo'));
  d.getElementById('ra').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true })); await sleep(20);
  ok('C: F9 opens the card form with our bank accounts', !!d.getElementById('sfInto') && d.getElementById('sfInto').options.length === w.S.banks.length);
  d.getElementById('sfAmt').value = '1000'; d.getElementById('sfOk').click(); await sleep(20);
  ok('C: three parts add up', d.querySelectorAll('.pay-part').length === 3 && /13,500/.test(d.querySelector('.pay-tot').textContent));
  d.getElementById('ra').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true })); await sleep(60); w.closeModals();
  const newPays = w.S.payments.slice(payN2);
  ok('C: F12 records one receipt per part', newPays.length === 3 && newPays.map(p => p.method).join() === 'CASH,CHEQUE,CARD' && Math.abs(w.partyBal('C', 2) - (owed2 - 13500)) < 0.01);
  ok('C: cheque recorded with its number, date and bank', w.S.cheques.length === chqN + 1 && w.S.cheques.at(-1).no === '556201' && w.S.cheques.at(-1).bank === 'HNB Kaduruwela');
  ok('C: card payment went into a bank account', newPays[2].bank === w.S.banks[0].id && w.bal(w.S.banks[0].ac) > 0);
  ok('C: ledger still balanced', (() => { const tb = Object.keys(w.GL).map(k => w.bal(k)); const dr = tb.filter(v => v > 0).reduce((a, v) => a + v, 0), cr = tb.filter(v => v < 0).reduce((a, v) => a - v, 0); return Math.abs(dr - cr) < 0.01; })());
  keyDoc('n', { ctrlKey: true }); await sleep(30);
  ok('C: Ctrl+N opens the new customer form', !!d.getElementById('cmName'));
  d.getElementById('cmName').value = 'Enter Stepper'; key(d.getElementById('cmName'), 'Enter'); ok('C: Enter steps name → mobile', d.activeElement.id === 'cmPhone');
  d.getElementById('cmPhone').value = '0722222222'; key(d.getElementById('cmPhone'), 'Enter'); key(d.getElementById('cmAddr'), 'Enter'); key(d.getElementById('cmLevel'), 'Enter');
  ok('C: … through to the limit box', d.activeElement.id === 'cmLimit');
  key(d.getElementById('cmLimit'), 'Enter'); key(d.getElementById('cmNotes'), 'Enter'); await sleep(30);
  ok('C: Enter on the last box saves the customer', !d.querySelector('.modal') && w.S.customers.some(c => c.name === 'Enter Stepper'));
  // clicking a customer shows a short "opening" beat, then the panel
  w.eval('custSel=2'); w.render(); await sleep(20);
  const row3 = d.querySelector('.cu-row[data-id="3"]'), name3 = row3.querySelector('.nm b').textContent; row3.click();
  ok('C: a loading spinner shows while switching customer', !!d.querySelector('.cu-loading'));
  await sleep(250);
  ok('C: then the chosen customer opens', w.eval('custSel') === 3 && !d.querySelector('.cu-loading') && d.querySelector('.cu-head h2').textContent.includes(name3), `sel ${w.eval('custSel')} head "${d.querySelector('.cu-head h2')?.textContent}" want "${name3}"`);
  w.eval('custSel=' + nc.id); w.render(); await sleep(20);
  d.querySelector('[data-act="custBill"]').click(); await sleep(30);
  ok('C: "New bill" opens the till with the customer on it', w.S.view === 'pos' && w.S.pos.customer === nc.id);
  w.S.pos.customer = null;
}

// ---------------------------------------------------------------- suppliers page (same shape as customers)
{
  const key = (el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const keyDoc = (k, extra = {}) => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  const type = (v) => { const q = d.getElementById('supQ'); q.value = v; q.dispatchEvent(new w.Event('input')); };
  const rows = () => [...d.querySelectorAll('.cu-row')].map(r => r.querySelector('.nm b').textContent);
  w.go('suppliers'); await sleep(30);
  ok('S: list shows every supplier with avatar and balance', rows().length === w.S.suppliers.length && d.querySelectorAll('.cu-row .av').length === rows().length);
  ok('S: buttons sit above the details', (() => { const h = d.querySelector('.cu-head'); return h && h.children[0].classList.contains('cu-acts') && h.children[1].classList.contains('cu-id'); })());
  ok('S: search box focused on opening', d.activeElement && d.activeElement.id === 'supQ');
  const rep = w.S.suppliers[1].contact.split(' ').pop().toLowerCase();
  type(rep); ok('S: finds by the rep\'s name', rows().length >= 1 && rows().some(r => r === w.S.suppliers[1].name), rows().join(', '));
  type(''); const iSel = rows().indexOf(d.querySelector('.cu-row.sel .nm b').textContent); key(d.getElementById('supQ'), 'ArrowDown'); await sleep(20);
  ok('S: ↓ moves the selection', d.querySelector('.cu-row.sel .nm b').textContent === rows()[Math.min(rows().length - 1, iSel + 1)], `from row ${iSel}`);
  w.eval('supSel=1'); w.render(); await sleep(20);
  ok('S: KPI matches the ledger', d.querySelector('.kpi .v').textContent.replace(/[^\d.]/g, '') === w.partyBal('S', 1).toFixed(2).replace(/[^\d.]/g, ''));
  for (const t of ['bills', 'payments', 'cheques', 'statement', 'details']) { d.querySelector(`[data-suptab="${t}"]`).click(); await sleep(20); ok(`S: ${t} tab renders`, d.querySelector('.cu-tabs button.on').dataset.suptab === t && d.querySelectorAll('.cu-tbl').length > 0 && !A.errors.length, A.errors[0] || ''); }
  d.querySelector('[data-suptab="statement"]').click(); await sleep(20); d.querySelector('[data-suprange="all"]').click(); await sleep(20);
  const last = [...d.querySelectorAll('.cu-tbl.stmt tr')].pop();
  ok('S: statement running balance ends at what we owe', !!last && last.textContent.replace(/[^\d.]/g, '').endsWith(w.partyBal('S', 1).toFixed(2).replace(/[^\d.]/g, '')));
  ok('S: ledger billed − paid = balance', Math.abs(w.supLedger(1).reduce((a, r) => a + r.billed - r.paid, 0) - w.partyBal('S', 1)) < 0.01);
  keyDoc('F7'); await sleep(30); ok('S: F7 opens Pay supplier', !!d.querySelector('.modal #pl') && /Pay /.test(d.querySelector('.modal h2').textContent)); w.closeModals();
  keyDoc('F8'); await sleep(30); ok('S: F8 prints the statement with a running balance', /SUPPLIER STATEMENT/.test(d.querySelector('.modal').innerHTML) && /Balance brought forward|Particulars/.test(d.querySelector('.modal').innerHTML)); w.closeModals();
  keyDoc('n', { ctrlKey: true }); await sleep(30);
  ok('S: Ctrl+N opens the new supplier form', !!d.getElementById('smName'));
  d.getElementById('smName').value = 'Lanka Tiles'; key(d.getElementById('smName'), 'Enter'); ok('S: Enter steps to the contact', d.activeElement.id === 'smContact');
  d.getElementById('smContact').value = 'Mr. Perera'; d.getElementById('smPhone').value = '0112223344'; d.getElementById('smDays').value = '45';
  d.getElementById('smOk').click(); await sleep(30);
  const ns = w.S.suppliers.find(s => s.name === 'Lanka Tiles');
  ok('S: supplier added and selected', !!ns && ns.days === 45 && ns.code === 'S' + String(w.S.suppliers.length).padStart(4, '0') && w.eval('supSel') === ns.id && !d.querySelector('.modal'));
  d.querySelector('[data-act="supEdit"]').click(); await sleep(20); d.getElementById('smAddr').value = 'Kaduruwela'; d.getElementById('smOk').click(); await sleep(20);
  ok('S: edit saves', ns.address === 'Kaduruwela');
  w.eval('supSel=1'); w.render(); await sleep(20);
  const r2 = d.querySelector('.cu-row[data-id="2"]'); r2.click();
  ok('S: loading beat on switching', !!d.querySelector('.cu-loading')); await sleep(250);
  ok('S: then the supplier opens', w.eval('supSel') === 2 && !d.querySelector('.cu-loading'));
  w.go('customers'); await sleep(20);
  ok('C: customer buttons sit above the details too', (() => { const h = d.querySelector('.cu-head'); return h && h.children[0].classList.contains('cu-acts'); })());
}

// ---------------------------------------------------------------- classic till keyboard flow
{
  const key = (el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const active = () => d.activeElement && (d.activeElement.id || d.activeElement.className);
  w.S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: w.S.pos.lastBill };
  w.go('pos'); await sleep(30);
  w.csStart(1); await sleep(20);
  // the name is a step of its own now: code → name → qty → price → discount
  ok('K: picking an item lands on the name', active() === 'csName');
  key(d.getElementById('csName'), 'Enter'); ok('K: Enter on the name goes to Qty', active() === 'csQty');
  key(d.getElementById('csQty'), 'ArrowRight'); ok('K: → from Qty goes to Price', active() === 'csPrice');
  key(d.getElementById('csPrice'), 'ArrowRight'); ok('K: → from Price goes to Discount', active() === 'csDisc');
  key(d.getElementById('csDisc'), 'ArrowLeft'); ok('K: ← from Discount goes back to Price', active() === 'csPrice');
  key(d.getElementById('csPrice'), 'ArrowLeft'); ok('K: ← from Price goes back to Qty', active() === 'csQty');
  key(d.getElementById('csQty'), 'Enter'); ok('K: Enter on Qty moves to Price, no line added', active() === 'csPrice' && w.S.pos.lines.length === 0);
  key(d.getElementById('csPrice'), 'Enter'); ok('K: Enter on Price moves to Discount, no line added', active() === 'csDisc' && w.S.pos.lines.length === 0);
  key(d.getElementById('csDisc'), 'Enter'); await sleep(20);
  ok('K: Enter on Discount puts the line on the bill', w.S.pos.lines.length === 1 && active() === 'csQ');
  w.csStart(2); await sleep(20); key(d.getElementById('csDisc'), 'Enter'); await sleep(20);
  w.csStart(3); await sleep(20); key(d.getElementById('csDisc'), 'Enter'); await sleep(20);
  ok('K: three lines on the bill', w.S.pos.lines.length === 3);
  // the same item again joins its line instead of making a new one
  w.csStart(2); await sleep(20); d.getElementById('csQty').value = '3'; d.getElementById('csQty').dispatchEvent(new w.Event('input')); key(d.getElementById('csDisc'), 'Enter'); await sleep(20);
  ok('K: same item keyed again is one line with the quantities added', w.S.pos.lines.length === 3 && w.S.pos.lines.filter(l => l.pid === 2).length === 1 && w.S.pos.lines.find(l => l.pid === 2).qty === 4 && w.S.pos.sel === w.S.pos.lines.findIndex(l => l.pid === 2));
  w.csStart(2); await sleep(20); d.getElementById('csPrice').value = String(w.eval('P')(2).retail - 50); d.getElementById('csPrice').dispatchEvent(new w.Event('input')); key(d.getElementById('csDisc'), 'Enter'); await sleep(20);
  ok('K: … but a different price stays a separate line', w.S.pos.lines.length === 4 && w.S.pos.lines.filter(l => l.pid === 2).length === 2);
  w.S.pos.lines.pop(); w.S.pos.sel = 2; w.render(); await sleep(20);
  key(d.getElementById('csQ'), 'ArrowDown'); await sleep(20);
  ok('K: ↓ from the item row lands on the bill (on the highlighted last line)', active() === 'till-lines' && w.S.pos.sel === 2, `sel ${w.S.pos.sel}`);
  key(d.activeElement, 'ArrowDown'); await sleep(20); ok('K: ↓ stops at the last line', w.S.pos.sel === 2 && d.querySelectorAll('.till-tbl tr.on').length === 1);
  key(d.activeElement, 'ArrowUp'); await sleep(20); ok('K: ↑ on the bill moves up', w.S.pos.sel === 1 && active() === 'till-lines');
  key(d.activeElement, 'ArrowUp'); await sleep(20); ok('K: ↑ again reaches the top line', w.S.pos.sel === 0);
  key(d.activeElement, 'ArrowDown'); await sleep(20); ok('K: ↓ on the bill moves down', w.S.pos.sel === 1);
  key(d.activeElement, 'F1'); await sleep(20); ok('K: F1 from the bill returns to the item box', active() === 'csQ' && w.eval('CS').focus === '');
  key(d.getElementById('csQ'), 'ArrowDown'); await sleep(20); ok('K: ↓ goes back to the line that was highlighted', active() === 'till-lines' && w.S.pos.sel === 1, `active ${active()} sel ${w.S.pos.sel} focus ${w.eval('CS').focus} q="${w.eval('CS').q}"`);
  key(d.activeElement, 'ArrowUp'); await sleep(20); key(d.activeElement, 'ArrowUp'); await sleep(20);
  ok('K: ↑ past the top line returns to the item box', active() === 'csQ');
  w.csStart(1); await sleep(20); key(d.getElementById('csPrice'), 'ArrowDown'); await sleep(20);
  ok('K: ↓ from Price lands on the bill too', active() === 'till-lines');
  // picking an item hides the match list
  const qb = d.getElementById('csQ'); qb.value = 'cement'; qb.dispatchEvent(new w.Event('input')); await sleep(20);
  ok('K: typing shows matches', d.querySelectorAll('#csHits [data-act="csPick"]').length > 0);
  w.csStart(1); await sleep(20);
  ok('K: match list gone once an item is picked', d.querySelectorAll('#csHits [data-act="csPick"]').length === 0 && active() === 'csName');
  // Space on a bill line: qty and price become boxes in the row
  key(d.getElementById('csName'), 'Enter');
  key(d.getElementById('csQty'), 'ArrowDown'); await sleep(20);
  w.S.pos.sel = 1; key(d.activeElement, ' '); await sleep(20);
  ok('K: Space opens the line in place', active() === 'lnQty' && w.eval('CS').editLine === 1 && !d.querySelector('.modal'));
  const line = w.S.pos.lines[1], wasPrice = line.price;
  d.getElementById('lnQty').value = '4'; d.getElementById('lnQty').dispatchEvent(new w.Event('input'));
  key(d.getElementById('lnQty'), 'Enter'); ok('K: Enter on qty goes to price', active() === 'lnPrice');
  key(d.getElementById('lnPrice'), 'ArrowLeft'); ok('K: ← goes back to qty', active() === 'lnQty');
  key(d.getElementById('lnQty'), 'ArrowRight'); ok('K: → goes to price', active() === 'lnPrice');
  d.getElementById('lnPrice').value = String(wasPrice + 10);
  key(d.getElementById('lnPrice'), 'Enter'); await sleep(20);
  ok('K: Enter on price saves and returns to the bill', line.qty === 4 && line.price === wasPrice + 10 && active() === 'till-lines' && w.eval('CS').editLine === null, `qty ${line.qty} price ${line.price} active ${active()}`);
  key(d.activeElement, ' '); await sleep(20); d.getElementById('lnQty').value = '9';
  key(d.getElementById('lnQty'), ' '); await sleep(20);
  ok('K: Space saves and leaves', line.qty === 9 && active() === 'till-lines');
  key(d.activeElement, ' '); await sleep(20); d.getElementById('lnQty').value = '1';
  key(d.getElementById('lnQty'), 'Escape'); await sleep(20);
  ok('K: Esc leaves without saving', line.qty === 9 && active() === 'till-lines' && !d.getElementById('lnQty'));
  w.S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: w.S.pos.lastBill }; w.eval("CS.focus=''; CS.pid=null");
  ok('K: no script errors during keyboard run', !A.errors.length, A.errors[0] || '');
}

w.go('settings'); w.setTab = undefined; // settings tabs are internal; check via button
const loyTab = [...d.querySelectorAll('[data-settab]')].find(b => b.dataset.settab === 'loyalty');
ok('A: loyalty settings tab exists', !!loyTab);
if (loyTab) { loyTab.click(); await sleep(30); ok('A: loyalty tab renders', /Points per Rs 100/.test(d.getElementById('main').innerHTML)); }

// ---------------------------------------------------------------- loyalty points on a sale
const S = w.S, P = w.eval('P'), C = w.eval('C'), extHere = w.eval('extHere');   // const arrows live in script scope, not on window
const nimal = C(2); nimal.points = 200; nimal.limit = 10e6;
const cement = P(1);
const before = { stock: cement.stock, points: nimal.points, pts6110: w.bal('6110') };
const inv1 = w.completeSale({ lines: [{ pid: 1, qty: 2, price: cement.retail, disc: 0 }], customerId: 2, pays: [{ method: 'POINTS', amount: 100 }, { method: 'CASH', amount: cement.retail * 2 - 100 }] });
ok('A: sale with points completes', !!inv1 && inv1.type === 'CASH', inv1.no);
ok('A: points spent (100 Rs = 100 pts)', nimal.points === before.points - 100 + (inv1.pointsEarned || 0), `points ${before.points} -> ${nimal.points}, earned ${inv1.pointsEarned}`);
ok('A: points earned on the balance', inv1.pointsEarned === Math.floor((inv1.total - 100) / 100));
ok('A: 6110 debited by the points spent', Math.abs(w.bal('6110') - before.pts6110 - 100) < 0.01);
ok('A: stock moved', cement.stock === before.stock - 2);
let tooMany = null; try { w.completeSale({ lines: [{ pid: 1, qty: 1, price: cement.retail, disc: 0 }], customerId: 2, pays: [{ method: 'POINTS', amount: 99999 }] }); } catch (e) { tooMany = e.message; }
ok('A: cannot spend more points than held', /only has/.test(tooMany || ''), tooMany);

// the printed bill, both layouts, as the old till printed them
{
  const h80 = w.billHtml(inv1, 'r80'), ha5 = w.billHtml(inv1, 'a5');
  ok('P: 80mm receipt has the old layout', /Invoice No :/.test(h80) && /Gross Total Rs\./.test(h80) && /Invoice Total Rs\./.test(h80) && /Payment Rs\./.test(h80) && /<svg class="bc"/.test(h80) && /No of Item \/ Qty/.test(h80) && /Authori[sz]ed By/i.test(h80));
  ok('P: A5 invoice has the old layout', /Invoice No/.test(ha5) && /Invoice By/.test(ha5) && /<th>Code<\/th>/.test(ha5) && /D\.Price/.test(ha5) && /Gross Total/.test(ha5) && /- Inv\.Discount/.test(ha5) && /Net Total/.test(ha5) && /Amount Paid/.test(ha5) && /CHANGE RS\.|CREDIT RS\./.test(ha5) && /Authorised By/.test(ha5) && /Received By/.test(ha5));
  ok('P: bill date is the local date', w.D(w.today) === new Date().toLocaleDateString('en-CA'));
  // the bill is set up under Settings → What the bill shows: logo, names, wording, what appears
  w.eval("setTab='layout'"); w.go('settings'); await sleep(40);
  ok('P: bill design tab shows both live samples and the logo box', d.querySelectorAll('.billprev .print').length === 2 && !!d.getElementById('logoFile') && !!d.querySelector('[data-set="shop.name"]') && !!d.querySelector('[data-set="bill.footer"]'));
  w.eval("CFG.shop.logo='data:image/png;base64,iVBORw0KGgo='; CFG.shop.name='TEST STORES'; CFG.bill.showBarcode=false; CFG.bill.signLeft='Cashier'; CFG.bill.t80Thanks='Come back soon'");
  const h80b = w.billHtml(inv1, 'r80'), ha5b = w.billHtml(inv1, 'a5');
  ok('P: logo, name, wording and toggles all reach the printed bill', /<img src="data:image\/png/.test(h80b) && /TEST STORES/.test(h80b) && !/<svg class="bc"/.test(h80b) && /Cashier/.test(h80b) && /Come back soon/.test(h80b) && /<img src="data:image\/png/.test(ha5b) && /TEST<\/span> STORES/.test(ha5b) && /Cashier/.test(ha5b));
  w.eval("CFG.bill.showCode=false; CFG.bill.showMrp=false");
  ok('P: A5 columns follow the toggles', !/<th>Code<\/th>/.test(w.billHtml(inv1, 'a5')) && !/>MRP</.test(w.billHtml(inv1, 'a5')) && />Price</.test(w.billHtml(inv1, 'a5')));
  w.eval("CFG.shop.logo=''; CFG.shop.name='REGAL HARDWARE'; CFG.bill.showBarcode=true; CFG.bill.signLeft='Authorised By'; CFG.bill.showCode=true; CFG.bill.showMrp=true; CFG.bill.t80Thanks='Thank you, come again!'");
  let printed = 0; w.print = () => { printed++; }; w.eval("CFG.print.agent=''"); w.printBill(inv1, 'r80'); await sleep(200);
  ok('P: printBill goes straight to print with the receipt page size', printed === 1 && /size:80mm \d+mm/.test(d.getElementById('printPage')?.textContent || '') && d.body.classList.contains('direct-print'));
  w.dispatchEvent(new w.Event('afterprint')); await sleep(400);
  ok('P: … stays while the print box is open', !!d.getElementById('printArea'));
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'F3', bubbles: true })); await sleep(20);
  ok('P: … and clears up once you are back at the till', !d.getElementById('printArea') && !d.body.classList.contains('direct-print'));
}

// trial balance still balances
const tb = Object.keys(w.GL).map(k => w.bal(k)); const dr = tb.filter(v => v > 0).reduce((a, v) => a + v, 0), cr = tb.filter(v => v < 0).reduce((a, v) => a - v, 0);
ok('A: ledger balanced after points sale', Math.abs(dr - cr) < 0.01, `${dr.toFixed(2)} / ${cr.toFixed(2)}`);

// ---------------------------------------------------------------- gift voucher: sell, spend, void
w.go('vouchers'); await sleep(30);
d.querySelector('[data-act="gvNew"]').click(); await sleep(30);
d.getElementById('gvAmt').value = '2500'; d.getElementById('gvHolder').value = 'Mrs Silva';
d.getElementById('gvOk').click(); await sleep(50);
const gv = S.vouchers[0];
ok('A: voucher sold', !!gv && gv.amount === 2500 && gv.status === 'open', gv?.code);
ok('A: voucher liability posted (2060)', Math.abs(-w.bal('2060') - 2500) < 0.01);
w.closeModals();
const inv2 = w.completeSale({ lines: [{ pid: 2, qty: 1, price: P(2).retail, disc: 0 }], customerId: 1, pays: [{ method: 'VOUCHER', amount: 1000, code: gv.code }, { method: 'CASH', amount: P(2).retail - 1000 }] });
ok('A: sale paid partly by voucher', !!inv2 && gv.balance === 1500 && gv.redeemed.length === 1, `${inv2.no} Â· voucher left ${gv.balance}`);
ok('A: 2060 down by the amount used', Math.abs(-w.bal('2060') - 1500) < 0.01);
let badV = null; try { w.completeSale({ lines: [{ pid: 2, qty: 1, price: P(2).retail, disc: 0 }], customerId: 1, pays: [{ method: 'VOUCHER', amount: 5000, code: gv.code }] }); } catch (e) { badV = e.message; }
ok('A: cannot overspend a voucher', /only has/.test(badV || ''), badV);
w.gvVoid(gv.code);
ok('A: voucher voided, liability cleared', gv.status === 'void' && Math.abs(w.bal('2060')) < 0.01);

// ---------------------------------------------------------------- locations & transfers
ok('A: two locations seeded', S.locations.length === 2, S.locations.map(l => l.name).join(', '));
const nails = P(23); const here = extHere(nails); const total = nails.stock;
w.go('transfers'); await sleep(30);
ok('A: transfers view shows both locations', /Store room/.test(d.getElementById('main').innerHTML));
d.querySelector('[data-act="trfNew"]').click(); await sleep(30);
d.getElementById('trfFrom').value = '1'; d.getElementById('trfTo').value = '2';
const q = d.getElementById('trfQ'); q.value = nails.code; q.dispatchEvent(new w.Event('input')); await sleep(30);
d.querySelector('[data-tadd]').click(); await sleep(30);
const qtyIn = d.querySelector('[data-tq]'); qtyIn.value = '10'; qtyIn.dispatchEvent(new w.Event('change')); await sleep(30);
d.getElementById('trfOk').click(); await sleep(50);
ok('A: transfer recorded', S.transfers.length === 1 && S.transfers[0].lines[0].qty === 10, S.transfers[0]?.no);
ok('A: stock split moved, total unchanged', extHere(nails) === here - 10 && nails.stock === total && nails.locs[2] >= 10, JSON.stringify(nails.locs));
w.closeModals();
// sell more than is at this location -> refused, even though the shop holds it elsewhere
let short = null; try { w.completeSale({ lines: [{ pid: 23, qty: extHere(nails) + 1, price: nails.retail, disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: (extHere(nails) + 1) * nails.retail }] }); } catch (e) { short = e.message; }
ok('A: sale refused when the till\'s location is short', /elsewhere/.test(short || ''), short);
// switch this till to the store room and sell from there
w.extUseLocation(2); const atStore = extHere(nails);
const inv3 = w.completeSale({ lines: [{ pid: 23, qty: 3, price: nails.retail, disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: nails.retail * 3 }] });
ok('A: sale from the store room deducts there', !!inv3 && extHere(nails) === atStore - 3 && nails.locs[1] === here - 10, JSON.stringify(nails.locs));
w.extUseLocation(1);

// ---------------------------------------------------------------- persistence to the server
w.persist(); await sleep(900);
const saved = await (await fetch(BASE + '/api/books/regal', { headers: { Authorization: 'Bearer ' + tok } })).json();
ok('A: books saved to server', saved.rev > rev.rev, `rev ${saved.rev}`);
ok('A: vouchers + transfers + points in the saved books', saved.data.S.vouchers.length === 1 && saved.data.S.transfers.length === 1 && saved.data.S.customers.find(c => c.id === 2).points === nimal.points, `vouchers ${saved.data.S.vouchers.length} transfers ${saved.data.S.transfers.length} points ${saved.data.S.customers.find(c => c.id === 2).points}/${nimal.points} local vouchers ${S.vouchers.length}`);
ok('A: per-till state stripped from the shared books', saved.data.S.user === undefined && saved.data.S.pos === undefined && saved.data.S.locId === undefined && saved.data.S.terminal === undefined);
ok('A: no script errors so far', A.errors.length === 0, A.errors.slice(0, 2).join(' | '));

// ---------------------------------------------------------------- SMS: test mode holds every number but the listed ones
{
  const j = async (path, opts = {}) => { const r = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: opts.body ? JSON.stringify(opts.body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  w.eval("CFG.msg.live=true; CFG.msg.apiUrl='https://smslenz.lk/api'; CFG.msg.apiKey='not-a-real-key'; CFG.msg.userId='0'; CFG.msg.testOnly='0777849964'"); w.persist(true); await sleep(900);
  const held = await j('/api/sms/send', { method: 'POST', body: { to: '0771234501', message: 'x' } });
  ok('M: a number outside test mode is held, nothing sent', held.held === true && /Held/.test(held.status));
  const tried = await j('/api/sms/send', { method: 'POST', body: { to: '0777849964', message: 'x' } });
  ok('M: the listed number is sent to the provider (refused here: fake key)', tried.ok === false && /Provider|Failed/.test(tried.status) && !tried.held, tried.status);
  // WhatsApp: held by the same test mode, and the webhook that brings replies in
  const waHeld = await j('/api/wa/send', { method: 'POST', body: { to: '0771234501', message: 'x' } });
  ok('M: WhatsApp respects test mode', waHeld.held === true);
  const waNo = await j('/api/wa/send', { method: 'POST', body: { to: '0777849964', template: { name: 'hello_world', lang: 'en_US' } } });
  ok('M: WhatsApp without credentials says what is missing', waNo.ok === false && /not set up/.test(waNo.status), waNo.status);
  w.eval("CFG.msg.waVerifyToken='e2e-verify'"); w.persist(true); await sleep(900);
  const bad = await fetch(BASE + '/api/wa/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc');
  const good = await fetch(BASE + '/api/wa/webhook?hub.mode=subscribe&hub.verify_token=e2e-verify&hub.challenge=abc123');
  ok('M: webhook verifies only with the shop\'s token', bad.status === 403 && good.status === 200 && (await good.text()) === 'abc123');
  const hook = await fetch(BASE + '/api/wa/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '94771234501', profile: { name: 'Nimal' } }], messages: [{ id: 'wamid.e2e.' + Date.now(), from: '94771234501', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Is my order ready?' } }] } }] }] }) });
  const inbox = await j('/api/wa/inbox');
  ok('M: a customer\'s WhatsApp reply lands in the inbox', hook.status === 200 && inbox.ok && inbox.inbox.some(r => r.from_no === '94771234501' && /order ready/.test(r.body)) && inbox.unread >= 1);
  w.eval("CFG.msg.live=false; CFG.msg.apiKey=''; CFG.msg.testOnly=''; CFG.msg.waVerifyToken=''"); w.persist(true); await sleep(900);
}

// ---------------------------------------------------------------- the public shop site (regalhw.lk)
let webNo = null;
{
  const j = async (path, opts = {}) => { const r = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const home = await (await fetch(BASE + '/')).text();
  ok('W: / is the customer shop page', /Regal Hardware/.test(home) && /api\/shop/.test(home) && !/csQ/.test(home));
  const pos = await (await fetch(BASE + '/pos')).text();
  ok('W: /pos is the staff system', /csQ|shopLock/.test(pos));
  const cat = await j('/api/shop/catalog');
  ok('W: catalogue is public and has no cost figures', cat.status === 200 && cat.products.length > 10 && cat.products.every(p => p.cost === undefined) && cat.settings.open === true, `${cat.products.length} products`);
  const noAuth = await j('/api/shop/order', { method: 'POST', body: { lines: [] } });
  ok('W: ordering needs a mobile sign-in', noAuth.status === 401);
  const otp = await j('/api/shop/otp', { method: 'POST', body: { phone: '0771234567' } });
  ok('W: code issued (returned because SMS is off)', otp.status === 200 && otp.sent === false && /^\d{6}$/.test(otp.code), otp.code);
  const badLogin = await j('/api/shop/login', { method: 'POST', body: { phone: '0771234567', code: '000000' } });
  ok('W: wrong code refused', badLogin.status === 401);
  const first = await j('/api/shop/login', { method: 'POST', body: { phone: '0771234567', code: otp.code } });
  ok('W: new customer is asked for a name', first.status === 200 && first.needName === true);
  const login = await j('/api/shop/login', { method: 'POST', body: { phone: '0771234567', code: otp.code, name: 'Sunil Perera' } });
  ok('W: signed in with mobile + code', login.status === 200 && !!login.token && login.name === 'Sunil Perera');
  const H = { Authorization: 'Bearer ' + login.token };
  const p1 = cat.products.find(p => p.stock > 2);
  const order = await j('/api/shop/order', { method: 'POST', headers: H, body: { lines: [{ pid: p1.id, qty: 2 }], deliver: true, address: '12 Temple Road', note: 'call first' } });
  webNo = order.no;
  ok('W: order placed', order.status === 200 && /^ONL-\d{5}$/.test(order.no || '') && Math.abs(order.total - (2 * p1.price + (2 * p1.price < cat.settings.freeOver ? cat.settings.delivery : 0))) < 0.01, `${order.no} ${order.total}`);
  const me = await j('/api/shop/me', { headers: H });
  ok('W: my orders shows it, with the shop', me.status === 200 && me.orders.some(o => o.no === order.no && o.status === 'placed'));
  const askP = await j('/api/shop/ask', { method: 'POST', body: { q: 'price of ' + p1.name.split(' ')[0].toLowerCase() } });
  ok('W: ask-us answers a price question', askP.status === 200 && askP.answer.includes(p1.name));
  const askO = await j('/api/shop/ask', { method: 'POST', headers: H, body: { q: 'where is my order' } });
  ok('W: ask-us tracks the order when signed in', askO.status === 200 && askO.answer.includes(order.no));
  // the till sees it: rev unchanged but inbox > 0, the next poll pulls it and saves
  const rv = await j('/api/books/regal/rev', { headers: { Authorization: 'Bearer ' + tok } });
  ok('W: till is told about the inbox', rv.inbox === 1, `inbox ${rv.inbox}`);
  const onA = await until(() => A.w.S.web.orders.some(o => o.no === order.no), 20000, 500);
  ok('A: online order arrived in Online orders by polling', !!onA);
  const cust = A.w.S.customers.find(c => c.phone === '0771234567');
  ok('A: customer created from the website order', !!cust && cust.name === 'Sunil Perera' && A.w.S.web.orders.find(o => o.no === order.no).cid === cust.id);
  ok('A: bell rang for it', A.w.S.notif.some(n => n.kind === 'order' && n.text.includes('Sunil')));
  await sleep(1200);
  const rv2 = await j('/api/books/regal/rev', { headers: { Authorization: 'Bearer ' + tok } });
  ok('W: inbox cleared once the till saved the books', rv2.inbox === 0, `inbox ${rv2.inbox}`);
  // the shop accepts it; the customer sees the new status
  A.w.S.web.orders.find(o => o.no === order.no).status = 'accepted'; A.w.persist(); await sleep(900);
  const me2 = await j('/api/shop/me', { headers: H });
  ok('W: customer sees the shop\'s status change', me2.orders.find(o => o.no === order.no).status === 'accepted');
  const cat2 = await j('/api/shop/catalog');
  ok('W: accepted order holds stock on the site', cat2.products.find(p => p.id === p1.id).stock === p1.stock - 2);
  // pictures: staff put them up, the site gets a cacheable link, nobody else may write
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const noStaff = await j('/api/shop/media/p:' + p1.id, { method: 'POST', body: { dataUrl: png } });
  ok('W: a picture needs a staff sign-in', noStaff.status === 401);
  const up = await j('/api/shop/media/p:' + p1.id, { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: { dataUrl: png } });
  const cat3 = await j('/api/shop/catalog');
  const img = cat3.products.find(p => p.id === p1.id).img;
  const got = await fetch(BASE + img);
  ok('W: product photo is on the site', up.status === 200 && /^\/api\/shop\/media\/p%3A\d+\?v=\d+$/.test(img) && got.status === 200 && got.headers.get('content-type') === 'image/png' && /immutable/.test(got.headers.get('cache-control')), img);
  const bad = await j('/api/shop/media/x:1', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: { dataUrl: png } });
  ok('W: only known picture slots are accepted', bad.status === 400);
  const rm = await j('/api/shop/media/p:' + p1.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
  const cat4 = await j('/api/shop/catalog');
  ok('W: photo taken down again', rm.removed === 1 && cat4.products.find(p => p.id === p1.id).img === '' && cat4.categories.length > 0 && typeof cat4.products[0].sold === 'number');
  const track = await j('/api/shop/track', { method: 'POST', body: { no: order.no, phone: '0771234567' } });
  const trackBad = await j('/api/shop/track', { method: 'POST', body: { no: order.no, phone: '0770000000' } });
  ok('W: order tracked by number + mobile, not by number alone', track.status === 200 && track.order.status === 'accepted' && trackBad.status === 404);
}

// ---------------------------------------------------------------- the suppliers' page
{
  const j = async (path, opts = {}) => { const r = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const page = await (await fetch(BASE + '/supplier')).text();
  ok('S: /supplier is the suppliers\' page', /api\/sup/.test(page) && /Send an order/.test(page));
  const sup = A.w.S.suppliers.find(s => /^0\d{9}$/.test((s.phone || '').replace(/\D/g, '')));
  const phone = sup.phone.replace(/\D/g, '');
  const stranger = await j('/api/sup/otp', { method: 'POST', body: { phone: '0700000000' } });
  ok('S: a mobile not on any supplier is refused', stranger.status === 404);
  const otp = await j('/api/sup/otp', { method: 'POST', body: { phone } });
  const login = await j('/api/sup/login', { method: 'POST', body: { phone, code: otp.code, rep: 'Silva' } });
  ok('S: rep signs in with the supplier\'s mobile', otp.status === 200 && login.status === 200 && login.sid === sup.id && login.rep === 'Silva', login.supplier);
  const H = { Authorization: 'Bearer ' + login.token };
  // 1. the rep took an order by hand: photo + note → waits for the owner
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const up = await j('/api/sup/order', { method: 'POST', headers: H, body: { text: '20 bags cement, 10 lengths 25mm PVC', photos: [png, png] } });
  ok('S: hand-written order uploaded with photos', up.status === 200 && up.photos === 2, JSON.stringify(up));
  const me1 = await j('/api/sup/me', { headers: H });
  ok('S: rep sees it as reaching the shop', me1.sent.some(o => o.waiting && o.photos === 2));
  const landed = await until(() => A.w.S.orders.find(o => o.id === 'sp' + up.id), 20000, 500);
  ok('A: it landed in Supplier orders by polling, pending, with photo links', !!landed && landed.status === 'pending' && landed.files.length === 2 && /\/api\/sup\/photo\/\d+\?k=/.test(landed.files[0]) && landed.src === 'portal');
  const pic = await fetch(BASE + landed.files[0]);
  ok('A: photo opens from its signed link, not without it', pic.status === 200 && pic.headers.get('content-type') === 'image/png' && (await fetch(BASE + landed.files[0].split('?')[0])).status === 404);
  ok('A: approvers are told', A.w.S.notif.some(n => n.forApprovers && /needs the owner/.test(n.text)));
  A.w.ordAct('sp' + up.id, 'accepted', 'ok — Thursday'); A.w.persist(); await sleep(1000);
  const me2 = await j('/api/sup/me', { headers: H });
  ok('S: rep sees the owner\'s approval', me2.sent.some(o => o.id === 'sp' + up.id && o.status === 'accepted' && /Thursday/.test(o.note)));
  // 2. the shop writes an order with an item it has never carried; the rep confirms and dispatches it
  A.w.eval(`poDraft={sid:${sup.id},lines:[{pid:null,desc:'Galvanised bucket 15L',unit:'pcs',qty:12,est:450,known:false}],note:'with the Thursday lorry',want:'',q:''}; sendPO(); closeModals()`);
  const po = A.w.S.orders.find(o => o.dir === 'OUT' && o.sid === sup.id);
  ok('A: order to the supplier written with an item not on the system', !!po && po.lines[0].known === false && po.status === 'sent', po && po.no);
  A.w.persist(); await sleep(1000);
  const me3 = await j('/api/sup/me', { headers: H });
  ok('S: rep sees the shop\'s order with the new item', me3.pos.some(o => o.no === po.no && o.lines[0].desc === 'Galvanised bucket 15L' && !o.lines[0].known));
  const acc = await j('/api/sup/po/' + po.no + '/respond', { method: 'POST', headers: H, body: { action: 'accepted', note: 'Thursday it is' } });
  const disp = await j('/api/sup/po/' + po.no + '/respond', { method: 'POST', headers: H, body: { action: 'dispatched', invoice: 'INV-4521', eta: '2026-09-25' } });
  ok('S: rep confirms and marks it dispatched with their invoice number', acc.status === 200 && disp.status === 200);
  const arrived = await until(() => { const o = A.w.S.orders.find(x => x.no === po.no); return o && o.status === 'dispatched' ? o : null; }, 20000, 500);
  ok('A: the order shows dispatched with the invoice number and both events', !!arrived && arrived.invoiceNo === 'INV-4521' && arrived.events.filter(e => e.actor === 'supplier').length === 2, arrived && JSON.stringify(arrived.events.map(e => e.action)));
  A.w.persist(); await sleep(900);
  const pending = await j('/api/sup/me', { headers: H });
  ok('S: nothing left pending once the till has saved', !pending.sent.some(o => o.waiting) && !pending.pos.find(o => o.no === po.no).events.some(e => e.pending));
}

// ---------------------------------------------------------------- quotation requests & tenders, and the files behind them
{
  const j = async (path, opts = {}) => { const r = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const H = { Authorization: 'Bearer ' + tok };
  A.w.eval(`S.tenders=[]; S.tenders.unshift({id:'t1',no:tdNo('RFQ'),status:'received',org:'Divisional Secretariat',orgType:'gov',ref:'DS/1',subject:'Cement',contact:'',phone:'',email:'ds@example.lk',address:'',received:D(today),via:'post',closing:ago(-2),priceLevel:'wholesale',lines:[],files:[],terms:{validDays:30},events:[]}); tdSel='t1'; go('tenders')`);
  ok('T: the request shows on the tenders page with its closing date', /Divisional Secretariat/.test(A.d.body.textContent) && /closes in 2 days/.test(A.d.body.textContent));
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const noAuth = await j('/api/files', { method: 'POST', body: { kind: 'tender', ref: 't1', name: 'letter.png', dataUrl: png } });
  const up = await j('/api/files', { method: 'POST', headers: H, body: { kind: 'tender', ref: 't1', name: 'letter.png', dataUrl: png } });
  ok('T: the letter is attached (staff only)', noAuth.status === 401 && up.status === 200 && /^\/api\/files\/\d+\?k=/.test(up.url), up.url);
  const got = await fetch(BASE + up.url), bad = await fetch(BASE + up.url.split('?')[0]);
  ok('T: attachment opens from its signed link only', got.status === 200 && got.headers.get('content-type') === 'image/png' && bad.status === 404);
  const exe = await j('/api/files', { method: 'POST', headers: H, body: { kind: 'tender', ref: 't1', name: 'x.exe', dataUrl: 'data:application/x-msdownload;base64,AAAA' } });
  ok('T: only documents and pictures are accepted', exe.status === 400);
  A.w.eval(`const t=S.tenders[0]; const p=S.products[0]; t.lines.push({pid:p.id,desc:p.name,unit:p.unit,qty:10,price:p.wholesale,remark:''},{pid:null,desc:'River sand 3 cube',unit:'load',qty:1,price:30000,remark:'to site'}); tenderPrint(t); closeModals()`);
  const t1 = A.w.S.tenders[0];
  ok('T: quotation numbered and priced, with an item not on the system', /^QTN-\d{5}$/.test(t1.quoteNo) && t1.status === 'priced' && A.w.eval('tdTotal(S.tenders[0])') === 10 * A.w.S.products[0].wholesale + 30000, t1.quoteNo);
  A.w.eval(`const t=S.tenders[0]; t.submitted={date:D(today),via:'email',ref:'',note:'',by:S.user.name,total:tdTotal(t)}; t.status='submitted'; tdEvent(t,'Submitted'); render()`);
  A.w.eval(`const t=S.tenders[0]; t.result={date:D(today),amount:tdTotal(t)}; t.status='won'; tdEvent(t,'Won'); render()`);
  ok('T: submission and result recorded, win rate shows', A.w.S.tenders[0].status === 'won' && /Win rate/.test(A.d.body.textContent) && /100%/.test(A.d.body.textContent));
  const mail = await j('/api/files/mail/send', { method: 'POST', headers: H, body: { to: 'ds@example.lk', subject: 'x', text: 'y' } });
  ok('T: emailing says what is missing until SMTP is set up', mail.status === 400 && /not set up/.test(mail.error || ''), mail.error);
  A.w.eval(`S.tenders=[]; go('dashboard')`);
}

// ---------------------------------------------------------------- the privacy screen
{
  const real = A.w.S.sales, realN = real.length, realJ = A.w.S.journal.length, revBefore = (await (await fetch(BASE + '/api/books/regal/rev', { headers: { Authorization: 'Bearer ' + tok } })).json()).rev;
  A.w.eval("CFG.privacy.on=true; CFG.privacy.pct=40; CFG.privacy.hideCredit=true; go('dashboard'); privacyToggle()");
  ok('P: privacy screen shows fewer bills and no credit', A.w.privacyOn === true && A.w.S.sales.length < realN && A.w.S.sales.length > 0 && !A.w.S.sales.some(s => s.balance > 0) && A.w.S.journal.length < realJ, `${A.w.S.sales.length} of ${realN}`);
  let refused = '';
  try { A.w.completeSale({ lines: [{ pid: 23, qty: 1, price: 100, disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: 100 }] }); } catch (e) { refused = e.message; }
  ok('P: nothing can be billed while it is up', /busy/.test(refused), refused);
  A.w.persist(true); await sleep(900);
  const revAfter = (await (await fetch(BASE + '/api/books/regal/rev', { headers: { Authorization: 'Bearer ' + tok } })).json()).rev;
  ok('P: nothing is saved while it is up', revAfter === revBefore, `rev ${revBefore} → ${revAfter}`);
  A.w.eval("privacyToggle()");
  ok('P: the key again brings the real books straight back', A.w.privacyOn === false && A.w.S.sales === real && A.w.S.sales.length === realN && A.w.S.journal.length === realJ);
  A.w.eval("CFG.privacy.on=false");
}

// ---------------------------------------------------------------- till B: another PC, same books
// the owner puts a plain cashier on the roll for the other till to use
A.w.eval(`(function(){ if(!S.users.some(u=>u.name==='Ravi')) S.users.push({name:'Ravi',role:'Cashier',uid:'KS',pin:'',passHash:hashSync('ravi123'),perms:[...ROLE_DEFAULTS.Cashier],active:true,lastSeen:null,prefs:{...PREF_DEFAULTS}}); })()`);
A.w.persist(true); await sleep(1200);

const B = await openTill('B');
const lockB = await until(() => B.d.getElementById('lockScreen'));
const staffB = () => [...lockB.querySelectorAll('[data-user]')].map(b => b.dataset.user);   // older lock screen listed them as buttons
ok('B: fresh browser gets the lock screen and knows the staff', !!lockB && (!!B.d.getElementById('lockUser') || (staffB().includes('Afridh') && staffB().includes('Ravi'))),
  B.d.getElementById('lockUser') ? 'name and password asked for' : staffB().join(', '));
if (B.d.getElementById('lockUser')) {
  B.d.getElementById('lockUser').value = 'Ravi';
  B.d.getElementById('lockUser').dispatchEvent(new B.w.Event('input'));
} else {
  lockB.querySelector('[data-user="Ravi"]').click();
}
await until(() => B.d.getElementById('lockPw'));
B.d.getElementById('lockPw').value = 'wrong'; B.d.getElementById('lockGo').click(); await sleep(400);
ok('B: wrong password refused', !!B.d.getElementById('lockScreen') && /not right/.test(B.d.getElementById('lockMsg').textContent));
B.d.getElementById('lockPw').value = 'ravi123'; B.d.getElementById('lockGo').click();
ok('B: cashier signed in', !!(await until(() => !B.d.getElementById('lockScreen'))), `${B.w.S.user.name} Â· ${B.w.S.user.role} Â· ${B.w.S.user.perms.length} perms`);
await sleep(300);
ok('B: sees till A\'s voucher, transfer and bills', B.w.S.vouchers.length === 1 && B.w.S.transfers.length === 1 && B.w.S.sales.some(s => s.no === inv1.no), `${B.w.S.sales.length} bills`);
ok('B: sees the website order once, not twice', B.w.S.web.orders.filter(o => o.no === webNo).length === 1);
ok('B: keeps its own signed-in user (not A\'s)', B.w.S.user.name === 'Ravi');
ok('B: cashier cannot open Users', !B.w.allowed('users') && B.w.allowed('pos'));

// ---------------------------------------------------------------- approvals: the cashier asks, the owner decides
{
  const CB = B.w.eval('C'), CA = A.w.eval('C');
  const wasPortal = !!CB(2).portal;
  B.w.eval('custSel=2; custTab="overview"'); B.w.go('customers'); await sleep(30);
  B.d.querySelector('[data-act="custPortal"][data-id="2"]').click(); await sleep(30);
  const req0 = (B.w.S.approvals || []).find(a => a.status === 'pending' && a.by === 'Ravi' && a.kind === 'custPortal');
  ok('B: cashier cannot switch a portal — a request is made instead', !!CB(2).portal === wasPortal && !!req0 && (B.w.S.approvals || []).filter(a => a.status === 'pending').length === 1, JSON.stringify((B.w.S.approvals||[]).map(a=>[a.kind,a.status,a.by])));
  ok('B: menu shows the waiting badge', /nbadge/.test(B.d.querySelector('[data-view="approvals"]').innerHTML));
  B.w.go('approvals'); await sleep(30);
  ok('B: cashier sees their request waiting, with no approve button', /Waiting for the owner/.test(B.d.getElementById('main').innerHTML) && !B.d.querySelector('[data-act="apOk"]'));
  B.w.go('dashboard'); A.w.go('dashboard'); await sleep(30);
  // nobody calls persist(): every change now saves itself, and the other till picks it up by polling
  const seenA = await until(() => A.w.S.approvals && A.w.S.approvals.some(a => a.by === 'Ravi' && a.status === 'pending'), 25000, 500);
  ok('A: request reached the owner by itself (auto-save + poll)', !!seenA);
  ok('A: owner is told in the bell', A.w.S.notif.some(n => n.kind === 'approval' && /Ravi asks/.test(n.text)) && !!A.d.querySelector('#bell .bdot'));
  ok('A: bell entry is not shown to the cashier', !B.w.eval('notifMine')(A.w.S.notif.find(n => n.kind === 'approval')));
  A.w.go('approvals'); await sleep(30);
  ok('A: owner sees Approve / Turn down', !!A.d.querySelector('[data-act="apOk"]') && !!A.d.querySelector('[data-act="apNo"]'));
  const reqId = A.w.S.approvals.find(a => a.status === 'pending' && a.by === 'Ravi').id, reqA = () => A.w.S.approvals.find(a => a.id === reqId);
  A.d.getElementById('apn-' + reqId).value = 'fine, but watch the balance';
  A.d.querySelector('[data-act="apOk"][data-id="' + reqId + '"]').click(); await sleep(50);
  ok('A: approved — the change is applied', !!CA(2).portal === !wasPortal && reqA().status === 'approved' && reqA().decidedBy === 'Afridh' && reqA().note === 'fine, but watch the balance');
  A.w.go('dashboard');
  const backB = await until(() => B.w.S.approvals.some(a => a.id === reqId && a.status === 'approved'), 25000, 500);
  ok('B: cashier sees the decision and the change', !!backB && !!CB(2).portal === !wasPortal);
  ok('B: cashier is told in their bell, with the note', B.w.S.notif.some(n => n.kind === 'approval' && /Approved/.test(n.text) && /watch the balance/.test(n.text) && n.forUser === 'Ravi'));
  // the owner does the same thing without asking anyone
  A.w.eval('custSel=2; custTab="overview"'); A.w.go('customers'); await sleep(30);
  A.d.querySelector('[data-act="custPortal"][data-id="2"]').click(); await sleep(30);
  ok('A: owner switches it straight away, no request', !!CA(2).portal === wasPortal && A.w.S.approvals.filter(a => a.status === 'pending').length === 0);
  A.w.go('dashboard');
  // a request the owner turns down changes nothing
  await until(() => !!CB(2).portal === wasPortal, 25000, 500);
  B.w.eval('custSel=2; custTab="details"'); B.w.go('customers'); await sleep(30);
  B.d.querySelector('[data-act="custEdit"]').click(); await sleep(20);
  B.d.getElementById('cmLimit').value = '99999999'; B.d.getElementById('cmAddr').value = 'New Town, by the tank'; B.d.getElementById('cmOk').click(); await sleep(30);
  // who the customer is and what their terms are both wait for the owner now — nothing is changed quietly
  ok('B: the limit and the address both become requests, neither is applied',
    CB(2).limit !== 99999999 && CB(2).address !== 'New Town, by the tank'
    && B.w.S.approvals.some(a => a.kind === 'custTerms' && a.status === 'pending')
    && B.w.S.approvals.some(a => a.kind === 'custEdit' && a.status === 'pending' && a.data.fields.address === 'New Town, by the tank')
    && !B.d.querySelector('.modal'));
  B.w.go('dashboard');
  const termsA = await until(() => A.w.S.approvals.find(a => a.kind === 'custTerms' && a.status === 'pending'), 25000, 500);
  ok('A: terms request arrived', !!termsA);
  A.w.go('approvals'); await sleep(30);
  A.d.getElementById('apn-' + termsA.id).value = 'too high'; A.d.querySelector(`[data-act="apNo"][data-id="${termsA.id}"]`).click(); await sleep(50);
  ok('A: turned down — limit unchanged', CA(2).limit !== 99999999 && A.w.S.approvals.find(a => a.id === termsA.id).status === 'rejected');
  A.w.go('dashboard');
  const rejB = await until(() => B.w.S.approvals.some(a => a.id === termsA.id && a.status === 'rejected'), 25000, 500);
  ok('B: cashier sees it was turned down, with the reason', !!rejB && B.w.S.notif.some(n => /Turned down/.test(n.text) && /too high/.test(n.text)));
  ok('no script errors during approvals', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors][0] || '');
}
// B makes a sale; A should pick it up on its next poll
const inv4 = B.w.completeSale({ lines: [{ pid: 3, qty: 1, price: B.w.eval('P')(3).retail, disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: B.w.eval('P')(3).retail }] });
B.w.persist(); await sleep(900);
// bill numbers are figures alone now: the cashier's own number, then a running number of theirs
ok('B: sale saved', !!inv4 && /^\d+$/.test(inv4.no) && inv4.no.startsWith(String(B.w.eval('userNo')('Ravi'))), `${inv4.no} (the cashier's number in front)`);
const seenOnA = await until(() => A.w.S.sales.some(s => s.no === inv4.no), 20000, 500);
ok('A: picked up B\'s bill by polling', !!seenOnA, seenOnA ? `${A.w.S.sales.length} bills on A now` : 'not within 20s');
ok('A: still signed in as Afridh after the pull', A.w.S.user.name === 'Afridh' && !A.d.getElementById('lockScreen'));

// ---------------------------------------------------------------- reload of till A with the token kept
const A3 = await openTill('A3', tok);
ok('A3: token remembered -> straight back at the till, no lock', !!(await until(() => A3.w.S.user && A3.w.S.user.name === 'Afridh' && !A3.d.getElementById('lockScreen') && A3.w.S.sales.some(s => s.no === inv4.no), 8000)), A3.w.S.user?.name);
ok('A3: books loaded from server', A3.w.S.sales.some(s => s.no === inv4.no), `${A3.w.S.sales.length} bills`);

ok('no script errors on any till', [A, B, A3].every(t => t.errors.length === 0), [A, B, A3].flatMap(t => t.errors).slice(0, 3).join(' | '));
console.log(failures ? `\n${failures} FAILED` : '\nall end-to-end checks passed');
[A, B, A3].forEach(t => t.dom.window.close());
process.exit(failures ? 1 : 0);


