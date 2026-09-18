/* regal-ext.js — features brought across from SePOS into the Regal system:
     · loyalty points (earned on bills, spent as a payment kind at the till)
     · gift vouchers (sold at the counter, spent as a payment kind, a liability until used)
     · locations and stock transfers (stock per location; a till sells from its own location)
   Loaded before the main script; the main script calls extInstall() just before it boots, so the
   functions here exist by the time the first screen is drawn.  Everything reads the same S / CFG. */

/* ================================================================ defaults */
const EXT_LOYALTY = { enabled: true, pointsPer100: 1, rupeesPerPoint: 1, minRedeem: 100, expireMonths: 12 };
const EXT_LOCAL_LOC_KEY = 'regal_locId';

function extInstall() {
  // menu items: they sit in the groups the shop already knows
  const add = (after, entry) => { const i = views.findIndex(v => v[0] === after); if (i >= 0 && !views.some(v => v[0] === entry[0])) views.splice(i + 1, 0, entry); };
  add('expenses', ['vouchers', 'Gift vouchers']);
  add('stocktake', ['transfers', 'Stock transfers']);
  // ledger accounts the new features post to
  GL['2060'] = 'Gift vouchers not yet used';
  GL['6110'] = 'Loyalty points redeemed';
  GL['6120'] = 'Gift vouchers written off';
  // menu icons
  ICONS.vouchers = 'M3 8h18v4a2 2 0 000 4v4H3v-4a2 2 0 000-4zM9 8v12';
  ICONS.transfers = 'M4 7h12l-3-3M20 17H8l3 3M4 7v4M20 17v-4';
  // every books load (seed, server, restore) passes through here
  const _applyKept = applyKept;
  applyKept = function (kept) { _applyKept(kept); extEnsure(); };
  const _seed = seed;
  seed = function () { _seed(); extEnsure(); extSeedDemo(); };
  // the stock tab gains a column per location
  const _inventory = inventory;
  inventory = function () { return extInventory(_inventory()); };
}

/** Make sure the books carry what the extensions need, whatever version saved them. */
function extEnsure() {
  if (!CFG.loyalty) CFG.loyalty = { ...EXT_LOYALTY };
  if (!Array.isArray(S.vouchers)) S.vouchers = [];
  if (!Array.isArray(S.transfers)) S.transfers = [];
  if (!Array.isArray(S.locations) || !S.locations.length) S.locations = [{ id: 1, name: 'Main shop', till: true }];
  S.customers.forEach(c => { if (c.points === undefined) c.points = 0; });
  S.products.forEach(p => extLocsOf(p));
  const wanted = +localStorage.getItem(EXT_LOCAL_LOC_KEY) || 0;
  S.locId = S.locations.some(l => l.id === wanted) ? wanted : S.locations[0].id;
}
function extSeedDemo() {
  if (S.locations.length === 1) S.locations.push({ id: 2, name: 'Store room', till: false });
  // a little of the demo stock sits in the store room
  S.products.forEach((p, i) => { if (i % 4 === 0 && p.stock >= 8) { const q = Math.floor(p.stock / 4); const l = extLocsOf(p); l[1] = +(l[1] - q).toFixed(3); l[2] = +((l[2] || 0) + q).toFixed(3); } });
  S.customers.forEach((c, i) => { if (c.id !== 1) c.points = [0, 120, 45, 300, 0, 80][i] || 0; });
}

/* ================================================================ locations */
const extLoc = () => S.locations.find(l => l.id === S.locId) || S.locations[0];
function extLocsOf(p) {
  if (!p.locs || typeof p.locs !== 'object') p.locs = { [S.locations[0].id]: +p.stock || 0 };
  // keep the split honest against the total the ledger holds
  const sum = Object.values(p.locs).reduce((a, v) => a + (+v || 0), 0);
  if (Math.abs(sum - p.stock) > 1e-6) { const main = S.locations[0].id; p.locs[main] = +((+p.locs[main] || 0) + (p.stock - sum)).toFixed(3); }
  return p.locs;
}
/** Called by move(): keep the per-location split in step with the total. */
function extMove(p, qty, loc) {
  const l = extLocsOf(p); const id = loc || S.locId || S.locations[0].id;
  l[id] = +((+l[id] || 0) + qty).toFixed(3);
}
const extHere = (p) => +(extLocsOf(p)[S.locId] || 0);

