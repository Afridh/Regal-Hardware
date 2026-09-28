/* The books, boiled down to something Claude can read.

   The books are one big JSON document — every product, customer, supplier and bill the
   shop has ever had. Sending that whole thing on every question would be slow, dear, and
   no more accurate. So this builds a short report of the figures that actually answer the
   question, and only that goes out.

   The figures are worked out the same way the till works them out, because an answer that
   is confidently wrong is worse than no answer at all:
     · what a customer owes, and what we owe a supplier, come out of the journal — account
       1100 for debtors and 2100 for creditors, exactly as partyBal() does in app/index.html
     · gross profit is the bill total less the cost carried on each line, which is the cost
       at the moment it was sold
   Nothing here guesses. If a figure cannot be worked out it is left out, so that Claude has
   no reason to invent one. */

const CAP = { rows: 25, lines: 40, digest: 60000 };

/* ---------- small helpers ---------- */
const num = n => (Number.isFinite(+n) ? +n : 0);
const money = n => 'Rs ' + Math.round(num(n)).toLocaleString('en-US');
const pct = (a, b) => (num(b) ? (num(a) / num(b) * 100).toFixed(1) + '%' : '—');
const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** Today where the shop is, not where the server is. */
export function shopToday(tz = process.env.SHOP_TZ || 'Asia/Colombo') {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()) }
  catch { return new Date().toISOString().slice(0, 10) }
}
const daysBack = (from, n) => { const d = new Date(from + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) };
const weekday = d => { try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }) } catch { return '' } };

/* a table with a header, kept to a sane number of rows */
function table(head, rows, cap = CAP.rows) {
  if (!rows.length) return '(none)';
  const shown = rows.slice(0, cap);
  const more = rows.length - shown.length;
  return [head, ...shown].join('\n') + (more > 0 ? `\n… and ${more} more not listed` : '');
}

/* ---------- what is owed, straight off the journal ---------- */
function balances(S) {
  const m = new Map();                       // "C12" -> [debits, credits]
  for (const j of S.journal || []) {
    for (const l of j.lines || []) {
      if (!l.party) continue;
      if (l.ac !== (l.party.type === 'C' ? '1100' : '2100')) continue;
      const k = l.party.type + l.party.id;
      const v = m.get(k) || [0, 0];
      v[0] += num(l.dr); v[1] += num(l.cr);
      m.set(k, v);
    }
  }
  return {
    owedBy: id => { const v = m.get('C' + id); return v ? v[0] - v[1] : 0 },   // a customer owes us
    owedTo: id => { const v = m.get('S' + id); return v ? v[1] - v[0] : 0 }    // we owe a supplier
  };
}

/* ---------- sales ---------- */
function salesBetween(S, from, to) {
  return (S.sales || []).filter(s => s.date >= from && s.date <= to);
}
function profitOf(sale) {
  const cogs = (sale.lines || []).reduce((a, l) => a + num(l.qty) * num(l.cost), 0);
  return num(sale.total) - cogs;
}
function dayRows(S, from, to) {
  const by = new Map();
  for (const s of salesBetween(S, from, to)) {
    const r = by.get(s.date) || { bills: 0, sales: 0, profit: 0, credit: 0 };
    r.bills++; r.sales += num(s.total); r.profit += profitOf(s); r.credit += num(s.balance);
    by.set(s.date, r);
  }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}
function totals(S, from, to) {
  const list = salesBetween(S, from, to);
  const sales = list.reduce((a, s) => a + num(s.total), 0);
  const profit = list.reduce((a, s) => a + profitOf(s), 0);
  const credit = list.reduce((a, s) => a + num(s.balance), 0);
  return { bills: list.length, sales, profit, credit, margin: pct(profit, sales) };
}

/* ---------- the pieces a report is made of ---------- */

function headFacts(S, CFG, today) {
  const shop = CFG?.shop || {};
  return [
    `SHOP: ${clean(shop.name) || 'Regal Hardware'}${shop.address ? ', ' + clean(shop.address) : ''}`,
    `TODAY: ${today} (${weekday(today)})`,
    `All money is Sri Lankan rupees (Rs). "Owes" means owes the shop; "we owe" means the shop owes the supplier.`,
    `Counted from the books: ${(S.products || []).length} products, ${(S.customers || []).length} customers, ${(S.suppliers || []).length} suppliers, ${(S.sales || []).length} bills on record.`
  ].join('\n');
}

