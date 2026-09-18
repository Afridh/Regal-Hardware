import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const NAV = [
  { group: 'Overview', items: [
    { to: '/', label: 'Dashboard', ico: '▦', perm: 'view_home', end: true },
    { to: '/pos', label: 'POS / Invoice', ico: '🛒', perm: 'invoice' },
  ]},
  { group: 'Sales', items: [
    { to: '/invoices', label: 'Invoices', ico: '🧾' },
    { to: '/quotations', label: 'Quotations', ico: '📝', perm: 'quotation' },
    { to: '/customer-payments', label: 'Customer Payments', ico: '💵', perm: 'pay_due' },
  ]},
  { group: 'Purchasing', items: [
    { to: '/purchases', label: 'Purchases (GRN)', ico: '📦', perm: ['purchase', 'purchase_return', 'sup_rpt'] },
    { to: '/purchase-orders', label: 'Purchase Orders', ico: '📋', perm: 'purchase_order' },
    { to: '/supplier-payments', label: 'Supplier Payments', ico: '💸', perm: 'pay_due' },
  ]},
  { group: 'Inventory', items: [
    { to: '/items', label: 'Items', ico: '🏷️' },
    { to: '/stock', label: 'Stock', ico: '📊', perm: ['stock_rpt', 'qty_adjust', 'stock_transfer'] },
    { to: '/stock-adjustments', label: 'Adjustments', ico: '⚖️', perm: 'qty_adjust' },
    { to: '/stock-transfers', label: 'Transfers', ico: '🔁', perm: 'stock_transfer' },
    { to: '/categories', label: 'Categories', ico: '🗂️' },
  ]},
  { group: 'Contacts', items: [
    { to: '/customers', label: 'Customers', ico: '👤' },
    { to: '/suppliers', label: 'Suppliers', ico: '🏭' },
    { to: '/employees', label: 'Employees', ico: '🧑‍💼' },
  ]},
  { group: 'Finance', items: [
    { to: '/income-expenses', label: 'Income & Expenses', ico: '📒', perm: ['add_income', 'add_expenses', 'account_det'] },
    { to: '/banks', label: 'Banks', ico: '🏦', perm: ['add_bank', 'add_deposit', 'add_withdraw', 'account_det'] },
    { to: '/cheques', label: 'Cheques', ico: '🧮', perm: ['edit_chq', 'account_det'] },
    { to: '/shifts', label: 'Shifts / Day End', ico: '🕓', perm: ['cash_denomination', 'view_cash_denomination_rpt'] },
    { to: '/vouchers', label: 'Gift Vouchers', ico: '🎁', perm: 'invoice' },
  ]},
  { group: 'Reports', items: [
    { to: '/reports', label: 'Reports', ico: '📈', perm: ['item_rpt', 'stock_rpt', 'cus_rpt', 'sup_rpt', 'emp_rpt', 'cat_rpt', 'account_det', 'print_day_summary'] },
  ]},
  { group: 'Administration', items: [
    { to: '/users', label: 'Users & Permissions', ico: '🔐', perm: ['add_user', 'edit_user', 'user_control'] },
    { to: '/settings', label: 'Settings', ico: '⚙️', perm: ['company_settings', 'sms_settings'] },
  ]},
];

export default function Layout() {
  const { user, company, locations, locationId, setLocationId, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const [theme, setTheme] = useState(() => localStorage.getItem('sepos_theme') || '');
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next); localStorage.setItem('sepos_theme', next); document.documentElement.dataset.theme = next;
  };
  if (theme) document.documentElement.dataset.theme = theme;

  const current = NAV.flatMap(g => g.items).find(i => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to) && i.to !== '/'));

  return (
    <div className="app">
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><span className="logo">S</span> SePOS <span className="subtle" style={{ color: '#64748b' }}>web</span></div>
        <nav>
          {NAV.map(g => {
            const items = g.items.filter(i => !i.perm || can(i.perm));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="group">{g.group}</div>
                {items.map(i => <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setOpen(false)}><span className="ico">{i.ico}</span>{i.label}</NavLink>)}
              </div>
            );
          })}
        </nav>
        <div className="foot">{company?.name}<br /><span style={{ color: '#64748b' }}>v1.0 · {user?.role}</span></div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon burger" onClick={() => setOpen(o => !o)}>☰</button>
          <span className="title">{current?.label || 'SePOS'}</span>
          <span className="spacer" />
          {locations.length > 1 && can('change_location') && (
            <select className="input sm" value={locationId} onChange={e => { setLocationId(e.target.value); window.location.reload(); }}>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {locations.length > 1 && !can('change_location') && <span className="muted">{locations.find(l => String(l.id) === String(locationId))?.name}</span>}
          <button className="btn ghost icon" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? '☀️' : '🌙'}</button>
          <span className="muted">{user?.name}</span>
          <button className="btn sm" onClick={logout}>Logout</button>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
