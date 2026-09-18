import { useState } from 'react';
import { get, post, errMsg } from '../api.js';
import { useList, DataTable, Pager, Modal, Input, Select, fmt, fmtQty, fmtDate, todayStr, useToast } from '../components/ui.jsx';
import LineEditor from '../components/LineEditor.jsx';

const TYPES = [{ value: 'ADD', label: 'Add stock (+)' }, { value: 'DEDUCT', label: 'Deduct stock (−)' }, { value: 'DAMAGE', label: 'Damaged (−)' }, { value: 'EXPIRED', label: 'Expired (−)' }, { value: 'STOCK_TAKE', label: 'Stock take (set counted qty)' }];

export default function StockAdjustments() {
  const toast = useToast();
  const list = useList('/stock/adjustments');
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState([]);
  const [h, setH] = useState({ adj_type: 'ADD', reason: '', adj_date: todayStr() });
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);

  const addItem = it => { const b = it.batches?.[0]; setLines(ls => [...ls, { item_id: it.id, item_code: it.code, item_name: it.name, batches: it.batches, batch_id: b?.id || null, on_hand: it.batches.reduce((s, x) => s + Number(x.qty_remain), 0), qty: h.adj_type === 'STOCK_TAKE' ? it.batches.reduce((s, x) => s + Number(x.qty_remain), 0) : 1, cost_price: b?.cost_price || 0, selling_price: b?.selling_price || 0 }]); };
  const save = async () => {
    if (!lines.length) return toast.error('Add items');
    setBusy(true);
    try { const a = await post('/stock/adjustments', { ...h, items: lines.map(l => ({ item_id: l.item_id, batch_id: l.batch_id, qty: Number(l.qty), cost_price: Number(l.cost_price), selling_price: Number(l.selling_price) })) }); toast.success(`Adjustment ${a.serial_no} saved`); setOpen(false); setLines([]); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const openView = async r => { try { setView(await get(`/stock/adjustments/${r.id}`)); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <div className="stack">
      <div className="page-head"><h1>Stock Adjustments</h1><button className="btn primary" onClick={() => setOpen(true)}>＋ New adjustment</button></div>
      <div className="card">
        <DataTable rows={list.rows} loading={list.loading} onRowClick={openView} columns={[
          { key: 'serial_no', label: 'No' }, { key: 'adj_date', label: 'Date', render: r => fmtDate(r.adj_date) }, { key: 'adj_type', label: 'Type' }, { key: 'location_name', label: 'Location' }, { key: 'reason', label: 'Reason' },
          { key: 'total_qty', label: 'Qty', num: true, render: r => <span className={Number(r.total_qty) < 0 ? 'text-bad' : 'text-good'}>{fmtQty(r.total_qty)}</span> }, { key: 'total_cost', label: 'Cost value', num: true }, { key: 'created_by', label: 'By' },
        ]} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>

      <Modal open={open} title="New stock adjustment" onClose={() => setOpen(false)} size="lg"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
        <div className="form-grid mb">
          <Select label="Adjustment type" value={h.adj_type} onChange={e => setH(x => ({ ...x, adj_type: e.target.value }))} options={TYPES} />
          <Input label="Date" type="date" value={h.adj_date} onChange={e => setH(x => ({ ...x, adj_date: e.target.value }))} />
          <Input label="Reason" value={h.reason} onChange={e => setH(x => ({ ...x, reason: e.target.value }))} className="span-2" />
        </div>
        <LineEditor lines={lines} setLines={setLines} onAdd={addItem} cols={[
          { key: 'batch_id', label: 'Batch', type: 'batch', onChange: b => ({ cost_price: b?.cost_price || 0, selling_price: b?.selling_price || 0 }) },
          { key: 'on_hand', label: 'On hand', type: 'readonly' },
          { key: 'qty', label: h.adj_type === 'STOCK_TAKE' ? 'Counted qty' : 'Qty', type: 'number', width: 100, step: '0.001' },
          ...(h.adj_type === 'ADD' ? [{ key: 'cost_price', label: 'Cost', type: 'number', width: 100 }, { key: 'selling_price', label: 'Selling', type: 'number', width: 100 }] : []),
        ]} />
        {h.adj_type === 'STOCK_TAKE' && <p className="subtle mt">Enter the physically counted quantity; the difference is posted automatically.</p>}
      </Modal>

      <Modal open={!!view} title={`Adjustment ${view?.serial_no}`} onClose={() => setView(null)}>
        {view && <>
          <dl className="kv mb"><dt>Type</dt><dd>{view.adj_type}</dd><dt>Date</dt><dd>{fmtDate(view.adj_date)}</dd><dt>Reason</dt><dd>{view.reason || '-'}</dd><dt>By</dt><dd>{view.created_by}</dd></dl>
          <table className="table compact"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Value</th></tr></thead>
            <tbody>{view.items.map(it => <tr key={it.id}><td>{it.item_name}<div className="subtle">{it.item_code}</div></td><td className={`num ${Number(it.qty) < 0 ? 'text-bad' : 'text-good'}`}>{fmtQty(it.qty)}</td><td className="num">{fmt(it.cost_price)}</td><td className="num">{fmt(Number(it.qty) * Number(it.cost_price))}</td></tr>)}</tbody></table>
        </>}
      </Modal>
    </div>
  );
}
