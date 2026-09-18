import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Stat, Bars, HBars, DataTable, fmt, fmtQty, fmtTime, Badge, useToast } from '../components/ui.jsx';

export default function Dashboard() {
  const { company, locationId } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);
  const cur = company?.currency_symbol || 'Rs.';

  useEffect(() => { get('/dashboard', { location_id: locationId }).then(setD).catch(e => toast.error(errMsg(e))); }, [locationId]);
  if (!d) return <div className="empty">Loading dashboard…</div>;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div><h1>Good day 👋</h1><div className="sub">{company?.name} · {d.date}</div></div>
        <Link to="/pos" className="btn primary">＋ New Invoice</Link>
      </div>

      <div className="stat-grid">
        <Stat label="Today's sales" value={`${cur} ${fmt(d.today.sales)}`} sub={`${d.today.invoices} invoices · cash ${fmt(d.today.cash)}`} />
        <Stat label="Today's profit" value={`${cur} ${fmt(d.today.profit)}`} sub={d.today.sales ? `${fmt(d.today.profit / d.today.sales * 100, 1)}% margin` : '—'} />
        <Stat label="This month" value={`${cur} ${fmt(d.month.sales)}`} sub={`${d.month.invoices} invoices · profit ${fmt(d.month.profit)}`} />
        <Stat label="Receivables" value={`${cur} ${fmt(d.receivables.total)}`} sub={`${d.receivables.customers} customers owe`} />
        <Stat label="Payables" value={`${cur} ${fmt(d.payables.total)}`} sub={`${d.payables.suppliers} suppliers to pay`} />
        <Stat label="Stock value (cost)" value={`${cur} ${fmt(d.stock.value_cost)}`} sub={`${d.stock.items} items · ${d.stock.low_items} low`} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Sales — last 14 days</h2><span className="subtle">Net sales per day</span></div>
          <div className="card-body"><Bars data={d.trend} xKey="day" yKey="sales" labelFn={r => `${r.day}: ${cur} ${fmt(r.sales)} (${r.invoices} inv)`} /></div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Top items — 30 days</h2><span className="subtle">by net sales</span></div>
          <div className="card-body"><HBars data={d.top_items} valueKey="sales" /></div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Recent invoices</h2><Link to="/invoices" className="subtle">View all →</Link></div>
          <DataTable compact rows={d.recent_invoices} columns={[
            { key: 'serial_no', label: 'Serial', render: r => <Link to={`/invoices/${r.id}`}>{r.serial_no}</Link> },
            { key: 'invoice_time', label: 'Time', render: r => fmtTime(r.invoice_time) },
            { key: 'customer_name', label: 'Customer' },
            { key: 'net_total', label: 'Net', num: true },
            { key: 'order_status', label: 'Status', render: r => <Badge status={r.order_status} /> },
          ]} />
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Low stock</h2><Link to="/stock?filter=low" className="subtle">Reorder list →</Link></div>
            <DataTable compact rows={d.low_stock} empty="All items above reorder level" columns={[
              { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' },
              { key: 'qty', label: 'On hand', num: true, render: r => <span className={Number(r.qty) <= 0 ? 'text-bad bold' : 'text-warn'}>{fmtQty(r.qty)}</span> },
              { key: 'qty_min', label: 'Min', num: true, render: r => fmtQty(r.qty_min) },
            ]} />
          </div>
          <div className="stat-grid">
            <Stat label="Pending cheques (in)" value={fmt(d.cheques.amount)} sub={`${d.cheques.pending} cheques · ${d.cheques.due_soon} due in 7 days`} />
            <Stat label="Month income / expense" value={`${fmt(d.income_expense.income)} / ${fmt(d.income_expense.expense)}`} sub="other income vs expenses" />
          </div>
        </div>
      </div>
    </div>
  );
}
