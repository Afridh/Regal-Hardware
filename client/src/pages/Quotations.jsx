import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, put, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useList, DataTable, Pager, Badge, Modal, Lookup, Input, fmt, fmtQty, fmtDate, useToast } from '../components/ui.jsx';
import LineEditor from '../components/LineEditor.jsx';

export default function Quotations() {
  const toast = useToast();
  const nav = useNavigate();
  const { company } = useAuth();
  const list = useList('/sales/quotations', { status: '' });
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [h, setH] = useState({ valid_till: '', remark: '', bill_discount: '' });
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);

  const addItem = it => { const b = it.batches?.[0]; setLines(ls => [...ls, { item_id: it.id, item_code: it.code, item_name: it.name, qty: 1, unit_price: b?.selling_price || 0, discount: 0 }]); };
  const lt = l => Number(l.qty) * Number(l.unit_price) - Number(l.discount || 0);
  const save = async () => {
    if (!lines.length) return toast.error('Add items');
    setBusy(true);
    try { const q = await post('/sales/quotations', { ...h, customer_id: customer?.id, items: lines.map(l => ({ ...l, qty: Number(l.qty), unit_price: Number(l.unit_price), discount: Number(l.discount || 0) })) }); toast.success(`Quotation ${q.serial_no} saved`); setOpen(false); setLines([]); setCustomer(null); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const openView = async r => { try { setView(await get(`/sales/quotations/${r.id}`)); } catch (e) { toast.error(errMsg(e)); } };
  const setStatus = async (id, status) => { try { await put(`/sales/quotations/${id}/status`, { status }); setView(null); list.reload(); } catch (e) { toast.error(errMsg(e)); } };
  const convert = q => {
    // hand the lines to the POS via sessionStorage; POS reads it on mount
    sessionStorage.setItem('sepos_quote', JSON.stringify(q));
    nav('/pos?from_quote=' + q.id);
  };

  return (
    <div className="stack">
      <div className="page-head"><h1>Quotations</h1><button className="btn primary" onClick={() => setOpen(true)}>＋ New quotation</button></div>
      <div className="card">
        <div className="toolbar">
          <input className="input sm" placeholder="Search" value={list.q} onChange={e => list.setQ(e.target.value)} />
          <select className="input sm" value={list.filters.status} onChange={e => list.setFilter('status', e.target.value)}><option value="">All</option><option>OPEN</option><option>CONVERTED</option><option>EXPIRED</option><option>CANCELLED</option></select>
        </div>
        <DataTable rows={list.rows} loading={list.loading} onRowClick={openView} columns={[
          { key: 'serial_no', label: 'No' }, { key: 'quot_date', label: 'Date', render: r => fmtDate(r.quot_date) }, { key: 'customer_name', label: 'Customer' }, { key: 'valid_till', label: 'Valid till', render: r => fmtDate(r.valid_till) },
          { key: 'net_total', label: 'Net', num: true }, { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> }, { key: 'created_by', label: 'By' },
        ]} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>

      <Modal open={open} title="New quotation" onClose={() => setOpen(false)} size="lg"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
        <div className="form-grid mb">
          <div className="field"><label>Customer</label><Lookup url="/master/customers" placeholder={customer ? customer.name : 'Cash customer'} onPick={setCustomer} render={r => <><span>{r.name}</span><small>{r.mobile}</small></>} /></div>
          <Input label="Valid till" type="date" value={h.valid_till} onChange={e => setH(x => ({ ...x, valid_till: e.target.value }))} />
          <Input label="Bill discount" type="number" value={h.bill_discount} onChange={e => setH(x => ({ ...x, bill_discount: e.target.value }))} />
          <Input label="Remark" value={h.remark} onChange={e => setH(x => ({ ...x, remark: e.target.value }))} />
        </div>
        <LineEditor lines={lines} setLines={setLines} onAdd={addItem} totalKey={lt} cols={[
          { key: 'qty', label: 'Qty', type: 'number', width: 90, step: '0.001' }, { key: 'unit_price', label: 'Price', type: 'number', width: 100 }, { key: 'discount', label: 'Disc', type: 'number', width: 90 }, { key: 'total', label: 'Total', type: 'readonly', compute: lt },
        ]} />
      </Modal>

      <Modal open={!!view} title={`Quotation ${view?.serial_no}`} onClose={() => setView(null)}
        footer={<><button className="btn" onClick={() => window.print()}>🖨 Print</button><span className="grow" />{view?.status === 'OPEN' && <><button className="btn danger" onClick={() => setStatus(view.id, 'CANCELLED')}>Cancel</button><button className="btn primary" onClick={() => convert(view)}>Convert to invoice</button></>}</>}>
        {view && <div className="print-area">
          <div className="print-only"><h2>{company?.name}</h2><p>{company?.address1}</p></div>
          <dl className="kv mb"><dt>Customer</dt><dd>{view.customer_name}</dd><dt>Date</dt><dd>{fmtDate(view.quot_date)}</dd><dt>Valid till</dt><dd>{fmtDate(view.valid_till)}</dd><dt>Status</dt><dd><Badge status={view.status} /></dd></dl>
          <table className="table compact"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Disc</th><th className="num">Total</th></tr></thead>
            <tbody>{view.items.map(it => <tr key={it.id}><td>{it.item_name}</td><td className="num">{fmtQty(it.qty)}</td><td className="num">{fmt(it.unit_price)}</td><td className="num">{fmt(it.discount)}</td><td className="num">{fmt(it.line_total)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={4} className="right">Net</td><td className="num">{fmt(view.net_total)}</td></tr></tfoot></table>
          {view.remark && <p className="mt muted">{view.remark}</p>}
        </div>}
      </Modal>
    </div>
  );
}
