SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `activity_log`;
CREATE TABLE `activity_log` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT,
  `user_id` BIGINT,
  `username` VARCHAR(50),
  `action` VARCHAR(50) NOT NULL,
  `entity` VARCHAR(50),
  `entity_id` VARCHAR(50),
  `details` JSON,
  `ip` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `bank_transactions`;
CREATE TABLE `bank_transactions` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT,
  `bank_id` BIGINT NOT NULL,
  `serial_no` VARCHAR(50) NOT NULL,
  `txn_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `txn_type` VARCHAR(20) NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `reference` VARCHAR(100),
  `description` VARCHAR(250),
  `source` VARCHAR(30),
  `source_id` BIGINT,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `banks`;
CREATE TABLE `banks` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `code` VARCHAR(20) NOT NULL,
  `bank_name` VARCHAR(80) NOT NULL,
  `branch` VARCHAR(80),
  `account_no` VARCHAR(50),
  `account_type` VARCHAR(20) DEFAULT 'CURRENT',
  `opening_balance` DECIMAL(14,2) DEFAULT 0,
  `active` TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `books`;
CREATE TABLE `books` (
  `key` VARCHAR(50) NOT NULL,
  `rev` BIGINT NOT NULL DEFAULT 0,
  `data` JSON,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_by` VARCHAR(80),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `books_history`;
CREATE TABLE `books_history` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `key` VARCHAR(50) NOT NULL,
  `rev` BIGINT NOT NULL,
  `data` JSON,
  `saved_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `saved_by` VARCHAR(80),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `remark` LONGTEXT,
  `show_on_web` TINYINT(1) DEFAULT 0,
  `active` TINYINT(1) DEFAULT 1,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `cheques`;
CREATE TABLE `cheques` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT,
  `cheque_no` VARCHAR(50) NOT NULL,
  `cheque_date` DATE,
  `bank_name` VARCHAR(80),
  `amount` DECIMAL(14,2) NOT NULL,
  `direction` VARCHAR(10) NOT NULL,
  `party_type` VARCHAR(10),
  `party_id` BIGINT,
  `party_name` VARCHAR(100),
  `status` VARCHAR(20) DEFAULT 'PENDING',
  `deposit_bank_id` BIGINT,
  `source` VARCHAR(30),
  `source_id` BIGINT,
  `realized_at` DATE,
  `remark` LONGTEXT,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `companies`;
CREATE TABLE `companies` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `address1` VARCHAR(150),
  `address2` VARCHAR(150),
  `address3` VARCHAR(150),
  `contact1` VARCHAR(50),
  `contact2` VARCHAR(50),
  `email` VARCHAR(100),
  `fax` VARCHAR(30),
  `vat_reg_no` VARCHAR(30),
  `invoice_desc1` VARCHAR(250),
  `invoice_desc2` VARCHAR(250),
  `logo_url` LONGTEXT,
  `currency_name` VARCHAR(10) DEFAULT 'LKR',
  `currency_symbol` VARCHAR(10) DEFAULT 'Rs.',
  `day_start_time` TIME DEFAULT '00:00:00',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `cust_inbox`;
CREATE TABLE `cust_inbox` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `cid` INT NOT NULL,
  `kind` VARCHAR(12) NOT NULL,
  `data` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `imported_at` DATETIME,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `cust_logins`;
CREATE TABLE `cust_logins` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `owner` INT NOT NULL,
  `username` VARCHAR(40) NOT NULL,
  `name` VARCHAR(80),
  `role` VARCHAR(40),
  `phone` VARCHAR(20),
  `admin_hash` LONGTEXT,
  `own_hash` LONGTEXT,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_seen` DATETIME,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `starter` VARCHAR(40),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `customer_payment_allocations`;
CREATE TABLE `customer_payment_allocations` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `payment_id` BIGINT NOT NULL,
  `invoice_id` BIGINT NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `customer_payments`;
