import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import POS from './pages/POS.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import Quotations from './pages/Quotations.jsx';
import Purchases from './pages/Purchases.jsx';
import PurchaseDetail from './pages/PurchaseDetail.jsx';
import PurchaseOrders from './pages/PurchaseOrders.jsx';
import Items from './pages/Items.jsx';
import Stock from './pages/Stock.jsx';
import StockAdjustments from './pages/StockAdjustments.jsx';
import StockTransfers from './pages/StockTransfers.jsx';
import { Categories, Customers, Suppliers, Employees } from './pages/Masters.jsx';
import CustomerPayments from './pages/CustomerPayments.jsx';
import SupplierPayments from './pages/SupplierPayments.jsx';
import IncomeExpenses from './pages/IncomeExpenses.jsx';
import Banks from './pages/Banks.jsx';
import Cheques from './pages/Cheques.jsx';
import Shifts from './pages/Shifts.jsx';
import Vouchers from './pages/Vouchers.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';

function Guard({ perm, children }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <div className="card pad"><h2>Access denied</h2><p className="muted mt">You do not have permission to open this page.</p></div>;
  return children;
}

export default function App() {
  const { loading, user } = useAuth();
  if (loading) return <div className="login"><div className="box center">Loading…</div></div>;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Guard perm="view_home"><Dashboard /></Guard>} />
        <Route path="pos" element={<Guard perm="invoice"><POS /></Guard>} />
        <Route path="pos/:holdId" element={<Guard perm="invoice"><POS /></Guard>} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="quotations" element={<Guard perm="quotation"><Quotations /></Guard>} />
        <Route path="purchases" element={<Purchases />} />
        <Route path="purchases/:id" element={<PurchaseDetail />} />
        <Route path="purchase-orders" element={<Guard perm="purchase_order"><PurchaseOrders /></Guard>} />
        <Route path="items" element={<Items />} />
        <Route path="stock" element={<Stock />} />
        <Route path="stock-adjustments" element={<Guard perm="qty_adjust"><StockAdjustments /></Guard>} />
        <Route path="stock-transfers" element={<Guard perm="stock_transfer"><StockTransfers /></Guard>} />
        <Route path="categories" element={<Categories />} />
        <Route path="customers" element={<Customers />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="employees" element={<Employees />} />
        <Route path="customer-payments" element={<Guard perm="pay_due"><CustomerPayments /></Guard>} />
        <Route path="supplier-payments" element={<Guard perm="pay_due"><SupplierPayments /></Guard>} />
        <Route path="income-expenses" element={<IncomeExpenses />} />
        <Route path="banks" element={<Banks />} />
        <Route path="cheques" element={<Cheques />} />
        <Route path="shifts" element={<Shifts />} />
        <Route path="vouchers" element={<Vouchers />} />
        <Route path="reports" element={<Reports />} />
        <Route path="users" element={<Guard perm={['add_user', 'edit_user', 'user_control']}><Users /></Guard>} />
        <Route path="settings" element={<Guard perm={['company_settings', 'sms_settings']}><Settings /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
