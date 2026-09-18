import { useState } from 'react';
import { post, del, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import MasterPage from '../components/MasterPage.jsx';
import { useList, DataTable, Pager, Modal, Confirm, Input, Select, RefSelect, fmt, fmtDate, todayStr, firstOfMonth, useToast, Badge } from '../components/ui.jsx';

export default function IncomeExpenses() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('entries');
  const list = useList('/finance/income-expenses', { kind: '', date_from: firstOfMonth(), date_to: todayStr() });
  const [open, setOpen] = useState(false);
  const [h, setH] = useState({ kind: 'EXPENSE', category_id: '', description: '', vendor_name: '', amount: '', pay_mode: 'CASH', reference: '', bank_id: '', txn_date: todayStr(), remark: '' });
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setH(x => ({ ...x, [k]: v }));

  const save = async () => {
    if (Number(h.amount) <= 0) return toast.error('Enter an amount');
    setBusy(true);
    try { await post('/finance/income-expenses', { ...h, amount: Number(h.amount) }); toast.success('Saved'); setOpen(false); setH(x => ({ ...x, description: '', amount: '', reference: '', vendor_name: '' })); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async () => { setBusy(true); try { await del(`/finance/income-expenses/${confirm.id}`); setConfirm(null); list.reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };

  return (
    <div className="stack">
      <div className="page-head"><h1>Income & Expenses</h1>{can(['add_income', 'add_expenses']) && <button className="btn primary" onClick={() => setOpen(true)}>＋ New entry</button>}</div>
      <div className="tabs"><button className={tab === 'entries' ? 'active' : ''} onClick={() => setTab('entries')}>Entries</button><button className={tab === 'cats' ? 'active' : ''} onClick={() => setTab('cats')}>Categories</button></div>

      {tab === 'entries' && (
        <div className="card">
          <div className="toolbar">
            <input className="input sm" placeholder="Search" value={list.q} onChange={e => list.setQ(e.target.value)} />
            <select className="input sm" value={list.filters.kind} onChange={e => list.setFilter('kind', e.target.value)}><option value="">Income + Expense</option><option value="INCOME">Income</option><option value="EXPENSE">Expense</option></select>
            <input type="date" className="input sm" value={list.filters.date_from} onChange={e => list.setFilter('date_from', e.target.value)} />
            <input type="date" className="input sm" value={list.filters.date_to} onChange={e => list.setFilter('date_to', e.target.value)} />
            <span className="grow" /><span className="muted">Total {fmt(list.extra.sum)}</span>
          </div>
          <DataTable rows={list.rows} loading={list.loading} columns={[
            { key: 'serial_no', label: 'No' }, { key: 'txn_date', label: 'Date', render: r => fmtDate(r.txn_date) }, { key: 'kind', label: 'Kind', render: r => <Badge status={r.kind === 'INCOME' ? 'PAID' : 'UNPAID'}>{r.kind}</Badge> },
            { key: 'category_name', label: 'Category' }, { key: 'description', label: 'Description' }, { key: 'vendor_name', label: 'Vendor / payee' }, { key: 'pay_mode', label: 'Pay' },
            { key: 'amount', label: 'Amount', num: true, render: r => <span className={r.kind === 'INCOME' ? 'text-good' : 'text-bad'}>{fmt(r.amount)}</span> }, { key: 'created_by', label: 'By' },
            { key: '_a', label: '', className: 'actions', render: r => can(['add_income', 'add_expenses']) && <button className="btn sm danger" onClick={() => setConfirm(r)}>Delete</button> },
          ]} />
          <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
        </div>
      )}

      {tab === 'cats' && (
        <MasterPage title="Income / Expense Categories" url="/master/expense-categories" perms={{ create: 'add_expenses', update: 'add_expenses', delete: 'add_expenses' }}
          columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'kind', label: 'Kind' }, { key: 'direct', label: 'P&L group', render: r => r.direct ? 'Direct' : 'Indirect' }]}
          fields={[{ key: 'code', label: 'Code', hint: 'Auto if blank' }, { key: 'name', label: 'Name', required: true }, { key: 'kind', label: 'Kind', type: 'select', options: ['EXPENSE', 'INCOME'], default: 'EXPENSE' }, { key: 'direct', label: 'Direct (cost of sales)', type: 'check', default: true }]} />
      )}

      <Modal open={open} title="New income / expense" onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
        <div className="form-grid">
          <Select label="Kind" value={h.kind} onChange={e => { set('kind', e.target.value); set('category_id', ''); }} options={[...(can('add_expenses') ? ['EXPENSE'] : []), ...(can('add_income') ? ['INCOME'] : [])]} />
          <RefSelect label="Category" url="/master/expense-categories" params={{ kind: h.kind }} value={h.category_id} onChange={v => set('category_id', v)} />
          <Input label="Date" type="date" value={h.txn_date} onChange={e => set('txn_date', e.target.value)} />
          <Input label="Amount" type="number" step="0.01" value={h.amount} onChange={e => set('amount', e.target.value)} />
          <Input label="Description" value={h.description} onChange={e => set('description', e.target.value)} className="span-2" />
          <Input label="Vendor / payee" value={h.vendor_name} onChange={e => set('vendor_name', e.target.value)} />
          <Select label="Paid by" value={h.pay_mode} onChange={e => set('pay_mode', e.target.value)} options={['CASH', 'BANK', 'CARD', 'CHEQUE']} />
          {h.pay_mode === 'BANK' && <RefSelect label="Bank account" url="/master/banks" labelKey="bank_name" value={h.bank_id} onChange={v => set('bank_id', v)} extraLabel={b => `${b.bank_name} ${b.account_no || ''}`} />}
          <Input label="Reference" value={h.reference} onChange={e => set('reference', e.target.value)} />
        </div>
      </Modal>
      <Confirm open={!!confirm} title="Delete entry?" message={`${confirm?.serial_no} · ${fmt(confirm?.amount)} will be removed.`} onClose={() => setConfirm(null)} onConfirm={remove} busy={busy} />
    </div>
  );
}
