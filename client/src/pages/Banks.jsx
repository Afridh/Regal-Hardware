import { useEffect, useState } from 'react';
import { get, post, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import MasterPage from '../components/MasterPage.jsx';
import { useList, DataTable, Pager, Modal, Input, Select, RefSelect, Stat, fmt, fmtDate, todayStr, useToast } from '../components/ui.jsx';

export default function Banks() {
  const { can, company } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('txns');
  const [balances, setBalances] = useState([]);
  const list = useList('/finance/bank-transactions', { bank_id: '' });
  const [open, setOpen] = useState(false);
  const [h, setH] = useState({ bank_id: '', txn_type: 'DEPOSIT', amount: '', txn_date: todayStr(), reference: '', description: '' });
  const [busy, setBusy] = useState(false);
  const loadBal = () => get('/finance/bank-balances').then(setBalances).catch(() => {});
  useEffect(() => { loadBal(); }, []);

  const save = async () => {
    if (!h.bank_id || Number(h.amount) <= 0) return toast.error('Bank and amount are required');
    setBusy(true);
    try { await post('/finance/bank-transactions', { ...h, amount: Number(h.amount) }); toast.success('Saved'); setOpen(false); list.reload(); loadBal(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const IN = ['DEPOSIT', 'CHEQUE_IN', 'CARD_SETTLE'];

  return (
    <div className="stack">
      <div className="page-head"><h1>Banks</h1>{can(['add_deposit', 'add_withdraw']) && <button className="btn primary" onClick={() => setOpen(true)}>＋ Deposit / Withdraw</button>}</div>
      <div className="stat-grid">{balances.map(b => <Stat key={b.id} label={`${b.bank_name} · ${b.account_no || ''}`} value={`${company?.currency_symbol || ''} ${fmt(b.balance)}`} sub={b.branch} />)}</div>
      <div className="tabs"><button className={tab === 'txns' ? 'active' : ''} onClick={() => setTab('txns')}>Transactions</button><button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>Bank accounts</button></div>

      {tab === 'txns' && (
        <div className="card">
          <div className="toolbar"><RefSelect url="/master/banks" labelKey="bank_name" value={list.filters.bank_id} onChange={v => list.setFilter('bank_id', v)} placeholder="All banks" className="" style={{ width: 200 }} extraLabel={b => `${b.bank_name} ${b.account_no || ''}`} /></div>
          <DataTable rows={list.rows} loading={list.loading} columns={[
            { key: 'serial_no', label: 'No' }, { key: 'txn_date', label: 'Date', render: r => fmtDate(r.txn_date) }, { key: 'bank_name', label: 'Bank' }, { key: 'txn_type', label: 'Type' }, { key: 'description', label: 'Description' }, { key: 'reference', label: 'Ref' },
            { key: 'in', label: 'In', num: true, render: r => IN.includes(r.txn_type) ? <span className="text-good">{fmt(r.amount)}</span> : '' },
            { key: 'out', label: 'Out', num: true, render: r => !IN.includes(r.txn_type) ? <span className="text-bad">{fmt(r.amount)}</span> : '' }, { key: 'created_by', label: 'By' },
          ]} />
          <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
        </div>
      )}
      {tab === 'accounts' && (
        <MasterPage title="Bank Accounts" url="/master/banks" perms={{ create: 'add_bank', update: 'edit_bank', delete: 'del_bank' }}
          columns={[{ key: 'code', label: 'Code' }, { key: 'bank_name', label: 'Bank' }, { key: 'branch', label: 'Branch' }, { key: 'account_no', label: 'Account no' }, { key: 'account_type', label: 'Type' }, { key: 'opening_balance', label: 'Opening', num: true }]}
          fields={[{ key: 'code', label: 'Code', hint: 'Auto if blank' }, { key: 'bank_name', label: 'Bank name', required: true }, { key: 'branch', label: 'Branch' }, { key: 'account_no', label: 'Account no' }, { key: 'account_type', label: 'Type', type: 'select', options: ['CURRENT', 'SAVINGS', 'OD', 'FD'], default: 'CURRENT' }, { key: 'opening_balance', label: 'Opening balance', type: 'number' }]} />
      )}

      <Modal open={open} title="Bank deposit / withdrawal" onClose={() => setOpen(false)} size="sm" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
        <div className="stack">
          <RefSelect label="Bank account" url="/master/banks" labelKey="bank_name" value={h.bank_id} onChange={v => setH(x => ({ ...x, bank_id: v }))} extraLabel={b => `${b.bank_name} ${b.account_no || ''}`} />
          <Select label="Type" value={h.txn_type} onChange={e => setH(x => ({ ...x, txn_type: e.target.value }))} options={[...(can('add_deposit') ? ['DEPOSIT'] : []), ...(can('add_withdraw') ? ['WITHDRAW'] : [])]} />
          <Input label="Amount" type="number" step="0.01" value={h.amount} onChange={e => setH(x => ({ ...x, amount: e.target.value }))} />
          <Input label="Date" type="date" value={h.txn_date} onChange={e => setH(x => ({ ...x, txn_date: e.target.value }))} />
          <Input label="Reference" value={h.reference} onChange={e => setH(x => ({ ...x, reference: e.target.value }))} />
          <Input label="Description" value={h.description} onChange={e => setH(x => ({ ...x, description: e.target.value }))} />
        </div>
      </Modal>
    </div>
  );
}
