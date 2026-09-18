import { useEffect, useState } from 'react';
import { get, post, put, del, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { DataTable, Modal, Confirm, Input, Select, Check, Badge, useToast } from '../components/ui.jsx';

const ROLES = ['ADMIN', 'MANAGER', 'CASHIER', 'USER'];
const PRESETS = {
  CASHIER: ['invoice', 'hold_invoice', 'print_invoice', 'view_home', 'add_cus', 'cash_denomination', 'quotation', 'pay_due'],
  MANAGER: null, // all except admin group
};

export default function Users() {
  const { can, user: me, locations } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [groups, setGroups] = useState([]);
  const [edit, setEdit] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => get('/admin/users').then(d => setRows(d.data)).catch(e => toast.error(errMsg(e)));
  useEffect(() => { load(); get('/auth/permissions').then(setGroups).catch(() => {}); }, []);

  const set = (k, v) => setEdit(x => ({ ...x, [k]: v }));
  const togglePerm = (k, v) => setEdit(x => ({ ...x, permissions: { ...x.permissions, [k]: v } }));
  const applyPreset = role => {
    if (role === 'ADMIN') return;
    const all = groups.flatMap(g => g.perms.map(([k]) => k));
    let keys = PRESETS[role] ?? [];
    if (role === 'MANAGER') keys = groups.filter(g => g.group !== 'Administration').flatMap(g => g.perms.map(([k]) => k)).concat(['add_user', 'edit_user', 'change_location']);
    setEdit(x => ({ ...x, role, permissions: Object.fromEntries(all.map(k => [k, keys.includes(k)])) }));
  };
  const save = async () => {
    if (!edit.name || !edit.username || (!edit.id && !edit.password)) return toast.error('Name, username and password are required');
    setBusy(true);
    try {
      if (edit.id) await put(`/admin/users/${edit.id}`, edit); else await post('/admin/users', edit);
      toast.success('Saved'); setEdit(null); load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const disable = async () => { setBusy(true); try { await del(`/admin/users/${confirm.id}`); setConfirm(null); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const count = p => Object.values(p || {}).filter(Boolean).length;

  return (
    <div className="stack">
      <div className="page-head"><h1>Users & Permissions</h1>{can('add_user') && <button className="btn primary" onClick={() => setEdit({ name: '', username: '', password: '', pin: '', role: 'CASHIER', permissions: Object.fromEntries(PRESETS.CASHIER.map(k => [k, true])), location_id: locations[0]?.id, active: true })}>＋ New user</button>}</div>
      <div className="card">
        <DataTable rows={rows} columns={[
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'username', label: 'Username' }, { key: 'role', label: 'Role', render: r => <Badge status={r.role === 'ADMIN' ? 'PAID' : 'OPEN'}>{r.role}</Badge> }, { key: 'location_name', label: 'Location' },
          { key: 'permissions', label: 'Permissions', render: r => r.role === 'ADMIN' ? 'All' : `${count(r.permissions)} granted` }, { key: 'last_login_at', label: 'Last login', render: r => r.last_login_at ? String(r.last_login_at).slice(0, 16).replace('T', ' ') : '-' },
          { key: 'active', label: 'Status', render: r => <Badge status={r.active ? 'ACTIVE' : 'CANCELLED'}>{r.active ? 'Active' : 'Disabled'}</Badge> },
          { key: '_a', label: '', className: 'actions', render: r => <span className="row gap-sm" style={{ justifyContent: 'flex-end' }}>{can(['edit_user', 'user_control']) && <button className="btn sm" onClick={() => setEdit({ ...r, password: '' })}>Edit</button>}{can('del_user') && r.active && r.id !== me.id && <button className="btn sm danger" onClick={() => setConfirm(r)}>Disable</button>}</span> },
        ]} />
      </div>

      <Modal open={!!edit} title={edit?.id ? `Edit user — ${edit.name}` : 'New user'} onClose={() => setEdit(null)} size="lg"
        footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
        {edit && <>
          <div className="form-grid mb">
            <Input label="Full name" value={edit.name} onChange={e => set('name', e.target.value)} />
            <Input label="Username" value={edit.username} onChange={e => set('username', e.target.value)} autoComplete="off" />
            <Input label={edit.id ? 'New password (blank = keep)' : 'Password'} type="password" value={edit.password || ''} onChange={e => set('password', e.target.value)} autoComplete="new-password" />
            <Input label="Approval PIN" value={edit.pin || ''} onChange={e => set('pin', e.target.value)} hint="Used to approve discounts / cancellations" />
            <Select label="Role" value={edit.role} onChange={e => applyPreset(e.target.value)} options={ROLES.filter(r => r !== 'ADMIN' || me.role === 'ADMIN')} hint="Changing role applies a preset" />
            <Select label="Home location" value={edit.location_id || ''} onChange={e => set('location_id', e.target.value)} options={locations.map(l => ({ value: l.id, label: l.name }))} />
            <Input label="Code" value={edit.code || ''} onChange={e => set('code', e.target.value)} />
            {edit.id && <div className="field" style={{ justifyContent: 'flex-end' }}><Check label="Active" checked={!!edit.active} onChange={e => set('active', e.target.checked)} /></div>}
          </div>
          {edit.role === 'ADMIN' ? <p className="muted">Administrators have every permission.</p> : (
            <div className="stack">
              {groups.map(g => (
                <div key={g.group} className="card pad">
                  <div className="row between mb"><h3>{g.group}</h3><span className="row gap-sm"><button className="btn sm" onClick={() => g.perms.forEach(([k]) => togglePerm(k, true))}>All</button><button className="btn sm" onClick={() => g.perms.forEach(([k]) => togglePerm(k, false))}>None</button></span></div>
                  <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                    {g.perms.map(([k, label]) => <Check key={k} label={label} checked={!!edit.permissions?.[k]} onChange={e => togglePerm(k, e.target.checked)} disabled={!can('user_control') && edit.id} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>}
      </Modal>
      <Confirm open={!!confirm} title="Disable user?" message={`${confirm?.name} will no longer be able to sign in.`} onClose={() => setConfirm(null)} onConfirm={disable} busy={busy} />
    </div>
  );
}