function salesSection(S, today, days = 14) {
  const from = daysBack(today, days - 1);
  const rows = dayRows(S, from, today).map(([d, r]) =>
    `${d} ${weekday(d).slice(0, 3)}  bills ${r.bills}  sales ${money(r.sales)}  profit ${money(r.profit)} (${pct(r.profit, r.sales)})  on credit ${money(r.credit)}`);
  const now = totals(S, from, today);
  const prevFrom = daysBack(today, days * 2 - 1), prevTo = daysBack(today, days);
  const was = totals(S, prevFrom, prevTo);
  const change = was.sales ? ((now.sales - was.sales) / was.sales * 100).toFixed(1) + '%' : '—';
  return [
    `SALES, last ${days} days (newest first):`,
    table('date        bills / sales / gross profit / sold on credit', rows, days),
    ``,
    `Last ${days} days: ${now.bills} bills, ${money(now.sales)} sales, ${money(now.profit)} gross profit (${now.margin}), ${money(now.credit)} of it on credit.`,
    `The ${days} days before that: ${was.bills} bills, ${money(was.sales)} sales, ${money(was.profit)} gross profit (${was.margin}).`,
    `Change in sales: ${change}.`
  ].join('\n');
}

function itemSection(S, today, days = 30, cap = CAP.rows) {
  const from = daysBack(today, days - 1);
  const by = new Map();
  for (const s of salesBetween(S, from, today)) {
    for (const l of s.lines || []) {
      const r = by.get(l.pid) || { qty: 0, sales: 0, profit: 0 };
      r.qty += num(l.qty);
      r.sales += num(l.qty) * num(l.price) - num(l.disc);
      r.profit += num(l.qty) * (num(l.price) - num(l.cost)) - num(l.disc);
      by.set(l.pid, r);
    }
  }
  const prod = new Map((S.products || []).map(p => [p.id, p]));
  const rows = [...by.entries()]
    .map(([pid, r]) => ({ p: prod.get(pid), ...r }))
    .filter(r => r.p)
    .sort((a, b) => b.profit - a.profit);
  const fmt = r => `${clean(r.p.name)}${r.p.cat ? ' [' + clean(r.p.cat) + ']' : ''}  sold ${(+r.qty.toFixed(2))} ${clean(r.p.unit) || ''}  sales ${money(r.sales)}  profit ${money(r.profit)} (${pct(r.profit, r.sales)})`;
  const losing = rows.filter(r => r.profit < 0);
  return [
    `BEST ITEMS by gross profit, last ${days} days:`,
    table('item / quantity / sales / profit', rows.slice(0, cap).map(fmt), cap),
    ``,
    `ITEMS SOLD AT A LOSS, last ${days} days: ${losing.length ? '' : '(none)'}`,
    losing.length ? table('item / quantity / sales / profit', losing.map(fmt), 10) : ''
  ].filter(Boolean).join('\n');
}

function stockSection(S, today, cap = CAP.rows) {
  const prods = (S.products || []).filter(p => p.active !== false);
  const low = prods.filter(p => num(p.min) > 0 && num(p.stock) <= num(p.min))
    .sort((a, b) => (num(a.stock) - num(a.min)) - (num(b.stock) - num(b.min)));
  const sold = new Set();
  const since = daysBack(today, 59);
  for (const s of salesBetween(S, since, today)) for (const l of s.lines || []) sold.add(l.pid);
  const dead = prods.filter(p => num(p.stock) > 0 && !sold.has(p.id))
    .map(p => ({ p, tied: num(p.stock) * num(p.cost) }))
    .sort((a, b) => b.tied - a.tied);
  const tiedTotal = prods.reduce((a, p) => a + num(p.stock) * num(p.cost), 0);
  const deadTotal = dead.reduce((a, d) => a + d.tied, 0);
  return [
    `STOCK: ${money(tiedTotal)} of money is sitting in stock, at cost.`,
    ``,
    `AT OR BELOW MINIMUM (${low.length}):`,
    table('item / on hand / minimum / supplier', low.map(p =>
      `${clean(p.name)}  on hand ${num(p.stock)} ${clean(p.unit) || ''}  minimum ${num(p.min)}${p.cat ? '  [' + clean(p.cat) + ']' : ''}`), cap),
    ``,
    `NOT SOLD IN 60 DAYS but still in stock — ${money(deadTotal)} tied up across ${dead.length} items:`,
    table('item / on hand / money tied up', dead.slice(0, cap).map(d =>
      `${clean(d.p.name)}  on hand ${num(d.p.stock)} ${clean(d.p.unit) || ''}  tied up ${money(d.tied)}${d.p.cat ? '  [' + clean(d.p.cat) + ']' : ''}`), cap)
  ].join('\n');
}

