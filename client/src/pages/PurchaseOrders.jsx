import { useState } from 'react';
import { get, post, put, errMsg } from '../api.js';
import { useList, DataTable, Pager, Badge, Modal, RefSelect, Input, fmt, fmtQty, fmtDate, todayStr, useToast } from '../components/ui.jsx';
import LineEditor from '../components/LineEditor.jsx';
import { GrnForm } from './Purchases.jsx';

export default function PurchaseOrders() {
  const toast = useToast();
  const list = useList('/purchases/orders', { status: '' });
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState([]);
  const [h, setH] = useState({ supplier_id: '', expected_date: '', remark: '' });
  const [view, setView] = useState(null);
  const [receive, setReceive] = useState(null);
  const [busy, setBusy] = useState(false);

  const addItem = it => { const last = it.batches?.[it.batches.length - 1]; setLines(ls => [...ls, { item_id: it.id, item_code: it.code, item_name: it.name, qty: 1, cost_price: last?.cost_price || 0 }]); };
  const loadSuggestions = async () => {
    try {
      const rows = await get('/purchases/reorder-suggestions');
      if (!rows.length) return toast.push('No items below reorder level');
      setLines(rows.filter(r => !h.supplier_id || String(r.supplier_id) === String(h.supplier_id)).map(r => ({ item_id: r.item_id, item_code: r.code, item_name: r.name, qty: Math.max(Number(r.qty_max) - Number(r.qty_on_hand), 1), cost_price: r.cost_price || 0 })));
    } catch (e) { toast.error(errMsg(e)); }
  };
  const save = async () => {
    if (!h.supplier_id || !lines.length) return toast.error('Supplier and items are required');
    setBusy(true);
    try { const po = await post('/purchases/orders', { ...h, items: lines.map(l => ({ ...l, qty: Number(l.qty), cost_price: Number(l.cost_price) })) }); toast.success(`PO ${po.serial_no} created`); setOpen(false); setLines([]); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const openView = async r => { try { setView(await get(`/purchases/orders/${r.id}`)); } catch (e) { toast.error(errMsg(e)); } };
  const setStatus = async (id, status) => { try { await put(`/purchases/orders/${id}/status`, { status }); setView(null); list.reload(); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <div className="stack">
      <div className="page-head"><h1>Purchase Orders</h1><button className="btn primary" onClick={() => setOpen(true)}>＋ New PO</button></div>
      <div className="card">
        <div className="toolbar">
          <input className="input sm" placeholder="Search PO / supplier" value={list.q} onChange={e => list.setQ(e.target.value)} />
          <select className="input sm" value={list.filters.status} onChange={e => list.setFilter('status', e.target.value)}><option value="">All</option><option>OPEN</option><option>RECEIVED</option><option>CANCELLED</option></select>
        </div>
        <DataTable rows={list.rows} loading={list.loading} onRowClick={openView} columns={[
          { key: 'serial_no', label: 'PO no' }, { key: 'po_date', label: 'Date', render: r => fmtDate(r.po_date) }, { key: 'supplier_name', label: 'Supplier' }, { key: 'expected_date', label: 'Expected', render: r => fmtDate(r.expected_date) },
          { key: 'total_qty', label: 'Qty', num: true, render: r => fmtQty(r.total_qty) }, { key: 'net_total', label: 'Value', num: true }, { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> }, { key: 'created_by', label: 'By' },
        ]} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>

      <Modal open={open} title="New purchase order" onClose={() => setOpen(false)} size="lg"
        footer={<><button className="btn" onClick={loadSuggestions}>Fill from reorder list</button><span className="grow" /><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save PO</button></>}>
        <div className="form-grid mb">
          <RefSelect label="Supplier" url="/master/suppliers" value={h.supplier_id} onChange={v => setH(x => ({ ...x, supplier_id: v }))} placeholder="— select supplier —" />
          <Input label="Expected date" type="date" value={h.expected_date} onChange={e => setH(x => ({ ...x, expected_date: e.target.value }))} />
          <Input label="Remark" value={h.remark} onChange={e => setH(x => ({ ...x, remark: e.target.value }))} />
        </div>
        <LineEditor lines={lines} setLines={setLines} onAdd={addItem} totalKey={l => Number(l.qty) * Number(l.cost_price)} cols={[
          { key: 'qty', label: 'Qty', type: 'number', width: 90, step: '0.001' }, { key: 'cost_price', label: 'Cost', type: 'number', width: 100 }, { key: 'total', label: 'Total', type: 'readonly', compute: l => Number(l.qty) * Number(l.cost_price) },
        ]} />
      </Modal>

      <Modal open={!!view} title={`PO ${view?.serial_no}`} onClose={() => setView(null)}
        footer={view?.status === 'OPEN' ? <><button className="btn danger" onClick={() => setStatus(view.id, 'CANCELLED')}>Cancel PO</button><span className="grow" /><button className="btn primary" onClick={() => { setReceive(view); setView(null); }}>Receive as GRN</button></> : null}>
        {view && <>
          <dl className="kv mb"><dt>Supplier</dt><dd>{view.supplier_name}</dd><dt>Status</dt><dd><Badge status={view.status} /></dd><dt>Expected</dt><dd>{fmtDate(view.expected_date)}</dd>{view.remark && <><dt>Remark</dt><dd>{view.remark}</dd></>}</dl>
          <table className="table compact"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Total</th></tr></thead>
            <tbody>{view.items.map(it => <tr key={it.id}><td>{it.item_name}<div className="subtle">{it.item_code}</div></td><td className="num">{fmtQty(it.qty)}</td><td className="num">{fmt(it.cost_price)}</td><td className="num">{fmt(it.line_total)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3} className="right">Total</td><td className="num">{fmt(view.net_total)}</td></tr></tfoot></table>
        </>}
      </Modal>

      <GrnForm open={!!receive} fromPo={receive} onClose={() => setReceive(null)} onSaved={() => list.reload()} />
    </div>
  );
}
