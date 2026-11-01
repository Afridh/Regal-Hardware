// The directors' report (regalhw.lk/d?k=…): the shop's figures for a day or a stretch of days, read live
// from the books each time the page asks — sales and how they were paid, profit, what came in from customers
// and went out to suppliers, expenses, what customers owe and what the shop owes, cheques, cash and banks,
// and stock. Each director has a link of their own (CFG.directors.list[].key), made, changed or switched off
// in Settings → Directors' report. Nothing can be changed from it.
const TZ = 'Asia/Colombo';
export const todayHere = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysAgo = (d, now) => Math.max(0, Math.round((new Date(now + 'T12:00:00Z') - new Date(String(d).slice(0, 10) + 'T12:00:00Z')) / 864e5));
const r2 = (n) => +(+n || 0).toFixed(2);
const isBF = (s) => !!(s && (s.opening || (s.by === 'SePOS' && !(s.lines || []).length && /brought forward/i.test(s.note || ''))));
// the expense accounts, as the till names them
const EXP = { '6010': 'Electricity', '6020': 'Water', '6030': 'Rent', '6040': 'Transport', '6050': 'Repairs', '6060': 'Office', '6070': 'Staff expenses', '6080': 'Salaries', '6090': 'Bank charges', '6095': 'Cash short in the drawer', '6100': 'Other', '6120': 'Tradesman commission' };

/* which days: today, yesterday, the last 7 days, this month, last month, or from–to */
export function rangeOf(q = {}) {
  const t = todayHere();
  const r = String(q.range || 'today');
  if (r === 'yesterday') return { from: addDays(t, -1), to: addDays(t, -1), range: r };
  if (r === 'week') return { from: addDays(t, -6), to: t, range: r };
  if (r === 'month') return { from: t.slice(0, 8) + '01', to: t, range: r };
  if (r === 'lastmonth') { const first = t.slice(0, 8) + '01', end = addDays(first, -1); return { from: end.slice(0, 8) + '01', to: end, range: r }; }
  if (r === 'custom' && /^\d{4}-\d\d-\d\d$/.test(q.from || '') && /^\d{4}-\d\d-\d\d$/.test(q.to || '')) {
    const from = q.from <= q.to ? q.from : q.to, to = q.from <= q.to ? q.to : q.from;
    return { from, to: to > t ? t : to, range: r };
  }
  return { from: t, to: t, range: 'today' };
}

/* what each customer and supplier owes or is owed, and each account's balance, from the journal */
function ledger(S) {
  const party = new Map(), ac = new Map();
  for (const j of S.journal || []) for (const l of j.lines || []) {
    const dr = +l.dr || 0, cr = +l.cr || 0;
    ac.set(l.ac, (ac.get(l.ac) || 0) + dr - cr);
    if (l.party && l.ac === (l.party.type === 'C' ? '1100' : '2100')) {
      const k = l.party.type + l.party.id; party.set(k, (party.get(k) || 0) + (l.party.type === 'C' ? dr - cr : cr - dr));
    }
  }
  return { party: (t, id) => party.get(t + id) || 0, ac: (a) => ac.get(a) || 0 };
}