CREATE TABLE `customer_payments` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `serial_no` VARCHAR(50) NOT NULL,
  `pay_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `customer_id` BIGINT NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `pay_type` VARCHAR(20) DEFAULT 'CASH',
  `reference` VARCHAR(100),
  `bank_id` BIGINT,
  `cheque_no` VARCHAR(50),
  `cheque_date` DATE,
  `entry_type` VARCHAR(20) DEFAULT 'PAYMENT',
  `remark` LONGTEXT,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `customers`;
CREATE TABLE `customers` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `nic` VARCHAR(30),
  `name` VARCHAR(100) NOT NULL,
  `category` VARCHAR(20) DEFAULT 'RETAIL',
  `price_category` SMALLINT DEFAULT 0,
  `cus_group` VARCHAR(50),
  `phone` VARCHAR(50),
  `mobile` VARCHAR(50),
  `email` VARCHAR(100),
  `address` VARCHAR(250),
  `company_name` VARCHAR(100),
  `occupation` VARCHAR(50),
  `remark` LONGTEXT,
  `opening_balance` DECIMAL(14,2) DEFAULT 0,
  `due_amount` DECIMAL(14,2) DEFAULT 0,
  `advance_amount` DECIMAL(14,2) DEFAULT 0,
  `credit_limit` DECIMAL(14,2) DEFAULT 0,
  `loyalty_points` DECIMAL(12,2) DEFAULT 0,
  `allow_cash_discount` TINYINT(1) DEFAULT 1,
  `allow_cus_discount` TINYINT(1) DEFAULT 1,
  `allow_staff_discount` TINYINT(1) DEFAULT 0,
  `active` TINYINT(1) DEFAULT 1,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `employees`;
CREATE TABLE `employees` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT,
  `code` VARCHAR(30) NOT NULL,
  `nic` VARCHAR(30),
  `name` VARCHAR(100) NOT NULL,
  `designation` VARCHAR(50),
  `department` VARCHAR(50),
  `emp_type` VARCHAR(20) DEFAULT 'PERMANENT',
  `phone` VARCHAR(50),
  `mobile` VARCHAR(50),
  `email` VARCHAR(100),
  `address` VARCHAR(250),
  `salary_type` VARCHAR(20) DEFAULT 'MONTHLY',
  `basic_salary` DECIMAL(14,2) DEFAULT 0,
  `is_salesman` TINYINT(1) DEFAULT 1,
  `active` TINYINT(1) DEFAULT 1,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `expense_categories`;
CREATE TABLE `expense_categories` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `kind` VARCHAR(10) NOT NULL DEFAULT 'EXPENSE',
  `direct` TINYINT(1) DEFAULT 1,
  `active` TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `gift_vouchers`;
CREATE TABLE `gift_vouchers` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `voucher_no` VARCHAR(50) NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `customer_id` BIGINT,
  `customer_name` VARCHAR(100),
  `issued_at` DATE DEFAULT (CURRENT_DATE),
  `expires_at` DATE,
  `status` VARCHAR(20) DEFAULT 'ACTIVE',
  `redeemed_invoice_id` BIGINT,
  `created_by` VARCHAR(50),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `income_expenses`;
CREATE TABLE `income_expenses` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `serial_no` VARCHAR(50) NOT NULL,
  `txn_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `kind` VARCHAR(10) NOT NULL,
  `category_id` BIGINT,
  `description` VARCHAR(250),
  `vendor_name` VARCHAR(100),
  `amount` DECIMAL(14,2) NOT NULL,
  `pay_mode` VARCHAR(20) DEFAULT 'CASH',
  `reference` VARCHAR(100),
  `bank_id` BIGINT,
  `remark` LONGTEXT,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `invoice_items`;
CREATE TABLE `invoice_items` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `invoice_id` BIGINT NOT NULL,
  `line_no` INT NOT NULL,
  `item_id` BIGINT,
  `batch_id` BIGINT,
  `item_code` VARCHAR(30),
  `item_name` VARCHAR(200),
  `unit` VARCHAR(10),
  `qty` DECIMAL(14,3) NOT NULL,
  `cost_price` DECIMAL(14,4) DEFAULT 0,
  `selling_price` DECIMAL(14,4) DEFAULT 0,
  `unit_price` DECIMAL(14,4) DEFAULT 0,
  `discount` DECIMAL(14,2) DEFAULT 0,
  `line_total` DECIMAL(14,2) DEFAULT 0,
  `price_type` VARCHAR(20) DEFAULT 'RETAIL',
  `warranty` VARCHAR(50),
  `serial_nos` LONGTEXT,
  `remark` VARCHAR(250),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `invoice_payments`;
