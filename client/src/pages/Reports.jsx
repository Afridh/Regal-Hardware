import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { DataTable, DateRange, Stat, Lookup, fmt, fmtQty, fmtDate, todayStr, firstOfMonth, useToast, downloadCsv, HBars } from '../components/ui.jsx';

const TABS = [
  { key: 'sales', label: 'Sales', perm: ['cus_rpt', 'emp_rpt', 'account_det', 'view_home'] },
  { key: 'items', label: 'Item / Category sales', perm: ['item_rpt', 'cat_rpt', 'sup_rpt', 'view_home'] },
  { key: 'invoices', label: 'Invoice list', perm: ['cus_rpt', 'account_det', 'view_home'] },
  { key: 'top', label: 'Top 10', perm: ['view_home'] },
  { key: 'purchases', label: 'Purchases', perm: ['sup_rpt', 'account_det'] },
  { key: 'stock', label: 'Stock valuation', perm: ['stock_rpt'] },
  { key: 'reorder', label: 'Reorder', perm: ['stock_rpt'] },
  { key: 'expiry', label: 'Expiry', perm: ['stock_rpt'] },
  { key: 'movement', label: 'Stock movement', perm: ['stock_rpt'] },
  { key: 'outstanding', label: 'Outstanding', perm: ['cus_rpt', 'sup_rpt', 'account_det'] },
  { key: 'statement', label: 'Statements', perm: ['cus_rpt', 'sup_rpt', 'account_det'] },
  { key: 'incexp', label: 'Income / Expense', perm: ['account_det'] },
  { key: 'pl', label: 'Profit & Loss', perm: ['account_det'] },
  { key: 'day', label: 'Day summary', perm: ['print_day_summary', 'view_home'] },
  { key: 'activity', label: 'Activity log', perm: ['user_control'] },
];

function Table({ cols, rows, sumKeys = [], name }) {
  const sums = Object.fromEntries(sumKeys.map(k => [k, rows.reduce((s, r) => s + Number(r[k] || 0), 0)]));
  return (
    <div className="card">
      <div className="toolbar no-print"><span className="muted">{rows.length} rows</span><span className="grow" /><button className="btn sm" onClick={() => downloadCsv(`${name}.csv`, cols, rows)}>⬇ CSV</button><button className="btn sm" onClick={() => window.print()}>🖨 Print</button></div>
      <DataTable columns={cols} rows={rows} compact keyField="key" footer={sumKeys.length ? cols.map((c, i) => <td key={c.key} className={c.num ? 'num' : ''}>{i === 0 ? 'Total' : sumKeys.includes(c.key) ? fmt(sums[c.key]) : ''}</td>) : null} />
    </div>
  );
}

