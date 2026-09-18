import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, post, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useList, DataTable, Pager, Badge, Modal, RefSelect, Input, Select, fmt, fmtDate, todayStr, firstOfMonth, useToast, downloadCsv } from '../components/ui.jsx';
import LineEditor from '../components/LineEditor.jsx';

const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

export function GrnForm({ open, onClose, onSaved, fromPo }) {
  const toast = useToast();
  const [lines, setLines] = useState([]);
  const [h, setH] = useState({ supplier_id: '', invoice_no: '', purchase_date: todayStr(), pay_type: 'CASH', paid_amount: '', bill_discount: '', extra_charges: '', remark: '', due_date: '', bank_id: '', cheque_no: '', cheque_date: '', cheque_bank: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setH(x => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!open) return;
    if (fromPo) {
      setH(x => ({ ...x, supplier_id: fromPo.supplier_id, remark: `From PO ${fromPo.serial_no}` }));
      setLines(fromPo.items.map(it => ({ item_id: it.item_id, item_code: it.item_code, item_name: it.item_name, qty: it.qty, free_qty: 0, cost_price: it.cost_price, selling_price: '', wholesale_price: '', mrp: '', discount: 0, expiry_date: '' })));
    } else { setLines([]); setH(x => ({ ...x, supplier_id: '', invoice_no: '', paid_amount: '', bill_discount: '', extra_charges: '', remark: '' })); }
  }, [open, fromPo]);

  const addItem = item => {
    const last = item.batches?.[item.batches.length - 1];
    setLines(ls => [...ls, { item_id: item.id, item_code: item.code, item_name: item.name, qty: 1, free_qty: 0, cost_price: last?.cost_price || 0, selling_price: last?.selling_price || '', wholesale_price: last?.wholesale_price || '', mrp: last?.mrp || '', discount: 0, expiry_date: '', new_batch: false }]);
  };
  const lineTotal = l => r2(Number(l.qty) * Number(l.cost_price) - Number(l.discount || 0));
  const gross = lines.reduce((s, l) => s + lineTotal(l), 0);
  const net = r2(gross - Number(h.bill_discount || 0) + Number(h.extra_charges || 0));

  const save = async () => {
    if (!h.supplier_id) return toast.error('Select a supplier');
    if (!lines.length) return toast.error('Add at least one item');
    setBusy(true);
    try {
      const p = await post('/purchases', { ...h, po_id: fromPo?.id, items: lines.map(l => ({ ...l, qty: Number(l.qty), free_qty: Number(l.free_qty || 0), cost_price: Number(l.cost_price), selling_price: Number(l.selling_price || 0), wholesale_price: Number(l.wholesale_price || 0), mrp: Number(l.mrp || 0), discount: Number(l.discount || 0), expiry_date: l.expiry_date || undefined })) });
      toast.success(`GRN ${p.serial_no} saved`); onSaved?.(p); onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={fromPo ? `Receive PO ${fromPo.serial_no}` : 'New purchase (GRN)'} onClose={onClose} size="lg"
      footer={<><span className="grow row" style={{ fontSize: 16 }}>Net <b style={{ marginLeft: 8 }}>{fmt(net)}</b></span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save GRN'}</button></>}>
      <div className="form-grid mb">
        <RefSelect label="Supplier" url="/master/suppliers" value={h.supplier_id} onChange={v => set('supplier_id', v)} placeholder="— select supplier —" />
        <Input label="Supplier invoice no" value={h.invoice_no} onChange={e => set('invoice_no', e.target.value)} />
        <Input label="Date" type="date" value={h.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
        <Input label="Remark" value={h.remark} onChange={e => set('remark', e.target.value)} />
      </div>
      <LineEditor lines={lines} setLines={setLines} onAdd={addItem} totalKey={lineTotal} cols={[
        { key: 'qty', label: 'Qty', type: 'number', width: 80, step: '0.001' }, { key: 'free_qty', label: 'Free', type: 'number', width: 70, step: '0.001' },
        { key: 'cost_price', label: 'Cost', type: 'number', width: 95 }, { key: 'selling_price', label: 'Selling', type: 'number', width: 95 }, { key: 'wholesale_price', label: 'W/S', type: 'number', width: 90 },
        { key: 'mrp', label: 'MRP', type: 'number', width: 90 }, { key: 'discount', label: 'Disc', type: 'number', width: 80 }, { key: 'expiry_date', label: 'Expiry', type: 'date', width: 135 },
        { key: 'total', label: 'Total', type: 'readonly', compute: lineTotal },
      ]} />
      <div className="form-grid mt">
        <Input label="Bill discount" type="number" value={h.bill_discount} onChange={e => set('bill_discount', e.target.value)} />
        <Input label="Extra charges (freight etc.)" type="number" value={h.extra_charges} onChange={e => set('extra_charges', e.target.value)} />
        <Input label="Paid now" type="number" value={h.paid_amount} onChange={e => set('paid_amount', e.target.value)} hint={`Balance ${fmt(net - Number(h.paid_amount || 0))} goes to supplier account`} />
        <Select label="Paid by" value={h.pay_type} onChange={e => set('pay_type', e.target.value)} options={['CASH', 'BANK', 'CHEQUE', 'CARD']} />
        {h.pay_type === 'BANK' && <RefSelect label="Bank account" url="/master/banks" labelKey="bank_name" value={h.bank_id} onChange={v => set('bank_id', v)} extraLabel={b => `${b.bank_name} ${b.account_no || ''}`} />}
        {h.pay_type === 'CHEQUE' && <><Input label="Cheque no" value={h.cheque_no} onChange={e => set('cheque_no', e.target.value)} /><Input label="Cheque date" type="date" value={h.cheque_date} onChange={e => set('cheque_date', e.target.value)} /><Input label="Cheque bank" value={h.cheque_bank} onChange={e => set('cheque_bank', e.target.value)} /></>}
        <Input label="Due date" type="date" value={h.due_date} onChange={e => set('due_date', e.target.value)} />
      </div>
    </Modal>
  );
}

export default function Purchases() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const list = useList('/purchases', { date_from: firstOfMonth(), date_to: todayStr(), inv_mode: '', order_status: '' });
  const [open, setOpen] = useState(sp.get('new') === '1');
  const cols = [
    { key: 'serial_no', label: 'GRN no' }, { key: 'purchase_date', label: 'Date', render: r => fmtDate(r.purchase_date) }, { key: 'invoice_no', label: 'Supplier inv' },
    { key: 'inv_mode', label: 'Type', render: r => r.inv_mode === 'RET' ? <Badge status="RETURNED">RETURN</Badge> : 'GRN' }, { key: 'supplier_name', label: 'Supplier' },
    { key: 'net_total', label: 'Net', num: true }, { key: 'paid_amount', label: 'Paid', num: true }, { key: 'due_amount', label: 'Due', num: true, render: r => <span className={Number(r.due_amount) > 0 ? 'text-warn' : ''}>{fmt(r.due_amount)}</span> },
    { key: 'invoice_status', label: 'Status', render: r => <Badge status={r.invoice_status} /> }, { key: 'order_status', label: 'Payment', render: r => <Badge status={r.order_status} /> },
  ];
  return (
    <div className="stack">
      <div className="page-head"><h1>Purchases (GRN)</h1>{can('purchase') && <button className="btn primary" onClick={() => setOpen(true)}>＋ New GRN</button>}</div>
      <div className="card">
        <div className="toolbar">
          <input className="input sm" placeholder="Search GRN / supplier" value={list.q} onChange={e => list.setQ(e.target.value)} />
          <input type="date" className="input sm" value={list.filters.date_from} onChange={e => list.setFilter('date_from', e.target.value)} />
          <input type="date" className="input sm" value={list.filters.date_to} onChange={e => list.setFilter('date_to', e.target.value)} />
          <select className="input sm" value={list.filters.inv_mode} onChange={e => list.setFilter('inv_mode', e.target.value)}><option value="">All types</option><option value="PCH">GRN</option><option value="RET">Returns</option></select>
          <select className="input sm" value={list.filters.order_status} onChange={e => list.setFilter('order_status', e.target.value)}><option value="">All payment</option><option>PAID</option><option>PARTIAL</option><option>UNPAID</option></select>
          <span className="grow" /><span className="muted">Net {fmt(list.extra.sum_net)} · Due {fmt(list.extra.sum_due)}</span>
          <button className="btn sm" onClick={() => downloadCsv('purchases.csv', cols, list.rows)}>⬇ CSV</button>
        </div>
        <DataTable columns={cols} rows={list.rows} loading={list.loading} onRowClick={r => nav(`/purchases/${r.id}`)} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>
      <GrnForm open={open} onClose={() => setOpen(false)} onSaved={() => list.reload()} />
    </div>
  );
}