CREATE TABLE `invoice_payments` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `invoice_id` BIGINT NOT NULL,
  `pay_type` VARCHAR(20) NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `reference` VARCHAR(100),
  `bank_id` BIGINT,
  `card_type` VARCHAR(20),
  `card_no` VARCHAR(30),
  `cheque_no` VARCHAR(50),
  `cheque_date` DATE,
  `cheque_bank` VARCHAR(80),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `invoices`;
CREATE TABLE `invoices` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `terminal_id` BIGINT,
  `serial_no` VARCHAR(50) NOT NULL,
  `invoice_no` VARCHAR(50),
  `invoice_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `invoice_time` TIME NOT NULL DEFAULT (CURRENT_TIME),
  `inv_mode` VARCHAR(10) NOT NULL DEFAULT 'INV',
  `customer_id` BIGINT,
  `customer_name` VARCHAR(100) DEFAULT 'CASH CUSTOMER',
  `customer_mobile` VARCHAR(50),
  `salesman_id` BIGINT,
  `pay_mode` VARCHAR(20) DEFAULT 'CASH',
  `invoice_status` VARCHAR(20) DEFAULT 'PRINTED',
  `order_status` VARCHAR(20) DEFAULT 'PAID',
  `order_type` VARCHAR(20) DEFAULT 'COUNTER',
  `table_no` VARCHAR(10),
  `delivery_address` VARCHAR(250),
  `gross_total` DECIMAL(14,2) DEFAULT 0,
  `item_discount` DECIMAL(14,2) DEFAULT 0,
  `bill_discount` DECIMAL(14,2) DEFAULT 0,
  `extra_charges` DECIMAL(14,2) DEFAULT 0,
  `net_total` DECIMAL(14,2) DEFAULT 0,
  `cost_total` DECIMAL(14,2) DEFAULT 0,
  `profit` DECIMAL(14,2) DEFAULT 0,
  `total_qty` DECIMAL(14,3) DEFAULT 0,
  `total_lines` INT DEFAULT 0,
  `cash_paid` DECIMAL(14,2) DEFAULT 0,
  `card_paid` DECIMAL(14,2) DEFAULT 0,
  `cheque_paid` DECIMAL(14,2) DEFAULT 0,
  `bank_paid` DECIMAL(14,2) DEFAULT 0,
  `credit_paid` DECIMAL(14,2) DEFAULT 0,
  `voucher_paid` DECIMAL(14,2) DEFAULT 0,
  `points_redeemed` DECIMAL(14,2) DEFAULT 0,
  `points_earned` DECIMAL(14,2) DEFAULT 0,
  `total_paid` DECIMAL(14,2) DEFAULT 0,
  `balance_amount` DECIMAL(14,2) DEFAULT 0,
  `due_amount` DECIMAL(14,2) DEFAULT 0,
  `due_date` DATE,
  `remark` LONGTEXT,
  `shift_id` BIGINT,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `cancelled_by` VARCHAR(50),
  `cancelled_at` DATETIME,
  `cancel_reason` LONGTEXT,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `item_ledger`;
CREATE TABLE `item_ledger` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `item_id` BIGINT NOT NULL,
  `batch_id` BIGINT,
  `txn_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `txn_type` VARCHAR(10) NOT NULL,
  `ref_no` VARCHAR(50),
  `qty_in` DECIMAL(14,3) DEFAULT 0,
  `qty_out` DECIMAL(14,3) DEFAULT 0,
  `balance` DECIMAL(14,3) DEFAULT 0,
  `cost_price` DECIMAL(14,4) DEFAULT 0,
  `selling_price` DECIMAL(14,4) DEFAULT 0,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `items`;
