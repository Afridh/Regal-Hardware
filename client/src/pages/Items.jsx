import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import MasterPage from '../components/MasterPage.jsx';
import { get, post, put, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmt, fmtQty, Badge, RefSelect, Modal, useToast, Input } from '../components/ui.jsx';

const UNITS = ['PCS', 'KG', 'G', 'L', 'ML', 'M', 'BOX', 'PKT', 'DOZ', 'SET'];

/** Price-link / batch editor shown inside the item modal. */
function BatchPanel({ item }) {
  const { can, locationId } = useAuth();
  const toast = useToast();
  const [batches, setBatches] = useState([]);
  const [edit, setEdit] = useState(null);
  const [opening, setOpening] = useState(null);
  const load = () => get(`/master/items/${item.id}/batches`).then(setBatches).catch(() => {});
  useEffect(() => { load(); }, [item.id]);

  const saveBatch = async () => {
    try { await put(`/master/items/batches/${edit.id}`, edit); toast.success('Prices updated'); setEdit(null); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const saveOpening = async () => {
    try { await post(`/master/items/${item.id}/opening-stock`, { ...opening, location_id: locationId }); toast.success('Opening stock added'); setOpening(null); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const f = (k, label, type = 'number') => <Input key={k} label={label} type={type} step="0.01" value={edit?.[k] ?? ''} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} />;
  const o = (k, label, type = 'number') => <Input key={k} label={label} type={type} step="0.01" value={opening?.[k] ?? ''} onChange={e => setOpening(x => ({ ...x, [k]: e.target.value }))} />;

  return (
    <div className="mt">
      <div className="row between mb"><h3>Stock batches / price links</h3>
        {can(['qty_adjust', 'add_item']) && <button className="btn sm" onClick={() => setOpening({ qty: 0, cost_price: 0, selling_price: 0, qty_min: 0 })}>＋ Opening stock</button>}</div>
      <table className="table compact">
        <thead><tr><th>Location</th><th>Batch</th><th className="num">Cost</th><th className="num">Selling</th><th className="num">Min sell</th><th className="num">Wholesale</th><th className="num">MRP</th><th className="num">On hand</th><th className="num">Reorder</th><th>Expiry</th><th /></tr></thead>
        <tbody>
          {batches.length === 0 && <tr><td colSpan={11} className="empty">No stock batches — add opening stock or receive a GRN.</td></tr>}
          {batches.map(b => <tr key={b.id}><td>{b.location_name}</td><td>#{b.batch_no}</td><td className="num">{can('show_cost') ? fmt(b.cost_price) : '•••'}</td><td className="num">{fmt(b.selling_price)}</td><td className="num">{fmt(b.discount_price)}</td><td className="num">{fmt(b.wholesale_price)}</td><td className="num">{fmt(b.mrp)}</td>
            <td className={`num bold ${Number(b.qty_remain) <= 0 ? 'text-bad' : ''}`}>{fmtQty(b.qty_remain)}</td><td className="num">{fmtQty(b.qty_min)}</td><td>{b.expiry_date || '-'}</td>
            <td>{can('price_change') && <button className="btn sm" onClick={() => setEdit({ ...b })}>Prices</button>}</td></tr>)}
        </tbody>
      </table>

      <Modal open={!!edit} title={`Batch #${edit?.batch_no} prices`} onClose={() => setEdit(null)} size="sm" footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={saveBatch}>Save</button></>}>
        {edit && <div className="form-grid">{f('cost_price', 'Cost price')}{f('selling_price', 'Selling price')}{f('discount_price', 'Minimum selling')}{f('wholesale_price', 'Wholesale')}{f('mrp', 'MRP')}{f('offer_price', 'Offer price')}{f('qty_min', 'Reorder level')}{f('qty_max', 'Max level')}{f('expiry_date', 'Expiry', 'date')}</div>}
      </Modal>
      <Modal open={!!opening} title="Add opening stock" onClose={() => setOpening(null)} size="sm" footer={<><button className="btn" onClick={() => setOpening(null)}>Cancel</button><button className="btn primary" onClick={saveOpening}>Add</button></>}>
        {opening && <div className="form-grid">{o('qty', 'Quantity')}{o('cost_price', 'Cost price')}{o('selling_price', 'Selling price')}{o('discount_price', 'Minimum selling')}{o('wholesale_price', 'Wholesale')}{o('mrp', 'MRP')}{o('qty_min', 'Reorder level')}{o('expiry_date', 'Expiry', 'date')}</div>}
      </Modal>
    </div>
  );
}

export default function Items() {
  const { can } = useAuth();
  return (
    <MasterPage title="Items" url="/master/items" perms={{ create: 'add_item', update: 'edit_item', delete: 'del_item' }} searchPlaceholder="Search code / barcode / name"
      columns={[
        { key: 'code', label: 'Code' }, { key: 'barcode', label: 'Barcode' }, { key: 'name', label: 'Name' }, { key: 'category_name', label: 'Category' }, { key: 'unit', label: 'Unit' },
        ...(can('show_cost') ? [{ key: 'cost_price', label: 'Cost', num: true }] : []),
        { key: 'selling_price', label: 'Price', num: true },
        { key: 'qty_on_hand', label: 'On hand', num: true, render: r => <span className={Number(r.qty_on_hand) <= 0 ? 'text-bad' : ''}>{fmtQty(r.qty_on_hand)}</span> },
        { key: 'active', label: 'Status', render: r => <Badge status={r.active ? 'ACTIVE' : 'CANCELLED'}>{r.active ? 'Active' : 'Inactive'}</Badge> },
      ]}
      filters={list => <RefSelect url="/master/categories" value={list.filters.category_id || ''} onChange={v => list.setFilter('category_id', v)} placeholder="All categories" className="" style={{ width: 170 }} />}
      fields={[
        { key: 'code', label: 'Item code', hint: 'Auto if blank' }, { key: 'barcode', label: 'Barcode' }, { key: 'name', label: 'Item name', required: true, span: 2 },
        { key: 'name2', label: 'Alt. name (print)' }, { key: 'item_type', label: 'Type', type: 'select', options: ['STOCK', 'SERVICE'], default: 'STOCK' }, { key: 'unit', label: 'Unit', type: 'select', options: UNITS, default: 'PCS' },
        { key: 'category_id', label: 'Category', type: 'ref', url: '/master/categories' }, { key: 'sub_category_id', label: 'Sub-category', type: 'ref', url: '/master/sub-categories' }, { key: 'supplier_id', label: 'Supplier', type: 'ref', url: '/master/suppliers' },
        { key: 'barcode1', label: 'Barcode 2' }, { key: 'barcode2', label: 'Barcode 3' }, { key: 'part_no', label: 'Part no' }, { key: 'make', label: 'Make / brand' }, { key: 'bin_no', label: 'Bin / rack' }, { key: 'warranty_months', label: 'Warranty (months)', type: 'number', step: '1' },
        { key: 'track_inventory', label: 'Track inventory', type: 'check', default: true }, { key: 'allow_decimal', label: 'Allow decimal qty', type: 'check' }, { key: 'allow_discount', label: 'Allow discount', type: 'check', default: true },
        { key: 'allow_wholesale', label: 'Allow wholesale price', type: 'check', default: true }, { key: 'allow_loyalty', label: 'Earns loyalty points', type: 'check', default: true }, { key: 'allow_edit_price_on_invoice', label: 'Price editable on invoice', type: 'check' },
        { key: 'ask_serial_on_invoice', label: 'Ask serial no on invoice', type: 'check' }, { key: 'remind_reorder', label: 'Reorder reminder', type: 'check', default: true }, { key: 'remind_expiry', label: 'Expiry reminder', type: 'check' }, { key: 'show_on_web', label: 'Show on web', type: 'check' },
        { key: 'remark', label: 'Remark', type: 'textarea' },
      ]}
      renderExtra={editing => editing?.id && <BatchPanel item={editing} />}
      rowActions={r => <Link className="btn sm" to={`/stock?ledger=${r.id}`} onClick={e => e.stopPropagation()}>Ledger</Link>}
    />
  );
}
