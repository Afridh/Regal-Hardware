import { useState } from 'react';
import { get, post, errMsg } from '../api.js';
import { useList, DataTable, Pager, Modal, Lookup, Input, Select, RefSelect, fmt, fmtDate, todayStr, useToast } from '../components/ui.jsx';

/** Shared payment form for customers (party='customer') and suppliers (party='supplier'). */
export function PartyPaymentForm({ open, onClose, onSaved, party }) {
  const toast = useToast();
  const isCus = party === 'customer';
  const [p, setP] = useState(null);           // {customer|supplier, invoices|purchases}
  const [alloc, setAlloc] = useState({});
  const [h, setH] = useState({ amount: '', pay_type: 'CASH', reference: '', bank_id: '', cheque_no: '', cheque_date: '', cheque_bank: '', remark: '', pay_date: todayStr(), entry_type: 'PAYMENT' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setH(x => ({ ...x, [k]: v }));

  const pick = async r => {
    try { const d = await get(`/finance/${isCus ? 'customer' : 'supplier'}-outstanding/${r.id}`); setP(d); setAlloc({}); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const docs = p ? (isCus ? p.invoices : p.purchases) : [];
  const partyRow = p ? (isCus ? p.customer : p.supplier) : null;
  const allocated = Object.values(alloc).reduce((s, v) => s + Number(v || 0), 0);
  const autoAlloc = () => {
    let left = Number(h.amount || 0); const a = {};
    for (const d of docs) { if (left <= 0) break; const x = Math.min(left, Number(d.due_amount)); a[d.id] = x; left -= x; }
    setAlloc(a);
  };
  const save = async () => {
    if (!partyRow) return toast.error(`Select a ${party}`);
    if (Number(h.amount) <= 0) return toast.error('Enter an amount');
    setBusy(true);
    try {
      const allocations = Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([id, amount]) => (isCus ? { invoice_id: id, amount: Number(amount) } : { purchase_id: id, amount: Number(amount) }));
      const r = await post(`/finance/${party}-payments`, { ...h, [`${party}_id`]: partyRow.id, amount: Number(h.amount), allocations: allocations.length ? allocations : undefined });
      toast.success(`Payment ${r.serial_no} recorded`); onSaved?.(); onClose(); setP(null); setH(x => ({ ...x, amount: '', reference: '', remark: '' }));
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={isCus ? 'Receive customer payment' : 'Pay supplier'} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save payment'}</button></>}>
      <div className="form-grid mb">
        <div className="field span-2"><label>{isCus ? 'Customer' : 'Supplier'}</label>
          <Lookup url={`/master/${party}s`} placeholder={partyRow ? `${partyRow.code} · ${partyRow.name}` : 'Search…'} onPick={pick} render={r => <><span>{r.name} <small>{r.code}</small></span><small>due {fmt(r.due_amount)}</small></>} /></div>
        {partyRow && <div className="field"><label>Outstanding</label><div className="input" style={{ fontWeight: 600 }} >{fmt(partyRow.due_amount)}{Number(partyRow.advance_amount) > 0 ? ` (advance ${fmt(partyRow.advance_amount)})` : ''}</div></div>}
        <Input label="Date" type="date" value={h.pay_date} onChange={e => set('pay_date', e.target.value)} />
        <Select label="Entry type" value={h.entry_type} onChange={e => set('entry_type', e.target.value)} options={[{ value: 'PAYMENT', label: isCus ? 'Payment received' : 'Payment made' }, { value: 'CREDIT_ADJ', label: 'Credit adjustment (reduce due)' }, { value: 'DEBIT_ADJ', label: 'Debit adjustment (increase due)' }]} />
        <Input label="Amount" type="number" step="0.01" value={h.amount} onChange={e => set('amount', e.target.value)} />
        <Select label="Pay by" value={h.pay_type} onChange={e => set('pay_type', e.target.value)} options={['CASH', 'CARD', 'CHEQUE', 'BANK']} />
        <Input label="Reference" value={h.reference} onChange={e => set('reference', e.target.value)} />
        {h.pay_type === 'BANK' && <RefSelect label="Bank account" url="/master/banks" labelKey="bank_name" value={h.bank_id} onChange={v => set('bank_id', v)} extraLabel={b => `${b.bank_name} ${b.account_no || ''}`} />}
        {h.pay_type === 'CHEQUE' && <><Input label="Cheque no" value={h.cheque_no} onChange={e => set('cheque_no', e.target.value)} /><Input label="Cheque date" type="date" value={h.cheque_date} onChange={e => set('cheque_date', e.target.value)} /><Input label="Cheque bank" value={h.cheque_bank} onChange={e => set('cheque_bank', e.target.value)} /></>}
        <Input label="Remark" value={h.remark} onChange={e => set('remark', e.target.value)} className="span-2" />
      </div>
      {p && h.entry_type !== 'DEBIT_ADJ' && (
        <div className="card">
          <div className="card-head"><h3>Allocate to {isCus ? 'invoices' : 'GRNs'}</h3><div className="row gap-sm"><span className="muted">Allocated {fmt(allocated)} / {fmt(h.amount || 0)}</span><button className="btn sm" onClick={autoAlloc}>Auto (oldest first)</button></div></div>
          <table className="table compact">
            <thead><tr><th>No</th><th>Date</th><th className="num">Total</th><th className="num">Due</th><th className="num">Allocate</th></tr></thead>
            <tbody>
              {docs.length === 0 && <tr><td colSpan={5} className="empty">No outstanding documents — payment will be kept as advance.</td></tr>}
              {docs.map(d => <tr key={d.id}><td>{d.serial_no}</td><td>{fmtDate(d.invoice_date || d.purchase_date)}</td><td className="num">{fmt(d.net_total)}</td><td className="num text-bad">{fmt(d.due_amount)}</td><td className="num"><input className="input sm" type="number" step="0.01" min="0" max={d.due_amount} style={{ width: 110 }} value={alloc[d.id] ?? ''} onChange={e => setAlloc(a => ({ ...a, [d.id]: e.target.value }))} /></td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function CustomerPayments() {
  const list = useList('/finance/customer-payments');
  const [open, setOpen] = useState(false);
  return (
    <div className="stack">
      <div className="page-head"><h1>Customer Payments</h1><button className="btn primary" onClick={() => setOpen(true)}>＋ Receive payment</button></div>
      <div className="card">
        <div className="toolbar"><input className="input sm" placeholder="Search serial / customer" value={list.q} onChange={e => list.setQ(e.target.value)} /></div>
        <DataTable rows={list.rows} loading={list.loading} columns={[
          { key: 'serial_no', label: 'No' }, { key: 'pay_date', label: 'Date', render: r => fmtDate(r.pay_date) }, { key: 'customer_name', label: 'Customer' }, { key: 'entry_type', label: 'Type' }, { key: 'pay_type', label: 'Pay by' }, { key: 'reference', label: 'Ref', render: r => r.reference || r.cheque_no || '-' },
          { key: 'amount', label: 'Amount', num: true }, { key: 'remark', label: 'Remark' }, { key: 'created_by', label: 'By' },
        ]} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>
      <PartyPaymentForm open={open} onClose={() => setOpen(false)} onSaved={list.reload} party="customer" />
    </div>
  );
}
