import { Lookup, fmt, fmtQty } from './ui.jsx';

/**
 * Generic document line editor.
 * cols: [{ key, label, type: 'number'|'text'|'date'|'batch'|'readonly', width, step, compute?(line) }]
 * onAdd(item) receives the POS lookup row (item + batches at the location).
 */
export default function LineEditor({ lines, setLines, cols, onAdd, lookupUrl = '/master/items/lookup/pos', placeholder = 'Scan / search item to add', totalKey }) {
  const setLine = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = totalKey ? lines.reduce((s, l) => s + Number(typeof totalKey === 'function' ? totalKey(l) : l[totalKey] || 0), 0) : null;
  return (
    <div>
      <Lookup url={lookupUrl} placeholder={placeholder} onPick={onAdd} inputProps={{ autoPickSingle: true }}
        render={r => <><span>{r.name} <small>{r.code}</small></span><small>{r.batches?.length ? `stock ${fmtQty(r.batches.reduce((s, b) => s + Number(b.qty_remain), 0))} · cost ${fmt(r.batches[r.batches.length - 1].cost_price)}` : 'no stock'}</small></>} />
      <div className="table-wrap mt">
        <table className="table compact">
          <thead><tr><th>#</th><th>Item</th>{cols.map(c => <th key={c.key} className={c.type === 'number' || c.type === 'readonly' ? 'num' : ''}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={cols.length + 3} className="empty">No lines yet</td></tr>}
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="muted">{i + 1}</td>
                <td><div className="bold">{l.item_name}</div><div className="subtle">{l.item_code}</div></td>
                {cols.map(c => (
                  <td key={c.key} className={c.type === 'number' || c.type === 'readonly' ? 'num' : ''}>
                    {c.type === 'readonly' ? <span className="bold">{fmt(c.compute ? c.compute(l) : l[c.key])}</span>
                      : c.type === 'batch' ? (l.batches?.length ? <select className="input sm" value={l.batch_id || ''} onChange={e => { const b = l.batches.find(x => String(x.id) === String(e.target.value)); setLine(i, { batch_id: b?.id || null, ...(c.onChange ? c.onChange(b) : {}) }); }}>{l.batches.map(b => <option key={b.id} value={b.id}>#{b.batch_no} · {fmtQty(b.qty_remain)} @ {fmt(b.selling_price)}</option>)}</select> : <span className="subtle">-</span>)
                      : <input className="input sm" type={c.type} step={c.step || (c.type === 'number' ? '0.01' : undefined)} style={{ width: c.width || 100 }} value={l[c.key] ?? ''} onChange={e => setLine(i, { [c.key]: e.target.value })} onFocus={e => e.target.select()} />}
                  </td>
                ))}
                <td><button className="btn ghost icon sm" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
          {total !== null && lines.length > 0 && <tfoot><tr><td colSpan={cols.length + 1} className="right">Total</td><td className="num">{fmt(total)}</td><td /></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
