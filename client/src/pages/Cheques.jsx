import { useState } from 'react';
import { put, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useList, DataTable, Pager, Badge, Modal, RefSelect, Input, fmt, fmtDate, todayStr, useToast } from '../components/ui.jsx';

export default function Cheques() {
  const { can } = useAuth();
  const toast = useToast();
  const list = useList('/finance/cheques', { status: 'PENDING', direction: '' });
  const [act, setAct] = useState(null);   // {cheque, status}
  const [bankId, setBankId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    try { await put(`/finance/cheques/${act.cheque.id}/status`, { status: act.status, deposit_bank_id: bankId || undefined, realized_at: date }); toast.success(`Cheque ${act.status.toLowerCase()}`); setAct(null); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="page-head"><h1>Cheques</h1></div>
      <div className="card">
        <div className="toolbar">
          <input className="input sm" placeholder="Cheque no / party / bank" value={list.q} onChange={e => list.setQ(e.target.value)} />
          <select className="input sm" value={list.filters.status} onChange={e => list.setFilter('status', e.target.value)}><option value="">All status</option><option>PENDING</option><option>REALIZED</option><option>RETURNED</option><option>CANCELLED</option></select>
          <select className="input sm" value={list.filters.direction} onChange={e => list.setFilter('direction', e.target.value)}><option value="">In + Out</option><option value="IN">Received</option><option value="OUT">Issued</option></select>
        </div>
        <DataTable rows={list.rows} loading={list.loading} columns={[
          { key: 'cheque_no', label: 'Cheque no' }, { key: 'cheque_date', label: 'Cheque date', render: r => <span className={r.status === 'PENDING' && r.cheque_date && r.cheque_date <= todayStr() ? 'text-warn bold' : ''}>{fmtDate(r.cheque_date)}</span> },
          { key: 'direction', label: 'Dir', render: r => r.direction === 'IN' ? <Badge status="PAID">RECEIVED</Badge> : <Badge status="PENDING">ISSUED</Badge> }, { key: 'party_name', label: 'Party' }, { key: 'bank_name', label: 'Bank' },
          { key: 'amount', label: 'Amount', num: true }, { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> }, { key: 'deposit_bank', label: 'Deposited to' }, { key: 'source', label: 'Source' },
          { key: '_a', label: '', className: 'actions', render: r => r.status === 'PENDING' && can('edit_chq') && <span className="row gap-sm" style={{ justifyContent: 'flex-end' }}><button className="btn sm good" onClick={() => setAct({ cheque: r, status: 'REALIZED' })}>Realize</button><button className="btn sm danger" onClick={() => setAct({ cheque: r, status: 'RETURNED' })}>Return</button></span> },
        ]} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>
      <Modal open={!!act} title={`${act?.status === 'REALIZED' ? 'Realize' : 'Return'} cheque ${act?.cheque.cheque_no}`} onClose={() => setAct(null)} size="sm"
        footer={<><button className="btn" onClick={() => setAct(null)}>Cancel</button><button className={`btn ${act?.status === 'REALIZED' ? 'primary' : 'danger'}`} disabled={busy} onClick={apply}>Confirm</button></>}>
        <p className="mb">{act?.cheque.party_name} · {fmt(act?.cheque.amount)}</p>
        {act?.status === 'REALIZED' ? <div className="stack"><RefSelect label="Deposited / drawn on bank" url="/master/banks" labelKey="bank_name" value={bankId} onChange={setBankId} extraLabel={b => `${b.bank_name} ${b.account_no || ''}`} /><Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          : <p className="muted">A returned customer cheque re-opens the amount on the customer's account.</p>}
      </Modal>
    </div>
  );
}
