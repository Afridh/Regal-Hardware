// Headless end-to-end run of the Regal app against the live server (jsdom).
//   node tools/e2e.mjs            (server must be running on :4000, books cleared)
import jsdom from 'jsdom';
const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

const BASE = 'http://localhost:4000';
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
lock.querySelector('[data-user="Afridh"]').click();
await until(() => d.getElementById('lockPw'));
d.getElementById('lockPw').value = 'afridh123';
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
  d.querySelector('[data-act="custBill"]').click(); await sleep(30);
  ok('C: "New bill" opens the till with the customer on it', w.S.view === 'pos' && w.S.pos.customer === nc.id);
  w.S.pos.customer = null;
}

// ---------------------------------------------------------------- classic till keyboard flow
{
  const key = (el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const active = () => d.activeElement && (d.activeElement.id || d.activeElement.className);
  w.S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: w.S.pos.lastBill };
  w.go('pos'); await sleep(30);
  w.csStart(1); await sleep(20);
  ok('K: picking an item lands on Qty', active() === 'csQty');
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
  ok('K: match list gone once an item is picked', d.querySelectorAll('#csHits [data-act="csPick"]').length === 0 && active() === 'csQty');
  // Space on a bill line: qty and price become boxes in the row
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
ok('A: vouchers + transfers + points in the saved books', saved.data.S.vouchers.length === 1 && saved.data.S.transfers.length === 1 && saved.data.S.customers.find(c => c.id === 2).points === nimal.points);
ok('A: per-till state stripped from the shared books', saved.data.S.user === undefined && saved.data.S.pos === undefined && saved.data.S.locId === undefined && saved.data.S.terminal === undefined);
ok('A: no script errors so far', A.errors.length === 0, A.errors.slice(0, 2).join(' | '));

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
}

// ---------------------------------------------------------------- till B: another PC, same books
const B = await openTill('B');
const lockB = await until(() => B.d.getElementById('lockScreen'));
ok('B: fresh browser gets the lock screen with the real staff list', !!lockB && lockB.querySelectorAll('[data-user]').length === 5);
lockB.querySelector('[data-user="Kasun"]').click(); await until(() => B.d.getElementById('lockPw'));
B.d.getElementById('lockPw').value = 'wrong'; B.d.getElementById('lockGo').click(); await sleep(400);
ok('B: wrong password refused', !!B.d.getElementById('lockScreen') && /not right/.test(B.d.getElementById('lockMsg').textContent));
B.d.getElementById('lockPw').value = 'kasun123'; B.d.getElementById('lockGo').click();
ok('B: cashier signed in', !!(await until(() => !B.d.getElementById('lockScreen'))), `${B.w.S.user.name} Â· ${B.w.S.user.role} Â· ${B.w.S.user.perms.length} perms`);
await sleep(300);
ok('B: sees till A\'s voucher, transfer and bills', B.w.S.vouchers.length === 1 && B.w.S.transfers.length === 1 && B.w.S.sales.some(s => s.no === inv1.no), `${B.w.S.sales.length} bills`);
ok('B: sees the website order once, not twice', B.w.S.web.orders.filter(o => o.no === webNo).length === 1);
ok('B: keeps its own signed-in user (not A\'s)', B.w.S.user.name === 'Kasun');
ok('B: cashier cannot open Users', !B.w.allowed('users') && B.w.allowed('pos'));
// B makes a sale; A should pick it up on its next poll
const inv4 = B.w.completeSale({ lines: [{ pid: 3, qty: 1, price: B.w.eval('P')(3).retail, disc: 0 }], customerId: 1, pays: [{ method: 'CASH', amount: B.w.eval('P')(3).retail }] });
B.w.persist(); await sleep(900);
ok('B: sale saved', !!inv4 && !!inv4.no.match(/-KS-/), `${inv4.no} (cashier id in the number)`);
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


