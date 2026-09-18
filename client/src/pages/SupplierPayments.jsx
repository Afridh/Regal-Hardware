import { useState } from 'react';
import { useList, DataTable, Pager, fmtDate } from '../components/ui.jsx';
import { PartyPaymentForm } from './CustomerPayments.jsx';

export default function SupplierPayments() {
  const list = useList('/finance/supplier-payments');
  const [open, setOpen] = useState(false);
  return (
    <div className="stack">
      <div className="page-head"><h1>Supplier Payments</h1><button className="btn primary" onClick={() => setOpen(true)}>＋ Pay supplier</button></div>
      <div className="card">
        <div className="toolbar"><input className="input sm" placeholder="Search serial / supplier" value={list.q} onChange={e => list.setQ(e.target.value)} /></div>
        <DataTable rows={list.rows} loading={list.loading} columns={[
          { key: 'serial_no', label: 'No' }, { key: 'pay_date', label: 'Date', render: r => fmtDate(r.pay_date) }, { key: 'supplier_name', label: 'Supplier' }, { key: 'entry_type', label: 'Type' }, { key: 'pay_type', label: 'Pay by' }, { key: 'reference', label: 'Ref', render: r => r.reference || r.cheque_no || '-' },
          { key: 'amount', label: 'Amount', num: true }, { key: 'remark', label: 'Remark' }, { key: 'created_by', label: 'By' },
        ]} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>
      <PartyPaymentForm open={open} onClose={() => setOpen(false)} onSaved={list.reload} party="supplier" />
    </div>
  );
}
