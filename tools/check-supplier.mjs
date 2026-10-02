// Drives the supplier side in a real browser, against the list the shop gave:
// goods on a delivery note and the invoice matched to it later, the invoice photographed onto a
// GRN, booking by total gated by a setting, a rep's special price, and damaged goods.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1400, height: 1000 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));

let pass = 0, fail = 0;
const ok = (c, what, extra = '') => { if (c) { pass++; console.log('PASS ' + what + (extra ? '  ' + extra : '')); } else { fail++; console.log('FAIL ' + what + (extra ? '  ' + extra : '')); } };

await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForSelector('#lockScreen', { timeout: 15000 });
if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh'); else await pg.click('[data-user="Afridh"]');
await pg.type('#lockPw', 'Afridh123');
await pg.click('#lockGo');
await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 15000 });
await new Promise(r => setTimeout(r, 800));

/* ---------- goods in on a delivery note ---------- */
const note = await pg.evaluate(() => {
  const d = D(today), pid = S.products[0].id, sid = S.suppliers[0].id;
  const stock0 = P(pid).stock, owed0 = partyBal('S', sid), grni0 = -bal('2120');
  const pur = receiveOnNote({ supplierId: sid, dnNo: 'DN-7781', date: d,
    lines: [{ pid, qty: 40, cost: 2000 }], note: 'two bags short, driver said they follow' });
  return { no: pur.no, sid, pid, stock0, owed0, grni0,
    stock: P(pid).stock, owed: partyBal('S', sid), grni: -bal('2120'), total: pur.total,
    onNote: !!pur.onNote, invoiced: !!pur.invoiced };
});
ok(note.stock === note.stock0 + 40, 'the goods on a note go on the floor the same day', `${note.stock0} → ${note.stock}`);
ok(Math.abs(note.owed - note.owed0) < 0.005, 'nothing goes on the supplier account, because there is no invoice yet', `owed ${note.owed}`);
ok(Math.abs(note.grni - note.grni0 - 80000) < 0.005, 'the value waits in the goods-received account', `${note.grni0} → ${note.grni}`);
ok(note.onNote && !note.invoiced, 'the note knows it is waiting for its invoice');

/* ---------- the invoice turns up, charging more than the note said ---------- */
const matched = await pg.evaluate((o) => {
  const before = { owed: partyBal('S', o.sid), grni: -bal('2120'), cost: P(o.pid).cost };
  const pur = matchNoteInvoice({ no: o.no, supInv: 'TC-99120', costs: { [o.pid]: 2150 }, other: 1000, disc: 500 });
  let dr = 0, cr = 0; for (const j of S.journal) for (const l of j.lines) { dr += l.dr || 0; cr += l.cr || 0 }
  return { before, total: pur.total, invoiced: !!pur.invoiced, supInv: pur.supInv,
    owed: partyBal('S', o.sid), grni: -bal('2120'), cost: P(o.pid).cost, off: +(dr - cr).toFixed(2) };
}, note);
ok(Math.abs(matched.total - 86500) < 0.005, 'the invoice total is the goods plus transport less the discount', String(matched.total));
ok(Math.abs(matched.owed - matched.before.owed - 86500) < 0.005, 'matching puts it on the supplier account', `${matched.before.owed} → ${matched.owed}`);
ok(Math.abs(matched.grni - matched.before.grni + 80000) < 0.005, 'and takes it off the waiting account', `${matched.before.grni} → ${matched.grni}`);
ok(matched.cost > matched.before.cost, 'the goods are re-costed by what was actually charged', `${matched.before.cost} → ${matched.cost}`);
ok(Math.abs(matched.off) < 0.005, 'the journal still balances', String(matched.off));

const twice = await pg.evaluate((o) => { try { matchNoteInvoice({ no: o.no, supInv: 'X' }); return 'let through' } catch (e) { return e.message } }, note);
ok(/already had its invoice/.test(twice), 'the same note cannot be invoiced twice', twice);

const noNumber = await pg.evaluate(() => {
  try { receiveOnNote({ supplierId: S.suppliers[0].id, dnNo: '', lines: [{ pid: S.products[0].id, qty: 1, cost: 1 }] }); return 'let through' }
  catch (e) { return e.message }
});
ok(/note number/.test(noNumber), 'a note without its number is refused — there would be nothing to match', noNumber);