CREATE TABLE `items` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `barcode` VARCHAR(30),
  `barcode1` VARCHAR(30),
  `barcode2` VARCHAR(30),
  `name` VARCHAR(200) NOT NULL,
  `name2` VARCHAR(200),
  `item_type` VARCHAR(20) DEFAULT 'STOCK',
  `unit` VARCHAR(10) DEFAULT 'PCS',
  `category_id` BIGINT,
  `sub_category_id` BIGINT,
  `supplier_id` BIGINT,
  `part_no` VARCHAR(50),
  `make` VARCHAR(50),
  `bin_no` VARCHAR(50),
  `allow_decimal` TINYINT(1) DEFAULT 0,
  `track_inventory` TINYINT(1) DEFAULT 1,
  `allow_discount` TINYINT(1) DEFAULT 1,
  `allow_wholesale` TINYINT(1) DEFAULT 1,
  `allow_loyalty` TINYINT(1) DEFAULT 1,
  `allow_edit_price_on_invoice` TINYINT(1) DEFAULT 0,
  `ask_serial_on_invoice` TINYINT(1) DEFAULT 0,
  `warranty_months` INT DEFAULT 0,
  `remind_reorder` TINYINT(1) DEFAULT 1,
  `remind_expiry` TINYINT(1) DEFAULT 0,
  `remark` LONGTEXT,
  `image_url` LONGTEXT,
  `show_on_web` TINYINT(1) DEFAULT 0,
  `active` TINYINT(1) DEFAULT 1,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `locations`;
CREATE TABLE `locations` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `code` VARCHAR(10) NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `address` VARCHAR(150),
  `manager_name` VARCHAR(50),
  `phone` VARCHAR(50),
  `mobile` VARCHAR(50),
  `active` TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `login_requests`;
CREATE TABLE `login_requests` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `kind` CHAR(1) NOT NULL,
  `owner` INT NOT NULL,
  `asked_by` VARCHAR(80),
  `name` VARCHAR(80) NOT NULL,
  `role` VARCHAR(40),
  `phone` VARCHAR(20),
  `note` VARCHAR(300),
  `status` VARCHAR(12) NOT NULL DEFAULT 'waiting',
  `decided_by` VARCHAR(80),
  `decided_at` DATETIME,
  `reason` VARCHAR(300),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `loyalty_transactions`;
