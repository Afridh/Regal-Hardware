import { Link } from 'react-router-dom';
import MasterPage from '../components/MasterPage.jsx';
import { fmt, Badge } from '../components/ui.jsx';

const Active = r => <Badge status={r.active ? 'ACTIVE' : 'CANCELLED'}>{r.active ? 'Active' : 'Inactive'}</Badge>;

export function Categories() {
  return (
    <MasterPage title="Categories" url="/master/categories" perms={{ create: 'add_cat', update: 'edit_cat', delete: 'del_cat' }}
      columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'remark', label: 'Remark' }, { key: 'active', label: 'Status', render: Active }]}
      fields={[{ key: 'code', label: 'Code', hint: 'Leave blank to auto-generate' }, { key: 'name', label: 'Name', required: true }, { key: 'show_on_web', label: 'Show on web', type: 'check' }, { key: 'remark', label: 'Remark', type: 'textarea' }]}
      renderExtra={editing => editing?.id && <p className="subtle mt">Sub-categories can be managed from the item form (choose a category, then add).</p>}
    />
  );
}

export function Customers() {
  return (
    <MasterPage title="Customers" url="/master/customers" perms={{ create: 'add_cus', update: 'edit_cus', delete: 'del_cus' }} searchPlaceholder="Search name / code / mobile / NIC"
      columns={[
        { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'category', label: 'Type' }, { key: 'mobile', label: 'Mobile' },
        { key: 'due_amount', label: 'Outstanding', num: true, render: r => <span className={Number(r.due_amount) > 0 ? 'text-bad' : ''}>{fmt(r.due_amount)}</span> },
        { key: 'loyalty_points', label: 'Points', num: true, render: r => fmt(r.loyalty_points, 0) }, { key: 'active', label: 'Status', render: Active },
      ]}
      fields={[
        { key: 'code', label: 'Code', hint: 'Auto if blank' }, { key: 'name', label: 'Name', required: true }, { key: 'nic', label: 'NIC' },
        { key: 'category', label: 'Customer type', type: 'select', options: ['RETAIL', 'WHOLESALE', 'STAFF', 'VIP'], default: 'RETAIL' },
        { key: 'price_category', label: 'Price category', type: 'select', options: [{ value: 0, label: 'Standard' }, { value: 1, label: 'Category 1' }, { value: 2, label: 'Category 2' }, { value: 3, label: 'Category 3' }, { value: 4, label: 'Category 4' }, { value: 5, label: 'Category 5' }], default: 0 },
        { key: 'mobile', label: 'Mobile' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'address', label: 'Address', span: 2 },
        { key: 'company_name', label: 'Company' }, { key: 'cus_group', label: 'Group' }, { key: 'credit_limit', label: 'Credit limit', type: 'number' }, { key: 'opening_balance', label: 'Opening balance', type: 'number' },
        { key: 'allow_cash_discount', label: 'Allow cash discount', type: 'check', default: true }, { key: 'allow_cus_discount', label: 'Allow customer discount', type: 'check', default: true }, { key: 'allow_staff_discount', label: 'Allow staff discount', type: 'check' },
        { key: 'remark', label: 'Remark', type: 'textarea' },
      ]}
      rowActions={r => <Link className="btn sm" to={`/reports?tab=statement&customer_id=${r.id}`}>Statement</Link>}
    />
  );
}

export function Suppliers() {
  return (
    <MasterPage title="Suppliers" url="/master/suppliers" perms={{ create: 'add_sup', update: 'edit_sup', delete: 'del_sup' }}
      columns={[
        { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'mobile', label: 'Mobile' }, { key: 'contact_person', label: 'Contact' },
        { key: 'due_amount', label: 'Payable', num: true, render: r => <span className={Number(r.due_amount) > 0 ? 'text-warn' : ''}>{fmt(r.due_amount)}</span> }, { key: 'active', label: 'Status', render: Active },
      ]}
      fields={[
        { key: 'code', label: 'Code', hint: 'Auto if blank' }, { key: 'name', label: 'Name', required: true }, { key: 'phone', label: 'Phone' }, { key: 'mobile', label: 'Mobile' },
        { key: 'email', label: 'Email' }, { key: 'website', label: 'Website' }, { key: 'address', label: 'Address', span: 2 },
        { key: 'contact_person', label: 'Contact person' }, { key: 'contact_mobile', label: 'Contact mobile' }, { key: 'sup_group', label: 'Group' }, { key: 'opening_balance', label: 'Opening balance', type: 'number' },
        { key: 'remark', label: 'Remark', type: 'textarea' },
      ]}
      rowActions={r => <Link className="btn sm" to={`/reports?tab=statement&supplier_id=${r.id}`}>Statement</Link>}
    />
  );
}

export function Employees() {
  return (
    <MasterPage title="Employees" url="/master/employees" perms={{ create: 'add_emp', update: 'edit_emp', delete: 'del_emp' }}
      columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'designation', label: 'Designation' }, { key: 'department', label: 'Department' }, { key: 'mobile', label: 'Mobile' }, { key: 'is_salesman', label: 'Salesman', render: r => r.is_salesman ? 'Yes' : '' }, { key: 'active', label: 'Status', render: Active }]}
      fields={[
        { key: 'code', label: 'Code', hint: 'Auto if blank' }, { key: 'name', label: 'Name', required: true }, { key: 'nic', label: 'NIC' }, { key: 'designation', label: 'Designation' }, { key: 'department', label: 'Department' },
        { key: 'emp_type', label: 'Type', type: 'select', options: ['PERMANENT', 'CONTRACT', 'CASUAL'], default: 'PERMANENT' }, { key: 'mobile', label: 'Mobile' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
        { key: 'address', label: 'Address', span: 2 }, { key: 'salary_type', label: 'Salary type', type: 'select', options: ['MONTHLY', 'DAILY', 'HOURLY', 'COMMISSION'], default: 'MONTHLY' }, { key: 'basic_salary', label: 'Basic salary', type: 'number' },
        { key: 'is_salesman', label: 'Is salesman', type: 'check', default: true },
      ]}
    />
  );
}
