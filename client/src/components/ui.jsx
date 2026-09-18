import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../api.js';

// ---------------------------------------------------------------- formatting
export const fmt = (v, d = 2) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? '-' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtQty = v => fmt(v, Number.isInteger(Number(v)) ? 0 : 3);
export const fmtDate = v => (v ? String(v).slice(0, 10) : '-');
export const fmtTime = v => (v ? String(v).slice(0, 5) : '');
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const firstOfMonth = () => todayStr().slice(0, 8) + '01';
export const Money = ({ v, className = '' }) => <span className={`num ${className}`}>{fmt(v)}</span>;

// ---------------------------------------------------------------- toasts
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setItems(t => [...t, { id, msg, type }]);
    setTimeout(() => setItems(t => t.filter(x => x.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);
  const api = useMemo(() => ({ push, success: m => push(m, 'success'), error: m => push(m, 'error') }), [push]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts">{items.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- modal
export function Modal({ open, title, onClose, children, footer, size = '' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${size}`}>
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title = 'Are you sure?', message, onConfirm, onClose, danger = true, busy }) {
  return (
    <Modal open={open} title={title} onClose={onClose} size="sm"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : 'Confirm'}</button></>}>
      <p>{message}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- form fields
export function Field({ label, hint, children, className = '' }) {
  return <div className={`field ${className}`}>{label && <label>{label}</label>}{children}{hint && <span className="hint">{hint}</span>}</div>;
}

export function Input({ label, hint, className = '', ...props }) {
  return <Field label={label} hint={hint} className={className}><input className="input" {...props} /></Field>;
}

export function Select({ label, hint, options = [], placeholder, className = '', ...props }) {
  return (
    <Field label={label} hint={hint} className={className}>
      <select className="input" {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </Field>
  );
}

export function Check({ label, ...props }) {
  return <label className="check"><input type="checkbox" {...props} /> {label}</label>;
}

export function Textarea({ label, hint, className = '', ...props }) {
  return <Field label={label} hint={hint} className={className}><textarea className="input" {...props} /></Field>;
}

/** Async select backed by a list endpoint. Loads all (up to 200) and filters client-side. */
export function RefSelect({ url, params, labelKey = 'name', valueKey = 'id', label, value, onChange, placeholder = '— select —', extraLabel, ...props }) {
  const [opts, setOpts] = useState([]);
  const key = JSON.stringify(params || {});
  useEffect(() => { let on = true; get(url, { limit: 200, active: 'true', ...(params || {}) }).then(d => on && setOpts(d.data || d)).catch(() => {}); return () => { on = false; }; }, [url, key]);
  return (
    <Select label={label} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      options={opts.map(o => ({ value: o[valueKey], label: extraLabel ? extraLabel(o) : o[labelKey] }))} {...props} />
  );
}

/** Typeahead lookup: fetches `url?q=` and calls onPick(row). */
export function Lookup({ url, params, render, onPick, placeholder = 'Search…', value, onChange, inputProps = {}, minChars = 1, autoFocus, clearOnPick = true, inputClass = 'input' }) {
  const [q, setQ] = useState(value || '');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const timer = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => { if (value !== undefined) setQ(value); }, [value]);

  const search = useCallback(async text => {
    if (text.trim().length < minChars) { setRows([]); return; }
    try { const d = await get(url, { q: text, limit: 20, ...(params || {}) }); setRows(Array.isArray(d) ? d : d.data || []); setOpen(true); setHl(0); }
    catch { setRows([]); }
  }, [url, JSON.stringify(params || {}), minChars]);

  const onInput = e => {
    const t = e.target.value; setQ(t); onChange?.(t);
    clearTimeout(timer.current); timer.current = setTimeout(() => search(t), 180);
  };
  const pick = r => { onPick(r); setOpen(false); if (clearOnPick) { setQ(''); onChange?.(''); } inputRef.current?.focus(); };
  const onKey = e => {
    if (e.key === 'ArrowDown') { setHl(h => Math.min(h + 1, rows.length - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setHl(h => Math.max(h - 1, 0)); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && rows[hl]) pick(rows[hl]);
      else if (q.trim()) search(q).then(() => {});
    } else if (e.key === 'Escape') setOpen(false);
  };
  // Scanner support: auto-pick when the query is an exact barcode / code match (the lookup endpoint returns rank 0 for those)
  useEffect(() => { if (open && rows.length >= 1 && inputProps.autoPickSingle && rows[0].rank === 0 && (rows.length === 1 || rows[1].rank !== 0)) pick(rows[0]); }, [rows]); // eslint-disable-line

  return (
    <div className="lookup">
      <input ref={inputRef} className={inputClass} value={q} onChange={onInput} onKeyDown={onKey} onFocus={() => rows.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" />
      {open && rows.length > 0 && (
        <div className="drop">
          {rows.map((r, i) => <div key={r.id ?? i} className={`opt ${i === hl ? 'hl' : ''}`} onMouseDown={() => pick(r)}>{render(r)}</div>)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- data table
/**
 * columns: [{ key, label, render?(row), className?, num? }]
 */
export function DataTable({ columns, rows, loading, empty = 'No records', onRowClick, footer, compact, keyField = 'id' }) {
  return (
    <div className="table-wrap">
      <table className={`table ${compact ? 'compact' : ''}`}>
        <thead><tr>{columns.map(c => <th key={c.key} className={c.num ? 'num' : c.className || ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {loading && <tr><td colSpan={columns.length} className="empty">Loading…</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={columns.length} className="empty">{empty}</td></tr>}
          {!loading && rows.map((r, i) => (
            <tr key={r[keyField] ?? i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map(c => <td key={c.key} className={c.num ? 'num' : c.className || ''}>{c.render ? c.render(r) : c.num ? fmt(r[c.key]) : r[c.key] ?? '-'}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot><tr>{footer}</tr></tfoot>}
      </table>
    </div>
  );
}

export function Pager({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pager">
      <span>{total} record{total === 1 ? '' : 's'}</span>
      <span className="grow" />
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
      <span>Page {page} / {pages}</span>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
    </div>
  );
}

/** Hook: paged list with search + filters. */
export function useList(url, initialFilters = {}, limit = 25) {
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [data, setData] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(filters);
  useEffect(() => {
    let on = true; setLoading(true);
    get(url, { page, limit, q, ...filters }).then(d => on && setData(d)).catch(() => on && setData({ data: [], total: 0 })).finally(() => on && setLoading(false));
    return () => { on = false; };
  }, [url, page, limit, q, key, tick]);
  const reload = () => setTick(t => t + 1);
  const setFilter = (k, v) => { setPage(1); setFilters(f => ({ ...f, [k]: v })); };
  return { rows: data.data, total: data.total, extra: data, page, setPage, q, setQ: v => { setPage(1); setQ(v); }, filters, setFilter, setFilters, loading, reload, limit };
}

export const Badge = ({ status, map, children }) => {
  const cls = map?.[status] || ({ PAID: 'good', PRINTED: 'good', RECEIVED: 'good', REALIZED: 'good', CLOSED: 'good', ACTIVE: 'good', OPEN: 'info', SENT: 'info', PARTIAL: 'warn', PENDING: 'warn', HOLD: 'warn', UNPAID: 'bad', CANCELLED: 'bad', RETURNED: 'bad', FAILED: 'bad' })[status] || '';
  return <span className={`badge ${cls}`}>{children ?? status}</span>;
};

// ---------------------------------------------------------------- charts (single-series, one hue, hover tooltip)
export function Bars({ data, xKey, yKey, labelFn }) {
  const max = Math.max(1, ...data.map(d => Number(d[yKey]) || 0));
  return (
    <div>
      <div className="bars">
        {data.map((d, i) => {
          const v = Number(d[yKey]) || 0;
          return <div key={i} className="bar" style={{ height: `${Math.max(2, (v / max) * 100)}%` }}><span className="tip">{labelFn ? labelFn(d) : `${d[xKey]}: ${fmt(v)}`}</span></div>;
        })}
      </div>
      <div className="bars-x">{data.map((d, i) => <span key={i}>{String(d[xKey]).slice(5)}</span>)}</div>
    </div>
  );
}

export function HBars({ data, labelKey = 'label', valueKey = 'sales', format = fmt }) {
  const max = Math.max(1, ...data.map(d => Number(d[valueKey]) || 0));
  return (
    <div>
      {data.map((d, i) => (
        <div key={i} className="hbar" title={`${d[labelKey]}: ${format(d[valueKey])}`}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d[labelKey]}</span>
          <div className="track"><div className="fill" style={{ width: `${(Number(d[valueKey]) / max) * 100}%` }} /></div>
          <span className="num">{format(d[valueKey])}</span>
        </div>
      ))}
      {data.length === 0 && <div className="empty">No data</div>}
    </div>
  );
}

export function Stat({ label, value, sub, className = '' }) {
  return <div className={`card stat ${className}`}><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="sub">{sub}</div>}</div>;
}

export function DateRange({ from, to, onChange }) {
  return (
    <div className="row gap-sm">
      <input type="date" className="input sm" value={from} onChange={e => onChange(e.target.value, to)} style={{ width: 'auto' }} />
      <span className="muted">to</span>
      <input type="date" className="input sm" value={to} onChange={e => onChange(from, e.target.value)} style={{ width: 'auto' }} />
      <button className="btn sm" onClick={() => onChange(todayStr(), todayStr())}>Today</button>
      <button className="btn sm" onClick={() => onChange(firstOfMonth(), todayStr())}>This month</button>
    </div>
  );
}

/** Export rows to CSV (client-side). */
export function downloadCsv(filename, columns, rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map(c => esc(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map(c => esc(c.csv ? c.csv(r) : r[c.key])).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
