import { fmt, fmtQty, fmtDate, fmtTime } from './ui.jsx';

/** 80mm-style receipt preview (rptInvoiceR80mm equivalent). */
export default function Receipt({ invoice: inv, company }) {
  const cur = company?.currency_symbol || 'Rs.';
  const isRet = inv.inv_mode === 'RET';
  return (
    <div className="receipt" id="receipt">
      <div className="c bold" style={{ fontSize: 15 }}>{company?.name}</div>
      {company?.address1 && <div className="c">{company.address1}</div>}
      {company?.contact1 && <div className="c">Tel: {company.contact1}</div>}
      {company?.vat_reg_no && <div className="c">VAT: {company.vat_reg_no}</div>}
      <hr />
      <div className="c bold">{isRet ? 'SALES RETURN' : 'INVOICE'}</div>
      <table><tbody>
        <tr><td>No</td><td className="right">{inv.serial_no}</td></tr>
        <tr><td>Date</td><td className="right">{fmtDate(inv.invoice_date)} {fmtTime(inv.invoice_time)}</td></tr>
        <tr><td>Customer</td><td className="right">{inv.customer_name}</td></tr>
        <tr><td>Cashier</td><td className="right">{inv.created_by}</td></tr>
      </tbody></table>
      <hr />
      <table>
        <thead><tr><td>Item</td><td className="right">Qty</td><td className="right">Price</td><td className="right">Total</td></tr></thead>
        <tbody>
          {inv.items.map(it => (
            <tr key={it.id}><td style={{ maxWidth: 140 }}>{it.item_name}{Number(it.discount) > 0 ? <div className="subtle">disc {fmt(it.discount)}</div> : null}</td><td className="right">{fmtQty(it.qty)}</td><td className="right">{fmt(it.unit_price)}</td><td className="right">{fmt(it.line_total)}</td></tr>
          ))}
        </tbody>
      </table>
      <hr />
      <table><tbody>
        <tr><td>Gross</td><td className="right">{fmt(inv.gross_total)}</td></tr>
        {Number(inv.item_discount) + Number(inv.bill_discount) > 0 && <tr><td>Discount</td><td className="right">-{fmt(Number(inv.item_discount) + Number(inv.bill_discount))}</td></tr>}
        {Number(inv.extra_charges) > 0 && <tr><td>Charges</td><td className="right">{fmt(inv.extra_charges)}</td></tr>}
        <tr className="bold" style={{ fontSize: 14 }}><td>NET</td><td className="right">{cur} {fmt(inv.net_total)}</td></tr>
        {inv.payments?.map(p => <tr key={p.id}><td>{p.pay_type}{p.reference ? ` (${p.reference})` : ''}</td><td className="right">{fmt(p.amount)}</td></tr>)}
        {Number(inv.balance_amount) > 0 && <tr><td>Change</td><td className="right">{fmt(inv.balance_amount)}</td></tr>}
        {Number(inv.due_amount) > 0 && <tr className="bold"><td>Balance due</td><td className="right">{fmt(inv.due_amount)}</td></tr>}
        {Number(inv.points_earned) > 0 && <tr><td>Points earned</td><td className="right">{fmt(inv.points_earned, 0)}</td></tr>}
      </tbody></table>
      <hr />
      <div className="c">{inv.total_lines} items · {fmtQty(inv.total_qty)} qty</div>
      {company?.invoice_desc1 && <div className="c">{company.invoice_desc1}</div>}
      {company?.invoice_desc2 && <div className="c">{company.invoice_desc2}</div>}
      <div className="c subtle">Powered by SePOS</div>
    </div>
  );
}

/** Opens the receipt in a print window (keeps the app page untouched). */
export function printReceipt() {
  const el = document.getElementById('receipt');
  if (!el) return window.print();
  const w = window.open('', '_blank', 'width=420,height=700');
  w.document.write(`<!doctype html><html><head><title>Receipt</title><style>
    body{font-family:ui-monospace,Consolas,monospace;font-size:12px;margin:0;padding:8px;color:#000}
    .receipt{width:76mm}.c{text-align:center}.bold{font-weight:700}.right{text-align:right}.subtle{font-size:10px;color:#555}
    hr{border:none;border-top:1px dashed #999;margin:6px 0}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}
    @page{margin:4mm}</style></head><body>${el.outerHTML}</body></html>`);
  w.document.close(); w.focus();
  setTimeout(() => { w.print(); w.close(); }, 250);
}