/* ---------- a discount on an ordinary purchase comes off the cost of the goods ---------- */
const withDisc = await pg.evaluate(() => {
  const pid = S.products[1].id, before = P(pid).stock;
  const pur = receivePurchase({ supplierId: S.suppliers[0].id, supInv: 'D-1', lines: [{ pid, qty: 10, cost: 1000 }], disc: 1000 });
  return { total: pur.total, landed: pur.lines[0].landed, before, after: P(pid).stock };
});
ok(Math.abs(withDisc.total - 9000) < 0.005, 'a discount comes off what the purchase comes to', String(withDisc.total));
ok(Math.abs(withDisc.landed - 900) < 0.5, 'and off what each item cost, not booked as income', String(withDisc.landed));

const tooMuch = await pg.evaluate(() => {
  try { receivePurchase({ supplierId: S.suppliers[0].id, supInv: 'D-2', lines: [{ pid: S.products[1].id, qty: 1, cost: 100 }], disc: 500 }); return 'let through' }
  catch (e) { return e.message }
});
ok(/more than the goods/.test(tooMuch), 'a discount bigger than the goods is refused', tooMuch);

/* ---------- booking by total is the owner's decision ---------- */
const gate = await pg.evaluate(() => {
  const out = {};
  // the page as drawn, not the whole document — its own source is in there too
  const drawn = () => document.getElementById('main').innerHTML;
  CFG.buying.amountOnly = true; go('purchases');
  out.onShown = drawn().includes('Just the invoice total');
  CFG.buying.amountOnly = false; render();
  out.offHidden = !drawn().includes('Just the invoice total');
  out.offRefused = (() => { let said = ''; const t = window.toast; window.toast = (m) => { said = m }; quickPurModal(); window.toast = t; return said })();
  CFG.buying.amountOnly = true; CFG.buying.amountOnlyWho = 'super'; render();
  out.superSeesIt = drawn().includes('Just the invoice total');
  CFG.buying.amountOnlyWho = 'any';
  out.dnShown = drawn().includes('Goods on a delivery note');
  CFG.buying.dnFirst = false; render();
  out.dnHidden = !drawn().includes('Goods on a delivery note');
  CFG.buying.dnFirst = true; render();
  return out;
});
ok(gate.onShown && gate.offHidden, 'booking by total can be switched off', JSON.stringify(gate));
ok(/switched off/.test(gate.offRefused), 'and the window refuses even if it is reached another way', gate.offRefused);
ok(gate.superSeesIt, 'the owner still sees it when it is left to the owner');
ok(gate.dnShown && gate.dnHidden, 'taking goods in on a note can be switched off too');

/* ---------- what the shop decides reaches the rep ---------- */
const told = await pg.evaluate(() => {
  const s = S.suppliers.find(x => x.phone) || S.suppliers[0];
  s.phone = s.phone || '0771234567';
  const o = { id: 'tst1', dir: 'IN', sid: s.id, no: 'SP-1', rep: 'Nimal', text: '20 bags cement', date: D(today),
    status: 'pending', events: [], lines: [] };
  S.orders.push(o);
  const sent = [];
  const real = window.sms; window.sms = (to, body) => { sent.push(body); };
  poAct('SP-1', 'accepted', '');
  poAct('SP-1', 'cancelled', 'out of stock');
  window.sms = real;
  return sent;
});
ok(told.length === 2 && /is accepted/.test(told[0]), 'accepting an order texts the rep, not only cancelling it', JSON.stringify(told[0] || ''));
ok(/cancelled/.test(told[1] || ''), 'and cancelling still does');

/* ---------- a rep's special price ---------- */
const offer = await pg.evaluate(() => {
  const s = S.suppliers[0];
  const o = S.orders.find(x => x.no === 'SP-1');
  o.disc = { kind: 'pct', value: 5, note: 'on the cement only' };
  o.status = 'pending'; o.sid = s.id;   // the offer matters while the owner is still deciding
  go('orders'); ordTab = 'in'; render();
  const shown = document.getElementById('main').innerHTML.includes('They are offering');
  return { shown, says: discSays(o.disc), amt: discSays({ kind: 'amt', value: 2500 }),
    on100k: discOn(o.disc, 100000) };
});
ok(offer.shown, 'the offer is on the card the owner decides from');
ok(offer.says === '5% off' && /2,500/.test(offer.amt), 'an offer is put in words', `${offer.says} · ${offer.amt}`);
ok(offer.on100k === 5000, 'a percentage offer is worked out against the goods', String(offer.on100k));