function debtorSection(S, cap = CAP.rows) {
  const bal = balances(S);
  const rows = (S.customers || [])
    .filter(c => c.id !== 1)                                   // the walk-in counter customer
    .map(c => ({ c, owes: bal.owedBy(c.id) }))
    .filter(r => r.owes > 1)
    .sort((a, b) => b.owes - a.owes);
  const total = rows.reduce((a, r) => a + r.owes, 0);
  const over = rows.filter(r => num(r.c.limit) > 0 && r.owes > num(r.c.limit));
  return [
    `CUSTOMERS WHO OWE THE SHOP: ${money(total)} across ${rows.length} customers.`,
    table('customer / owes / credit limit', rows.slice(0, cap).map(r =>
      `${clean(r.c.name)}  owes ${money(r.owes)}${num(r.c.limit) > 0 ? `  limit ${money(r.c.limit)}${r.owes > num(r.c.limit) ? '  ** OVER THE LIMIT **' : ''}` : '  (no limit set)'}`), cap),
    ``,
    `OVER THEIR LIMIT: ${over.length}${over.length ? ' — ' + over.slice(0, 10).map(r => `${clean(r.c.name)} by ${money(r.owes - num(r.c.limit))}`).join(', ') : ''}`
  ].join('\n');
}

function supplierSection(S, today, cap = CAP.rows) {
  const bal = balances(S);
  const lastBuy = new Map();
  for (const p of S.purchases || []) {
    const cur = lastBuy.get(p.supplierId);
    if (!cur || p.date > cur) lastBuy.set(p.supplierId, p.date);
  }
  const rows = (S.suppliers || [])
    .map(s => ({ s, owe: bal.owedTo(s.id), last: lastBuy.get(s.id) || null }))
    .filter(r => r.owe > 1)
    .sort((a, b) => b.owe - a.owe);
  const total = rows.reduce((a, r) => a + r.owe, 0);
  return [
    `WHAT THE SHOP OWES SUPPLIERS: ${money(total)} across ${rows.length} suppliers.`,
    table('supplier / we owe / credit days / last purchase', rows.slice(0, cap).map(r =>
      `${clean(r.s.name)}  we owe ${money(r.owe)}${num(r.s.days) > 0 ? `  credit ${num(r.s.days)} days` : '  (credit days not set)'}${r.last ? `  last bought ${r.last}` : ''}`), cap)
  ].join('\n');
}

