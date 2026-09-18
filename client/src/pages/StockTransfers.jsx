import { useState } from 'react';
import { get, post, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useList, DataTable, Pager, Badge, Modal, Input, Select, fmt, fmtQty, fmtDate, useToast } from '../components/ui.jsx';
import LineEditor from '../components/LineEditor.jsx';

export default function StockTransfers() {
  const toast = useToast();
  const { locations, locationId, location } = useAuth();
  const list = useList('/stock/transfers');
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState([]);
  const [h, setH] = useState({ to_location_id: '', remark: '' });
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);

  const addItem = it => { const b = it.batches?.find(x => Number(x.qty_remain) > 0) || it.batches?.[0]; setLines(ls => [...ls, { item_id: it.id, item_code: it.code, item_name: it.name, batches: it.batches, batch_id: b?.id || null, on_hand: it.batches.reduce((s, x) => s + Number(x.qty_remain), 0), qty: 1 }]); };
  const save = async () => {
    if (!h.to_location_id || !lines.length) return toast.error('Destination and items are required');
    setBusy(true);
    try { const t = await post('/stock/transfers', { ...h, items: lines.map(l => ({ item_id: l.item_id, batch_id: l.batch_id, qty: Number(l.qty) })) }); toast.success(`Transfer ${t.serial_no} sent`); setOpen(false); setLines([]); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const openView = async r => { try { setView(await get(`/stock/transfers/${r.id}`)); } catch (e) { toast.error(errMsg(e)); } };
  const act = async (id, action) => { try { await post(`/stock/transfers/${id}/${action}`); toast.success(action === 'receive' ? 'Received' : 'Cancelled'); setView(null); list.reload(); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <div className="stack">
      <div className="page-head"><div><h1>Stock Transfers</h1><div className="sub">Sending from: {location?.name}</div></div><button className="btn primary" onClick={() => setOpen(true)} disabled={locations.length < 2}>＋ New transfer</button></div>
      {locations.length < 2 && <div className="card pad muted">Add a second location under Settings → Locations to use stock transfers.</div>}
      <div className="card">
        <DataTable rows={list.rows} loading={list.loading} onRowClick={openView} columns={[
          { key: 'serial_no', label: 'No' }, { key: 'transfer_date', label: 'Date', render: r => fmtDate(r.transfer_date) }, { key: 'from_location_name', label: 'From' }, { key: 'to_location_name', label: 'To' },
          { key: 'total_qty', label: 'Qty', num: true, render: r => fmtQty(r.total_qty) }, { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> }, { key: 'created_by', label: 'By' },
        ]} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>

      <Modal open={open} title="New stock transfer" onClose={() => setOpen(false)} size="lg"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Send transfer</button></>}>
        <div className="form-grid mb">
          <Select label="To location" value={h.to_location_id} onChange={e => setH(x => ({ ...x, to_location_id: e.target.value }))} placeholder="— select —" options={locations.filter(l => String(l.id) !== String(locationId)).map(l => ({ value: l.id, label: l.name }))} />
          <Input label="Remark" value={h.remark} onChange={e => setH(x => ({ ...x, remark: e.target.value }))} className="span-2" />
        </div>
        <LineEditor lines={lines} setLines={setLines} onAdd={addItem} cols={[
          { key: 'batch_id', label: 'Batch', type: 'batch' }, { key: 'on_hand', label: 'On hand', type: 'readonly' }, { key: 'qty', label: 'Qty', type: 'number', width: 100, step: '0.001' },
        ]} />
      </Modal>

      <Modal open={!!view} title={`Transfer ${view?.serial_no}`} onClose={() => setView(null)}
        footer={view?.status === 'SENT' ? <><button className="btn danger" onClick={() => act(view.id, 'cancel')}>Cancel (return stock)</button><span className="grow" /><button className="btn primary" onClick={() => act(view.id, 'receive')}>Mark received</button></> : null}>
        {view && <table className="table compact"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Selling</th></tr></thead>
          <tbody>{view.items.map(it => <tr key={it.id}><td>{it.item_name}<div className="subtle">{it.item_code}</div></td><td className="num">{fmtQty(it.qty)}</td><td className="num">{fmt(it.cost_price)}</td><td className="num">{fmt(it.selling_price)}</td></tr>)}</tbody></table>}
      </Modal>
    </div>
  );
}