function transfers() {
  const cur = extLoc();
  const list = S.transfers.slice().reverse();
  const lowHere = S.products.filter(p => extHere(p) <= p.min && p.stock > extHere(p));
  return `<h1>Stock transfers</h1>
  <div class="row" style="margin-bottom:12px">
   ${stat('This till sells from', cur.name, `${S.locations.length} location${S.locations.length === 1 ? '' : 's'} on the books`, 'b')}
   ${stat('Stock here', fmt(S.products.reduce((a, p) => a + extHere(p) * p.cost, 0)), 'at cost', 'g')}
   ${stat('Elsewhere', fmt(S.products.reduce((a, p) => a + (p.stock - extHere(p)) * p.cost, 0)), 'in the other locations', 'y')}
   ${stat('Short here, held elsewhere', lowHere.length, lowHere.length ? 'worth moving over' : 'nothing to move', 'r')}
  </div>
  <div class="card" style="margin-bottom:12px">
   <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
    <div class="muted">Goods moving between the shop, the store room and any branch. The total on the books does not change — only where it sits.
     A till sells from the location chosen for it in <b>Settings → My screen</b>.</div>
    <div style="display:flex;gap:6px"><button class="btn tape" data-act="trfNew">Move stock</button>
     <button class="btn ghost" data-act="locManage">Locations</button></div></div></div>
  <div class="card" style="margin-bottom:12px">
   <h2>Where the stock is</h2>
   <table><tr><th>Item</th>${S.locations.map(l => `<th class="n">${l.name}${l.id === S.locId ? ' <span class="tag ok">here</span>' : ''}</th>`).join('')}<th class="n">Total</th><th class="n">Reorder</th></tr>
   ${S.products.map(p => { const l = extLocsOf(p); return `<tr><td>${p.name}<div class="muted">${p.code}</div></td>
     ${S.locations.map(x => `<td class="n">${(+l[x.id] || 0) <= 0 ? '<span class="muted">—</span>' : fq(+l[x.id])}</td>`).join('')}
     <td class="n"><b>${fq(p.stock)} ${p.unit}</b></td><td class="n">${extHere(p) <= p.min ? `<span class="tag bad">${p.min}</span>` : p.min}</td></tr>`; }).join('')}</table>
  </div>
  <div class="card">
   <h2>Transfers</h2>
   <table><tr><th>No</th><th>Date</th><th>From</th><th>To</th><th>Items</th><th class="n">Qty</th><th class="n">At cost</th><th>By</th><th></th></tr>
   ${list.map(t => `<tr><td><b>${t.no}</b></td><td>${t.date}</td><td>${extLocName(t.from)}</td><td>${extLocName(t.to)}</td>
     <td class="muted">${t.lines.map(l => P(l.pid).name + ' × ' + fq(l.qty)).join('<br>')}</td>
     <td class="n">${fq(t.lines.reduce((a, l) => a + l.qty, 0))}</td><td class="n">${fmt(t.value)}</td><td>${t.by}</td>
     <td><button class="btn ghost sm" data-act="trfPrint" data-no="${t.no}">Print</button></td></tr>`).join('')
      || '<tr><td colspan="9" class="muted" style="padding:22px;text-align:center">Nothing moved yet.</td></tr>'}</table>
  </div>`;
}
const extLocName = id => (S.locations.find(l => l.id === id) || {}).name || '—';
function extInventory(html) {
  if (invTab !== 'stock' || S.locations.length < 2) return html;
  // add the per-location columns to the stock table
  const head = S.locations.map(l => `<th class="n">${l.name}</th>`).join('');
  html = html.replace('<th class="n">In stock</th>', head + '<th class="n">In stock</th>');
  S.products.forEach(p => {
    const l = extLocsOf(p);
    const cells = S.locations.map(x => `<td class="n">${(+l[x.id] || 0) ? fq(+l[x.id]) : '<span class="muted">—</span>'}</td>`).join('');
    html = html.replace(`<td>${p.code}<div class="muted">${p.barcode}</div></td><td>${p.name}</td><td>${p.cat}</td>`, `<td>${p.code}<div class="muted">${p.barcode}</div></td><td>${p.name}</td><td>${p.cat}</td>${cells}`);
  });
  html = html.replace('<tr><td colspan=8><b>Total stock value</b></td>', `<tr><td colspan=${8 + S.locations.length}><b>Total stock value</b></td>`);
  return html;
}
function trfModal() {
  if (S.locations.length < 2) { toast('Add a second location first (Locations)'); return locModal(); }
  let lines = [];
  const m = modal(`<h2>Move stock</h2>
   <div class="grid3">
    <div class="f"><label>From</label><select id="trfFrom">${S.locations.map(l => `<option value="${l.id}" ${l.id === S.locId ? 'selected' : ''}>${l.name}</option>`).join('')}</select></div>
    <div class="f"><label>To</label><select id="trfTo">${S.locations.map(l => `<option value="${l.id}" ${l.id !== S.locId ? 'selected' : ''}>${l.name}</option>`).join('')}</select></div>
    <div class="f"><label>Note</label><input id="trfNote" placeholder="e.g. Thursday lorry"></div></div>
   <label>Add an item</label><input id="trfQ" placeholder="name, code, short code or number" autocomplete="off">
   <div id="trfHits"></div><div id="trfBody"></div>`);
  const from = () => +m.querySelector('#trfFrom').value;
  const draw = () => {
    m.querySelector('#trfBody').innerHTML = `<table style="margin-top:8px"><tr><th>Item</th><th class="n">At the source</th><th class="n">Moving</th><th class="n">At cost</th><th></th></tr>
      ${lines.map((l, i) => { const p = P(l.pid); const have = +(extLocsOf(p)[from()] || 0); return `<tr><td>${p.name}<div class="muted">${p.code}</div></td>
        <td class="n ${l.qty > have ? 'rust' : ''}">${fq(have)} ${p.unit}</td>
        <td class="n"><input type="number" step="any" data-tq="${i}" value="${l.qty}" style="width:90px;text-align:right"></td>
        <td class="n">${fmt(l.qty * p.cost)}</td><td><button class="btn ghost sm" data-tx="${i}">✕</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Nothing on it yet.</td></tr>'}</table>
     <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn ghost" data-act="closeModal">Cancel</button>
      <button class="btn tape" id="trfOk" ${lines.length ? '' : 'disabled'}>Move it</button></div>`;
    m.querySelectorAll('[data-tq]').forEach(el => el.onchange = () => { lines[+el.dataset.tq].qty = +el.value || 0; draw(); });
    m.querySelectorAll('[data-tx]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.tx, 1); draw(); });
    m.querySelector('#trfOk').onclick = save;
  };
  const q = m.querySelector('#trfQ');
  q.oninput = () => {
    const v = q.value.trim().toLowerCase();
    const hits = v ? S.products.filter(p => p.name.toLowerCase().includes(v) || p.code.toLowerCase().includes(v) || (p.short || '').toLowerCase() === v || String(p.num || '') === v).slice(0, 6) : [];
    m.querySelector('#trfHits').innerHTML = hits.map(p => `<button class="btn ghost sm" data-tadd="${p.id}" style="margin:3px 3px 0 0">${p.name} · ${fq(+(extLocsOf(p)[from()] || 0))} ${p.unit} there</button>`).join('');
    m.querySelectorAll('[data-tadd]').forEach(b => b.onclick = () => { const p = P(+b.dataset.tadd); if (!lines.some(l => l.pid === p.id)) lines.push({ pid: p.id, qty: 1 }); q.value = ''; m.querySelector('#trfHits').innerHTML = ''; draw(); q.focus(); });
  };
  m.querySelector('#trfFrom').onchange = draw;
  const save = () => {
    const f = from(), t = +m.querySelector('#trfTo').value;
    if (f === t) return toast('From and to are the same place');
    const keep = lines.filter(l => l.qty > 0);
    if (!keep.length) return toast('Nothing to move');
    for (const l of keep) { const p = P(l.pid); if (l.qty > (+extLocsOf(p)[f] || 0) + 1e-9 && !CFG.stock.allowNegative) return toast(`Only ${fq(+extLocsOf(p)[f] || 0)} ${p.unit} of ${p.name} at ${extLocName(f)}`); }
    const no = 'TRF-' + String((S.seq.TRF = (S.seq.TRF || 1))).padStart(5, '0'); S.seq.TRF++;
    let value = 0;
    keep.forEach(l => { const p = P(l.pid); value += l.qty * p.cost;
      move(l.pid, -l.qty, 'TRANSFER_OUT', no + ' → ' + extLocName(t), p.cost, D(today), f);
      move(l.pid, l.qty, 'TRANSFER_IN', no + ' ← ' + extLocName(f), p.cost, D(today), t); });
    S.transfers.push({ no, date: D(today), from: f, to: t, lines: keep, value: +value.toFixed(2), note: (m.querySelector('#trfNote').value || '').trim(), by: S.user.name });
    notify('stock', `${fmt(value)} of stock moved ${extLocName(f)} → ${extLocName(t)}`, 'transfers');
    m.remove(); render(); trfPrint(no); toast(`${no} — ${keep.length} item(s) moved`);
  };
  draw(); q.focus();
}
function trfPrint(no) {
  const t = S.transfers.find(x => x.no === no); if (!t) return;
  voucherPrint({ title: 'Stock Transfer', no: t.no, date: t.date, payee: extLocName(t.to), payeeLabel: 'TO', payeeSub: 'from ' + extLocName(t.from),
    amount: t.value, totalLabel: 'VALUE AT COST',
    rows: [['From', extLocName(t.from)], ['To', extLocName(t.to)], ['Lines', t.lines.length], ['Note', t.note || '—'], ['Moved by', t.by]],
    linesLabel: 'Goods moved', lines: t.lines.map(l => [`${P(l.pid).name} — ${fq(l.qty)} ${P(l.pid).unit}`, l.qty * P(l.pid).cost]), thirdSign: 'RECEIVED AT DESTINATION' });
}
function locModal() {
  const m = modal(`<h2>Locations</h2>
   <div class="muted">The shop floor, a store room, a second branch. Stock is counted per location; a till sells from the one chosen for it.</div>
   <div id="locBody"></div>
   <div class="row" style="margin-top:10px"><input id="locNew" placeholder="New location, e.g. Store room" style="flex:1"><button class="btn tape" id="locAdd">Add</button></div>
   <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn ghost" data-act="closeModal">Done</button></div>`);
  const draw = () => {
    m.querySelector('#locBody').innerHTML = `<table style="margin-top:10px"><tr><th>Name</th><th class="n">Stock at cost</th><th></th></tr>
      ${S.locations.map(l => `<tr><td><input data-ln="${l.id}" value="${l.name}"></td><td class="n">${fmt(S.products.reduce((a, p) => a + (+extLocsOf(p)[l.id] || 0) * p.cost, 0))}</td>
        <td>${l.id === S.locId ? '<span class="tag ok">this till</span>' : `<button class="btn ghost sm" data-luse="${l.id}">Use for this till</button>`}
          ${S.locations.length > 1 && l.id !== S.locations[0].id ? `<button class="btn ghost sm" data-ldel="${l.id}">Remove</button>` : ''}</td></tr>`).join('')}</table>`;
    m.querySelectorAll('[data-ln]').forEach(el => el.onchange = () => { S.locations.find(l => l.id === +el.dataset.ln).name = el.value.trim() || 'Location'; render(); });
    m.querySelectorAll('[data-luse]').forEach(b => b.onclick = () => { extUseLocation(+b.dataset.luse); draw(); render(); });
    m.querySelectorAll('[data-ldel]').forEach(b => b.onclick = () => { const id = +b.dataset.ldel;
      if (S.products.some(p => (+extLocsOf(p)[id] || 0) > 0)) return toast('Move its stock out first');
      S.locations = S.locations.filter(l => l.id !== id); if (S.locId === id) extUseLocation(S.locations[0].id); draw(); render(); });
  };
  m.querySelector('#locAdd').onclick = () => { const n = (m.querySelector('#locNew').value || '').trim(); if (!n) return;
    S.locations.push({ id: Math.max(...S.locations.map(l => l.id)) + 1, name: n }); m.querySelector('#locNew').value = ''; draw(); render(); toast(n + ' added'); };
  draw();
}
function extUseLocation(id) { S.locId = id; localStorage.setItem(EXT_LOCAL_LOC_KEY, String(id)); toast('This till now sells from ' + extLocName(id)); }

/* ================================================================ loyalty points */
const extLoy = () => CFG.loyalty || (CFG.loyalty = { ...EXT_LOYALTY });
function extPointsFor(total) { const L = extLoy(); return L.enabled ? Math.floor(total / 100 * (+L.pointsPer100 || 0)) : 0; }
function extPointsValue(c) { return +((+c.points || 0) * (+extLoy().rupeesPerPoint || 1)).toFixed(2); }
/** Called from completeSale after the bill is posted: earn, and record any points spent. */
function extAfterSale(inv, c, pays) {
  const L = extLoy();
  const spent = pays.filter(p => p.method === 'POINTS').reduce((a, p) => a + p.amount, 0);
  if (c && c.id !== 1) {
    if (spent > 0) { const pts = +(spent / (+L.rupeesPerPoint || 1)).toFixed(2); c.points = +Math.max(0, (+c.points || 0) - pts).toFixed(2); inv.pointsSpent = pts; }
    const earned = extPointsFor(inv.total - spent);
    if (earned > 0) { c.points = +((+c.points || 0) + earned).toFixed(2); inv.pointsEarned = earned; }
  }
  pays.filter(p => p.method === 'VOUCHER').forEach(p => extRedeemVoucher(p.code, p.amount, inv));
}
function extPointsModal(cid) {
  const c = C(cid); if (!c) return;
  const m = modal(`<h2>Loyalty points — ${c.name}</h2>
   <div class="paytop" style="margin:8px 0"><div class="pt-l"><span>Points on the card</span><b>${fq(c.points || 0)}</b></div>
    <div class="pt-r"><span>worth ${fmt(extPointsValue(c))}</span><span>${extLoy().pointsPer100} point(s) per Rs 100 · Rs ${extLoy().rupeesPerPoint} a point</span></div></div>
   <div class="grid2"><div class="f"><label>Adjust by (minus to take away)</label><input id="ptAdj" type="number" step="any" placeholder="0"></div>
    <div class="f"><label>Why</label><input id="ptWhy" placeholder="e.g. goodwill, wrong bill"></div></div>
   <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="closeModal">Close</button><button class="btn tape" id="ptOk">Apply</button></div>`);
  m.querySelector('#ptOk').onclick = () => { const v = +m.querySelector('#ptAdj').value || 0; if (!v) return m.remove();
    c.points = +Math.max(0, (+c.points || 0) + v).toFixed(2);
    (c.pointsLog = c.pointsLog || []).push({ date: D(today), by: S.user.name, change: v, why: (m.querySelector('#ptWhy').value || '').trim() });
    m.remove(); render(); toast(`${c.name} now has ${fq(c.points)} points`); };
}

/* ================================================================ gift vouchers */
function vouchers() {
  const open = S.vouchers.filter(v => v.status === 'open');
  const mk = D(today).slice(0, 7);
  const used = S.vouchers.flatMap(v => v.redeemed || []).filter(r => r.date.slice(0, 7) === mk).reduce((a, r) => a + r.amount, 0);
  return `<h1>Gift vouchers</h1>
  <div class="row" style="margin-bottom:12px">
   ${stat('Out there, unused', fmt(open.reduce((a, v) => a + v.balance, 0)), `${open.length} voucher${open.length === 1 ? '' : 's'} · owed to their holders`, 'y')}
   ${stat('Spent this month', fmt(used), 'at the till', 'g')}
   ${stat('Sold this month', fmt(S.vouchers.filter(v => v.issued.slice(0, 7) === mk).reduce((a, v) => a + v.amount, 0)), '', 'b')}
   ${stat('Ledger says', fmt(-bal('2060')), 'gift vouchers not yet used', 'r')}
  </div>
  <div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
   <div class="muted">A voucher is money taken now for goods later. It sits as a liability until it is spent — press <b>V</b> on the payment screen and key the code.</div>
   <button class="btn tape" data-act="gvNew">Sell a voucher</button></div></div>
  <div class="card"><table><tr><th>Code</th><th>Issued</th><th>For</th><th class="n">Value</th><th class="n">Left</th><th>Expires</th><th>State</th><th></th></tr>
   ${S.vouchers.slice().reverse().map(v => `<tr><td><b>${v.code}</b><div class="muted">by ${v.by}${v.note ? ' · ' + v.note : ''}</div></td><td>${v.issued}</td>
     <td>${v.customerId ? C(v.customerId)?.name || '—' : v.holder || 'bearer'}</td><td class="n">${fmt(v.amount)}</td><td class="n"><b>${fmt(v.balance)}</b></td>
     <td>${v.expires || '—'}${v.expires && v.expires < D(today) && v.status === 'open' ? ' <span class="tag bad">lapsed</span>' : ''}</td>
     <td>${v.status === 'open' ? '<span class="tag ok">open</span>' : v.status === 'used' ? '<span class="tag blue">used</span>' : '<span class="tag bad">void</span>'}
      ${(v.redeemed || []).length ? `<div class="muted">${v.redeemed.map(r => r.no + ' ' + fmt(r.amount)).join(', ')}</div>` : ''}</td>
     <td><div class="rowacts"><button class="btn ghost sm" data-act="gvPrint" data-code="${v.code}">Print</button>
      ${v.status === 'open' ? `<button class="btn ghost sm" data-act="gvVoid" data-code="${v.code}">Void</button>` : ''}</div></td></tr>`).join('')
      || '<tr><td colspan="8" class="muted" style="padding:22px;text-align:center">No vouchers sold yet.</td></tr>'}</table></div>`;
}
function extVoucherCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = 'GV-'; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)]; return S.vouchers.some(v => v.code === s) ? extVoucherCode() : s; }
function gvModal() {
  const m = modal(`<h2>Sell a gift voucher</h2>
   <div class="grid3">
    <div class="f"><label>Value</label><input id="gvAmt" type="number" step="any" placeholder="0.00"></div>
    <div class="f"><label>Paid by</label><select id="gvHow"><option>CASH</option><option>CARD</option><option>BANK</option></select></div>
    <div class="f"><label>Into</label><select id="gvBank">${S.banks.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}</select></div></div>
   <div class="grid3">
    <div class="f"><label>For (customer, optional)</label><select id="gvCust"><option value="">bearer</option>${S.customers.filter(c => c.id !== 1).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
    <div class="f"><label>Or a name to print</label><input id="gvHolder" placeholder="e.g. Mrs. Silva"></div>
    <div class="f"><label>Expires</label><input id="gvExp" type="date" value="${D(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()))}"></div></div>
   <div class="f"><label>Note</label><input id="gvNote" placeholder="optional"></div>
   <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn tape" id="gvOk">Take the money and print</button></div>`);
  m.querySelector('#gvOk').onclick = () => {
    const amt = +m.querySelector('#gvAmt').value || 0; if (!(amt > 0)) return toast('Enter the value');
    const how = m.querySelector('#gvHow').value, bank = +m.querySelector('#gvBank').value;
    const v = { code: extVoucherCode(), amount: amt, balance: amt, issued: D(today), expires: m.querySelector('#gvExp').value || '', status: 'open',
      customerId: +m.querySelector('#gvCust').value || null, holder: (m.querySelector('#gvHolder').value || '').trim(), note: (m.querySelector('#gvNote').value || '').trim(), by: S.user.name, redeemed: [] };
    S.vouchers.push(v);
    post(D(today), `Gift voucher ${v.code} sold`, v.code, [how === 'CASH' ? { ac: '1010', dr: amt } : { ac: B(bank).ac, dr: amt }, { ac: '2060', cr: amt }]);
    notify('money', `Gift voucher ${v.code} sold for ${fmt(amt)}`, 'vouchers');
    m.remove(); render(); gvPrint(v.code); toast(`${v.code} sold · ${fmt(amt)}`);
  };
}
function gvPrint(code) {
  const v = S.vouchers.find(x => x.code === code); if (!v) return;
  voucherPrint({ title: 'Gift Voucher', no: v.code, date: v.issued, payee: v.customerId ? (C(v.customerId)?.name || 'Bearer') : (v.holder || 'Bearer'), payeeLabel: 'THIS VOUCHER IS FOR',
    amount: v.balance, totalLabel: 'VALUE',
    rows: [['Original value', fmt(v.amount)], ['Still to spend', fmt(v.balance)], ['Use before', v.expires || 'no expiry'], ['Issued by', v.by], ['Code', v.code]],
    note: 'Present this voucher at the counter. It can be spent in parts; no cash is given for any balance left.', thirdSign: 'HOLDER' });
}
function extFindVoucher(code) {
  const v = S.vouchers.find(x => x.code.toUpperCase() === String(code || '').trim().toUpperCase());
  if (!v) return { error: 'No voucher with that code' };
  if (v.status !== 'open') return { error: 'That voucher has been ' + v.status };
  if (v.expires && v.expires < D(today)) return { error: 'That voucher expired on ' + v.expires };
  if (v.balance <= 0) return { error: 'Nothing left on that voucher' };
  return { v };
}
function extRedeemVoucher(code, amount, inv) {
  const { v } = extFindVoucher(code); if (!v) return;
  v.balance = +(v.balance - amount).toFixed(2);
  (v.redeemed = v.redeemed || []).push({ no: inv.no, amount, date: inv.date });
  if (v.balance <= 0.005) { v.balance = 0; v.status = 'used'; }
}
function gvVoid(code) {
  const v = S.vouchers.find(x => x.code === code); if (!v || v.status !== 'open') return;
  const why = prompt('Why is it being voided? The balance is written off.', 'lost / refunded'); if (why === null) return;
  post(D(today), `Gift voucher ${v.code} voided — ${why}`, v.code, [{ ac: '2060', dr: v.balance }, { ac: '6120', cr: v.balance }]);
  v.status = 'void'; v.voidWhy = why; v.balance = 0; render(); toast(`${v.code} voided`);
}

