import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useList, DataTable, Pager, Modal, RefSelect, fmt, fmtQty, fmtDate, useToast, downloadCsv } from '../components/ui.jsx';

export default function Stock() {
  const { can, locations, locationId } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const list = useList('/stock', { filter: sp.get('filter') || '', category_id: '', supplier_id: '', location_id: locationId }, 50);
  const [ledger, setLedger] = useState(null);
  const [ledgerRows, setLedgerRows] = useState([]);

  const openLedger = async row => {
    setLedger(row);
    try { setLedgerRows(await get(`/stock/ledger/${row.item_id || row.id}`, { location_id: list.filters.location_id })); } catch (e) { toast.error(errMsg(e)); }
  };
  useEffect(() => { const id = sp.get('ledger'); if (id) { get(`/master/items/${id}`).then(it => openLedger({ ...it, item_id: it.id })); } }, []);

  const totals = list.rows.reduce((a, r) => ({ cost: a.cost + Number(r.value_cost), sell: a.sell + Number(r.value_selling) }), { cost: 0, sell: 0 });
  const cols = [
    { key: 'code', label: 'Code' }, { key: 'barcode', label: 'Barcode' }, { key: 'name', label: 'Item' }, { key: 'category_name', label: 'Category' }, { key: 'supplier_name', label: 'Supplier' },
    { key: 'qty_on_hand', label: 'On hand', num: true, render: r => <span className={`bold ${Number(r.qty_on_hand) < 0 ? 'text-bad' : Number(r.qty_on_hand) <= Number(r.qty_min) ? 'text-warn' : ''}`}>{fmtQty(r.qty_on_hand)} {r.unit}</span> },
    { key: 'qty_min', label: 'Reorder', num: true, render: r => fmtQty(r.qty_min) },
    ...(can('show_cost') ? [{ key: 'cost_price', label: 'Cost', num: true }, { key: 'value_cost', label: 'Value (cost)', num: true }] : []),
    { key: 'selling_price', label: 'Price', num: true }, { key: 'value_selling', label: 'Value (selling)', num: true }, { key: 'next_expiry', label: 'Expiry', render: r => fmtDate(r.next_expiry) },
  ];

  return (
    <div className="stack">
      <div className="page-head"><h1>Stock</h1><div className="row"><span className="muted">Page value: cost {fmt(totals.cost)} · selling {fmt(totals.sell)}</span></div></div>
      <div className="card">
        <div className="toolbar">
          <input className="input sm" placeholder="Search item" value={list.q} onChange={e => list.setQ(e.target.value)} />
          {locations.length > 1 && <select className="input sm" value={list.filters.location_id} onChange={e => list.setFilter('location_id', e.target.value)}>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
          <select className="input sm" value={list.filters.filter} onChange={e => { list.setFilter('filter', e.target.value); setSp(e.target.value ? { filter: e.target.value } : {}); }}>
            <option value="">All items</option><option value="low">Low stock (≤ reorder)</option><option value="zero">Out of stock</option><option value="negative">Negative stock</option><option value="expiring">Expiring in 30 days</option>
          </select>
          <RefSelect url="/master/categories" value={list.filters.category_id} onChange={v => list.setFilter('category_id', v)} placeholder="All categories" className="" style={{ width: 160 }} />
          <RefSelect url="/master/suppliers" value={list.filters.supplier_id} onChange={v => list.setFilter('supplier_id', v)} placeholder="All suppliers" className="" style={{ width: 160 }} />
          <span className="grow" />
          <button className="btn sm" onClick={() => downloadCsv('stock.csv', cols, list.rows)}>⬇ CSV</button>
          <button className="btn sm" onClick={() => window.print()}>🖨 Print</button>
        </div>
        <DataTable columns={cols} rows={list.rows} loading={list.loading} onRowClick={openLedger} keyField="item_id" />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>

      <Modal open={!!ledger} title={`Item ledger — ${ledger?.name}`} onClose={() => setLedger(null)} size="lg">
        <table className="table compact">
          <thead><tr><th>Date</th><th>Type</th><th>Ref</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th>{can('show_cost') && <th className="num">Cost</th>}<th className="num">Price</th><th>By</th></tr></thead>
          <tbody>
            {ledgerRows.length === 0 && <tr><td colSpan={9} className="empty">No movements</td></tr>}
            {ledgerRows.map(l => <tr key={l.id}><td>{fmtDate(l.txn_date)}</td><td>{l.txn_type}</td><td>{l.ref_no}</td><td className="num text-good">{Number(l.qty_in) ? fmtQty(l.qty_in) : ''}</td><td className="num text-bad">{Number(l.qty_out) ? fmtQty(l.qty_out) : ''}</td><td className="num bold">{fmtQty(l.balance)}</td>{can('show_cost') && <td className="num">{fmt(l.cost_price)}</td>}<td className="num">{fmt(l.selling_price)}</td><td className="muted">{l.created_by}</td></tr>)}
          </tbody>
        </table>
      </Modal>
    </div>
  );
}