export function reportOf(data, q = {}, who = {}) {
  const S = (data && data.S) || {}, CFG = (data && data.CFG) || {};
  const { from, to, range } = rangeOf(q);
  const now = todayHere(), inR = (d) => { const x = String(d || '').slice(0, 10); return x >= from && x <= to; };
  const P = new Map((S.products || []).map(p => [p.id, p]));
  const L = ledger(S);

  // ---- the sales ----
  const sales = (S.sales || []).filter(s => s && !isBF(s) && inR(s.date));
  let total = 0, profit = 0, disc = 0, returns = 0, credit = 0, bills = 0;
  const how = { CASH: 0, CARD: 0, BANK: 0, CHEQUE: 0 }, byItem = new Map(), byCat = new Map(), bySeller = new Map(), byDay = new Map(), byHour = new Map();
  for (const s of sales) {
    const t = +s.total || 0; total += t;
    if (t > 0) bills++; else if (t < 0) returns += -t;
    credit += +(s.credit0 ?? s.balance) || 0;
    for (const p of s.pays || []) if (how[p.method] !== undefined) how[p.method] += +p.amount || 0;
    const lines = s.lines || [];
    let gross = 0, cost = 0;
    for (const l of lines) {
      const q2 = +l.qty || 0, v = q2 * (+l.price || 0) - (+l.disc || 0); gross += v; cost += q2 * (+l.cost || 0); disc += +l.disc || 0;
      const p = P.get(l.pid) || {}, name = l.name || p.name || 'Item';
      const it = byItem.get(name) || { name, qty: 0, value: 0, unit: p.unit || '' }; it.qty += q2; it.value += v; byItem.set(name, it);
      const cat = p.cat || 'Other'; byCat.set(cat, (byCat.get(cat) || 0) + v);
    }
    disc += +s.billDisc || 0;
    profit += gross - (+s.billDisc || 0) - cost;
    const who2 = s.salesman || s.by || '—'; const sl = bySeller.get(who2) || { name: who2, bills: 0, value: 0 }; sl.bills += t > 0 ? 1 : 0; sl.value += t; bySeller.set(who2, sl);
    byDay.set(s.date, (byDay.get(s.date) || 0) + t);
    const h = String(s.time || '').slice(0, 2); if (/^\d\d$/.test(h)) byHour.set(h, (byHour.get(h) || 0) + t);
  }
  const days = []; for (let d = from; d <= to && days.length < 92; d = addDays(d, 1)) days.push({ d, v: r2(byDay.get(d) || 0) });
  const hours = []; for (let h = 7; h <= 21; h++) { const k = String(h).padStart(2, '0'); hours.push({ h: k, v: r2(byHour.get(k) || 0) }); }

  // ---- money in and out ----
  const pays = S.payments || [];
  const inn = pays.filter(p => p && p.dir === 'IN' && inR(p.date));
  const collected = { total: 0, CASH: 0, CARD: 0, BANK: 0, CHEQUE: 0 };
  for (const p of inn) { collected.total += +p.amount || 0; if (collected[p.method] !== undefined) collected[p.method] += +p.amount || 0; }
  const paidOut = pays.filter(p => p && !p.dir && p.supplierId && inR(p.date)).reduce((a, p) => a + (+p.total || 0), 0);
  const exp = (S.expenses || []).filter(e => e && inR(e.date));
  const expByCat = new Map(); for (const e of exp) { const k = EXP[e.cat] || 'Other'; expByCat.set(k, (expByCat.get(k) || 0) + (+e.amount || 0)); }
  const expenses = exp.reduce((a, e) => a + (+e.amount || 0), 0);
  const bought = (S.purchases || []).filter(p => p && !isBF(p) && inR(p.date)).reduce((a, p) => a + (+p.total || 0), 0);

  // ---- what customers owe (now) ----
  const custs = (S.customers || []).filter(c => c && c.id !== 1).map(c => ({ c, owes: L.party('C', c.id) })).filter(x => x.owes > 0.005);
  const age = [0, 0, 0, 0];
  const openOf = (id) => (S.sales || []).filter(s => s.customerId === id && +s.balance > 0.005);
  const custRows = custs.map(({ c, owes }) => {
    const open = openOf(c.id), oldest = open.reduce((a, s) => Math.max(a, daysAgo(s.date, now)), 0);
    for (const s of open) { const d = daysAgo(s.date, now); age[d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3] += +s.balance || 0; }
    return { name: c.name, owes: r2(owes), oldest, bills: open.length, limit: +c.limit || 0, cat: c.cat || '' };
  }).sort((a, b) => b.owes - a.owes);

  // ---- what the shop owes suppliers (now) ----
  const sups = (S.suppliers || []).map(s => ({ s, owed: L.party('S', s.id) })).filter(x => x.owed > 0.005);
  const supRows = sups.map(({ s, owed }) => {
    const open = (S.purchases || []).filter(p => p.supplierId === s.id && (+p.total || 0) - (+p.paid || 0) > 0.005);
    const oldest = open.reduce((a, p) => Math.max(a, daysAgo(p.date, now)), 0);
    const due = open.filter(p => p.due && p.due <= now).reduce((a, p) => a + ((+p.total || 0) - (+p.paid || 0)), 0);
    return { name: s.name, owed: r2(owed), oldest, bills: open.length, overdue: r2(due) };
  }).sort((a, b) => b.owed - a.owed);

  // ---- cheques ----
  const chq = S.cheques || [];
  const inHand = chq.filter(c => c && (c.dir === 'RECEIVED') && ['RECEIVED', 'DEPOSITED'].includes(c.status || 'RECEIVED'));
  const toClear = chq.filter(c => c && c.dir === 'ISSUED' && ['ISSUED', 'PRINTED'].includes(c.status));
  const chqRow = (c) => ({ no: c.no || '', who: c.party || c.payee || c.from || '', bank: c.bank || '', date: c.date || '', amount: r2(c.amount) });

  // ---- cash and banks (now) ----
  const banks = (S.banks || []).filter(b => b && b.ac).map(b => ({ name: b.name + (b.no ? ' ·' + String(b.no).slice(-4) : ''), bal: r2(L.ac(b.ac)) }));
  const cash = r2(L.ac('1010')), petty = r2(L.ac('1015'));

  // ---- stock (now) ----
  const prods = (S.products || []).filter(p => p && p.active !== false && p.id > 0);
  const stockValue = prods.reduce((a, p) => a + Math.max(0, +p.stock || 0) * (+p.cost || 0), 0);
  const low = prods.filter(p => (+p.min || 0) > 0 && (+p.stock || 0) <= (+p.min || 0));

  const close = (S.dayends || []).find(r => r && String(r.date) === to);
  const showProfit = who.profit !== false;
  const top = (m, n, f) => [...m.values()].sort((a, b) => f(b) - f(a)).slice(0, n);
  return {
    ok: true, shop: { name: (CFG.shop || {}).name || 'Regal Hardware', addr: (CFG.shop || {}).addr || '' }, who: who.name || '',
    range, from, to, at: new Date().toLocaleString('en-GB', { timeZone: TZ, hour12: false }).slice(0, 17),
    sales: { total: r2(total), bills, avg: r2(bills ? total / bills : 0), returns: r2(returns), discounts: r2(disc), credit: r2(credit),
      profit: showProfit ? r2(profit) : null, margin: showProfit && total > 0 ? +(profit / total * 100).toFixed(1) : null,
      cash: r2(how.CASH), card: r2(how.CARD), bank: r2(how.BANK), cheque: r2(how.CHEQUE), days, hours },
    topItems: top(byItem, 8, x => x.value).map(x => ({ ...x, qty: +x.qty.toFixed(3), value: r2(x.value) })),
    topCats: [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, v]) => ({ name, value: r2(v) })),
    sellers: top(bySeller, 8, x => x.value).map(x => ({ ...x, value: r2(x.value) })),
    money: { collected: { total: r2(collected.total), cash: r2(collected.CASH), card: r2(collected.CARD), bank: r2(collected.BANK), cheque: r2(collected.CHEQUE) },
      paidSuppliers: r2(paidOut), expenses: r2(expenses), expByCat: [...expByCat.entries()].sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, value: r2(v) })), bought: r2(bought) },
    customers: { total: r2(custRows.reduce((a, x) => a + x.owes, 0)), count: custRows.length, age: age.map(r2), top: custRows.slice(0, 12),
      overLimit: custRows.filter(x => x.limit > 0 && x.owes > x.limit).length },
    suppliers: { total: r2(supRows.reduce((a, x) => a + x.owed, 0)), count: supRows.length, overdue: r2(supRows.reduce((a, x) => a + x.overdue, 0)), top: supRows.slice(0, 12) },
    cheques: { inHand: r2(inHand.reduce((a, c) => a + (+c.amount || 0), 0)), inHandN: inHand.length, toClear: r2(toClear.reduce((a, c) => a + (+c.amount || 0), 0)), toClearN: toClear.length,
      nextIn: inHand.filter(c => c.date && c.date <= addDays(now, 7)).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 8).map(chqRow),
      nextOut: toClear.filter(c => c.date && c.date <= addDays(now, 7)).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 8).map(chqRow) },
    cash: { drawer: cash, petty, banks, total: r2(cash + petty + banks.reduce((a, b) => a + b.bal, 0)) },
    stock: { value: r2(stockValue), items: prods.length, low: low.length },
    dayEnd: close ? { closed: true, diff: r2(close.diff), by: close.by || '' } : { closed: false },
  };
}