export default function Reports() {
  const { can, company, locations } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const visible = TABS.filter(t => can(t.perm));
  const [tab, setTab] = useState(sp.get('tab') || visible[0]?.key);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayStr());
  const [loc, setLoc] = useState('');
  const [group, setGroup] = useState('day');
  const [rows, setRows] = useState([]);
  const [data, setData] = useState(null);
  const [party, setParty] = useState(sp.get('customer_id') ? { type: 'customer', id: sp.get('customer_id') } : sp.get('supplier_id') ? { type: 'supplier', id: sp.get('supplier_id') } : null);
  const [outKind, setOutKind] = useState('customers');
  const [loading, setLoading] = useState(false);
  const cur = company?.currency_symbol || '';
  const P = { date_from: from, date_to: to, location_id: loc || undefined };

  useEffect(() => { setGroup(tab === 'items' ? 'item' : tab === 'stock' ? 'item' : tab === 'incexp' ? 'category' : 'day'); }, [tab]);

  useEffect(() => {
    let on = true; setLoading(true); setRows([]); setData(null);
    const run = async () => {
      try {
        switch (tab) {
          case 'sales': setRows(await get('/reports/sales/summary', { ...P, group_by: group })); break;
          case 'items': setRows(await get('/reports/sales/items', { ...P, group_by: group })); break;
          case 'invoices': setRows(await get('/reports/sales/invoices', P)); break;
          case 'top': setData(await get('/reports/sales/top', P)); break;
          case 'purchases': setRows(await get('/reports/purchases/summary', { ...P, group_by: group })); break;
          case 'stock': setRows(await get('/reports/stock/valuation', { location_id: loc || undefined, group_by: group })); break;
          case 'reorder': setRows(await get('/reports/stock/reorder', { location_id: loc || undefined })); break;
          case 'expiry': setRows(await get('/reports/stock/expiry', { location_id: loc || undefined, days: 60 })); break;
          case 'movement': setRows(await get('/reports/stock/movement', P)); break;
          case 'outstanding': setRows(await get(`/reports/outstanding/${outKind}`)); break;
          case 'statement': if (party) setData(await get(`/reports/statement/${party.type}/${party.id}`, { date_from: from, date_to: to })); break;
          case 'incexp': setRows(await get('/reports/income-expense', { ...P, group_by: group })); break;
          case 'pl': setData(await get('/reports/profit-loss', P)); break;
          case 'day': setData(await get('/reports/day-summary', P)); break;
          case 'activity': setRows(await get('/reports/activity', { date_from: from, date_to: to })); break;
        }
      } catch (e) { if (on) toast.error(errMsg(e)); }
      finally { if (on) setLoading(false); }
    };
    run(); return () => { on = false; };
  }, [tab, from, to, loc, group, outKind, party?.id]);

  const groupSel = opts => <select className="input sm" value={group} onChange={e => setGroup(e.target.value)}>{opts.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>;
  const money = (key, label) => ({ key, label, num: true });
  const showDates = !['stock', 'reorder', 'expiry', 'outstanding'].includes(tab);

  return (
    <div className="stack">
      <div className="page-head"><h1>Reports</h1></div>
      <div className="tabs no-print">{visible.map(t => <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => { setTab(t.key); setSp({ tab: t.key }); }}>{t.label}</button>)}</div>
      <div className="row no-print">
        {showDates && <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />}
        {locations.length > 1 && <select className="input sm" value={loc} onChange={e => setLoc(e.target.value)} style={{ width: 'auto' }}><option value="">All locations</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        {tab === 'sales' && groupSel([['day', 'Day-wise'], ['week', 'Week-wise'], ['month', 'Month-wise'], ['year', 'Year-wise'], ['hour', 'Hour-wise'], ['customer', 'Customer-wise'], ['salesman', 'Salesman-wise'], ['user', 'Cashier-wise'], ['paymode', 'Pay mode'], ['location', 'Location-wise']])}
        {tab === 'items' && groupSel([['item', 'Item-wise'], ['category', 'Category-wise'], ['subcat', 'Sub-category-wise'], ['supplier', 'Supplier-wise']])}
        {tab === 'purchases' && groupSel([['day', 'Day-wise'], ['month', 'Month-wise'], ['year', 'Year-wise'], ['supplier', 'Supplier-wise'], ['user', 'User-wise']])}
        {tab === 'stock' && groupSel([['item', 'Item-wise'], ['category', 'Category-wise'], ['supplier', 'Supplier-wise']])}
        {tab === 'incexp' && groupSel([['category', 'Category-wise'], ['day', 'Day-wise'], ['month', 'Month-wise']])}
        {tab === 'outstanding' && <select className="input sm" value={outKind} onChange={e => setOutKind(e.target.value)} style={{ width: 'auto' }}><option value="customers">Customers (receivables)</option><option value="suppliers">Suppliers (payables)</option></select>}
        {tab === 'statement' && <>
          <select className="input sm" value={party?.type || 'customer'} onChange={e => setParty({ type: e.target.value, id: null })} style={{ width: 'auto' }}><option value="customer">Customer</option><option value="supplier">Supplier</option></select>
          <div style={{ width: 260 }}><Lookup url={`/master/${party?.type || 'customer'}s`} placeholder={data ? (data.customer || data.supplier).name : 'Search party…'} onPick={r => setParty({ type: party?.type || 'customer', id: r.id })} render={r => <span>{r.name} <small>{r.code}</small></span>} /></div>
        </>}
        {loading && <span className="muted">Loading…</span>}
      </div>
      <div className="print-only"><h2>{company?.name}</h2><p>{TABS.find(t => t.key === tab)?.label} · {from} → {to}</p></div>

      {tab === 'sales' && <Table name="sales" rows={rows} sumKeys={['invoices', 'gross', 'discount', 'sales', 'cost', 'profit', 'qty', 'cash', 'card', 'credit', 'due']} cols={[
        { key: 'label', label: 'Period / Group' }, { key: 'invoices', label: 'Inv', num: true, render: r => r.invoices }, money('gross', 'Gross'), money('discount', 'Discount'), money('sales', 'Net sales'),
        ...(can('show_cost') ? [money('cost', 'Cost'), money('profit', 'Profit'), { key: 'gp', label: 'GP %', num: true, render: r => r.sales ? fmt(r.profit / r.sales * 100, 1) : '-' }] : []),
        { key: 'qty', label: 'Qty', num: true, render: r => fmtQty(r.qty) }, money('cash', 'Cash'), money('card', 'Card'), money('credit', 'Credit'), money('due', 'Due'),
      ]} />}

      {tab === 'items' && <Table name="item-sales" rows={rows} sumKeys={['qty', 'gross', 'sales', 'cost', 'profit']} cols={[
        { key: 'label', label: 'Item / Group' }, { key: 'code', label: 'Code' }, { key: 'invoices', label: 'Inv', num: true, render: r => r.invoices }, { key: 'qty', label: 'Qty', num: true, render: r => fmtQty(r.qty) }, money('gross', 'Gross'), money('sales', 'Net sales'),
        ...(can('show_cost') ? [money('cost', 'Cost'), money('profit', 'Profit'), { key: 'gp', label: 'GP %', num: true, render: r => r.sales ? fmt(r.profit / r.sales * 100, 1) : '-' }] : []),
      ]} />}

      {tab === 'invoices' && <Table name="invoice-list" rows={rows.map(r => ({ ...r, key: r.id }))} sumKeys={['gross_total', 'discount', 'net_total', 'profit', 'due_amount']} cols={[
        { key: 'serial_no', label: 'Serial' }, { key: 'invoice_date', label: 'Date', render: r => fmtDate(r.invoice_date) }, { key: 'inv_mode', label: 'Type' }, { key: 'customer_name', label: 'Customer' }, { key: 'pay_mode', label: 'Pay' }, { key: 'order_status', label: 'Status' },
        money('gross_total', 'Gross'), money('discount', 'Discount'), money('net_total', 'Net'), ...(can('show_cost') ? [money('profit', 'Profit')] : []), money('due_amount', 'Due'), { key: 'created_by', label: 'User' },
      ]} />}

      {tab === 'top' && data && <div className="grid-3">
        <div className="card"><div className="card-head"><h3>Top items</h3></div><div className="card-body"><HBars data={data.items} valueKey="sales" /></div></div>
        <div className="card"><div className="card-head"><h3>Top customers</h3></div><div className="card-body"><HBars data={data.customers} valueKey="sales" /></div></div>
        <div className="card"><div className="card-head"><h3>Top categories</h3></div><div className="card-body"><HBars data={data.categories} valueKey="sales" /></div></div>
      </div>}

      {tab === 'purchases' && <Table name="purchases" rows={rows} sumKeys={['grns', 'gross', 'discount', 'purchases', 'qty', 'paid', 'due']} cols={[
        { key: 'label', label: 'Period / Group' }, { key: 'grns', label: 'GRNs', num: true, render: r => r.grns }, { key: 'returns', label: 'Ret', num: true, render: r => r.returns }, money('gross', 'Gross'), money('discount', 'Discount'), money('purchases', 'Net'), { key: 'qty', label: 'Qty', num: true, render: r => fmtQty(r.qty) }, money('paid', 'Paid'), money('due', 'Due'),
      ]} />}

      {tab === 'stock' && <Table name="stock-valuation" rows={rows.map((r, i) => ({ ...r, key: i }))} sumKeys={['qty', 'value_cost', 'value_selling', 'potential_profit']} cols={[
        { key: 'label', label: 'Item / Group' }, { key: 'code', label: group === 'item' ? 'Code' : 'Items' }, { key: 'qty', label: 'Qty', num: true, render: r => fmtQty(r.qty) },
        ...(can('show_cost') ? [money('value_cost', 'Value @ cost')] : []), money('value_selling', 'Value @ selling'), ...(can('show_cost') ? [money('potential_profit', 'Potential GP')] : []),
      ]} />}

      {tab === 'reorder' && <Table name="reorder" rows={rows.map((r, i) => ({ ...r, key: i }))} cols={[
        { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'supplier_name', label: 'Supplier' }, { key: 'qty', label: 'On hand', num: true, render: r => <span className="text-bad">{fmtQty(r.qty)}</span> }, { key: 'qty_min', label: 'Reorder at', num: true, render: r => fmtQty(r.qty_min) }, { key: 'qty_max', label: 'Max', num: true, render: r => fmtQty(r.qty_max) }, { key: 'suggested', label: 'Suggested order', num: true, render: r => fmtQty(r.suggested) },
      ]} />}

      {tab === 'expiry' && <Table name="expiry" rows={rows.map((r, i) => ({ ...r, key: i }))} sumKeys={['value']} cols={[
        { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'batch_no', label: 'Batch' }, { key: 'expiry_date', label: 'Expiry', render: r => <span className={Number(r.days_left) < 0 ? 'text-bad bold' : Number(r.days_left) <= 14 ? 'text-warn' : ''}>{fmtDate(r.expiry_date)} ({r.days_left} d)</span> }, { key: 'qty_remain', label: 'Qty', num: true, render: r => fmtQty(r.qty_remain) }, ...(can('show_cost') ? [money('cost_price', 'Cost'), money('value', 'Value')] : []),
      ]} />}

      {tab === 'movement' && <Table name="stock-movement" rows={rows.map((r, i) => ({ ...r, key: i }))} cols={[
        { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'opening', label: 'Opening', num: true, render: r => fmtQty(r.opening) }, { key: 'purchased', label: 'In', num: true, render: r => fmtQty(r.purchased) }, { key: 'sold', label: 'Sold', num: true, render: r => fmtQty(r.sold) }, { key: 'returned', label: 'Returned', num: true, render: r => fmtQty(r.returned) },
        { key: 'adjusted', label: 'Adjusted', num: true, render: r => fmtQty(r.adjusted) }, { key: 'transferred_out', label: 'Out', num: true, render: r => fmtQty(r.transferred_out) }, { key: 'on_hand', label: 'On hand now', num: true, render: r => <b>{fmtQty(r.on_hand)}</b> },
      ]} />}

      {tab === 'outstanding' && <Table name={outKind + '-outstanding'} rows={rows} sumKeys={['due_amount', 'advance_amount', 'age_0_30', 'age_31_60', 'age_61_90', 'age_90_plus']} cols={[
        { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'mobile', label: 'Mobile' }, money('due_amount', 'Outstanding'), money('advance_amount', 'Advance'), money('age_0_30', '0–30 d'), money('age_31_60', '31–60 d'), money('age_61_90', '61–90 d'), money('age_90_plus', '90+ d'),
        ...(outKind === 'customers' ? [money('credit_limit', 'Limit'), { key: 'oldest_due', label: 'Oldest', render: r => fmtDate(r.oldest_due) }] : []),
      ]} />}

      {tab === 'statement' && (data ? <div className="card">
        <div className="card-head"><div><h2>{(data.customer || data.supplier).name}</h2><div className="subtle">{(data.customer || data.supplier).code} · {(data.customer || data.supplier).mobile || ''} · current balance {fmt((data.customer || data.supplier).due_amount)}</div></div><button className="btn sm no-print" onClick={() => window.print()}>🖨 Print</button></div>
        <DataTable compact rows={data.lines.map((l, i) => ({ ...l, id: i }))} columns={[
          { key: 'txn_date', label: 'Date', render: r => fmtDate(r.txn_date) }, { key: 'ref', label: 'Reference' }, { key: 'type', label: 'Type' }, money('debit', data.customer ? 'Debit (invoiced)' : 'Debit (paid)'), money('credit', data.customer ? 'Credit (paid)' : 'Credit (GRN)'), money('balance', 'Balance'),
        ]} />
      </div> : <div className="card pad muted">Select a customer or supplier to view the statement.</div>)}

      {tab === 'incexp' && <Table name="income-expense" rows={rows.map((r, i) => ({ ...r, key: i }))} sumKeys={['amount']} cols={[{ key: 'label', label: 'Group' }, { key: 'kind', label: 'Kind' }, { key: 'entries', label: 'Entries', num: true, render: r => r.entries }, money('amount', 'Amount')]} />}

      {tab === 'pl' && data && <div className="stack">
        <div className="stat-grid">
          <Stat label="Net sales" value={`${cur} ${fmt(data.net_sales)}`} sub={`gross ${fmt(data.gross_sales)} · discounts ${fmt(data.discounts)}`} />
          <Stat label="Gross profit" value={`${cur} ${fmt(data.gross_profit)}`} sub={`${fmt(data.gross_margin_pct, 1)}% margin · COGS ${fmt(data.cost_of_goods_sold)}`} />
          <Stat label="Expenses" value={`${cur} ${fmt(data.total_expenses)}`} sub={`other income ${fmt(data.other_income)}`} />
          <Stat label="Net profit" value={`${cur} ${fmt(data.net_profit)}`} sub={`purchases in period ${fmt(data.purchases)}`} className={Number(data.net_profit) < 0 ? 'text-bad' : ''} />
        </div>
        <div className="card"><table className="table compact"><tbody>
          <tr className="bold"><td>Net sales</td><td className="num">{fmt(data.net_sales)}</td></tr>
          <tr><td>Less: cost of goods sold</td><td className="num">({fmt(data.cost_of_goods_sold)})</td></tr>
          <tr className="bold"><td>Gross profit</td><td className="num">{fmt(data.gross_profit)}</td></tr>
          {data.income.map((x, i) => <tr key={'i' + i}><td>Add: {x.category}</td><td className="num">{fmt(x.amount)}</td></tr>)}
          {data.expenses.map((x, i) => <tr key={'e' + i}><td>Less: {x.category}{x.direct ? '' : ' (indirect)'}</td><td className="num">({fmt(x.amount)})</td></tr>)}
          {Number(data.stock_adjustments) !== 0 && <tr><td>Stock adjustments (at cost)</td><td className="num">{fmt(data.stock_adjustments)}</td></tr>}
          <tr className="bold" style={{ fontSize: 15 }}><td>Net profit</td><td className={`num ${Number(data.net_profit) < 0 ? 'text-bad' : 'text-good'}`}>{fmt(data.net_profit)}</td></tr>
        </tbody></table></div>
      </div>}

      {tab === 'day' && data && <div className="stack">
        <div className="stat-grid">
          <Stat label="Sales" value={`${cur} ${fmt(data.sales.net)}`} sub={`${data.sales.invoices} invoices · ${data.sales.returns} returns`} />
          <Stat label="Cash in hand (movement)" value={`${cur} ${fmt(data.cash_in_hand)}`} sub="cash sales + receipts − cash paid out" />
          {can('show_cost') && <Stat label="Gross profit" value={`${cur} ${fmt(data.sales.profit)}`} sub={`cost ${fmt(data.sales.cost)}`} />}
          <Stat label="Purchases" value={`${cur} ${fmt(data.purchases.net)}`} sub={`${data.purchases.grns} GRNs · paid ${fmt(data.purchases.paid)}`} />
        </div>
        <div className="grid-2">
          <div className="card"><div className="card-head"><h3>Collections</h3></div><table className="table compact"><tbody>
            <tr><td>Cash sales</td><td className="num">{fmt(data.sales.cash)}</td></tr><tr><td>Card</td><td className="num">{fmt(data.sales.card)}</td></tr><tr><td>Cheque</td><td className="num">{fmt(data.sales.cheque)}</td></tr><tr><td>Bank</td><td className="num">{fmt(data.sales.bank)}</td></tr>
            <tr><td>Credit sales</td><td className="num">{fmt(data.sales.credit)}</td></tr><tr><td>Vouchers / points</td><td className="num">{fmt(Number(data.sales.voucher) + Number(data.sales.points))}</td></tr><tr><td>Discounts</td><td className="num">{fmt(data.sales.discount)}</td></tr>
            <tr><td>Customer payments received</td><td className="num">{fmt(data.customer_payments.total)} <span className="subtle">({data.customer_payments.n})</span></td></tr>
            <tr><td>Other income</td><td className="num">{fmt(data.income_expense.income)}</td></tr><tr><td>Bank deposits</td><td className="num">{fmt(data.bank.deposits)}</td></tr>
          </tbody></table></div>
          <div className="card"><div className="card-head"><h3>Payments out</h3></div><table className="table compact"><tbody>
            <tr><td>Supplier payments</td><td className="num">{fmt(data.supplier_payments.total)} <span className="subtle">({data.supplier_payments.n})</span></td></tr><tr><td>Expenses</td><td className="num">{fmt(data.income_expense.expense)}</td></tr><tr><td>Bank withdrawals</td><td className="num">{fmt(data.bank.withdrawals)}</td></tr>
            <tr><td colSpan={2} className="bold" style={{ background: 'var(--surface-2)' }}>Sales by pay mode</td></tr>
            {data.pay_modes.map(p => <tr key={p.label}><td>{p.label}</td><td className="num">{fmt(p.sales)} <span className="subtle">({p.invoices})</span></td></tr>)}
          </tbody></table></div>
        </div>
        <div className="row no-print"><button className="btn" onClick={() => window.print()}>🖨 Print day summary</button></div>
      </div>}

      {tab === 'activity' && <Table name="activity" rows={rows.map(r => ({ ...r, key: r.id }))} cols={[
        { key: 'created_at', label: 'Time', render: r => String(r.created_at).slice(0, 19).replace('T', ' ') }, { key: 'username', label: 'User' }, { key: 'action', label: 'Action' }, { key: 'entity', label: 'Entity' }, { key: 'entity_id', label: 'Id' }, { key: 'details', label: 'Details', render: r => r.details ? JSON.stringify(r.details) : '' }, { key: 'ip', label: 'IP' },
      ]} />}
    </div>
  );
}