function moneySection(S, today) {
  const chq = S.cheques || [];
  const held = chq.filter(c => c.dir === 'RECEIVED' && c.status === 'RECEIVED');
  const out = chq.filter(c => c.dir === 'ISSUED' && c.status === 'ISSUED');
  const soon = out.filter(c => c.date >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const from = daysBack(today, 29);
  const exp = (S.expenses || []).filter(e => e.date >= from && e.date <= today);
  const byCat = new Map();
  for (const e of exp) byCat.set(clean(e.cat) || 'Other', (byCat.get(clean(e.cat) || 'Other') || 0) + num(e.amount));
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  return [
    `CHEQUES RECEIVED AND NOT YET BANKED: ${held.length}, worth ${money(held.reduce((a, c) => a + num(c.amount), 0))}.`,
    `CHEQUES THE SHOP HAS ISSUED, NOT YET CLEARED: ${out.length}, worth ${money(out.reduce((a, c) => a + num(c.amount), 0))}.`,
    soon.length ? `\nISSUED CHEQUES FALLING DUE (nearest first):\n` + table('date / payee / amount', soon.slice(0, 15).map(c =>
      `${c.date}  ${clean(c.payee || c.party)}  ${money(c.amount)}${c.no ? '  no ' + clean(c.no) : ''}`), 15) : '',
    ``,
    `EXPENSES, last 30 days: ${money(exp.reduce((a, e) => a + num(e.amount), 0))} over ${exp.length} entries.`,
    table('kind / amount', cats.map(([c, v]) => `${c}  ${money(v)}`), 15)
  ].filter(Boolean).join('\n');
}

/* Anything in the question that names a real customer, supplier or product gets its own
   detail attached — that is what makes "how much does Sunil owe me" answerable. */
function mentioned(S, question) {
  const q = ' ' + String(question || '').toLowerCase() + ' ';
  if (q.trim().length < 3) return '';
  const hit = name => { const n = clean(name).toLowerCase(); return n.length >= 3 && q.includes(n) };
  const bal = balances(S);
  const out = [];

  for (const c of (S.customers || []).filter(c => c.id !== 1 && hit(c.name)).slice(0, 5)) {
    const bills = (S.sales || []).filter(s => s.customerId === c.id).slice(-CAP.lines).reverse();
    out.push([
      `CUSTOMER "${clean(c.name)}": owes ${money(bal.owedBy(c.id))}, credit limit ${num(c.limit) ? money(c.limit) : 'not set'}${c.phone ? ', phone ' + clean(c.phone) : ''}${c.level ? ', price level ' + clean(c.level) : ''}.`,
      `Their last ${bills.length} bills:`,
      table('bill / date / total / still owing', bills.map(b =>
        `${clean(b.no)}  ${b.date}  ${money(b.total)}  still owing ${money(b.balance)}`), CAP.lines)
    ].join('\n'));
  }

  for (const s of (S.suppliers || []).filter(s => hit(s.name)).slice(0, 5)) {
    const buys = (S.purchases || []).filter(p => p.supplierId === s.id).slice(-CAP.lines).reverse();
    out.push([
      `SUPPLIER "${clean(s.name)}": the shop owes ${money(bal.owedTo(s.id))}, credit ${num(s.days) ? num(s.days) + ' days' : 'not set'}${s.phone ? ', phone ' + clean(s.phone) : ''}.`,
      `Last ${buys.length} purchases from them:`,
      table('purchase / date / their invoice / total / paid', buys.map(p =>
        `${clean(p.no)}  ${p.date}  ${clean(p.supInv) || '—'}  ${money(p.total)}  paid ${money(p.paid)}`), CAP.lines)
    ].join('\n'));
  }

  for (const p of (S.products || []).filter(p => hit(p.name)).slice(0, 8)) {
    out.push(`PRODUCT "${clean(p.name)}"${p.cat ? ' [' + clean(p.cat) + ']' : ''}: on hand ${num(p.stock)} ${clean(p.unit) || ''}, cost ${money(p.cost)}, retail ${money(p.retail)}${num(p.wholesale) ? ', wholesale ' + money(p.wholesale) : ''}${num(p.mrp) ? ', MRP ' + money(p.mrp) : ''}${num(p.webPrice) ? ', online ' + money(p.webPrice) : ''}${num(p.min) ? ', minimum ' + num(p.min) : ''}.`);
  }

  return out.length ? `ASKED ABOUT BY NAME:\n\n` + out.join('\n\n') : '';
}

/* ---------- what each mode is shown ---------- */
export function buildDigest(books, { mode = 'ask', question = '' } = {}) {
  const S = books?.S || {};
  const CFG = books?.CFG || {};
  const today = shopToday();
  const parts = [headFacts(S, CFG, today)];

  if (mode === 'write') {
    // writing needs the shop's voice and the item, not the whole ledger
    parts.push(`WHAT THE SHOP SELLS, by category: ` +
      [...new Set((S.products || []).map(p => clean(p.cat)).filter(Boolean))].slice(0, 40).join(', '));
    parts.push(itemSection(S, today, 30, 12));
    const m = mentioned(S, question);
    if (m) parts.push(m);
  } else if (mode === 'today') {
    parts.push(salesSection(S, today, 14));
    parts.push(debtorSection(S, 15));
    parts.push(supplierSection(S, today, 15));
    parts.push(moneySection(S, today));
    parts.push(stockSection(S, today, 15));
  } else if (mode === 'ideas') {
    parts.push(salesSection(S, today, 30));
    parts.push(itemSection(S, today, 90, 30));
    parts.push(stockSection(S, today, 20));
    parts.push(debtorSection(S, 10));
    parts.push(moneySection(S, today));
  } else {
    // "ask": a broad picture, plus whatever the question named
    parts.push(salesSection(S, today, 14));
    parts.push(debtorSection(S));
    parts.push(supplierSection(S, today));
    parts.push(stockSection(S, today, 15));
    parts.push(moneySection(S, today));
    const m = mentioned(S, question);
    if (m) parts.push(m);
  }

  let text = parts.filter(Boolean).join('\n\n----------\n\n');
  let trimmed = false;
  if (text.length > CAP.digest) { text = text.slice(0, CAP.digest) + '\n\n(cut short — the rest was too long to send)'; trimmed = true }
  return { text, today, trimmed, chars: text.length };
}
