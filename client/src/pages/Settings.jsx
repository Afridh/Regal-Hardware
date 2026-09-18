import { useEffect, useState } from 'react';
import { get, post, put, errMsg } from '../api.js';
import { useAuth } from '../auth.jsx';
import MasterPage from '../components/MasterPage.jsx';
import { Input, Select, Check, Textarea, DataTable, Badge, useToast } from '../components/ui.jsx';

function CompanyTab() {
  const { reload } = useAuth();
  const toast = useToast();
  const [c, setC] = useState(null);
  useEffect(() => { get('/admin/company').then(setC); }, []);
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));
  const save = async () => { try { await put('/admin/company', c); toast.success('Company saved'); reload(); } catch (e) { toast.error(errMsg(e)); } };
  if (!c) return null;
  const F = (k, label, props = {}) => <Input key={k} label={label} value={c[k] || ''} onChange={e => set(k, e.target.value)} {...props} />;
  return (
    <div className="card pad stack">
      <div className="form-grid">
        {F('name', 'Company name', { className: 'span-2' })}{F('vat_reg_no', 'VAT / Tax reg no')}{F('email', 'Email')}
        {F('address1', 'Address line 1', { className: 'span-2' })}{F('address2', 'Address line 2')}{F('address3', 'Address line 3')}
        {F('contact1', 'Phone 1')}{F('contact2', 'Phone 2')}{F('fax', 'Fax')}{F('currency_name', 'Currency')}{F('currency_symbol', 'Currency symbol')}{F('day_start_time', 'Day start time', { type: 'time' })}
        {F('invoice_desc1', 'Receipt footer line 1', { className: 'span-2' })}{F('invoice_desc2', 'Receipt footer line 2', { className: 'span-2' })}{F('logo_url', 'Logo URL', { className: 'span-2' })}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={save}>Save</button></div>
    </div>
  );
}

