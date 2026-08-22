PRAGMA foreign_keys = ON;

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_id TEXT NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE parents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id),
  parent_id TEXT REFERENCES parents(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  nis TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  photo TEXT,
  class TEXT NOT NULL,
  room TEXT NOT NULL,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE parent_students (
  parent_id TEXT NOT NULL REFERENCES parents(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  relationship TEXT NOT NULL DEFAULT 'WALI',
  PRIMARY KEY (parent_id, student_id)
);

CREATE TABLE wallets (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE REFERENCES students(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER wallets_prevent_negative
BEFORE UPDATE OF balance ON wallets
WHEN NEW.balance < 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_BALANCE');
END;

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  card_number TEXT NOT NULL UNIQUE,
  student_id TEXT NOT NULL REFERENCES students(id),
  qr_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BLOCKED', 'LOST', 'REPLACED', 'EXPIRED')),
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expired_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES product_categories(id),
  price INTEGER NOT NULL CHECK (price >= 0),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  image TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL UNIQUE,
  student_id TEXT NOT NULL REFERENCES students(id),
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  type TEXT NOT NULL CHECK (type IN ('PURCHASE', 'TOPUP', 'REFUND', 'ADJUSTMENT', 'REVERSAL')),
  direction TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  merchant_id TEXT REFERENCES merchants(id),
  cashier_id TEXT REFERENCES users(id),
  device_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE transaction_items (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0)
);

CREATE TABLE wallet_ledger (
  id TEXT PRIMARY KEY,
  transaction_id TEXT REFERENCES transactions(id),
  reference_id TEXT NOT NULL UNIQUE,
  student_id TEXT NOT NULL REFERENCES students(id),
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  type TEXT NOT NULL CHECK (type IN ('TOPUP', 'PURCHASE', 'REFUND', 'ADJUSTMENT', 'REVERSAL')),
  direction TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'LOCAL' CHECK (scope IN ('CLOUD', 'LOCAL')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TRIGGER wallet_ledger_immutable_update BEFORE UPDATE ON wallet_ledger
BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER wallet_ledger_immutable_delete BEFORE DELETE ON wallet_ledger
BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER transactions_immutable_update BEFORE UPDATE ON transactions
BEGIN SELECT RAISE(ABORT, 'TRANSACTION_IMMUTABLE'); END;
CREATE TRIGGER transactions_immutable_delete BEFORE DELETE ON transactions
BEGIN SELECT RAISE(ABORT, 'TRANSACTION_IMMUTABLE'); END;

CREATE TABLE topups (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES parents(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_reference TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'PENDING_SYNC', 'SYNCED', 'FAILED', 'EXPIRED', 'CANCELLED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  synced_at TEXT
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  topup_id TEXT NOT NULL UNIQUE REFERENCES topups(id),
  provider TEXT NOT NULL,
  provider_reference TEXT UNIQUE,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  raw_payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  reference_id TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settlements (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  settlement_date TEXT NOT NULL,
  gross_amount INTEGER NOT NULL,
  fee INTEGER NOT NULL,
  net_amount INTEGER NOT NULL,
  bank_reference TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  merchant_id TEXT REFERENCES merchants(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  reference_id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);

CREATE TABLE sync_logs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES sync_queue(id),
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  device TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE branding_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  app_name TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  logo_url TEXT,
  favicon_url TEXT,
  primary_color TEXT NOT NULL,
  secondary_color TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_students_name ON students(name);
CREATE INDEX idx_students_class ON students(class);
CREATE INDEX idx_cards_student ON cards(student_id);
CREATE INDEX idx_ledger_wallet_created ON wallet_ledger(wallet_id, created_at DESC);
CREATE INDEX idx_transactions_student_created ON transactions(student_id, created_at DESC);
CREATE INDEX idx_transactions_merchant_created ON transactions(merchant_id, created_at DESC);
CREATE INDEX idx_topups_parent_created ON topups(parent_id, created_at DESC);
CREATE INDEX idx_sync_queue_status_created ON sync_queue(status, created_at);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

INSERT INTO roles (id, name) VALUES
  ('ROLE_SUPER_ADMIN', 'SUPER_ADMIN'), ('ROLE_ADMIN', 'ADMIN'), ('ROLE_CASHIER', 'CASHIER'),
  ('ROLE_TREASURER', 'TREASURER'), ('ROLE_PARENT', 'PARENT');

INSERT INTO permissions (id, name) VALUES
  ('PERM_ALL', '*'), ('PERM_STUDENTS', 'students.manage'), ('PERM_SALES', 'sales.create'),
  ('PERM_FINANCE', 'finance.manage'), ('PERM_PARENT', 'parent.self');
INSERT INTO role_permissions VALUES
  ('ROLE_SUPER_ADMIN', 'PERM_ALL'), ('ROLE_ADMIN', 'PERM_STUDENTS'), ('ROLE_CASHIER', 'PERM_SALES'),
  ('ROLE_TREASURER', 'PERM_FINANCE'), ('ROLE_PARENT', 'PERM_PARENT');

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20)
INSERT INTO parents (id, name, phone)
SELECT printf('PARENT%03d', i), CASE WHEN i = 1 THEN 'Bapak Ahmad' ELSE printf('Wali Santri %02d', i) END, printf('08120000%04d', i) FROM n;

INSERT INTO users (id, email, name, password_hash, password_salt, role_id, parent_id) VALUES
  ('USR_ADMIN', 'admin@prj.demo', 'Super Admin PRJ', '039e438e5f0a4c2371d9c9612cb848fd6fca1daf466bfc3dd142707cef7bcf29', 'a1b2c3d4e5f60708', 'ROLE_SUPER_ADMIN', NULL),
  ('USR_OPERATOR', 'operator@prj.demo', 'Operator PRJ', 'b10c4e8f1db5898f158edf70db55ec73f9351d60d13f601903649b7ac2a2ea4b', '1122334455667788', 'ROLE_ADMIN', NULL),
  ('USR_CASHIER', 'kasir@prj.demo', 'Kasir Utama', '58d4913210b7f8633283acbbf717da604d0f4024ea0bd349c4bc6c59c39b66af', '99aabbccddeeff00', 'ROLE_CASHIER', NULL),
  ('USR_TREASURER', 'bendahara@prj.demo', 'Bendahara PRJ', '65014bae656a18397f1b32994394d2561c2309e308b8e94ea582ed8ca1927ed7', '13579bdf2468ace0', 'ROLE_TREASURER', NULL),
  ('USR_PARENT', 'parent@prj.demo', 'Bapak Ahmad', '4735ffd2afaa5a6e48392e7f99f86f430026a19924a75dd650f0c9e534ce86f7', 'fedcba9876543210', 'ROLE_PARENT', 'PARENT001');

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300)
INSERT INTO students (id, nis, name, class, room, generation)
SELECT printf('STU%06d', i), printf('2026%04d', i), CASE WHEN i = 1 THEN 'Andi Pratama' ELSE printf('Santri PRJ %03d', i) END,
  printf('%d %s', ((i - 1) % 6) + 7, CASE WHEN i % 2 = 0 THEN 'A' ELSE 'B' END),
  printf('Kamar %02d', ((i - 1) % 30) + 1), 2026 FROM n;

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300)
INSERT INTO wallets (id, student_id, balance)
SELECT printf('WAL%06d', i), printf('STU%06d', i), CASE WHEN i = 1 THEN 75000 ELSE 25000 + (i % 8) * 10000 END FROM n;

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300)
INSERT INTO cards (id, card_number, student_id, qr_token)
SELECT printf('CARD%06d', i), printf('PRJ-%06d', i), printf('STU%06d', i), CASE WHEN i = 1 THEN 'PRJ-ANDI-001' ELSE printf('PRJ-CARD-%06d', i) END FROM n;

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20)
INSERT INTO parent_students (parent_id, student_id, relationship)
SELECT printf('PARENT%03d', i), printf('STU%06d', i), 'AYAH' FROM n;
INSERT INTO parent_students VALUES ('PARENT001', 'STU000021', 'AYAH');

INSERT INTO product_categories VALUES ('CAT_FOOD', 'Makanan'), ('CAT_DRINK', 'Minuman'), ('CAT_SNACK', 'Snack'), ('CAT_OTHER', 'Lainnya');
INSERT INTO merchants (id, name, location) VALUES
  ('MER001', 'Kantin Putra', 'Kompleks Putra'), ('MER002', 'Kantin Putri', 'Kompleks Putri'),
  ('MER003', 'Kantin Utama', 'Gedung Utama'), ('MER004', 'Koperasi Santri', 'Sebelah Masjid'), ('MER005', 'Kedai Sehat', 'Area Olahraga');

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 50)
INSERT INTO products (id, name, category_id, price, merchant_id)
SELECT printf('PROD%03d', i),
  CASE i WHEN 1 THEN 'Nasi Goreng' WHEN 2 THEN 'Es Teh' WHEN 3 THEN 'Roti Bakar' WHEN 4 THEN 'Air Mineral' ELSE printf('Produk Kantin %02d', i) END,
  CASE i % 4 WHEN 1 THEN 'CAT_FOOD' WHEN 2 THEN 'CAT_DRINK' WHEN 3 THEN 'CAT_SNACK' ELSE 'CAT_OTHER' END,
  CASE i WHEN 1 THEN 10000 WHEN 2 THEN 5000 ELSE 3000 + (i % 8) * 2500 END,
  CASE WHEN i IN (1, 2) THEN 'MER003' ELSE printf('MER%03d', ((i - 1) % 5) + 1) END FROM n;

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300)
INSERT INTO wallet_ledger (id, reference_id, student_id, wallet_id, amount, type, direction, status, source, created_at)
SELECT printf('LEDGER-OPEN-%06d', i), printf('OPENING-%06d', i), printf('STU%06d', i), printf('WAL%06d', i),
  (CASE WHEN i = 1 THEN 75000 ELSE 25000 + (i % 8) * 10000 END) + (CASE WHEN i BETWEEN 2 AND 13 THEN 5000 + (i % 4) * 2500 ELSE 0 END),
  'ADJUSTMENT', 'CREDIT', 'COMPLETED', 'DEMO_SEED', datetime('now', '-30 days') FROM n;

WITH RECURSIVE n(i) AS (SELECT 2 UNION ALL SELECT i + 1 FROM n WHERE i < 13)
INSERT INTO transactions (id, reference_id, student_id, wallet_id, amount, type, direction, status, source, merchant_id, cashier_id, device_id, created_at)
SELECT printf('TX-SEED-%06d', i), printf('TX-SEED-REF-%06d', i), printf('STU%06d', i), printf('WAL%06d', i),
  5000 + (i % 4) * 2500, 'PURCHASE', 'DEBIT', 'COMPLETED', 'LOCAL_POS', printf('MER%03d', ((i - 1) % 5) + 1), 'USR_CASHIER', 'DEMO-POS-01', datetime('now', printf('-%d hours', i - 1)) FROM n;

WITH RECURSIVE n(i) AS (SELECT 2 UNION ALL SELECT i + 1 FROM n WHERE i < 13)
INSERT INTO wallet_ledger (id, transaction_id, reference_id, student_id, wallet_id, amount, type, direction, status, source, created_at)
SELECT printf('LEDGER-TX-%06d', i), printf('TX-SEED-%06d', i), printf('TX-SEED-REF-%06d', i), printf('STU%06d', i), printf('WAL%06d', i),
  5000 + (i % 4) * 2500, 'PURCHASE', 'DEBIT', 'COMPLETED', 'LOCAL_POS', datetime('now', printf('-%d hours', i - 1)) FROM n;

WITH RECURSIVE n(i) AS (SELECT 2 UNION ALL SELECT i + 1 FROM n WHERE i < 13)
INSERT INTO transaction_items (id, transaction_id, product_id, product_name, quantity, unit_price, subtotal)
SELECT printf('ITEM-SEED-%06d', i), printf('TX-SEED-%06d', i), printf('PROD%03d', ((i - 1) % 4) + 1),
  CASE ((i - 1) % 4) + 1 WHEN 1 THEN 'Nasi Goreng' WHEN 2 THEN 'Es Teh' WHEN 3 THEN 'Roti Bakar' ELSE 'Air Mineral' END,
  1, 5000 + (i % 4) * 2500, 5000 + (i % 4) * 2500 FROM n;

INSERT INTO branding_settings (id, app_name, organization_name, tagline, primary_color, secondary_color)
VALUES (1, 'PRJ SmartPay', 'Pondok Raudhatul Jannah', 'Satu Kartu. Satu Saldo. Semua Transaksi.', '#0f766e', '#14b8a6');

INSERT INTO app_settings (key, value) VALUES
  ('theme', 'system'), ('minimum_topup', '10000'), ('maximum_topup', '1000000'),
  ('daily_spending_limit', '100000'), ('transaction_limit', '50000'), ('low_balance_warning', '20000'),
  ('limits_enabled', 'false'), ('operating_hours_enabled', 'false'), ('operating_hours_start', '06:00'),
  ('operating_hours_end', '21:00'), ('payment_provider', 'demo');
