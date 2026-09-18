import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { get, post, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modal, Confirm, Badge, fmt, fmtQty, fmtDate, useToast } from '../components/ui.jsx';

export default function PurchaseDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [p, setP] = useState(null);
  const [cancel, setCancel] = useState(false);
  const [ret, setRet] = useState(false);
  const [retQty, setRetQty] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => get(`/purchases/${id}`).then(setP).catch(e => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [id]);
  if (!p) return <div className="empty">Loading…</div>;

  const doCancel = async () => { setBusy(true); try { await post(`/purchases/${id}/cancel`); toast.success('GRN cancelled'); setCancel(false); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const doReturn = async () => {
    const items = Object.entries(retQty).filter(([, q]) => Number(q) > 0).map(([purchase_item_id, qty]) => ({ purchase_item_id, qty: Number(qty) }));
    if (!items.length) return toast.error('Enter return quantities');
    setBusy(true);
    try { const r = await post(`/purchases/${id}/return`, { items, reason }); toast.success(`Return ${r.serial_no} created`); setRet(false); nav(`/purchases/${r.id}`); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const active = p.invoice_status === 'PRINTED';

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{p.inv_mode === 'RET' ? 'Purchase Return' : 'GRN'} {p.serial_no}</h1><div className="sub">{fmtDate(p.purchase_date)} · {p.location_name} · by {p.created_by}</div></div>
        <div className="row no-print">
          <Link to="/purchases" className="btn">← Back</Link>
          {active && p.inv_mode === 'PCH' && can('purchase_return') && <button className="btn" onClick={() => setRet(true)}>↩ Return to supplier</button>}
          {active && can('cancel_purchase') && <button className="btn danger" onClick={() => setCancel(true)}>Cancel GRN</button>}
          <button className="btn" onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>
      <div className="card pad">
        <dl className="kv">
          <dt>Status</dt><dd><Badge status={p.invoice_status} /> <Badge status={p.order_status} /></dd>
          <dt>Supplier</dt><dd>{p.supplier_name}{p.sup_mobile ? ` · ${p.sup_mobile}` : ''}</dd>
          <dt>Supplier invoice</dt><dd>{p.invoice_no || '-'}</dd>
          <dt>Pay mode</dt><dd>{p.pay_mode}</dd>
          {p.due_date && <><dt>Due date</dt><dd>{fmtDate(p.due_date)}</dd></>}
          {p.remark && <><dt>Remark</dt><dd>{p.remark}</dd></>}
        </dl>
      </div>
      <div className="card">
        <div className="card-head"><h2>Items</h2><span className="muted">{fmtQty(p.total_qty)} qty</span></div>
        <table className="table compact">
          <thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th className="num">Free</th><th className="num">Cost</th><th className="num">Selling</th><th className="num">Disc</th><th className="num">Total</th><th>Expiry</th></tr></thead>
          <tbody>{p.items.map(it => <tr key={it.id}><td>{it.line_no}</td><td>{it.item_name}<div className="subtle">{it.item_code}</div></td><td className="num">{fmtQty(it.qty)}</td><td className="num">{fmtQty(it.free_qty)}</td><td className="num">{fmt(it.cost_price)}</td><td className="num">{fmt(it.selling_price)}</td><td className="num">{fmt(it.discount)}</td><td className="num bold">{fmt(it.line_total)}</td><td>{it.expiry_date || '-'}</td></tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={7} className="right">Gross</td><td className="num">{fmt(p.gross_total)}</td><td /></tr>
            <tr><td colSpan={7} className="right">Discounts / Charges</td><td className="num">-{fmt(Number(p.item_discount) + Number(p.bill_discount))} / +{fmt(p.extra_charges)}</td><td /></tr>
            <tr><td colSpan={7} className="right">Net</td><td className="num" style={{ fontSize: 16 }}>{fmt(p.net_total)}</td><td /></tr>
            <tr><td colSpan={7} className="right">Paid / Due</td><td className="num">{fmt(p.paid_amount)} / <span className={Number(p.due_amount) > 0 ? 'text-warn' : ''}>{fmt(p.due_amount)}</span></td><td /></tr>
          </tfoot>
        </table>
      </div>

      <Confirm open={cancel} title="Cancel GRN?" message="Received stock will be deducted and the supplier balance reversed." onClose={() => setCancel(false)} onConfirm={doCancel} busy={busy} />
      <Modal open={ret} title={`Return items to ${p.supplier_name}`} onClose={() => setRet(false)}
        footer={<><button className="btn" onClick={() => setRet(false)}>Back</button><button className="btn primary" disabled={busy} onClick={doReturn}>Create return</button></>}>
        <table className="table compact">
          <thead><tr><th>Item</th><th className="num">Received</th><th className="num">Return qty</th></tr></thead>
          <tbody>{p.items.map(it => <tr key={it.id}><td>{it.item_name}</td><td className="num">{fmtQty(it.qty)}</td><td className="num"><input className="input sm" type="number" min="0" max={it.qty} style={{ width: 90 }} value={retQty[it.id] || ''} onChange={e => setRetQty(q => ({ ...q, [it.id]: e.target.value }))} /></td></tr>)}</tbody>
        </table>
        <div className="field mt"><label>Reason</label><input className="input" value={reason} onChange={e => setReason(e.target.value)} /></div>
      </Modal>
    </div>
  );
}