function OptionsTab() {
  const toast = useToast();
  const [inv, setInv] = useState({ allow_negative_stock: false, default_pay_mode: 'CASH', print_size: '80mm' });
  const [loy, setLoy] = useState({ enabled: false, points_per_currency: 0.01, currency_per_point: 1 });
  useEffect(() => { get('/admin/settings/invoice').then(v => setInv(x => ({ ...x, ...v }))); get('/admin/settings/loyalty').then(v => setLoy(x => ({ ...x, ...v }))); }, []);
  const save = async () => { try { await put('/admin/settings/invoice', inv); await put('/admin/settings/loyalty', { ...loy, points_per_currency: Number(loy.points_per_currency), currency_per_point: Number(loy.currency_per_point) }); toast.success('Options saved'); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="grid-2">
      <div className="card pad stack">
        <h3>Invoicing</h3>
        <Check label="Allow selling below available stock (negative stock)" checked={!!inv.allow_negative_stock} onChange={e => setInv(x => ({ ...x, allow_negative_stock: e.target.checked }))} />
        <Select label="Default pay mode" value={inv.default_pay_mode} onChange={e => setInv(x => ({ ...x, default_pay_mode: e.target.value }))} options={['CASH', 'CARD', 'CREDIT']} />
        <Select label="Receipt size" value={inv.print_size} onChange={e => setInv(x => ({ ...x, print_size: e.target.value }))} options={['80mm', '58mm', 'A4']} />
      </div>
      <div className="card pad stack">
        <h3>Loyalty points</h3>
        <Check label="Enable loyalty points" checked={!!loy.enabled} onChange={e => setLoy(x => ({ ...x, enabled: e.target.checked }))} />
        <Input label="Points earned per 1 currency unit" type="number" step="0.001" value={loy.points_per_currency} onChange={e => setLoy(x => ({ ...x, points_per_currency: e.target.value }))} hint="0.01 = 1 point per 100 spent" />
        <Input label="Currency value of 1 point" type="number" step="0.01" value={loy.currency_per_point} onChange={e => setLoy(x => ({ ...x, currency_per_point: e.target.value }))} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={save}>Save options</button></div>
      </div>
    </div>
  );
}

function SmsTab() {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [test, setTest] = useState({ mobile: '', message: 'SePOS test message' });
  const [result, setResult] = useState(null);
  const [outbox, setOutbox] = useState([]);
  const load = () => { get('/admin/sms').then(setS); get('/admin/sms/outbox').then(d => setOutbox(d.data)).catch(() => {}); };
  useEffect(load, []);
  if (!s) return null;
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const tpl = (k, v) => setS(x => ({ ...x, templates: { ...x.templates, [k]: v } }));
  const flag = (k, v) => setS(x => ({ ...x, flags: { ...x.flags, [k]: v } }));
  const save = async () => { try { await put('/admin/sms', s); toast.success('SMS settings saved'); } catch (e) { toast.error(errMsg(e)); } };
  const send = async () => { try { setResult(await post('/admin/sms/test', test)); } catch (e) { toast.error(errMsg(e)); } };
  const T = (k, label) => <Textarea key={k} label={label} value={s.templates?.[k] || ''} onChange={e => tpl(k, e.target.value)} hint="Placeholders: {name} {serial} {total} {due} {amount}" />;
  return (
    <div className="stack">
      <div className="grid-2">
        <div className="card pad stack">
          <h3>Gateway</h3>
          <Input label="API URL" value={s.api_url || ''} onChange={e => set('api_url', e.target.value)} hint="e.g. https://smslenz.lk/api/send-sms" />
          <Input label="API key" value={s.api_key || ''} onChange={e => set('api_key', e.target.value)} />
          <Input label="Sender ID" value={s.sender_id || ''} onChange={e => set('sender_id', e.target.value)} />
          <Input label="Owner mobile (alerts)" value={s.owner_mobile || ''} onChange={e => set('owner_mobile', e.target.value)} />
          <h3>Triggers</h3>
          <Check label="Send invoice SMS to customer" checked={!!s.flags?.send_invoice_to_customer} onChange={e => flag('send_invoice_to_customer', e.target.checked)} />
          <Check label="Send credit settlement SMS to customer" checked={!!s.flags?.send_credit_settlement_to_customer} onChange={e => flag('send_credit_settlement_to_customer', e.target.checked)} />
          <Check label="Send daily summary to owner" checked={!!s.flags?.send_daily_summary_to_owner} onChange={e => flag('send_daily_summary_to_owner', e.target.checked)} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={save}>Save</button></div>
        </div>
        <div className="card pad stack">
          <h3>Templates</h3>
          {T('invoice', 'Invoice')}{T('credit_invoice', 'Credit invoice')}{T('credit_settlement', 'Credit settlement')}{T('loyalty', 'Loyalty points')}
          <h3>Test send</h3>
          <div className="row"><input className="input sm grow" placeholder="Mobile" value={test.mobile} onChange={e => setTest(x => ({ ...x, mobile: e.target.value }))} /><button className="btn sm" onClick={send}>Send test</button></div>
          {result && <div className={`badge ${result.status === 'OK' ? 'good' : 'bad'}`} style={{ padding: 8, whiteSpace: 'normal' }}>Status: {result.status} {result.error || ''}</div>}
        </div>
      </div>
      <div className="card"><div className="card-head"><h3>SMS outbox</h3><button className="btn sm" onClick={load}>Refresh</button></div>
        <DataTable compact rows={outbox} columns={[{ key: 'created_at', label: 'Queued', render: r => String(r.created_at).slice(0, 16).replace('T', ' ') }, { key: 'mobile', label: 'Mobile' }, { key: 'message', label: 'Message' }, { key: 'status', label: 'Status', render: r => <Badge status={r.status === 'SENT' ? 'PAID' : r.status} >{r.status}</Badge> }, { key: 'attempts', label: 'Tries' }, { key: 'last_error', label: 'Error' }]} />
      </div>
    </div>
  );
}

function PasswordTab() {
  const toast = useToast();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const save = async () => {
    if (f.new_password !== f.confirm) return toast.error('Passwords do not match');
    try { await post('/auth/change-password', f); toast.success('Password changed'); setF({ current_password: '', new_password: '', confirm: '' }); } catch (e) { toast.error(errMsg(e)); }
  };
  return <div className="card pad stack" style={{ maxWidth: 420 }}><Input label="Current password" type="password" value={f.current_password} onChange={e => setF(x => ({ ...x, current_password: e.target.value }))} /><Input label="New password" type="password" value={f.new_password} onChange={e => setF(x => ({ ...x, new_password: e.target.value }))} /><Input label="Confirm" type="password" value={f.confirm} onChange={e => setF(x => ({ ...x, confirm: e.target.value }))} /><button className="btn primary" onClick={save}>Change password</button></div>;
}

function TerminalsTab() {
  const { locations } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ location_id: locations[0]?.id || '', code: '', name: '' });
  const load = () => get('/master/terminals').then(d => setRows(d.data));
  useEffect(() => { load(); }, []);
  const add = async () => { try { await post('/master/terminals', f); setF(x => ({ ...x, code: '', name: '' })); load(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="card">
      <div className="toolbar"><Select value={f.location_id} onChange={e => setF(x => ({ ...x, location_id: e.target.value }))} options={locations.map(l => ({ value: l.id, label: l.name }))} className="" /><input className="input sm" placeholder="Code" style={{ width: 90 }} value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value }))} /><input className="input sm" placeholder="Terminal name" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /><button className="btn sm primary" onClick={add}>Add terminal</button></div>
      <DataTable compact rows={rows} columns={[{ key: 'location_name', label: 'Location' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Terminal' }, { key: 'registered_pc', label: 'Registered PC' }, { key: 'active', label: 'Status', render: r => <Badge status={r.active ? 'ACTIVE' : 'CANCELLED'}>{r.active ? 'Active' : 'Inactive'}</Badge> }]} />
    </div>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const tabs = [
    ...(can('company_settings') ? [['company', 'Company'], ['options', 'Options'], ['locations', 'Locations'], ['terminals', 'Terminals']] : []),
    ...(can('sms_settings') ? [['sms', 'SMS']] : []),
    ['password', 'My password'],
  ];
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <div className="stack">
      <div className="page-head"><h1>Settings</h1></div>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'company' && <CompanyTab />}
      {tab === 'options' && <OptionsTab />}
      {tab === 'locations' && <MasterPage title="Locations" url="/master/locations" perms={{ create: 'company_settings', update: 'company_settings', delete: 'company_settings' }}
        columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'address', label: 'Address' }, { key: 'manager_name', label: 'Manager' }, { key: 'phone', label: 'Phone' }]}
        fields={[{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true }, { key: 'address', label: 'Address', span: 2 }, { key: 'manager_name', label: 'Manager' }, { key: 'phone', label: 'Phone' }, { key: 'mobile', label: 'Mobile' }]} />}
      {tab === 'terminals' && <TerminalsTab />}
      {tab === 'sms' && <SmsTab />}
      {tab === 'password' && <PasswordTab />}
    </div>
  );
}
