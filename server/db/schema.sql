-- ============================================================================
--  SePOS Web - PostgreSQL schema
--  Modelled on the legacy SePOS (VB6 / SQL Server) tables:
--    tbl_CompanyDet, tbl_LocaDet, tbl_UnitDet, tbl_UserAccounts,
--    tbl_CatDet, tbl_SubCatDet, tbl_ItemDet, tbl_PriceLink1 (stock batches),
--    tbl_CusDet, tbl_SupDet, tbl_EmpDet, tbl_InvSummery/tbl_InvDet,
--    tbl_PurSummery/tbl_PurDet, tbl_PurOrder, tbl_QuotSummery/tbl_QuotDet,
--    tbl_QtyUpdate, tbl_ItemDetBinCard, tbl_AccountsCus/Sup, tbl_DuePayDet,
--    tbl_OIncSummery (income/expense), tbl_BankDet/tbl_BankTransaction,
--    tbl_ChqDet, tbl_CardDet, tbl_CashDenominationStart/End (shifts),
--    tbl_PointsAddRedeemDet, tbl_GiftVoucherDet, tbl_SMSSetting, tbl_NextNumber
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS companies (
  id            BIGSERIAL PRIMARY KEY,
  code          VARCHAR(30) UNIQUE NOT NULL,
  name          VARCHAR(100) NOT NULL,
  address1      VARCHAR(150),
  address2      VARCHAR(150),
  address3      VARCHAR(150),
  contact1      VARCHAR(50),
  contact2      VARCHAR(50),
  email         VARCHAR(100),
  fax           VARCHAR(30),
  vat_reg_no    VARCHAR(30),
  invoice_desc1 VARCHAR(250),
  invoice_desc2 VARCHAR(250),
  logo_url      TEXT,
  currency_name VARCHAR(10) DEFAULT 'LKR',
  currency_symbol VARCHAR(10) DEFAULT 'Rs.',
  day_start_time TIME DEFAULT '00:00',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  code          VARCHAR(10) NOT NULL,
  name          VARCHAR(50) NOT NULL,
  address       VARCHAR(150),
  manager_name  VARCHAR(50),
  phone         VARCHAR(50),
  mobile        VARCHAR(50),
  active        BOOLEAN DEFAULT TRUE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS terminals (
  id            BIGSERIAL PRIMARY KEY,
  location_id   BIGINT NOT NULL REFERENCES locations(id),
  code          VARCHAR(20) NOT NULL,
  name          VARCHAR(50) NOT NULL,
  registered_pc VARCHAR(100),
  active        BOOLEAN DEFAULT TRUE,
  UNIQUE (location_id, code)
);

-- users : legacy tbl_UserAccounts had ~90 chk* permission columns.
-- Here they live in a JSONB map, e.g. {"invoice":true,"cancel_invoice":false}
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT REFERENCES locations(id),
  code          VARCHAR(30),
  name          VARCHAR(80) NOT NULL,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  pin           VARCHAR(30),
  role          VARCHAR(20) NOT NULL DEFAULT 'CASHIER',  -- ADMIN | MANAGER | CASHIER | USER
  permissions   JSONB NOT NULL DEFAULT '{}'::jsonb,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------- master data
CREATE TABLE IF NOT EXISTS categories (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  code          VARCHAR(30) NOT NULL,
  name          VARCHAR(80) NOT NULL,
  remark        TEXT,
  show_on_web   BOOLEAN DEFAULT FALSE,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS sub_categories (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  category_id   BIGINT NOT NULL REFERENCES categories(id),
  code          VARCHAR(30) NOT NULL,
  name          VARCHAR(80) NOT NULL,
  remark        TEXT,
  active        BOOLEAN DEFAULT TRUE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id),
  code            VARCHAR(30) NOT NULL,
  name            VARCHAR(100) NOT NULL,
  phone           VARCHAR(50),
  mobile          VARCHAR(50),
  email           VARCHAR(100),
  website         VARCHAR(100),
  address         VARCHAR(250),
  contact_person  VARCHAR(80),
  contact_mobile  VARCHAR(50),
  sup_group       VARCHAR(50),
  remark          TEXT,
  opening_balance NUMERIC(14,2) DEFAULT 0,
  due_amount      NUMERIC(14,2) DEFAULT 0,   -- what we owe the supplier
  advance_amount  NUMERIC(14,2) DEFAULT 0,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS customers (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id),
  code            VARCHAR(30) NOT NULL,
  nic             VARCHAR(30),
  name            VARCHAR(100) NOT NULL,
  category        VARCHAR(20) DEFAULT 'RETAIL',  -- RETAIL | WHOLESALE | STAFF | VIP
  price_category  SMALLINT DEFAULT 0,            -- 0 = selling price, 1..5 customer-category prices
  cus_group       VARCHAR(50),
  phone           VARCHAR(50),
  mobile          VARCHAR(50),
  email           VARCHAR(100),
  address         VARCHAR(250),
  company_name    VARCHAR(100),
  occupation      VARCHAR(50),
  remark          TEXT,
  opening_balance NUMERIC(14,2) DEFAULT 0,
  due_amount      NUMERIC(14,2) DEFAULT 0,   -- what the customer owes us
  advance_amount  NUMERIC(14,2) DEFAULT 0,
  credit_limit    NUMERIC(14,2) DEFAULT 0,
  loyalty_points  NUMERIC(12,2) DEFAULT 0,
  allow_cash_discount  BOOLEAN DEFAULT TRUE,
  allow_cus_discount   BOOLEAN DEFAULT TRUE,
  allow_staff_discount BOOLEAN DEFAULT FALSE,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS employees (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT REFERENCES locations(id),
  code          VARCHAR(30) NOT NULL,
  nic           VARCHAR(30),
  name          VARCHAR(100) NOT NULL,
  designation   VARCHAR(50),
  department    VARCHAR(50),
  emp_type      VARCHAR(20) DEFAULT 'PERMANENT',
  phone         VARCHAR(50),
  mobile        VARCHAR(50),
  email         VARCHAR(100),
  address       VARCHAR(250),
  salary_type   VARCHAR(20) DEFAULT 'MONTHLY',
  basic_salary  NUMERIC(14,2) DEFAULT 0,
  is_salesman   BOOLEAN DEFAULT TRUE,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS items (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id),
  code            VARCHAR(30) NOT NULL,
  barcode         VARCHAR(30),
  barcode1        VARCHAR(30),
  barcode2        VARCHAR(30),
  name            VARCHAR(200) NOT NULL,
  name2           VARCHAR(200),
  item_type       VARCHAR(20) DEFAULT 'STOCK',      -- STOCK | SERVICE
  unit            VARCHAR(10) DEFAULT 'PCS',
  category_id     BIGINT REFERENCES categories(id),
  sub_category_id BIGINT REFERENCES sub_categories(id),
  supplier_id     BIGINT REFERENCES suppliers(id),
  part_no         VARCHAR(50),
  make            VARCHAR(50),
  bin_no          VARCHAR(50),
  allow_decimal   BOOLEAN DEFAULT FALSE,
  track_inventory BOOLEAN DEFAULT TRUE,
  allow_discount  BOOLEAN DEFAULT TRUE,
  allow_wholesale BOOLEAN DEFAULT TRUE,
  allow_loyalty   BOOLEAN DEFAULT TRUE,
  allow_edit_price_on_invoice BOOLEAN DEFAULT FALSE,
  ask_serial_on_invoice BOOLEAN DEFAULT FALSE,
  warranty_months INT DEFAULT 0,
  remind_reorder  BOOLEAN DEFAULT TRUE,
  remind_expiry   BOOLEAN DEFAULT FALSE,
  remark          TEXT,
  image_url       TEXT,
  show_on_web     BOOLEAN DEFAULT FALSE,
  active          BOOLEAN DEFAULT TRUE,
  created_by      VARCHAR(50),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items (company_id, barcode);
CREATE INDEX IF NOT EXISTS idx_items_name    ON items (company_id, lower(name));

-- stock_batches == legacy tbl_PriceLink1: one row per item per location per
-- purchase batch, carrying its own cost/selling prices and remaining qty.
CREATE TABLE IF NOT EXISTS stock_batches (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id),
  location_id     BIGINT NOT NULL REFERENCES locations(id),
  item_id         BIGINT NOT NULL REFERENCES items(id),
  batch_no        VARCHAR(30) NOT NULL DEFAULT '1',
  cost_price      NUMERIC(14,4) DEFAULT 0,   -- ItemUPrice
  selling_price   NUMERIC(14,4) DEFAULT 0,   -- ItemSPrice
  discount_price  NUMERIC(14,4) DEFAULT 0,   -- ItemDPrice (min selling)
  wholesale_price NUMERIC(14,4) DEFAULT 0,   -- ItemWPrice
  mrp             NUMERIC(14,4) DEFAULT 0,   -- ItemMPrice
  offer_price     NUMERIC(14,4) DEFAULT 0,   -- ItemOPrice
  cus_cat_price   NUMERIC(14,4)[] DEFAULT '{0,0,0,0,0}',  -- ItemCusCatPrice1..5
  qty_received    NUMERIC(14,3) DEFAULT 0,   -- Qty
  qty_remain      NUMERIC(14,3) DEFAULT 0,   -- QtyRemain
  qty_sold        NUMERIC(14,3) DEFAULT 0,   -- QtySold
  qty_min         NUMERIC(14,3) DEFAULT 0,   -- reorder level
  qty_max         NUMERIC(14,3) DEFAULT 0,
  free_qty        NUMERIC(14,3) DEFAULT 0,
  damage_qty      NUMERIC(14,3) DEFAULT 0,
  expired_qty     NUMERIC(14,3) DEFAULT 0,
  expiry_date     DATE,
  warranty_months INT DEFAULT 0,
  avg_cost        NUMERIC(14,4) DEFAULT 0,
  last_purchase_date DATE,
  last_purchase_price NUMERIC(14,4),
  last_sale_date  DATE,
  last_sale_price NUMERIC(14,4),
  created_by      VARCHAR(50),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (location_id, item_id, batch_no)
);
CREATE INDEX IF NOT EXISTS idx_stock_item ON stock_batches (item_id, location_id);

-- item_ledger == tbl_ItemDetBinCard : every stock movement
CREATE TABLE IF NOT EXISTS item_ledger (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT NOT NULL REFERENCES locations(id),
  item_id       BIGINT NOT NULL REFERENCES items(id),
  batch_id      BIGINT REFERENCES stock_batches(id),
  txn_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  txn_type      VARCHAR(10) NOT NULL,   -- INV | INVR | PCH | PCHR | QTYA | TRF | OPEN
  ref_no        VARCHAR(50),
  qty_in        NUMERIC(14,3) DEFAULT 0,
  qty_out       NUMERIC(14,3) DEFAULT 0,
  balance       NUMERIC(14,3) DEFAULT 0,
  cost_price    NUMERIC(14,4) DEFAULT 0,
  selling_price NUMERIC(14,4) DEFAULT 0,
  created_by    VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_item ON item_ledger (item_id, txn_date);

-- ---------------------------------------------------------------- sequences
-- == tbl_NextNumber.  key examples: INV, PCH, PO, QUOT, QTYA, TRF, CPAY, SPAY, INC, EXP, BNK, CHQ, SAL
-- location_id = 0 means "company-wide" (kept NOT NULL so the UNIQUE constraint / ON CONFLICT works)
CREATE TABLE IF NOT EXISTS sequences (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  location_id BIGINT NOT NULL DEFAULT 0,
  key         VARCHAR(20) NOT NULL,
  prefix      VARCHAR(20) NOT NULL DEFAULT '',
  next_no     BIGINT NOT NULL DEFAULT 1,
  UNIQUE (company_id, location_id, key)
);

CREATE OR REPLACE FUNCTION next_serial(p_company BIGINT, p_location BIGINT, p_key VARCHAR, p_prefix VARCHAR DEFAULT NULL)
RETURNS VARCHAR LANGUAGE plpgsql AS $$
DECLARE v_no BIGINT; v_prefix VARCHAR; v_loc BIGINT := COALESCE(p_location, 0);
BEGIN
  INSERT INTO sequences (company_id, location_id, key, prefix, next_no)
  VALUES (p_company, v_loc, p_key, COALESCE(p_prefix, p_key || '-'), 1)
  ON CONFLICT (company_id, location_id, key) DO NOTHING;

  UPDATE sequences SET next_no = next_no + 1
   WHERE company_id = p_company AND location_id = v_loc AND key = p_key
   RETURNING next_no - 1, prefix INTO v_no, v_prefix;

  RETURN v_prefix || lpad(v_no::text, 6, '0');
END $$;

-- ---------------------------------------------------------------- sales
CREATE TABLE IF NOT EXISTS invoices (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id),
  location_id     BIGINT NOT NULL REFERENCES locations(id),
  terminal_id     BIGINT REFERENCES terminals(id),
  serial_no       VARCHAR(50) UNIQUE NOT NULL,      -- system serial (INV-000001)
  invoice_no      VARCHAR(50),                       -- printable / manual number
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  invoice_time    TIME NOT NULL DEFAULT CURRENT_TIME,
  inv_mode        VARCHAR(10) NOT NULL DEFAULT 'INV',   -- INV | RET (sales return)
  customer_id     BIGINT REFERENCES customers(id),
  customer_name   VARCHAR(100) DEFAULT 'CASH CUSTOMER',
  customer_mobile VARCHAR(50),
  salesman_id     BIGINT REFERENCES employees(id),
  pay_mode        VARCHAR(20) DEFAULT 'CASH',          -- CASH | CARD | CHEQUE | BANK | CREDIT | MULTI
  invoice_status  VARCHAR(20) DEFAULT 'PRINTED',       -- PRINTED | HOLD | CANCELLED | CLEARED
  order_status    VARCHAR(20) DEFAULT 'PAID',          -- PAID | PARTIAL | UNPAID
  order_type      VARCHAR(20) DEFAULT 'COUNTER',       -- COUNTER | DELIVERY | TAKEAWAY | DINE_IN
  table_no        VARCHAR(10),
  delivery_address VARCHAR(250),
  gross_total     NUMERIC(14,2) DEFAULT 0,   -- GTotal  (sum qty*selling)
  item_discount   NUMERIC(14,2) DEFAULT 0,   -- ItemDiscount
  bill_discount   NUMERIC(14,2) DEFAULT 0,   -- DiscountForTot
  extra_charges   NUMERIC(14,2) DEFAULT 0,   -- ExCharges
  net_total       NUMERIC(14,2) DEFAULT 0,   -- NTotal
  cost_total      NUMERIC(14,2) DEFAULT 0,   -- CTotal
  profit          NUMERIC(14,2) DEFAULT 0,   -- NProfit
  total_qty       NUMERIC(14,3) DEFAULT 0,
  total_lines     INT DEFAULT 0,
  cash_paid       NUMERIC(14,2) DEFAULT 0,
  card_paid       NUMERIC(14,2) DEFAULT 0,
  cheque_paid     NUMERIC(14,2) DEFAULT 0,
  bank_paid       NUMERIC(14,2) DEFAULT 0,
  credit_paid     NUMERIC(14,2) DEFAULT 0,   -- amount put on customer account
  voucher_paid    NUMERIC(14,2) DEFAULT 0,
  points_redeemed NUMERIC(14,2) DEFAULT 0,
  points_earned   NUMERIC(14,2) DEFAULT 0,
  total_paid      NUMERIC(14,2) DEFAULT 0,
  balance_amount  NUMERIC(14,2) DEFAULT 0,   -- change returned
  due_amount      NUMERIC(14,2) DEFAULT 0,   -- IDueAmount still outstanding
  due_date        DATE,
  remark          TEXT,
  shift_id        BIGINT,
  created_by      VARCHAR(50),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  cancelled_by    VARCHAR(50),
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_date ON invoices (company_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_inv_cus  ON invoices (customer_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id            BIGSERIAL PRIMARY KEY,
  invoice_id    BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no       INT NOT NULL,
  item_id       BIGINT REFERENCES items(id),
  batch_id      BIGINT REFERENCES stock_batches(id),
  item_code     VARCHAR(30),
  item_name     VARCHAR(200),
  unit          VARCHAR(10),
  qty           NUMERIC(14,3) NOT NULL,
  cost_price    NUMERIC(14,4) DEFAULT 0,
  selling_price NUMERIC(14,4) DEFAULT 0,   -- list price
  unit_price    NUMERIC(14,4) DEFAULT 0,   -- price actually charged
  discount      NUMERIC(14,2) DEFAULT 0,   -- line discount amount
  line_total    NUMERIC(14,2) DEFAULT 0,
  price_type    VARCHAR(20) DEFAULT 'RETAIL', -- RETAIL | WHOLESALE | OFFER | CUSCAT
  warranty      VARCHAR(50),
  serial_nos    TEXT,
  remark        VARCHAR(250)
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id          BIGSERIAL PRIMARY KEY,
  invoice_id  BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  pay_type    VARCHAR(20) NOT NULL,   -- CASH | CARD | CHEQUE | BANK | CREDIT | VOUCHER | POINTS
  amount      NUMERIC(14,2) NOT NULL,
  reference   VARCHAR(100),
  bank_id     BIGINT,
  card_type   VARCHAR(20),
  card_no     VARCHAR(30),
  cheque_no   VARCHAR(50),
  cheque_date DATE,
  cheque_bank VARCHAR(80),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------- purchases (GRN)
CREATE TABLE IF NOT EXISTS purchases (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id),
  location_id     BIGINT NOT NULL REFERENCES locations(id),
  serial_no       VARCHAR(50) UNIQUE NOT NULL,   -- PCH-000001
  invoice_no      VARCHAR(50),                    -- supplier's invoice number
  purchase_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  inv_mode        VARCHAR(10) NOT NULL DEFAULT 'PCH',   -- PCH | RET
  supplier_id     BIGINT REFERENCES suppliers(id),
  supplier_name   VARCHAR(100),
  pay_mode        VARCHAR(20) DEFAULT 'CREDIT',
  invoice_status  VARCHAR(20) DEFAULT 'PRINTED',   -- PRINTED | HOLD | CANCELLED
  order_status    VARCHAR(20) DEFAULT 'UNPAID',
  gross_total     NUMERIC(14,2) DEFAULT 0,
  item_discount   NUMERIC(14,2) DEFAULT 0,
  bill_discount   NUMERIC(14,2) DEFAULT 0,
  extra_charges   NUMERIC(14,2) DEFAULT 0,
  net_total       NUMERIC(14,2) DEFAULT 0,
  total_qty       NUMERIC(14,3) DEFAULT 0,
  paid_amount     NUMERIC(14,2) DEFAULT 0,
  due_amount      NUMERIC(14,2) DEFAULT 0,
  due_date        DATE,
  remark          TEXT,
  created_by      VARCHAR(50),
  created_at      TIMESTAMPTZ DEFAULT now(),
  cancelled_by    VARCHAR(50),
  cancelled_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pch_date ON purchases (company_id, purchase_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id              BIGSERIAL PRIMARY KEY,
  purchase_id     BIGINT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  line_no         INT NOT NULL,
  item_id         BIGINT REFERENCES items(id),
  batch_id        BIGINT REFERENCES stock_batches(id),
  item_code       VARCHAR(30),
  item_name       VARCHAR(200),
  unit            VARCHAR(10),
  qty             NUMERIC(14,3) NOT NULL,
  free_qty        NUMERIC(14,3) DEFAULT 0,
  cost_price      NUMERIC(14,4) DEFAULT 0,
  selling_price   NUMERIC(14,4) DEFAULT 0,
  wholesale_price NUMERIC(14,4) DEFAULT 0,
  mrp             NUMERIC(14,4) DEFAULT 0,
  discount        NUMERIC(14,2) DEFAULT 0,
  line_total      NUMERIC(14,2) DEFAULT 0,
  expiry_date     DATE,
  warranty_months INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT NOT NULL REFERENCES locations(id),
  serial_no     VARCHAR(50) UNIQUE NOT NULL,
  po_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id   BIGINT REFERENCES suppliers(id),
  supplier_name VARCHAR(100),
  status        VARCHAR(20) DEFAULT 'OPEN',   -- OPEN | RECEIVED | CANCELLED
  expected_date DATE,
  net_total     NUMERIC(14,2) DEFAULT 0,
  total_qty     NUMERIC(14,3) DEFAULT 0,
  remark        TEXT,
  created_by    VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id          BIGSERIAL PRIMARY KEY,
  po_id       BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no     INT NOT NULL,
  item_id     BIGINT REFERENCES items(id),
  item_code   VARCHAR(30),
  item_name   VARCHAR(200),
  qty         NUMERIC(14,3) NOT NULL,
  cost_price  NUMERIC(14,4) DEFAULT 0,
  line_total  NUMERIC(14,2) DEFAULT 0
);

-- ---------------------------------------------------------------- quotations
CREATE TABLE IF NOT EXISTS quotations (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT NOT NULL REFERENCES locations(id),
  serial_no     VARCHAR(50) UNIQUE NOT NULL,
  quot_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_till    DATE,
  customer_id   BIGINT REFERENCES customers(id),
  customer_name VARCHAR(100),
  status        VARCHAR(20) DEFAULT 'OPEN',   -- OPEN | CONVERTED | EXPIRED | CANCELLED
  gross_total   NUMERIC(14,2) DEFAULT 0,
  discount      NUMERIC(14,2) DEFAULT 0,
  net_total     NUMERIC(14,2) DEFAULT 0,
  remark        TEXT,
  converted_invoice_id BIGINT REFERENCES invoices(id),
  created_by    VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id            BIGSERIAL PRIMARY KEY,
  quotation_id  BIGINT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  line_no       INT NOT NULL,
  item_id       BIGINT REFERENCES items(id),
  item_code     VARCHAR(30),
  item_name     VARCHAR(200),
  qty           NUMERIC(14,3) NOT NULL,
  unit_price    NUMERIC(14,4) DEFAULT 0,
  discount      NUMERIC(14,2) DEFAULT 0,
  line_total    NUMERIC(14,2) DEFAULT 0
);

-- ---------------------------------------------------------------- stock adjustments & transfers
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT NOT NULL REFERENCES locations(id),
  serial_no     VARCHAR(50) UNIQUE NOT NULL,
  adj_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  adj_type      VARCHAR(20) NOT NULL,   -- ADD | DEDUCT | DAMAGE | EXPIRED | STOCK_TAKE
  reason        VARCHAR(250),
  total_qty     NUMERIC(14,3) DEFAULT 0,
  total_cost    NUMERIC(14,2) DEFAULT 0,
  created_by    VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_adjustment_items (
  id            BIGSERIAL PRIMARY KEY,
  adjustment_id BIGINT NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  item_id       BIGINT NOT NULL REFERENCES items(id),
  batch_id      BIGINT REFERENCES stock_batches(id),
  item_code     VARCHAR(30),
  item_name     VARCHAR(200),
  qty           NUMERIC(14,3) NOT NULL,   -- positive number; direction from adj_type
  cost_price    NUMERIC(14,4) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id               BIGSERIAL PRIMARY KEY,
  company_id       BIGINT NOT NULL REFERENCES companies(id),
  serial_no        VARCHAR(50) UNIQUE NOT NULL,
  transfer_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  from_location_id BIGINT NOT NULL REFERENCES locations(id),
  to_location_id   BIGINT NOT NULL REFERENCES locations(id),
  status           VARCHAR(20) DEFAULT 'SENT',   -- SENT | RECEIVED | CANCELLED
  total_qty        NUMERIC(14,3) DEFAULT 0,
  remark           TEXT,
  created_by       VARCHAR(50),
  created_at       TIMESTAMPTZ DEFAULT now(),
  received_by      VARCHAR(50),
  received_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id            BIGSERIAL PRIMARY KEY,
  transfer_id   BIGINT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  item_id       BIGINT NOT NULL REFERENCES items(id),
  from_batch_id BIGINT REFERENCES stock_batches(id),
  item_code     VARCHAR(30),
  item_name     VARCHAR(200),
  qty           NUMERIC(14,3) NOT NULL,
  cost_price    NUMERIC(14,4) DEFAULT 0,
  selling_price NUMERIC(14,4) DEFAULT 0
);

-- ---------------------------------------------------------------- receivables / payables
-- == tbl_AccountsCus / tbl_DuePayDet (ID='INV')
CREATE TABLE IF NOT EXISTS customer_payments (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT NOT NULL REFERENCES locations(id),
  serial_no     VARCHAR(50) UNIQUE NOT NULL,
  pay_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_id   BIGINT NOT NULL REFERENCES customers(id),
  amount        NUMERIC(14,2) NOT NULL,
  pay_type      VARCHAR(20) DEFAULT 'CASH',   -- CASH | CARD | CHEQUE | BANK
  reference     VARCHAR(100),
  bank_id       BIGINT,
  cheque_no     VARCHAR(50),
  cheque_date   DATE,
  entry_type    VARCHAR(20) DEFAULT 'PAYMENT',   -- PAYMENT | CREDIT_ADJ | DEBIT_ADJ | ADVANCE | OPENING
  remark        TEXT,
  created_by    VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_payment_allocations (
  id          BIGSERIAL PRIMARY KEY,
  payment_id  BIGINT NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  invoice_id  BIGINT NOT NULL REFERENCES invoices(id),
  amount      NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT NOT NULL REFERENCES locations(id),
  serial_no     VARCHAR(50) UNIQUE NOT NULL,
  pay_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id   BIGINT NOT NULL REFERENCES suppliers(id),
  amount        NUMERIC(14,2) NOT NULL,
  pay_type      VARCHAR(20) DEFAULT 'CASH',
  reference     VARCHAR(100),
  bank_id       BIGINT,
  cheque_no     VARCHAR(50),
  cheque_date   DATE,
  entry_type    VARCHAR(20) DEFAULT 'PAYMENT',
  remark        TEXT,
  created_by    VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id          BIGSERIAL PRIMARY KEY,
  payment_id  BIGINT NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  purchase_id BIGINT NOT NULL REFERENCES purchases(id),
  amount      NUMERIC(14,2) NOT NULL
);

-- ---------------------------------------------------------------- income / expenses (tbl_OIncSummery, tbl_DescDet, tbl_DescCatDet)
CREATE TABLE IF NOT EXISTS expense_categories (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  code        VARCHAR(30) NOT NULL,
  name        VARCHAR(80) NOT NULL,
  kind        VARCHAR(10) NOT NULL DEFAULT 'EXPENSE',   -- INCOME | EXPENSE
  direct      BOOLEAN DEFAULT TRUE,                     -- direct vs indirect (P&L grouping)
  active      BOOLEAN DEFAULT TRUE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS income_expenses (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT NOT NULL REFERENCES locations(id),
  serial_no     VARCHAR(50) UNIQUE NOT NULL,
  txn_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  kind          VARCHAR(10) NOT NULL,   -- INCOME | EXPENSE
  category_id   BIGINT REFERENCES expense_categories(id),
  description   VARCHAR(250),
  vendor_name   VARCHAR(100),
  amount        NUMERIC(14,2) NOT NULL,
  pay_mode      VARCHAR(20) DEFAULT 'CASH',
  reference     VARCHAR(100),
  bank_id       BIGINT,
  remark        TEXT,
  created_by    VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------- banking (tbl_BankDet, tbl_BankTransaction, tbl_ChqDet, tbl_CardDet)
CREATE TABLE IF NOT EXISTS banks (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id),
  code            VARCHAR(20) NOT NULL,
  bank_name       VARCHAR(80) NOT NULL,
  branch          VARCHAR(80),
  account_no      VARCHAR(50),
  account_type    VARCHAR(20) DEFAULT 'CURRENT',
  opening_balance NUMERIC(14,2) DEFAULT 0,
  active          BOOLEAN DEFAULT TRUE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  location_id BIGINT REFERENCES locations(id),
  bank_id     BIGINT NOT NULL REFERENCES banks(id),
  serial_no   VARCHAR(50) UNIQUE NOT NULL,
  txn_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  txn_type    VARCHAR(20) NOT NULL,   -- DEPOSIT | WITHDRAW | CHEQUE_IN | CHEQUE_OUT | CARD_SETTLE | TRANSFER
  amount      NUMERIC(14,2) NOT NULL,
  reference   VARCHAR(100),
  description VARCHAR(250),
  source      VARCHAR(30),   -- INV | CPAY | SPAY | INCEXP | MANUAL
  source_id   BIGINT,
  created_by  VARCHAR(50),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cheques (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT REFERENCES locations(id),
  cheque_no     VARCHAR(50) NOT NULL,
  cheque_date   DATE,
  bank_name     VARCHAR(80),
  amount        NUMERIC(14,2) NOT NULL,
  direction     VARCHAR(10) NOT NULL,   -- IN (received) | OUT (issued)
  party_type    VARCHAR(10),            -- CUS | SUP | OTHER
  party_id      BIGINT,
  party_name    VARCHAR(100),
  status        VARCHAR(20) DEFAULT 'PENDING',   -- PENDING | REALIZED | RETURNED | CANCELLED
  deposit_bank_id BIGINT REFERENCES banks(id),
  source        VARCHAR(30),
  source_id     BIGINT,
  realized_at   DATE,
  remark        TEXT,
  created_by    VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------- shifts / cash denomination / day end
CREATE TABLE IF NOT EXISTS shifts (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  location_id   BIGINT NOT NULL REFERENCES locations(id),
  terminal_id   BIGINT REFERENCES terminals(id),
  shift_no      VARCHAR(20) NOT NULL,
  opened_by     VARCHAR(50),
  opened_at     TIMESTAMPTZ DEFAULT now(),
  opening_cash  NUMERIC(14,2) DEFAULT 0,
  opening_denoms JSONB,
  closed_by     VARCHAR(50),
  closed_at     TIMESTAMPTZ,
  closing_cash  NUMERIC(14,2),
  closing_denoms JSONB,
  expected_cash NUMERIC(14,2),
  variance      NUMERIC(14,2),
  status        VARCHAR(10) DEFAULT 'OPEN',   -- OPEN | CLOSED
  remark        TEXT
);

-- ---------------------------------------------------------------- loyalty / vouchers
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  invoice_id  BIGINT REFERENCES invoices(id),
  txn_type    VARCHAR(10) NOT NULL,   -- EARN | REDEEM | ADJUST
  points      NUMERIC(12,2) NOT NULL,
  remark      VARCHAR(250),
  created_by  VARCHAR(50),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gift_vouchers (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  voucher_no    VARCHAR(50) UNIQUE NOT NULL,
  amount        NUMERIC(14,2) NOT NULL,
  customer_id   BIGINT REFERENCES customers(id),
  customer_name VARCHAR(100),
  issued_at     DATE DEFAULT CURRENT_DATE,
  expires_at    DATE,
  status        VARCHAR(20) DEFAULT 'ACTIVE',   -- ACTIVE | REDEEMED | EXPIRED | CANCELLED
  redeemed_invoice_id BIGINT REFERENCES invoices(id),
  created_by    VARCHAR(50)
);

-- ---------------------------------------------------------------- settings
CREATE TABLE IF NOT EXISTS sms_settings (
  company_id    BIGINT PRIMARY KEY REFERENCES companies(id),
  api_url       TEXT,
  api_key       TEXT,
  sender_id     VARCHAR(20),
  owner_mobile  VARCHAR(50),
  templates     JSONB DEFAULT '{}'::jsonb,   -- {invoice, credit_invoice, credit_settlement, loyalty, ...}
  flags         JSONB DEFAULT '{}'::jsonb,   -- {send_invoice_to_owner:true, send_daily_summary:true, ...}
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  key         VARCHAR(50) NOT NULL,
  value       JSONB,
  PRIMARY KEY (company_id, key)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT,
  user_id     BIGINT,
  username    VARCHAR(50),
  action      VARCHAR(50) NOT NULL,
  entity      VARCHAR(50),
  entity_id   VARCHAR(50),
  details     JSONB,
  ip          VARCHAR(50),
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_log (created_at);

-- ---------------------------------------------------------------- SMS outbox (worker queue, like SePOSbgWorkerSMS)
CREATE TABLE IF NOT EXISTS sms_outbox (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  mobile      VARCHAR(50) NOT NULL,
  message     TEXT NOT NULL,
  status      VARCHAR(20) DEFAULT 'PENDING',   -- PENDING | SENT | FAILED
  attempts    INT DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  sent_at     TIMESTAMPTZ
);

-- ---------------------------------------------------------------- Regal app (primary UI) document store
-- The Regal front-end keeps its books as one JSON document (S + CFG).  Each save bumps rev so two
-- tills cannot silently overwrite each other; the bridge script reloads the newer copy on conflict.
CREATE TABLE IF NOT EXISTS books (
  key         VARCHAR(50) PRIMARY KEY,
  rev         BIGINT NOT NULL DEFAULT 0,
  data        JSONB,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  VARCHAR(80)
);

-- history of saves, so a bad save can be rolled back (last 200 kept by the API)
CREATE TABLE IF NOT EXISTS books_history (
  id          BIGSERIAL PRIMARY KEY,
  key         VARCHAR(50) NOT NULL,
  rev         BIGINT NOT NULL,
  data        JSONB,
  saved_at    TIMESTAMPTZ DEFAULT now(),
  saved_by    VARCHAR(80)
);
CREATE INDEX IF NOT EXISTS idx_books_history ON books_history (key, rev);

-- logins for the embedded Shift Board (owner / supervisor), separate from the shop's own user list
CREATE TABLE IF NOT EXISTS shift_users (
  username      VARCHAR(50) PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'supervisor',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- orders placed on the public shop site (app/shop.html); a till pulls each one into the books
-- (S.web.orders) and imported_at is set once a save containing it lands.  Also created on demand.
CREATE TABLE IF NOT EXISTS shop_orders (
  id          BIGSERIAL PRIMARY KEY,
  no          VARCHAR(20) UNIQUE NOT NULL,
  phone       VARCHAR(20) NOT NULL,
  name        VARCHAR(120) NOT NULL,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS shop_orders_phone ON shop_orders (phone);
CREATE INDEX IF NOT EXISTS shop_orders_pending ON shop_orders (imported_at) WHERE imported_at IS NULL;

-- ---------------------------------------------------------------- helpful views
CREATE OR REPLACE VIEW v_item_stock AS
SELECT i.id AS item_id, i.company_id, i.code, i.barcode, i.name, i.unit, i.active,
       c.name AS category_name, s.name AS supplier_name,
       sb.location_id,
       COALESCE(SUM(sb.qty_remain),0) AS qty_on_hand,
       MAX(sb.selling_price)          AS selling_price,
       MAX(sb.cost_price)             AS cost_price,
       MIN(sb.qty_min)                AS qty_min,
       COALESCE(SUM(sb.qty_remain*sb.cost_price),0)    AS stock_value_cost,
       COALESCE(SUM(sb.qty_remain*sb.selling_price),0) AS stock_value_selling
FROM items i
LEFT JOIN categories c ON c.id = i.category_id
LEFT JOIN suppliers  s ON s.id = i.supplier_id
LEFT JOIN stock_batches sb ON sb.item_id = i.id
GROUP BY i.id, c.name, s.name, sb.location_id;

COMMIT;
