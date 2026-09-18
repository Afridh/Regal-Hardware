// Permission catalogue.  Mirrors the legacy tbl_UserAccounts chk* columns, grouped for the UI.
// Users with role ADMIN bypass all checks.
export const PERMISSION_GROUPS = [
  { group: 'Master Data', perms: [
    ['add_item', 'Add items'], ['edit_item', 'Edit items'], ['del_item', 'Delete items'],
    ['add_cat', 'Add categories'], ['edit_cat', 'Edit categories'], ['del_cat', 'Delete categories'],
    ['add_sup', 'Add suppliers'], ['edit_sup', 'Edit suppliers'], ['del_sup', 'Delete suppliers'],
    ['add_cus', 'Add customers'], ['edit_cus', 'Edit customers'], ['del_cus', 'Delete customers'],
    ['add_emp', 'Add employees'], ['edit_emp', 'Edit employees'], ['del_emp', 'Delete employees'],
    ['price_change', 'Change item prices'], ['show_cost', 'See cost prices'],
  ]},
  { group: 'Sales', perms: [
    ['invoice', 'Make invoices (POS)'], ['invoice_return', 'Sales returns'], ['hold_invoice', 'Hold invoices'],
    ['delete_hold_invoice', 'Delete held invoices'], ['cancel_invoice', 'Cancel invoices'], ['edit_invoice', 'Edit invoices'],
    ['clear_invoice', 'Clear invoices'], ['print_invoice', 'Print invoices'], ['credit_sales', 'Credit sales'],
    ['cash_discount', 'Give cash discount'], ['cus_discount', 'Give customer discount'], ['emp_discount', 'Give staff discount'],
    ['quotation', 'Quotations'], ['change_date', 'Change invoice date'],
  ]},
  { group: 'Purchases & Stock', perms: [
    ['purchase', 'Purchases (GRN)'], ['purchase_return', 'Purchase returns'], ['cancel_purchase', 'Cancel purchases'],
    ['edit_purchase', 'Edit purchases'], ['purchase_order', 'Purchase orders'], ['proceed_grn', 'Approve GRN'],
    ['qty_adjust', 'Stock adjustments'], ['stock_transfer', 'Stock transfers'], ['stock_replace', 'Stock replacement'],
  ]},
  { group: 'Finance', perms: [
    ['pay_due', 'Customer / supplier payments'], ['add_income', 'Add income'], ['add_expenses', 'Add expenses'],
    ['add_bank', 'Add banks'], ['edit_bank', 'Edit banks'], ['del_bank', 'Delete banks'],
    ['add_deposit', 'Bank deposits'], ['add_withdraw', 'Bank withdrawals'], ['edit_chq', 'Edit cheque details'],
    ['cash_denomination', 'Open / close shift'], ['update_cash_denomination', 'Edit shift cash'],
    ['salary_payment', 'Salary payments'], ['paid_out', 'Paid outs'],
  ]},
  { group: 'Reports', perms: [
    ['view_home', 'View dashboard'], ['item_rpt', 'Item reports'], ['stock_rpt', 'Stock reports'], ['cus_rpt', 'Customer reports'],
    ['sup_rpt', 'Supplier reports'], ['emp_rpt', 'Employee reports'], ['cat_rpt', 'Category reports'],
    ['account_det', 'Accounts / P&L'], ['view_cash_denomination_rpt', 'Shift reports'], ['print_day_summary', 'Day summary'],
  ]},
  { group: 'Administration', perms: [
    ['add_user', 'Add users'], ['edit_user', 'Edit users'], ['del_user', 'Delete users'], ['user_control', 'Set permissions'],
    ['change_location', 'Change location'], ['company_settings', 'Company settings'], ['sms_settings', 'SMS settings'],
    ['data_sync', 'Data sync'], ['web_access', 'Web access'],
  ]},
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.perms.map(([key, label]) => ({ key, label, group: g.group })));
