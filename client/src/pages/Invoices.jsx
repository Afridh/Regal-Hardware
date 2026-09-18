import { useNavigate } from 'react-router-dom';
import { useList, DataTable, Pager, Badge, fmt, fmtDate, fmtTime, todayStr, firstOfMonth, downloadCsv } from '../components/ui.jsx';

export default function Invoices() {
  const nav = useNavigate();
  const list = useList('/sales/invoices', { date_from: firstOfMonth(), date_to: todayStr(), status: '', order_status: '', inv_mode: '' });
  const cols = [
    { key: 'serial_no', label: 'Serial' },
    { key: 'invoice_date', label: 'Date', render: r => `${fmtDate(r.invoice_date)} ${fmtTime(r.invoice_time)}` },
    { key: 'inv_mode', label: 'Type', render: r => r.inv_mode === 'RET' ? <Badge status="RETURNED">RETURN</Badge> : 'Invoice' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'pay_mode', label: 'Pay' },
    { key: 'net_total', label: 'Net', num: true },
    { key: 'due_amount', label: 'Due', num: true, render: r => <span className={Number(r.due_amount) > 0 ? 'text-bad' : ''}>{fmt(r.due_amount)}</span> },
    { key: 'invoice_status', label: 'Status', render: r => <Badge status={r.invoice_status} /> },
    { key: 'order_status', label: 'Payment', render: r => <Badge status={r.order_status} /> },
    { key: 'created_by', label: 'User' },
  ];
  return (
    <div className="card">
      <div className="toolbar">
        <input className="input sm" placeholder="Search serial / customer" value={list.q} onChange={e => list.setQ(e.target.value)} />
        <input type="date" className="input sm" value={list.filters.date_from} onChange={e => list.setFilter('date_from', e.target.value)} />
        <input type="date" className="input sm" value={list.filters.date_to} onChange={e => list.setFilter('date_to', e.target.value)} />
        <select className="input sm" value={list.filters.inv_mode} onChange={e => list.setFilter('inv_mode', e.target.value)}><option value="">All types</option><option value="INV">Invoices</option><option value="RET">Returns</option></select>
        <select className="input sm" value={list.filters.status} onChange={e => list.setFilter('status', e.target.value)}><option value="">All status</option><option>PRINTED</option><option>HOLD</option><option>CANCELLED</option></select>
        <select className="input sm" value={list.filters.order_status} onChange={e => list.setFilter('order_status', e.target.value)}><option value="">All payment</option><option>PAID</option><option>PARTIAL</option><option>UNPAID</option></select>
        <span className="grow" />
        <span className="muted">Net {fmt(list.extra.sum_net)} · Due {fmt(list.extra.sum_due)}</span>
        <button className="btn sm" onClick={() => downloadCsv('invoices.csv', cols, list.rows)}>⬇ CSV</button>
      </div>
      <DataTable columns={cols} rows={list.rows} loading={list.loading} onRowClick={r => nav(`/invoices/${r.id}`)} />
      <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
    </div>
  );
}
