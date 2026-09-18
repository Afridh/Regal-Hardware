import { useEffect, useState } from 'react';
import { get, post, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useList, DataTable, Pager, Badge, Modal, Stat, fmt, useToast } from '../components/ui.jsx';

const DENOMS = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

function DenomGrid({ value, onChange }) {
  const total = DENOMS.reduce((s, d) => s + d * Number(value[d] || 0), 0);
  return (
    <div>
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
        {DENOMS.map(d => <div key={d} className="field"><label>{d} ×</label><input className="input sm" type="number" min="0" value={value[d] || ''} onChange={e => onChange({ ...value, [d]: e.target.value })} /></div>)}
      </div>
      <div className="right mt bold" style={{ fontSize: 16 }}>Counted: {fmt(total)}</div>
    </div>
  );
}
const denomTotal = v => DENOMS.reduce((s, d) => s + d * Number(v[d] || 0), 0);

export default function Shifts() {
  const { can, company } = useAuth();
  const toast = useToast();
  const cur = company?.currency_symbol || '';
  const [current, setCurrent] = useState(null);
  const [summary, setSummary] = useState(null);
  const [openM, setOpenM] = useState(false);
  const [closeM, setCloseM] = useState(false);
  const [denoms, setDenoms] = useState({});
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const list = useList('/finance/shifts');
  const terminalId = localStorage.getItem('sepos_terminal') || '';

  const loadCurrent = async () => {
    try {
      const s = await get('/finance/shifts/current', { terminal_id: terminalId || undefined });
      setCurrent(s);
      if (s) setSummary(await get(`/finance/shifts/${s.id}/summary`)); else setSummary(null);
    } catch (e) { toast.error(errMsg(e)); }
  };
  useEffect(() => { loadCurrent(); }, []);

  const openShift = async () => {
    setBusy(true);
    try { await post('/finance/shifts/open', { terminal_id: terminalId || undefined, opening_cash: denomTotal(denoms), opening_denoms: denoms }); toast.success('Shift opened'); setOpenM(false); setDenoms({}); loadCurrent(); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const closeShift = async () => {
    setBusy(true);
    try { const r = await post(`/finance/shifts/${current.id}/close`, { closing_cash: denomTotal(denoms), closing_denoms: denoms, remark }); toast.success(`Shift closed · variance ${fmt(r.shift.variance)}`); setCloseM(false); setDenoms({}); setView(r); loadCurrent(); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const openView = async r => { try { setView(await get(`/finance/shifts/${r.id}/summary`)); } catch (e) { toast.error(errMsg(e)); } };

  const Z = ({ s }) => s && (
    <div className="print-area">
      <div className="stat-grid mb">
        <Stat label="Sales" value={fmt(s.sales.sales_total)} sub={`${s.sales.invoices} invoices · returns ${fmt(s.sales.returns_total)}`} />
        <Stat label="Cash sales" value={fmt(s.sales.cash_sales)} sub={`card ${fmt(s.sales.card_sales)} · credit ${fmt(s.sales.credit_sales)}`} />
        <Stat label="Expected cash" value={fmt(s.expected_cash)} sub={`opening ${fmt(s.shift.opening_cash)}`} />
        {s.shift.status === 'CLOSED' && <Stat label="Counted / variance" value={fmt(s.shift.closing_cash)} sub={<span className={Number(s.shift.variance) < 0 ? 'text-bad' : 'text-good'}>variance {fmt(s.shift.variance)}</span>} />}
      </div>
      <table className="table compact">
        <tbody>
          <tr><td>Opening cash</td><td className="num">{fmt(s.shift.opening_cash)}</td></tr>
          <tr><td>+ Cash sales (net of cash refunds)</td><td className="num">{fmt(s.sales.cash_sales)}</td></tr>
          <tr><td>+ Customer payments (cash)</td><td className="num">{fmt(s.customer_payments.cash)}</td></tr>
          <tr><td>+ Other income (cash)</td><td className="num">{fmt(s.income_expense.cash_income)}</td></tr>
          <tr><td>− Supplier payments (cash)</td><td className="num">{fmt(s.supplier_payments.cash)}</td></tr>
          <tr><td>− Expenses (cash)</td><td className="num">{fmt(s.income_expense.cash_expense)}</td></tr>
          <tr><td>− Cash purchases</td><td className="num">{fmt(s.purchases.cash_purchases)}</td></tr>
          <tr className="bold"><td>= Expected cash in drawer</td><td className="num">{fmt(s.expected_cash)}</td></tr>
          <tr><td colSpan={2} style={{ background: 'var(--surface-2)' }} className="bold">Sales breakdown</td></tr>
          <tr><td>Card</td><td className="num">{fmt(s.sales.card_sales)}</td></tr><tr><td>Cheque</td><td className="num">{fmt(s.sales.cheque_sales)}</td></tr><tr><td>Bank transfer</td><td className="num">{fmt(s.sales.bank_sales)}</td></tr>
          <tr><td>Credit</td><td className="num">{fmt(s.sales.credit_sales)}</td></tr><tr><td>Vouchers / points</td><td className="num">{fmt(Number(s.sales.voucher_sales) + Number(s.sales.points_sales))}</td></tr>
          <tr><td>Discounts given</td><td className="num">{fmt(s.sales.discounts)}</td></tr><tr><td>Cancelled invoices</td><td className="num">{s.sales.cancelled}</td></tr>
          {can('show_cost') && <tr><td>Gross profit</td><td className="num">{fmt(s.sales.profit)}</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Shifts / Day End</h1><div className="sub">{terminalId ? 'Terminal set in POS' : 'No terminal selected — shifts are per location'}</div></div>
        <div className="row">
          {!current && can('cash_denomination') && <button className="btn primary" onClick={() => setOpenM(true)}>Open shift</button>}
          {current && can('cash_denomination') && <button className="btn danger" onClick={() => setCloseM(true)}>Close shift (Z report)</button>}
          {current && <button className="btn" onClick={() => window.print()}>🖨 X report</button>}
        </div>
      </div>

      {current ? <div className="card"><div className="card-head"><h2>Open shift {current.shift_no}</h2><span className="muted">opened by {current.opened_by} · {String(current.opened_at).slice(0, 16).replace('T', ' ')}</span></div><div className="card-body"><Z s={summary} /></div></div>
        : <div className="card pad muted">No shift is open. Open one with the starting cash float to track the drawer.</div>}

      <div className="card">
        <div className="card-head"><h2>Shift history</h2></div>
        <DataTable rows={list.rows} loading={list.loading} onRowClick={openView} columns={[
          { key: 'shift_no', label: 'Shift' }, { key: 'terminal_name', label: 'Terminal' }, { key: 'opened_at', label: 'Opened', render: r => String(r.opened_at).slice(0, 16).replace('T', ' ') }, { key: 'opened_by', label: 'By' },
          { key: 'closed_at', label: 'Closed', render: r => r.closed_at ? String(r.closed_at).slice(0, 16).replace('T', ' ') : '-' }, { key: 'opening_cash', label: 'Opening', num: true }, { key: 'expected_cash', label: 'Expected', num: true }, { key: 'closing_cash', label: 'Counted', num: true },
          { key: 'variance', label: 'Variance', num: true, render: r => r.variance == null ? '-' : <span className={Number(r.variance) < 0 ? 'text-bad' : Number(r.variance) > 0 ? 'text-warn' : 'text-good'}>{fmt(r.variance)}</span> }, { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> },
        ]} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>

      <Modal open={openM} title="Open shift — count opening float" onClose={() => setOpenM(false)} footer={<><button className="btn" onClick={() => setOpenM(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={openShift}>Open shift</button></>}><DenomGrid value={denoms} onChange={setDenoms} /></Modal>
      <Modal open={closeM} title="Close shift — count drawer" onClose={() => setCloseM(false)} footer={<><button className="btn" onClick={() => setCloseM(false)}>Cancel</button><button className="btn danger" disabled={busy} onClick={closeShift}>Close shift</button></>}>
        <p className="mb muted">Expected cash: <b>{cur} {fmt(summary?.expected_cash)}</b></p>
        <DenomGrid value={denoms} onChange={setDenoms} />
        <div className="field mt"><label>Remark</label><input className="input" value={remark} onChange={e => setRemark(e.target.value)} /></div>
      </Modal>
      <Modal open={!!view} title={`Shift ${view?.shift?.shift_no} — Z report`} onClose={() => setView(null)} size="lg" footer={<button className="btn" onClick={() => window.print()}>🖨 Print</button>}><Z s={view} /></Modal>
    </div>
  );
}
