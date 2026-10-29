// The owner's closing summary, sent by the server at the shop's time when nobody has closed the day.
//
// The till sends it at the day's close (deTellOwner) and marks the day in the books (S.summarySent).
// If by Settings → Bills "Time the owner summary goes out" (CFG.bill.summaryTime) the day is still not
// closed, the server sends it itself — the same figures, the same wording (CFG.tpl.closingSummary) — and
// marks the day too, so a close later does not send it again. One row per day in sum_runs, claimed
// before anything goes, so a restart never sends twice. Keep summaryOf in step with closeSummaryVars()
// in frontend/index.html.
import { query } from '../db.js';
import { letter } from '../lib/letter.js';
import { readBooks } from './dues.js';

const TZ = 'Asia/Colombo';
export const SUM_TPL = "Today's summary ({date}):\nBills: {bills}\nSales: {sales}\nCash: {cash} · Credit: {credit}\nProfit: {profit}\nCollected from customers: {collected}\nExpenses: {expenses}\nDrawer: {drawer}\nCustomers owe: {outstanding}\n{unusual}";
const RISKY = { holdDiscard: 'held bill thrown away', billCleared: 'bill cleared', lineOff: 'line taken off', billEdit: 'saved bill changed', billRemade: 'bill re-made', bigDisc: 'big discount', underCost: 'sold under cost', cashRefund: 'cash given back' };
const money = (n) => 'Rs ' + (+n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
export const todayHere = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const hhmm = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false }).slice(0, 5);

let ready = null;
function ensure() {
  if (!ready) ready = query(`CREATE TABLE IF NOT EXISTS sum_runs (day varchar(10) PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), ok boolean, note varchar(300))`)
    .catch(e => { ready = null; throw e; });
  return ready;
}

/* the day's figures, from the books */
export function summaryOf(data, day) {
  const S = (data && data.S) || {};
  const sales = (S.sales || []).filter(s => s && String(s.date) === day);
  const sold = sales.filter(s => +s.total > 0);
  let total = 0, cash = 0, credit = 0, profit = 0;
  for (const s of sales) {
    total += +s.total || 0;
    for (const p of s.pays || []) if (p.method === 'CASH') cash += +p.amount || 0;
    credit += +(s.credit0 ?? s.balance) || 0;
    const lines = s.lines || [];
    const gross = lines.reduce((a, l) => a + ((+l.qty || 0) * (+l.price || 0) - (+l.disc || 0)), 0);
    const cost = lines.reduce((a, l) => a + (+l.qty || 0) * (+l.cost || 0), 0);
    profit += gross - (+s.billDisc || 0) - cost;
  }
  const collected = (S.payments || []).filter(p => p && p.dir === 'IN' && String(p.date) === day).reduce((a, p) => a + (+p.amount || 0), 0);
  const expenses = (S.expenses || []).filter(e => e && String(e.date) === day).reduce((a, e) => a + (+e.amount || 0), 0);
  const owe = (S.customers || []).filter(c => c && c.id !== 1).reduce((a, c) => a + (S.sales || []).filter(s => s.customerId === c.id).reduce((x, s) => x + Math.max(0, +s.balance || 0), 0), 0);
  const close = (S.dayends || []).find(r => r && String(r.date) === day);
  const drawer = close ? (Math.abs(+close.diff || 0) < 0.005 ? 'counted, agreed' : `counted, ${money(Math.abs(close.diff))} ${close.diff > 0 ? 'over' : 'short'}`) : 'not counted yet';
  const risky = (S.trail || []).filter(t => t && t.date === day && RISKY[t.kind]);
  const unusual = risky.length
    ? `To look at (${risky.length}${risky.some(t => t.cam) ? ', with camera clips' : ''}):\n` + risky.slice(0, 3).map(t => `- ${RISKY[t.kind]}: ${t.what} (${t.by})`).join('\n') + (risky.length > 3 ? `\n- and ${risky.length - 3} more on the Trail` : '')
    : 'Nothing unusual today.';
  return { date: day, bills: String(sold.length), sales: money(total), cash: money(cash), credit: money(credit), profit: money(profit),
    collected: money(collected), expenses: money(expenses), drawer, outstanding: money(owe), unusual };
}

export async function summaryTick(send, booksEdit) {
  const data = await readBooks(); if (!data) return;
  const CFG = data.CFG || {}, S = data.S || {};
  if ((CFG.msg || {}).autoSummary === false) return;
  const to = String((CFG.shop || {}).owner || '').split(/[,;\s]+/)[0];
  if (!to) return;
  const day = todayHere(), at = String((CFG.bill || {}).summaryTime || '19:30');
  if (hhmm() < at || (S.summarySent || {})[day]) return;
  await ensure();
  const { rows: [had] } = await query(`SELECT day FROM sum_runs WHERE day = $1`, [day]);
  if (had) return;
  await query(`INSERT INTO sum_runs (day) VALUES ($1)`, [day]);
  const tpl = (CFG.tpl && CFG.tpl.closingSummary && CFG.tpl.closingSummary.text) || SUM_TPL;
  try {
    await send(CFG.msg || {}, to, letter(CFG, 'owner', fill(tpl, { shop: (CFG.shop || {}).name || '', ...summaryOf(data, day) })));
    await query(`UPDATE sum_runs SET ok = true WHERE day = $1`, [day]);
    if (booksEdit) await booksEdit('regal', 'closing summary', (d) => { d.S = d.S || {}; d.S.summarySent = { ...(d.S.summarySent || {}), [day]: 'server' }; }).catch(() => {});
  } catch (e) {
    await query(`UPDATE sum_runs SET ok = false, note = $1 WHERE day = $2`, [String(e.message || e).slice(0, 300), day]);
  }
}
