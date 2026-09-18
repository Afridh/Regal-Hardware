import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { get, post, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modal, Badge, fmt, fmtQty, fmtDate, fmtTime, useToast } from '../components/ui.jsx';
import Receipt, { printReceipt } from '../components/Receipt.jsx';

export default function InvoiceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { company, can } = useAuth();
  const toast = useToast();
  const [inv, setInv] = useState(null);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [ret, setRet] = useState(false);
  const [retQty, setRetQty] = useState({});
  const [refund, setRefund] = useState('CASH');
  const [busy, setBusy] = useState(false);

  const load = () => get(`/sales/invoices/${id}`).then(setInv).catch(e => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [id]);
  if (!inv) return <div className="empty">Loading…</div>;

  const doCancel = async () => {
    setBusy(true);
    try { await post(`/sales/invoices/${id}/cancel`, { reason }); toast.success('Invoice cancelled'); setCancel(false); load(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const doReturn = async () => {
    const items = Object.entries(retQty).filter(([, q]) => Number(q) > 0).map(([invoice_item_id, qty]) => ({ invoice_item_id, qty: Number(qty) }));
    if (!items.length) return toast.error('Enter return quantities');
    setBusy(true);
    try { const r = await post(`/sales/invoices/${id}/return`, { items, refund_type: refund, reason }); toast.success(`Return ${r.serial_no} created`); setRet(false); nav(`/invoices/${r.id}`); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const active = inv.invoice_status === 'PRINTED';
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{inv.inv_mode === 'RET' ? 'Sales Return' : 'Invoice'} {inv.serial_no}</h1><div className="sub">{fmtDate(inv.invoice_date)} {fmtTime(inv.invoice_time)} · {inv.location_name}{inv.terminal_name ? ` · ${inv.terminal_name}` : ''} · by {inv.created_by}</div></div>
        <div className="row no-print">
          <Link to="/invoices" className="btn">← Back</Link>
          {inv.invoice_status === 'HOLD' && <Link to={`/pos/${inv.id}`} className="btn primary">Resume in POS</Link>}
          {active && inv.inv_mode === 'INV' && can('invoice_return') && <button className="btn" onClick={() => setRet(true)}>↩ Return items</button>}
          {active && can('cancel_invoice') && <button className="btn danger" onClick={() => setCancel(true)}>Cancel invoice</button>}
          {can('print_invoice') && <button className="btn primary" onClick={printReceipt}>🖨 Print</button>}
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="card pad">
            <dl className="kv">
              <dt>Status</dt><dd><Badge status={inv.invoice_status} /> <Badge status={inv.order_status} /></dd>
              <dt>Customer</dt><dd>{inv.customer_name}{inv.customer_mobile ? ` · ${inv.customer_mobile}` : ''}</dd>
              {inv.salesman_name && <><dt>Salesman</dt><dd>{inv.salesman_name}</dd></>}
              <dt>Pay mode</dt><dd>{inv.pay_mode}</dd>
              {inv.remark && <><dt>Remark</dt><dd>{inv.remark}</dd></>}
              {inv.cancelled_by && <><dt>Cancelled</dt><dd className="text-bad">{inv.cancelled_by} · {String(inv.cancelled_at).slice(0, 16)} · {inv.cancel_reason}</dd></>}
            </dl>
          </div>
          <div className="card">
            <div className="card-head"><h2>Items</h2><span className="muted">{inv.total_lines} lines · {fmtQty(inv.total_qty)} qty</span></div>
            <table className="table compact">
              <thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Disc</th><th className="num">Total</th>{can('show_cost') && <th className="num">Cost</th>}</tr></thead>
              <tbody>{inv.items.map(it => (
                <tr key={it.id}><td>{it.line_no}</td><td>{it.item_name}<div className="subtle">{it.item_code}{it.warranty ? ` · ${it.warranty}` : ''}{it.serial_nos ? ` · SN ${it.serial_nos}` : ''}</div></td>
                  <td className="num">{fmtQty(it.qty)}</td><td className="num">{fmt(it.unit_price)}</td><td className="num">{fmt(it.discount)}</td><td className="num bold">{fmt(it.line_total)}</td>{can('show_cost') && <td className="num muted">{fmt(it.cost_price)}</td>}</tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={5} className="right">Gross</td><td className="num">{fmt(inv.gross_total)}</td>{can('show_cost') && <td />}</tr>
                <tr><td colSpan={5} className="right">Discounts</td><td className="num">{fmt(Number(inv.item_discount) + Number(inv.bill_discount))}</td>{can('show_cost') && <td />}</tr>
                <tr><td colSpan={5} className="right">Net</td><td className="num" style={{ fontSize: 16 }}>{fmt(inv.net_total)}</td>{can('show_cost') && <td className="num muted">GP {fmt(inv.profit)}</td>}</tr></tfoot>
            </table>
          </div>
          <div className="card">
            <div className="card-head"><h2>Payments</h2></div>
            <table className="table compact"><tbody>
              {inv.payments.map(p => <tr key={p.id}><td>{p.pay_type}</td><td className="muted">{p.reference || p.cheque_no || p.card_no || ''}</td><td className="num">{fmt(p.amount)}</td></tr>)}
              {Number(inv.balance_amount) > 0 && <tr><td>Change given</td><td /><td className="num">{fmt(inv.balance_amount)}</td></tr>}
              {Number(inv.due_amount) > 0 && <tr className="bold"><td>Outstanding</td><td /><td className="num text-bad">{fmt(inv.due_amount)}</td></tr>}
            </tbody></table>
          </div>
        </div>
        <div className="card pad"><Receipt invoice={inv} company={company} /></div>
      </div>

      <Modal open={cancel} title="Cancel invoice" onClose={() => setCancel(false)} size="sm"
        footer={<><button className="btn" onClick={() => setCancel(false)}>Back</button><button className="btn danger" disabled={busy} onClick={doCancel}>Cancel invoice</button></>}>
        <p className="mb">Stock will be returned and the customer balance reversed.</p>
        <textarea className="input" placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)} />
      </Modal>

      <Modal open={ret} title={`Return items from ${inv.serial_no}`} onClose={() => setRet(false)}
        footer={<><button className="btn" onClick={() => setRet(false)}>Back</button><button className="btn primary" disabled={busy} onClick={doReturn}>Create return</button></>}>
        <table className="table compact">
          <thead><tr><th>Item</th><th className="num">Sold</th><th className="num">Return qty</th></tr></thead>
          <tbody>{inv.items.map(it => <tr key={it.id}><td>{it.item_name}</td><td className="num">{fmtQty(it.qty)}</td><td className="num"><input className="input sm" type="number" min="0" max={it.qty} style={{ width: 90 }} value={retQty[it.id] || ''} onChange={e => setRetQty(q => ({ ...q, [it.id]: e.target.value }))} /></td></tr>)}</tbody>
        </table>
        <div className="form-grid mt">
          <div className="field"><label>Refund by</label><select className="input" value={refund} onChange={e => setRefund(e.target.value)}><option value="CASH">Cash refund</option>{inv.customer_id && <option value="CREDIT">Credit to customer account</option>}</select></div>
          <div className="field"><label>Reason</label><input className="input" value={reason} onChange={e => setReason(e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  );
}
