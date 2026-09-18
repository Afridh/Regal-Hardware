import { useState } from 'react';
import { post, errMsg } from '../api.js';
import { useList, DataTable, Pager, Badge, Modal, Input, Lookup, fmt, fmtDate, useToast } from '../components/ui.jsx';

export default function Vouchers() {
  const toast = useToast();
  const list = useList('/finance/vouchers');
  const [open, setOpen] = useState(false);
  const [h, setH] = useState({ voucher_no: '', amount: '', expires_at: '', customer_id: '', customer_name: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (Number(h.amount) <= 0) return toast.error('Enter an amount');
    setBusy(true);
    try { const v = await post('/finance/vouchers', { ...h, amount: Number(h.amount) }); toast.success(`Voucher ${v.voucher_no} issued`); setOpen(false); setH({ voucher_no: '', amount: '', expires_at: '', customer_id: '', customer_name: '' }); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className="page-head"><h1>Gift Vouchers</h1><button className="btn primary" onClick={() => setOpen(true)}>＋ Issue voucher</button></div>
      <div className="card">
        <DataTable rows={list.rows} loading={list.loading} columns={[
          { key: 'voucher_no', label: 'Voucher no' }, { key: 'amount', label: 'Amount', num: true }, { key: 'customer_name', label: 'Customer' }, { key: 'issued_at', label: 'Issued', render: r => fmtDate(r.issued_at) }, { key: 'expires_at', label: 'Expires', render: r => fmtDate(r.expires_at) },
          { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> }, { key: 'redeemed_invoice_id', label: 'Redeemed on', render: r => r.redeemed_invoice_id ? `Invoice #${r.redeemed_invoice_id}` : '-' }, { key: 'created_by', label: 'By' },
        ]} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>
      <Modal open={open} title="Issue gift voucher" onClose={() => setOpen(false)} size="sm" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Issue</button></>}>
        <div className="stack">
          <Input label="Voucher no" hint="Leave blank to auto-generate" value={h.voucher_no} onChange={e => setH(x => ({ ...x, voucher_no: e.target.value }))} />
          <Input label="Amount" type="number" step="0.01" value={h.amount} onChange={e => setH(x => ({ ...x, amount: e.target.value }))} />
          <Input label="Expires" type="date" value={h.expires_at} onChange={e => setH(x => ({ ...x, expires_at: e.target.value }))} />
          <div className="field"><label>Customer (optional)</label><Lookup url="/master/customers" placeholder={h.customer_name || 'Search…'} onPick={c => setH(x => ({ ...x, customer_id: c.id, customer_name: c.name }))} render={r => <span>{r.name} <small>{r.mobile}</small></span>} /></div>
        </div>
      </Modal>
    </div>
  );
}