CREATE TABLE `loyalty_transactions` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `customer_id` BIGINT NOT NULL,
  `invoice_id` BIGINT,
  `txn_type` VARCHAR(10) NOT NULL,
  `points` DECIMAL(12,2) NOT NULL,
  `remark` VARCHAR(250),
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `print_helper`;
CREATE TABLE `print_helper` (
  `one` TINYINT(1) NOT NULL DEFAULT 1,
  `seen_at` DATETIME,
  `printers` JSON,
  PRIMARY KEY (`one`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `print_jobs`;
CREATE TABLE `print_jobs` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `format` VARCHAR(10) NOT NULL,
  `no` VARCHAR(40),
  `copies` SMALLINT NOT NULL DEFAULT 1,
  `html` LONGTEXT NOT NULL,
  `by_user` VARCHAR(80),
  `from_till` VARCHAR(20),
  `status` VARCHAR(10) NOT NULL DEFAULT 'waiting',
  `printer` VARCHAR(120),
  `error` LONGTEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `taken_at` DATETIME,
  `done_at` DATETIME,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `purchase_items`;
CREATE TABLE `purchase_items` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `purchase_id` BIGINT NOT NULL,
  `line_no` INT NOT NULL,
  `item_id` BIGINT,
  `batch_id` BIGINT,
  `item_code` VARCHAR(30),
  `item_name` VARCHAR(200),
  `unit` VARCHAR(10),
  `qty` DECIMAL(14,3) NOT NULL,
  `free_qty` DECIMAL(14,3) DEFAULT 0,
  `cost_price` DECIMAL(14,4) DEFAULT 0,
  `selling_price` DECIMAL(14,4) DEFAULT 0,
  `wholesale_price` DECIMAL(14,4) DEFAULT 0,
  `mrp` DECIMAL(14,4) DEFAULT 0,
  `discount` DECIMAL(14,2) DEFAULT 0,
  `line_total` DECIMAL(14,2) DEFAULT 0,
  `expiry_date` DATE,
  `warranty_months` INT DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `purchase_order_items`;
CREATE TABLE `purchase_order_items` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `po_id` BIGINT NOT NULL,
  `line_no` INT NOT NULL,
  `item_id` BIGINT,
  `item_code` VARCHAR(30),
  `item_name` VARCHAR(200),
  `qty` DECIMAL(14,3) NOT NULL,
  `cost_price` DECIMAL(14,4) DEFAULT 0,
  `line_total` DECIMAL(14,2) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `purchase_orders`;
CREATE TABLE `purchase_orders` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `serial_no` VARCHAR(50) NOT NULL,
  `po_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `supplier_id` BIGINT,
  `supplier_name` VARCHAR(100),
  `status` VARCHAR(20) DEFAULT 'OPEN',
  `expected_date` DATE,
  `net_total` DECIMAL(14,2) DEFAULT 0,
  `total_qty` DECIMAL(14,3) DEFAULT 0,
  `remark` LONGTEXT,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `purchases`;
CREATE TABLE `purchases` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `serial_no` VARCHAR(50) NOT NULL,
  `invoice_no` VARCHAR(50),
  `purchase_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `inv_mode` VARCHAR(10) NOT NULL DEFAULT 'PCH',
  `supplier_id` BIGINT,
  `supplier_name` VARCHAR(100),
  `pay_mode` VARCHAR(20) DEFAULT 'CREDIT',
  `invoice_status` VARCHAR(20) DEFAULT 'PRINTED',
  `order_status` VARCHAR(20) DEFAULT 'UNPAID',
  `gross_total` DECIMAL(14,2) DEFAULT 0,
  `item_discount` DECIMAL(14,2) DEFAULT 0,
  `bill_discount` DECIMAL(14,2) DEFAULT 0,
  `extra_charges` DECIMAL(14,2) DEFAULT 0,
  `net_total` DECIMAL(14,2) DEFAULT 0,
  `total_qty` DECIMAL(14,3) DEFAULT 0,
  `paid_amount` DECIMAL(14,2) DEFAULT 0,
  `due_amount` DECIMAL(14,2) DEFAULT 0,
  `due_date` DATE,
  `remark` LONGTEXT,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `cancelled_by` VARCHAR(50),
  `cancelled_at` DATETIME,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `quotation_items`;
CREATE TABLE `quotation_items` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `quotation_id` BIGINT NOT NULL,
  `line_no` INT NOT NULL,
  `item_id` BIGINT,
  `item_code` VARCHAR(30),
  `item_name` VARCHAR(200),
  `qty` DECIMAL(14,3) NOT NULL,
  `unit_price` DECIMAL(14,4) DEFAULT 0,
  `discount` DECIMAL(14,2) DEFAULT 0,
  `line_total` DECIMAL(14,2) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `quotations`;
CREATE TABLE `quotations` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `serial_no` VARCHAR(50) NOT NULL,
  `quot_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `valid_till` DATE,
  `customer_id` BIGINT,
  `customer_name` VARCHAR(100),
  `status` VARCHAR(20) DEFAULT 'OPEN',
  `gross_total` DECIMAL(14,2) DEFAULT 0,
  `discount` DECIMAL(14,2) DEFAULT 0,
  `net_total` DECIMAL(14,2) DEFAULT 0,
  `remark` LONGTEXT,
  `converted_invoice_id` BIGINT,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `sequences`;
CREATE TABLE `sequences` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL DEFAULT 0,
  `key` VARCHAR(20) NOT NULL,
  `prefix` VARCHAR(20) NOT NULL DEFAULT '',
  `next_no` BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `settings`;
CREATE TABLE `settings` (
  `company_id` BIGINT NOT NULL,
  `key` VARCHAR(50) NOT NULL,
  `value` JSON,
  PRIMARY KEY (`company_id`, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `shift_photos`;
CREATE TABLE `shift_photos` (
  `id` VARCHAR(40) NOT NULL,
  `day` DATE NOT NULL,
  `mime` VARCHAR(40) NOT NULL,
  `data` LONGBLOB NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `shift_users`;
CREATE TABLE `shift_users` (
  `username` VARCHAR(50) NOT NULL,
  `password_hash` LONGTEXT NOT NULL,
  `role` VARCHAR(20) NOT NULL DEFAULT 'supervisor',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `shifts`;
CREATE TABLE `shifts` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `terminal_id` BIGINT,
  `shift_no` VARCHAR(20) NOT NULL,
  `opened_by` VARCHAR(50),
  `opened_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `opening_cash` DECIMAL(14,2) DEFAULT 0,
  `opening_denoms` JSON,
  `closed_by` VARCHAR(50),
  `closed_at` DATETIME,
  `closing_cash` DECIMAL(14,2),
  `closing_denoms` JSON,
  `expected_cash` DECIMAL(14,2),
  `variance` DECIMAL(14,2),
  `status` VARCHAR(10) DEFAULT 'OPEN',
  `remark` LONGTEXT,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `shop_media`;
CREATE TABLE `shop_media` (
  `key` VARCHAR(80) NOT NULL,
  `mime` VARCHAR(40) NOT NULL,
  `data` LONGBLOB NOT NULL,
  `link` VARCHAR(300),
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `shop_orders`;
CREATE TABLE `shop_orders` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `no` VARCHAR(20) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `data` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `imported_at` DATETIME,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `sms_outbox`;
CREATE TABLE `sms_outbox` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `mobile` VARCHAR(50) NOT NULL,
  `message` LONGTEXT NOT NULL,
  `status` VARCHAR(20) DEFAULT 'PENDING',
  `attempts` INT DEFAULT 0,
  `last_error` LONGTEXT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `sent_at` DATETIME,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `sms_settings`;
CREATE TABLE `sms_settings` (
  `company_id` BIGINT NOT NULL,
  `api_url` LONGTEXT,
  `api_key` LONGTEXT,
  `sender_id` VARCHAR(20),
  `owner_mobile` VARCHAR(50),
  `templates` JSON,
  `flags` JSON,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `stock_adjustment_items`;
CREATE TABLE `stock_adjustment_items` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `adjustment_id` BIGINT NOT NULL,
  `item_id` BIGINT NOT NULL,
  `batch_id` BIGINT,
  `item_code` VARCHAR(30),
  `item_name` VARCHAR(200),
  `qty` DECIMAL(14,3) NOT NULL,
  `cost_price` DECIMAL(14,4) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `stock_adjustments`;
CREATE TABLE `stock_adjustments` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `serial_no` VARCHAR(50) NOT NULL,
  `adj_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `adj_type` VARCHAR(20) NOT NULL,
  `reason` VARCHAR(250),
  `total_qty` DECIMAL(14,3) DEFAULT 0,
  `total_cost` DECIMAL(14,2) DEFAULT 0,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `stock_batches`;
CREATE TABLE `stock_batches` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `item_id` BIGINT NOT NULL,
  `batch_no` VARCHAR(30) NOT NULL DEFAULT '1',
  `cost_price` DECIMAL(14,4) DEFAULT 0,
  `selling_price` DECIMAL(14,4) DEFAULT 0,
  `discount_price` DECIMAL(14,4) DEFAULT 0,
  `wholesale_price` DECIMAL(14,4) DEFAULT 0,
  `mrp` DECIMAL(14,4) DEFAULT 0,
  `offer_price` DECIMAL(14,4) DEFAULT 0,
  `cus_cat_price` JSON,
  `qty_received` DECIMAL(14,3) DEFAULT 0,
  `qty_remain` DECIMAL(14,3) DEFAULT 0,
  `qty_sold` DECIMAL(14,3) DEFAULT 0,
  `qty_min` DECIMAL(14,3) DEFAULT 0,
  `qty_max` DECIMAL(14,3) DEFAULT 0,
  `free_qty` DECIMAL(14,3) DEFAULT 0,
  `damage_qty` DECIMAL(14,3) DEFAULT 0,
  `expired_qty` DECIMAL(14,3) DEFAULT 0,
  `expiry_date` DATE,
  `warranty_months` INT DEFAULT 0,
  `avg_cost` DECIMAL(14,4) DEFAULT 0,
  `last_purchase_date` DATE,
  `last_purchase_price` DECIMAL(14,4),
  `last_sale_date` DATE,
  `last_sale_price` DECIMAL(14,4),
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `stock_transfer_items`;
CREATE TABLE `stock_transfer_items` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `transfer_id` BIGINT NOT NULL,
  `item_id` BIGINT NOT NULL,
  `from_batch_id` BIGINT,
  `item_code` VARCHAR(30),
  `item_name` VARCHAR(200),
  `qty` DECIMAL(14,3) NOT NULL,
  `cost_price` DECIMAL(14,4) DEFAULT 0,
  `selling_price` DECIMAL(14,4) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `stock_transfers`;
CREATE TABLE `stock_transfers` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `serial_no` VARCHAR(50) NOT NULL,
  `transfer_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `from_location_id` BIGINT NOT NULL,
  `to_location_id` BIGINT NOT NULL,
  `status` VARCHAR(20) DEFAULT 'SENT',
  `total_qty` DECIMAL(14,3) DEFAULT 0,
  `remark` LONGTEXT,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `received_by` VARCHAR(50),
  `received_at` DATETIME,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `sub_categories`;
CREATE TABLE `sub_categories` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `category_id` BIGINT NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `remark` LONGTEXT,
  `active` TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `sup_inbox`;
CREATE TABLE `sup_inbox` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `sid` INT NOT NULL,
  `kind` VARCHAR(12) NOT NULL,
  `data` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `imported_at` DATETIME,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `sup_logins`;
CREATE TABLE `sup_logins` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `owner` INT NOT NULL,
  `username` VARCHAR(40) NOT NULL,
  `name` VARCHAR(80),
  `role` VARCHAR(40),
  `phone` VARCHAR(20),
  `admin_hash` LONGTEXT,
  `own_hash` LONGTEXT,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_seen` DATETIME,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `starter` VARCHAR(40),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `sup_media`;
CREATE TABLE `sup_media` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `inbox_id` BIGINT NOT NULL,
  `mime` VARCHAR(40) NOT NULL,
  `data` LONGBLOB NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `supplier_payment_allocations`;
CREATE TABLE `supplier_payment_allocations` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `payment_id` BIGINT NOT NULL,
  `purchase_id` BIGINT NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `supplier_payments`;
CREATE TABLE `supplier_payments` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `serial_no` VARCHAR(50) NOT NULL,
  `pay_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
  `supplier_id` BIGINT NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `pay_type` VARCHAR(20) DEFAULT 'CASH',
  `reference` VARCHAR(100),
  `bank_id` BIGINT,
  `cheque_no` VARCHAR(50),
  `cheque_date` DATE,
  `entry_type` VARCHAR(20) DEFAULT 'PAYMENT',
  `remark` LONGTEXT,
  `created_by` VARCHAR(50),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `suppliers`;
CREATE TABLE `suppliers` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(50),
  `mobile` VARCHAR(50),
  `email` VARCHAR(100),
  `website` VARCHAR(100),
  `address` VARCHAR(250),
  `contact_person` VARCHAR(80),
  `contact_mobile` VARCHAR(50),
  `sup_group` VARCHAR(50),
  `remark` LONGTEXT,
  `opening_balance` DECIMAL(14,2) DEFAULT 0,
  `due_amount` DECIMAL(14,2) DEFAULT 0,
  `advance_amount` DECIMAL(14,2) DEFAULT 0,
  `active` TINYINT(1) DEFAULT 1,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `terminals`;
CREATE TABLE `terminals` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `location_id` BIGINT NOT NULL,
  `code` VARCHAR(20) NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `registered_pc` VARCHAR(100),
  `active` TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `location_id` BIGINT,
  `code` VARCHAR(30),
  `name` VARCHAR(80) NOT NULL,
  `username` VARCHAR(50) NOT NULL,
  `password_hash` LONGTEXT NOT NULL,
  `pin` VARCHAR(30),
  `role` VARCHAR(20) NOT NULL DEFAULT 'CASHIER',
  `permissions` JSON NOT NULL,
  `active` TINYINT(1) DEFAULT 1,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `last_login_at` DATETIME,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `wa_inbox`;
CREATE TABLE `wa_inbox` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `wa_id` VARCHAR(80),
  `from_no` VARCHAR(20) NOT NULL,
  `name` VARCHAR(120),
  `body` LONGTEXT,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'text',
  `at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `read_at` DATETIME,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
DROP TABLE IF EXISTS `wa_status`;
CREATE TABLE `wa_status` (
  `msg_id` VARCHAR(80) NOT NULL,
  `status` VARCHAR(20),
  `at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`msg_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE UNIQUE INDEX `companies_code_key` ON `companies` (`code`);
CREATE UNIQUE INDEX `locations_company_id_code_key` ON `locations` (`company_id`, `code`);
CREATE UNIQUE INDEX `terminals_location_id_code_key` ON `terminals` (`location_id`, `code`);
CREATE UNIQUE INDEX `users_username_key` ON `users` (`username`);
CREATE UNIQUE INDEX `categories_company_id_code_key` ON `categories` (`company_id`, `code`);
CREATE UNIQUE INDEX `sub_categories_company_id_code_key` ON `sub_categories` (`company_id`, `code`);
CREATE UNIQUE INDEX `suppliers_company_id_code_key` ON `suppliers` (`company_id`, `code`);
CREATE UNIQUE INDEX `customers_company_id_code_key` ON `customers` (`company_id`, `code`);
CREATE UNIQUE INDEX `employees_company_id_code_key` ON `employees` (`company_id`, `code`);
CREATE UNIQUE INDEX `items_company_id_code_key` ON `items` (`company_id`, `code`);
CREATE INDEX `idx_items_barcode` ON `items` (`company_id`, `barcode`);
-- skipped (expression index): idx_items_name
CREATE UNIQUE INDEX `stock_batches_location_id_item_id_batch_no_key` ON `stock_batches` (`location_id`, `item_id`, `batch_no`);
CREATE INDEX `idx_stock_item` ON `stock_batches` (`item_id`, `location_id`);
CREATE INDEX `idx_ledger_item` ON `item_ledger` (`item_id`, `txn_date`);
CREATE UNIQUE INDEX `sequences_company_id_location_id_key_key` ON `sequences` (`company_id`, `location_id`, `key`);
CREATE UNIQUE INDEX `invoices_serial_no_key` ON `invoices` (`serial_no`);
CREATE INDEX `idx_inv_date` ON `invoices` (`company_id`, `invoice_date`);
CREATE INDEX `idx_inv_cus` ON `invoices` (`customer_id`);
CREATE UNIQUE INDEX `purchases_serial_no_key` ON `purchases` (`serial_no`);
CREATE INDEX `idx_pch_date` ON `purchases` (`company_id`, `purchase_date`);
CREATE UNIQUE INDEX `purchase_orders_serial_no_key` ON `purchase_orders` (`serial_no`);
CREATE UNIQUE INDEX `quotations_serial_no_key` ON `quotations` (`serial_no`);
CREATE UNIQUE INDEX `stock_adjustments_serial_no_key` ON `stock_adjustments` (`serial_no`);
CREATE UNIQUE INDEX `stock_transfers_serial_no_key` ON `stock_transfers` (`serial_no`);
CREATE UNIQUE INDEX `customer_payments_serial_no_key` ON `customer_payments` (`serial_no`);
CREATE UNIQUE INDEX `supplier_payments_serial_no_key` ON `supplier_payments` (`serial_no`);
CREATE UNIQUE INDEX `expense_categories_company_id_code_key` ON `expense_categories` (`company_id`, `code`);
CREATE UNIQUE INDEX `income_expenses_serial_no_key` ON `income_expenses` (`serial_no`);
CREATE UNIQUE INDEX `banks_company_id_code_key` ON `banks` (`company_id`, `code`);
CREATE UNIQUE INDEX `bank_transactions_serial_no_key` ON `bank_transactions` (`serial_no`);
CREATE UNIQUE INDEX `gift_vouchers_voucher_no_key` ON `gift_vouchers` (`voucher_no`);
CREATE INDEX `idx_activity_date` ON `activity_log` (`created_at`);
CREATE INDEX `idx_books_history` ON `books_history` (`key`, `rev`);
CREATE UNIQUE INDEX `shop_orders_no_key` ON `shop_orders` (`no`);
CREATE INDEX `shop_orders_phone` ON `shop_orders` (`phone`);
CREATE INDEX `shop_orders_pending` ON `shop_orders` (`imported_at`);   -- was partial: WHERE (imported_at IS NULL)
CREATE UNIQUE INDEX `wa_inbox_wa_id_key` ON `wa_inbox` (`wa_id`);
CREATE INDEX `sup_inbox_pending` ON `sup_inbox` (`imported_at`);   -- was partial: WHERE (imported_at IS NULL)
CREATE INDEX `idx_print_jobs_status` ON `print_jobs` (`status`, `id`);
CREATE INDEX `cust_inbox_pending` ON `cust_inbox` (`imported_at`);   -- was partial: WHERE (imported_at IS NULL)
-- skipped (expression index): cust_logins_user
-- skipped (expression index): sup_logins_user
CREATE INDEX `login_requests_waiting` ON `login_requests` (`kind`, `owner`);   -- was partial: WHERE ((status)::text = 'waiting'::text)
SET FOREIGN_KEY_CHECKS = 1;
