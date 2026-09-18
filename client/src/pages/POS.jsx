import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put, del, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Lookup, Modal, RefSelect, fmt, fmtQty, useToast, Confirm } from '../components/ui.jsx';
import Receipt, { printReceipt } from '../components/Receipt.jsx';

const PAY_TYPES = ['CASH', 'CARD', 'CHEQUE', 'BANK', 'VOUCHER', 'POINTS'];
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

function priceFor(batch, customer) {
  if (!batch) return 0;
  if (customer?.category === 'WHOLESALE' && Number(batch.wholesale_price) > 0) return Number(batch.wholesale_price);
  const pc = Number(customer?.price_category || 0);
  if (pc > 0 && Array.isArray(batch.cus_cat_price) && Number(batch.cus_cat_price[pc - 1]) > 0) return Number(batch.cus_cat_price[pc - 1]);
  return Number(batch.selling_price);
}

export default function POS() {
  const { user, company, can, locationId } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { holdId } = useParams();
  const cur = company?.currency_symbol || 'Rs.';

  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [salesman, setSalesman] = useState('');
  const [billDiscount, setBillDiscount] = useState('');
  const [extra, setExtra] = useState('');
  const [remark, setRemark] = useState('');
  const [payments, setPayments] = useState([{ pay_type: 'CASH', amount: '' }]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(-1);
  const [held, setHeld] = useState(null);        // list modal
  const [done, setDone] = useState(null);        // finished invoice -> receipt
  const [confirmClear, setConfirmClear] = useState(false);
  const [terminals, setTerminals] = useState([]);
  const [terminalId, setTerminalId] = useState(() => localStorage.getItem('sepos_terminal') || '');
  const scanRef = useRef(null);

  useEffect(() => { get('/master/terminals').then(d => setTerminals(d.data.filter(t => String(t.location_id) === String(locationId)))).catch(() => {}); }, [locationId]);
  /** Rebuild cart lines from saved document lines (held invoice / quotation) using current item + batch data. */
  const hydrate = (docLines, cus) => Promise.all(docLines.map(it => get('/master/items/lookup/pos', { q: it.item_code }).then(rows => ({ it, item: rows.find(r => r.code === it.item_code) })))).then(res =>
    res.filter(x => x.item).map(({ it, item }) => {
      const batch = (it.batch_id && item.batches.find(b => b.id === it.batch_id)) || item.batches.find(b => Number(b.qty_remain) > 0) || item.batches[0] || null;
      const current = priceFor(batch, cus);
      const editable = item.allow_edit_price_on_invoice || can('price_change');
      return { item_id: item.id, item_code: item.code, item_name: item.name, unit: item.unit, batch_id: batch?.id || null, batches: item.batches, qty: it.qty,
        unit_price: editable ? Number(it.unit_price) : current, list_price: current, min_price: Number(batch?.discount_price || 0), discount: it.discount || 0,
        allow_decimal: item.allow_decimal, allow_discount: item.allow_discount, allow_edit_price: editable, stock: batch ? Number(batch.qty_remain) : null, warranty: it.warranty || '', serial_nos: it.serial_nos || '' };
    }));

  // convert a quotation: lines handed over by Quotations.jsx through sessionStorage
  const [quoteId, setQuoteId] = useState(null);
  useEffect(() => {
    const raw = sessionStorage.getItem('sepos_quote');
    if (!raw || !window.location.search.includes('from_quote')) return;
    sessionStorage.removeItem('sepos_quote');
    const q = JSON.parse(raw);
    setQuoteId(q.id);
    const cus = q.customer_id ? { id: q.customer_id, name: q.customer_name, mobile: q.cus_mobile } : null;
    if (cus) setCustomer(cus);
    setRemark(`Quotation ${q.serial_no}`);
    hydrate(q.items, cus).then(setLines).catch(e => toast.error(errMsg(e)));
  }, []);

  useEffect(() => {
    if (!holdId) return;
    get(`/sales/invoices/${holdId}`).then(async inv => {
      if (inv.invoice_status !== 'HOLD') return;
      const cus = inv.customer_id ? { id: inv.customer_id, name: inv.customer_name, mobile: inv.customer_mobile, due_amount: inv.cus_due_amount } : null;
      if (cus) setCustomer(cus);
      setLines(await hydrate(inv.items, cus));
      setBillDiscount(inv.bill_discount || ''); setExtra(inv.extra_charges || ''); setRemark(inv.remark || ''); setSalesman(inv.salesman_id || '');
    }).catch(e => toast.error(errMsg(e)));
  }, [holdId]);

  // ---- totals
  const t = useMemo(() => {
    const gross = lines.reduce((s, l) => s + Number(l.qty) * Number(l.list_price || l.unit_price), 0);
    const sub = lines.reduce((s, l) => s + r2(Number(l.qty) * Number(l.unit_price) - Number(l.discount || 0)), 0);
    const itemDisc = gross - sub;
    const net = r2(sub - Number(billDiscount || 0) + Number(extra || 0));
    const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const qty = lines.reduce((s, l) => s + Number(l.qty), 0);
    return { gross: r2(gross), sub: r2(sub), itemDisc: r2(itemDisc), net, paid: r2(paid), balance: r2(paid - net), qty };
  }, [lines, billDiscount, extra, payments]);

  // ---- cart ops
  const addItem = item => {
    if (item.item_type === 'STOCK' && item.track_inventory && !item.batches.length) { toast.error(`${item.name}: no stock at this location`); return; }
    const batch = item.batches.find(b => Number(b.qty_remain) > 0) || item.batches[0] || null;
    const price = priceFor(batch, customer);
    setLines(ls => {
      const idx = ls.findIndex(l => l.item_id === item.id && l.batch_id === (batch?.id || null) && !item.ask_serial_on_invoice);
      if (idx >= 0) { const c = [...ls]; c[idx] = { ...c[idx], qty: Number(c[idx].qty) + 1 }; setSel(idx); return c; }
      setSel(ls.length);
      return [...ls, { item_id: item.id, item_code: item.code, item_name: item.name, unit: item.unit, batch_id: batch?.id || null, batches: item.batches, qty: 1,
        unit_price: price, list_price: price, min_price: Number(batch?.discount_price || 0), discount: 0, allow_decimal: item.allow_decimal, allow_discount: item.allow_discount,
        allow_edit_price: item.allow_edit_price_on_invoice || can('price_change'), stock: batch ? Number(batch.qty_remain) : null, warranty: item.warranty_months ? `${item.warranty_months} months` : '', serial_nos: '' }];
    });
  };
  const setLine = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLine = i => setLines(ls => ls.filter((_, j) => j !== i));
  const changeBatch = (i, batchId) => {
    const l = lines[i]; const b = l.batches.find(x => String(x.id) === String(batchId));
    setLine(i, { batch_id: b?.id || null, unit_price: priceFor(b, customer), list_price: priceFor(b, customer), min_price: Number(b?.discount_price || 0), stock: b ? Number(b.qty_remain) : null });
  };
  // re-price when the customer changes (wholesale / category prices)
  useEffect(() => { setLines(ls => ls.map(l => { const b = l.batches?.find(x => x.id === l.batch_id); if (!b) return l; const p = priceFor(b, customer); return { ...l, unit_price: p, list_price: p }; })); }, [customer?.id]);

  const reset = () => { setLines([]); setCustomer(null); setBillDiscount(''); setExtra(''); setRemark(''); setPayments([{ pay_type: 'CASH', amount: '' }]); setSel(-1); if (holdId) nav('/pos', { replace: true }); scanRef.current?.focus(); };

  // ---- payments
  const setPay = (i, patch) => setPayments(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const exactCash = () => setPayments([{ pay_type: 'CASH', amount: t.net }]);
  const quickCash = amt => setPayments(ps => { const c = [...ps]; const i = c.findIndex(p => p.pay_type === 'CASH'); if (i >= 0) c[i] = { ...c[i], amount: amt }; else c.unshift({ pay_type: 'CASH', amount: amt }); return c; });

  const body = status => ({
    status, hold_id: holdId || undefined, terminal_id: terminalId || undefined, customer_id: customer?.id || undefined, salesman_id: salesman || undefined,
    bill_discount: Number(billDiscount || 0), extra_charges: Number(extra || 0), remark,
    items: lines.map(l => ({ item_id: l.item_id, batch_id: l.batch_id, qty: Number(l.qty), unit_price: Number(l.unit_price), discount: Number(l.discount || 0), warranty: l.warranty, serial_nos: l.serial_nos || undefined })),
    payments: status === 'HOLD' ? [] : payments.filter(p => Number(p.amount) > 0).map(p => ({ ...p, amount: Number(p.amount) })),
  });

  const submit = async status => {
    if (!lines.length) return toast.error('Cart is empty');
    if (status !== 'HOLD' && t.paid < t.net && !customer) return toast.error(`Short by ${cur} ${fmt(t.net - t.paid)} — add payment or select a credit customer`);
    setBusy(true);
    try {
      const inv = await post('/sales/invoices', body(status));
      if (status === 'HOLD') { toast.success(`Held as ${inv.serial_no}`); reset(); }
      else {
        if (quoteId) { put(`/sales/quotations/${quoteId}/status`, { status: 'CONVERTED', invoice_id: inv.id }).catch(() => {}); setQuoteId(null); }
        setDone(inv);
      }
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const loadHeld = async () => { try { setHeld(await get('/sales/invoices/held')); } catch (e) { toast.error(errMsg(e)); } };
  const deleteHeld = async id => { try { await del(`/sales/invoices/${id}/hold`); setHeld(h => h.filter(x => x.id !== id)); } catch (e) { toast.error(errMsg(e)); } };

  // ---- keyboard shortcuts
  useEffect(() => {
    const onKey = e => {
      if (done) return;
      if (e.key === 'F2') { e.preventDefault(); scanRef.current?.focus(); }
      if (e.key === 'F4') { e.preventDefault(); exactCash(); }
      if (e.key === 'F8') { e.preventDefault(); submit('HOLD'); }
      if (e.key === 'F9') { e.preventDefault(); submit('PRINTED'); }
      if (e.key === 'Delete' && sel >= 0 && document.activeElement?.tagName !== 'INPUT') removeLine(sel);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="pos">
      {/* ------------------------------------------------ cart */}
      <div className="card cart">
        <div className="scan">
          <div className="grow">
            <Lookup url="/master/items/lookup/pos" placeholder="Scan barcode or type item name / code  (F2)" autoFocus onPick={addItem} inputProps={{ autoPickSingle: true }}
              render={r => <><span>{r.name} <small>{r.code}</small></span><small>{r.batches?.[0] ? `${fmt(priceFor(r.batches[0], customer))} · stock ${fmtQty(r.batches.reduce((s, b) => s + Number(b.qty_remain), 0))}` : 'no stock'}</small></>} />
          </div>
          <div style={{ width: 260 }}>
            <Lookup url="/master/customers" placeholder={customer ? `${customer.name}` : 'Customer (cash)'} clearOnPick onPick={c => setCustomer(c)} minChars={1}
              render={r => <><span>{r.name} <small>{r.code}</small></span><small>{r.mobile || ''}{Number(r.due_amount) > 0 ? ` · due ${fmt(r.due_amount)}` : ''}</small></>} />
          </div>
          {customer && <button className="btn icon" title="Cash customer" onClick={() => setCustomer(null)}>✕</button>}
        </div>
        <div className="lines">
          <table className="table compact">
            <thead><tr><th>#</th><th>Item</th><th>Batch</th><th className="num">Stock</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Disc</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={9} className="empty">Scan or search an item to begin.<br /><span className="subtle">F2 search · F4 exact cash · F8 hold · F9 pay & print</span></td></tr>}
              {lines.map((l, i) => (
                <tr key={i} className={i === sel ? 'sel' : ''} onClick={() => setSel(i)}>
                  <td className="muted">{i + 1}</td>
                  <td><div className="bold">{l.item_name}</div><div className="subtle">{l.item_code}{l.warranty ? ` · ${l.warranty}` : ''}</div></td>
                  <td>{l.batches?.length > 1 ? <select className="input sm" value={l.batch_id || ''} onChange={e => changeBatch(i, e.target.value)}>{l.batches.map(b => <option key={b.id} value={b.id}>#{b.batch_no} · {fmt(b.selling_price)} · {fmtQty(b.qty_remain)}</option>)}</select> : <span className="subtle">{l.batches?.[0]?.batch_no ? '#' + l.batches[0].batch_no : '-'}</span>}</td>
                  <td className={`num ${l.stock !== null && l.stock < Number(l.qty) ? 'text-bad' : ''}`}>{l.stock === null ? '-' : fmtQty(l.stock)}</td>
                  <td className="num"><input className="input sm" type="number" step={l.allow_decimal ? '0.001' : '1'} min="0" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} onFocus={e => e.target.select()} /></td>
                  <td className="num"><input className="input sm" type="number" step="0.01" value={l.unit_price} readOnly={!l.allow_edit_price} onChange={e => setLine(i, { unit_price: e.target.value })} onFocus={e => e.target.select()} /></td>
                  <td className="num"><input className="input sm" type="number" step="0.01" min="0" value={l.discount} readOnly={!l.allow_discount} onChange={e => setLine(i, { discount: e.target.value })} onFocus={e => e.target.select()} /></td>
                  <td className="num bold">{fmt(Number(l.qty) * Number(l.unit_price) - Number(l.discount || 0))}</td>
                  <td><button className="btn ghost icon sm" onClick={e => { e.stopPropagation(); removeLine(i); }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
          <span className="muted">{lines.length} lines · {fmtQty(t.qty)} qty</span>
          <span className="grow" />
          <RefSelect url="/master/employees" params={{ limit: 200 }} value={salesman} onChange={setSalesman} placeholder="Salesman" style={{ width: 170 }} className="" />
          {terminals.length > 0 && <select className="input sm" style={{ width: 140 }} value={terminalId} onChange={e => { setTerminalId(e.target.value); localStorage.setItem('sepos_terminal', e.target.value); }}><option value="">Terminal</option>{terminals.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
          <input className="input sm" style={{ width: 220 }} placeholder="Remark" value={remark} onChange={e => setRemark(e.target.value)} />
        </div>
      </div>

      {/* ------------------------------------------------ side */}
      <div className="side">
        <div className="card totals">
          <div className="line"><span className="muted">Customer</span><span className="bold">{customer ? customer.name : 'CASH CUSTOMER'}</span></div>
          {customer && Number(customer.due_amount) > 0 && <div className="line"><span className="muted">Outstanding</span><span className="text-bad">{fmt(customer.due_amount)}</span></div>}
          {customer && Number(customer.loyalty_points) > 0 && <div className="line"><span className="muted">Points</span><span>{fmt(customer.loyalty_points, 0)}</span></div>}
          <div className="line"><span className="muted">Gross</span><span>{fmt(t.gross)}</span></div>
          <div className="line"><span className="muted">Item discounts</span><span>{fmt(t.itemDisc)}</span></div>
          <div className="line"><span className="muted">Bill discount</span><input className="input sm" style={{ width: 110, textAlign: 'right' }} type="number" min="0" value={billDiscount} onChange={e => setBillDiscount(e.target.value)} disabled={!can('cash_discount')} /></div>
          <div className="line"><span className="muted">Extra charges</span><input className="input sm" style={{ width: 110, textAlign: 'right' }} type="number" min="0" value={extra} onChange={e => setExtra(e.target.value)} /></div>
          <div className="line big"><span>Net</span><span>{cur} {fmt(t.net)}</span></div>
        </div>

        <div className="card pay">
          <div className="row between"><h3>Payment</h3><button className="btn sm" onClick={() => setPayments(p => [...p, { pay_type: 'CARD', amount: '' }])}>＋ Split</button></div>
          <div className="pays">
            {payments.map((p, i) => (
              <div key={i}>
                <div className="p">
                  <select className="input sm" value={p.pay_type} onChange={e => setPay(i, { pay_type: e.target.value })}>{PAY_TYPES.map(x => <option key={x}>{x}</option>)}</select>
                  <input className="input sm" type="number" step="0.01" placeholder="Amount" value={p.amount} onChange={e => setPay(i, { amount: e.target.value })} onFocus={e => e.target.select()} />
                  <button className="btn ghost icon sm" onClick={() => setPayments(ps => ps.filter((_, j) => j !== i))} disabled={payments.length === 1}>✕</button>
                </div>
                {p.pay_type === 'CARD' && <input className="input sm mt" style={{ marginTop: 4 }} placeholder="Card last 4 / ref" value={p.reference || ''} onChange={e => setPay(i, { reference: e.target.value, card_no: e.target.value })} />}
                {p.pay_type === 'CHEQUE' && <div className="row gap-sm" style={{ marginTop: 4 }}><input className="input sm" placeholder="Cheque no" value={p.cheque_no || ''} onChange={e => setPay(i, { cheque_no: e.target.value })} /><input className="input sm" type="date" value={p.cheque_date || ''} onChange={e => setPay(i, { cheque_date: e.target.value })} /><input className="input sm" placeholder="Bank" value={p.cheque_bank || ''} onChange={e => setPay(i, { cheque_bank: e.target.value })} /></div>}
                {p.pay_type === 'BANK' && <div style={{ marginTop: 4 }}><RefSelect url="/master/banks" labelKey="bank_name" value={p.bank_id || ''} onChange={v => setPay(i, { bank_id: v })} placeholder="Bank account" extraLabel={b => `${b.bank_name} ${b.account_no || ''}`} /></div>}
                {p.pay_type === 'VOUCHER' && <input className="input sm" style={{ marginTop: 4 }} placeholder="Voucher no" value={p.reference || ''} onChange={e => setPay(i, { reference: e.target.value })} />}
              </div>
            ))}
          </div>
          <div className="row gap-sm">
            <button className="btn sm" onClick={exactCash}>Exact (F4)</button>
            {[500, 1000, 2000, 5000].map(a => <button key={a} className="btn sm" onClick={() => quickCash(a)}>{a}</button>)}
          </div>
          <div className="row between"><span className="muted">Paid</span><span className="bold">{fmt(t.paid)}</span></div>
          <div className="row between">
            <span className="muted">{t.balance >= 0 ? 'Change' : customer ? 'On credit' : 'Short'}</span>
            <span className={`bold ${t.balance < 0 && !customer ? 'text-bad' : t.balance < 0 ? 'text-warn' : 'text-good'}`} style={{ fontSize: 18 }}>{fmt(Math.abs(t.balance))}</span>
          </div>
        </div>

        <div className="card fn">
          <button className="btn" onClick={loadHeld}>Held ⋯</button>
          <button className="btn" onClick={() => submit('HOLD')} disabled={busy || !lines.length || !can('hold_invoice')}>Hold (F8)</button>
          <button className="btn danger" onClick={() => setConfirmClear(true)} disabled={!lines.length}>Clear</button>
          <button className="btn primary lg" style={{ gridColumn: '1 / -1' }} onClick={() => submit('PRINTED')} disabled={busy || !lines.length}>{busy ? 'Saving…' : 'Pay & Print (F9)'}</button>
        </div>
      </div>

      <Confirm open={confirmClear} title="Clear cart?" message="All lines will be removed." onClose={() => setConfirmClear(false)} onConfirm={() => { reset(); setConfirmClear(false); }} />

      <Modal open={!!held} title="Held invoices" onClose={() => setHeld(null)}>
        {held?.length === 0 && <div className="empty">No held invoices</div>}
        {held?.map(h => (
          <div key={h.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div><div className="bold">{h.serial_no} · {h.customer_name}</div><div className="subtle">{fmtQty(h.total_qty)} qty · {fmt(h.net_total)} · {h.created_by} · {String(h.created_at).slice(0, 16).replace('T', ' ')}</div></div>
            <div className="row gap-sm"><button className="btn sm primary" onClick={() => { setHeld(null); nav(`/pos/${h.id}`); }}>Resume</button><button className="btn sm danger" onClick={() => deleteHeld(h.id)}>Delete</button></div>
          </div>
        ))}
      </Modal>

      <Modal open={!!done} title={`Invoice ${done?.serial_no || ''} saved`} onClose={() => { setDone(null); reset(); }} size="sm"
        footer={<><button className="btn" onClick={() => { setDone(null); reset(); }}>New invoice</button><button className="btn primary" onClick={printReceipt}>🖨 Print</button></>}>
        {done && <Receipt invoice={done} company={company} />}
      </Modal>
    </div>
  );
}