/* ---------- damaged goods, on the rep's own page ---------- */
const dmg = await pg.evaluate(() => {
  const s = S.suppliers[0], pid = S.products[0].id;
  const owed0 = partyBal('S', s.id);
  const d = addSupplierDamage({ pid, sid: s.id, qty: 2, reason: 'broken in the lorry', note: '' });
  s.showAccounts = true;
  const html = portalDamage(s);
  return { owed0, owed: partyBal('S', s.id), value: d.value,
    shows: html.includes('Damaged goods'), names: html.includes(P(pid).name) };
});
ok(dmg.owed < dmg.owed0, 'raising a damage takes its value off what the shop owes them', `${dmg.owed0} → ${dmg.owed}`);
ok(dmg.shows && dmg.names, 'and the rep sees it on their own page, with what it was');

/* ---------- a supplier sees the goods they supply, and only those ---------- */
const theirs = await pg.evaluate(() => {
  const sid = S.suppliers[0].id, other = S.suppliers[1].id;
  // nothing in these books carries a supplier tag; the delivery history is what knows
  const tagged = (S.products || []).filter(p => p.supplierId).length;
  const mine = supplierItems(sid), notMine = supplierItems(other);
  const delivered = new Set();
  for (const pu of S.purchases) if (pu.supplierId === sid) for (const l of (pu.lines || [])) delivered.add(l.pid);
  const overlap = [...mine].filter(id => notMine.has(id) && !delivered.has(id));
  // and a tag still wins where the shop has set one
  const spare = S.products.find(p => !mine.has(p.id));
  if (spare) spare.supplierId = sid;
  const after = supplierItems(sid);
  return { tagged, mine: mine.size, delivered: delivered.size, overlap: overlap.length,
    tagCounts: spare ? after.has(spare.id) : null, otherUnaffected: !supplierItems(other).has(spare && spare.id) };
});
ok(theirs.tagged === 0 && theirs.mine > 0 && theirs.mine === theirs.delivered,
   'with no product tagged, what they have delivered is what they are shown', JSON.stringify(theirs));
ok(theirs.overlap === 0, 'and nothing another supplier delivered is in it');
ok(theirs.tagCounts === true && theirs.otherUnaffected,
   'a tag the shop sets counts too, and only for them');

/* ---------- the price a rep is asking goes on the order ---------- */
const asking = await pg.evaluate(() => {
  const s = S.suppliers[0];
  S.portal = { ...S.portal, session: s.id, ord: { lines: [], q: '', pid: null, qty: '', price: '' } };
  const pid = [...supplierItems(s.id)][0];
  S.portal.ord.pid = pid; S.portal.ord.qty = 20; S.portal.ord.price = 2175;
  portalStockAdd();
  const line = S.portal.ord.lines[0];
  S.portal.ord.lines = [line];
  portalStockSend(s);
  return { price: line.price, qty: line.qty, sheet: S.portal.draft, cleared: S.portal.ord.price };
});
ok(asking.price === 2175 && asking.qty === 20, 'the price a rep is asking is kept with the quantity', JSON.stringify({price:asking.price,qty:asking.qty}));
ok(/at /.test(asking.sheet) && /2,175/.test(asking.sheet), 'and it reaches the order sheet the shop reads', asking.sheet);
ok(asking.cleared === '', 'the box is empty again for the next line');

/* ---------- writing an order TO a supplier searches that supplier's goods ---------- */
const poSearch = await pg.evaluate(() => {
  const sid = S.suppliers[0].id;
  go('orders'); newPO(sid);
  const theirs = supplierItems(sid);
  const q = 'c';
  poDraft.q = q; poDraft.wide = false; render();
  const rows = () => [...document.querySelectorAll('#main .sug [data-act="poAdd"]')].map(el => +el.dataset.id);
  const narrow = rows();
  const everyMatch = S.products.filter(p => p.name.toLowerCase().includes(q) || String(p.code||'').toLowerCase().includes(q)).length;
  poDraft.wide = true; render();
  const wide = rows();
  const marked = document.querySelectorAll('#main .sug .tag').length;
  poDraft = null; render();
  return { narrow: narrow.length, allTheirs: narrow.every(id => theirs.has(id)),
    everyMatch, wide: wide.length, marked, theirs: theirs.size };
});
ok(poSearch.narrow > 0 && poSearch.allTheirs,
   'the order search offers only that supplier’s goods', JSON.stringify(poSearch));
ok(poSearch.everyMatch > poSearch.narrow,
   'where the whole shop would have offered more', String(poSearch.everyMatch) + ' vs ' + poSearch.narrow);
ok(poSearch.wide > poSearch.narrow && poSearch.marked > 0,
   'and widening it reaches the rest, marked as not usually from them', JSON.stringify({wide:poSearch.wide,marked:poSearch.marked}));

ok(errs.length === 0, 'no script errors through any of it', errs.join(' | '));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