/* the short text a director gets with their link */
export function textOf(rep, link) {
  const m = (n) => 'Rs ' + (+n || 0).toLocaleString('en-LK', { maximumFractionDigits: 0 });
  return `${rep.shop.name} — ${rep.from === rep.to ? rep.from : rep.from + ' to ' + rep.to}\nSales: ${m(rep.sales.total)} (${rep.sales.bills} bills)\nCollected: ${m(rep.money.collected.total)}\nCustomers owe: ${m(rep.customers.total)}\nWe owe suppliers: ${m(rep.suppliers.total)}\nLive report: ${link}`;
}

/* the email: the headline figures as a tidy table, and the button to the live page */
export function mailOf(rep, link) {
  const m = (n) => 'Rs ' + (+n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const when = rep.from === rep.to ? rep.from : `${rep.from} to ${rep.to}`;
  const row = (k, v, strong) => `<tr><td style="padding:7px 0;color:#5A6E72;border-bottom:1px solid #EAEEED">${k}</td><td style="padding:7px 0;text-align:right;border-bottom:1px solid #EAEEED;${strong ? 'font-weight:700;color:#201819' : ''}">${v}</td></tr>`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #EAEEED;border-radius:14px;overflow:hidden">
   <div style="background:linear-gradient(135deg,#7E141D,#C62833);color:#fff;padding:22px 24px"><div style="font-size:13px;opacity:.85">Directors' report · ${esc(when)}</div>
    <div style="font-size:22px;font-weight:800;margin-top:4px">${esc(rep.shop.name)}</div>
    <div style="font-size:30px;font-weight:800;margin-top:14px">${m(rep.sales.total)}</div><div style="opacity:.85;font-size:13px">sales · ${rep.sales.bills} bills${rep.sales.profit != null ? ` · profit ${m(rep.sales.profit)}` : ''}</div></div>
   <div style="padding:16px 24px"><table style="width:100%;border-collapse:collapse;font-size:14px">
    ${row('Cash taken', m(rep.sales.cash))}${row('Card / bank', m(rep.sales.card + rep.sales.bank))}${row('On credit', m(rep.sales.credit))}
    ${row('Collected from customers', m(rep.money.collected.total), true)}${row('Paid to suppliers', m(rep.money.paidSuppliers))}${row('Expenses', m(rep.money.expenses))}
    ${row('Customers owe us', m(rep.customers.total), true)}${row('We owe suppliers', m(rep.suppliers.total), true)}
    ${row('Cheques in hand', m(rep.cheques.inHand))}${row('Cash &amp; banks', m(rep.cash.total))}${row('Stock at cost', m(rep.stock.value))}</table>
    <div style="text-align:center;margin:20px 0 6px"><a href="${esc(link)}" style="display:inline-block;background:#AE1E2B;color:#fff;text-decoration:none;font-weight:700;padding:12px 26px;border-radius:99px">Open the live report</a></div>
    <div style="text-align:center;color:#8C9CA0;font-size:12px">It shows the figures as they are when you open it, and keeps up while it is open.</div></div></div>`;
  return { subject: `${rep.shop.name}: directors' report ${when}`, text: textOf(rep, link), html };
}
