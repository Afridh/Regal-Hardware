import { useState } from 'react';
import { post, put, del, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useList, DataTable, Pager, Modal, Confirm, Input, Select, Check, Textarea, RefSelect, useToast, downloadCsv } from './ui.jsx';

/**
 * Config-driven CRUD page.
 * fields: [{ key, label, type: 'text'|'number'|'select'|'ref'|'check'|'textarea'|'date', options, url, labelKey, required, span, default, hint }]
 */
export default function MasterPage({ title, url, columns, fields, perms = {}, searchPlaceholder = 'Search…', filters, extraToolbar, rowActions, renderExtra, defaultFilters = {} }) {
  const { can } = useAuth();
  const toast = useToast();
  const list = useList(url, { active: 'true', ...defaultFilters });
  const [editing, setEditing] = useState(null);   // null | {} (new) | row
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const openNew = () => { const f = {}; fields.forEach(x => { if (x.default !== undefined) f[x.key] = x.default; }); setForm(f); setEditing({}); };
  const openEdit = row => { setForm(row); setEditing(row); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    for (const f of fields) if (f.required && (form[f.key] === undefined || form[f.key] === '' || form[f.key] === null)) return toast.error(`${f.label} is required`);
    setBusy(true);
    try {
      const payload = {}; fields.forEach(f => { if (form[f.key] !== undefined) payload[f.key] = form[f.key]; });
      if (editing.id && 'active' in editing) payload.active = !!form.active;
      if (editing.id) { await put(`${url}/${editing.id}`, payload); toast.success('Saved'); }
      else { await post(url, payload); toast.success('Created'); }
      setEditing(null); list.reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await del(`${url}/${confirm.id}`); toast.success('Deactivated'); setConfirm(null); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const canCreate = !perms.create || can(perms.create);
  const canUpdate = !perms.update || can(perms.update);
  const canDelete = !perms.delete || can(perms.delete);

  const cols = [...columns];
  if (canUpdate || canDelete || rowActions) cols.push({ key: '_a', label: '', className: 'actions', render: r => (
    <span className="row gap-sm" style={{ justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
      {rowActions?.(r, list.reload)}
      {canUpdate && <button className="btn sm" onClick={() => openEdit(r)}>Edit</button>}
      {canDelete && r.active !== false && <button className="btn sm danger" onClick={() => setConfirm(r)}>Disable</button>}
    </span>) });

  const renderField = f => {
    const v = form[f.key] ?? '';
    const cls = f.span ? `span-${f.span}` : '';
    switch (f.type) {
      case 'select': return <Select key={f.key} label={f.label} className={cls} value={v} onChange={e => set(f.key, e.target.value)} options={f.options} placeholder={f.placeholder} hint={f.hint} />;
      case 'ref': return <RefSelect key={f.key} label={f.label} className={cls} url={f.url} params={f.params} labelKey={f.labelKey || 'name'} value={v} onChange={x => set(f.key, x)} placeholder={f.placeholder || '— none —'} extraLabel={f.extraLabel} />;
      case 'check': return <div key={f.key} className={`field ${cls}`} style={{ justifyContent: 'flex-end' }}><Check label={f.label} checked={!!form[f.key]} onChange={e => set(f.key, e.target.checked)} /></div>;
      case 'textarea': return <Textarea key={f.key} label={f.label} className={cls || 'span-all'} value={v} onChange={e => set(f.key, e.target.value)} hint={f.hint} />;
      case 'number': return <Input key={f.key} label={f.label} className={cls} type="number" step={f.step || '0.01'} value={v} onChange={e => set(f.key, e.target.value)} hint={f.hint} />;
      case 'date': return <Input key={f.key} label={f.label} className={cls} type="date" value={v} onChange={e => set(f.key, e.target.value)} />;
      default: return <Input key={f.key} label={f.label} className={cls} value={v} onChange={e => set(f.key, e.target.value)} hint={f.hint} placeholder={f.placeholder} />;
    }
  };

  return (
    <div className="stack">
      <div className="page-head"><h1>{title}</h1>{canCreate && <button className="btn primary" onClick={openNew}>＋ New</button>}</div>
      <div className="card">
        <div className="toolbar">
          <input className="input sm" placeholder={searchPlaceholder} value={list.q} onChange={e => list.setQ(e.target.value)} />
          {filters?.(list)}
          <select className="input sm" value={list.filters.active ?? 'true'} onChange={e => list.setFilter('active', e.target.value)}><option value="true">Active</option><option value="false">Inactive</option><option value="">All</option></select>
          {extraToolbar?.(list)}
          <span className="grow" />
          <button className="btn sm" onClick={() => downloadCsv(`${title.toLowerCase()}.csv`, columns, list.rows)}>⬇ CSV</button>
        </div>
        <DataTable columns={cols} rows={list.rows} loading={list.loading} onRowClick={canUpdate ? openEdit : undefined} />
        <Pager page={list.page} limit={list.limit} total={list.total} onPage={list.setPage} />
      </div>

      <Modal open={!!editing} title={editing?.id ? `Edit ${title.replace(/s$/, '')}` : `New ${title.replace(/s$/, '')}`} onClose={() => setEditing(null)} size={fields.length > 8 ? 'lg' : ''}
        footer={<><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
        <div className="form-grid">
          {fields.filter(f => f.key !== 'active').map(renderField)}
          {editing?.id && 'active' in editing && <div className="field" style={{ justifyContent: 'flex-end' }}><Check label="Active" checked={!!form.active} onChange={e => set('active', e.target.checked)} /></div>}
        </div>
        {renderExtra?.(editing, form, set)}
      </Modal>

      <Confirm open={!!confirm} title="Disable record?" message={`"${confirm?.name || confirm?.bank_name || confirm?.code}" will be marked inactive. Transactions are kept.`} onClose={() => setConfirm(null)} onConfirm={remove} busy={busy} />
    </div>
  );
}