/* ================================================================ settings: loyalty & locations */
function extSettingsTabs() { return [['loyalty', 'Loyalty & vouchers'], ['locations', 'Locations']]; }
function extSettingsBody(tab) {
  if (tab === 'loyalty') { const L = extLoy();
    return `<div class="muted" style="margin-bottom:10px">Points are earned on every bill to a named customer and spent at the till with the <b>L</b> key. Vouchers are sold under Money → Gift vouchers and spent with <b>V</b>.</div>
     <div class="grid3">
      <div class="f"><label class="chk"><input type="checkbox" data-loy="enabled" ${L.enabled ? 'checked' : ''}> Earn points on bills</label></div>
      <div class="f"><label>Points per Rs 100</label><input data-loy="pointsPer100" type="number" step="any" value="${L.pointsPer100}"></div>
      <div class="f"><label>Rupees a point is worth</label><input data-loy="rupeesPerPoint" type="number" step="any" value="${L.rupeesPerPoint}"></div>
      <div class="f"><label>Smallest redemption (points)</label><input data-loy="minRedeem" type="number" value="${L.minRedeem}"></div></div>
     <div class="card note" style="margin-top:10px">Points spent post to <b>6110 Loyalty points redeemed</b>; vouchers sit in <b>2060 Gift vouchers not yet used</b> until they are spent.
      Customers with points: ${S.customers.filter(c => (c.points || 0) > 0).length} · outstanding ${fq(S.customers.reduce((a, c) => a + (+c.points || 0), 0))} points (${fmt(S.customers.reduce((a, c) => a + extPointsValue(c), 0))}).</div>`; }
  if (tab === 'locations') return `<div class="muted" style="margin-bottom:10px">Stock is counted per location. This till (<b>${S.terminal}</b>) sells from <b>${extLoc().name}</b>.</div>
     <div class="f" style="max-width:320px"><label>This till sells from</label><select id="extLocPick">${S.locations.map(l => `<option value="${l.id}" ${l.id === S.locId ? 'selected' : ''}>${l.name}</option>`).join('')}</select></div>
     <button class="btn ghost" data-act="locManage">Add or rename locations</button>
     <div class="card note" style="margin-top:10px">Moving goods between locations is done under Stock → Stock transfers. The total on the ledger never changes on a transfer.</div>`;
  return '';
}
function extBindSettings() {
  document.querySelectorAll('[data-loy]').forEach(el => el.onchange = () => { const L = extLoy(); const k = el.dataset.loy; L[k] = el.type === 'checkbox' ? el.checked : +el.value || 0; render(); toast('Saved'); });
  const lp = document.getElementById('extLocPick'); if (lp) lp.onchange = e => { extUseLocation(+e.target.value); render(); };
}

/* ================================================================ clicks for the new screens */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  const fn = {
    trfNew: () => trfModal(), trfPrint: () => trfPrint(a.dataset.no), locManage: () => locModal(),
    gvNew: () => gvModal(), gvPrint: () => gvPrint(a.dataset.code), gvVoid: () => gvVoid(a.dataset.code),
    custPoints: () => extPointsModal(+a.dataset.id),
  }[act];
  if (fn) { e.preventDefault(); fn(); }
});
