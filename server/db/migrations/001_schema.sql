-- =====================================================================
-- EL CHUPE — POS Cafe Bar
-- Migracion 001: esquema completo
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Seguridad: roles, permisos, usuarios
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  is_system     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  module        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id         INTEGER NOT NULL REFERENCES roles(id),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  document        TEXT,
  phone           TEXT,
  pin             TEXT,
  password_hash   TEXT NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  ip          TEXT,
  success     INTEGER NOT NULL DEFAULT 0,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(email, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  user_name     TEXT,
  action        TEXT NOT NULL,
  entity        TEXT NOT NULL,
  entity_id     INTEGER,
  description   TEXT,
  old_value     TEXT,
  new_value     TEXT,
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

-- ---------------------------------------------------------------------
-- Configuracion del negocio
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  name            TEXT NOT NULL DEFAULT 'EL CHUPE',
  legal_name      TEXT,
  nit             TEXT,
  phone           TEXT,
  address         TEXT,
  city            TEXT DEFAULT 'Bogota',
  email           TEXT,
  logo_path       TEXT DEFAULT '/assets/logo.png',
  currency        TEXT NOT NULL DEFAULT 'COP',
  currency_symbol TEXT NOT NULL DEFAULT '$',
  decimals        INTEGER NOT NULL DEFAULT 0,
  timezone        TEXT NOT NULL DEFAULT 'America/Bogota',
  default_tax_id  INTEGER,
  prices_include_tax INTEGER NOT NULL DEFAULT 1,
  service_charge_pct REAL NOT NULL DEFAULT 0,
  ticket_width    TEXT NOT NULL DEFAULT '80mm',
  ticket_footer   TEXT DEFAULT 'Gracias por visitarnos',
  allow_negative_stock INTEGER NOT NULL DEFAULT 0,
  waiter_discount_limit REAL NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS taxes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  rate        REAL NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  code          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL DEFAULT 'other', -- cash | card | transfer | other
  affects_cash  INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- Zonas y mesas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tables (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id     INTEGER NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  seats       INTEGER NOT NULL DEFAULT 4,
  status      TEXT NOT NULL DEFAULT 'available'
              CHECK (status IN ('available','occupied','bill_requested','reserved')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tables_zone ON tables(zone_id);

-- ---------------------------------------------------------------------
-- Catalogo
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  color       TEXT DEFAULT '#B8873D',
  station     TEXT NOT NULL DEFAULT 'bar' CHECK (station IN ('bar','kitchen','none')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  company     TEXT,
  document    TEXT,
  phone       TEXT,
  whatsapp    TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  barcode         TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id     INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  image_path      TEXT,
  type            TEXT NOT NULL DEFAULT 'simple'
                  CHECK (type IN ('simple','recipe','supply')),
  -- simple : se vende y descuenta su propio stock
  -- recipe : se vende y descuenta los ingredientes de su receta
  -- supply : insumo, no se vende directamente
  cost            REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
  price           REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
  tax_id          INTEGER REFERENCES taxes(id) ON DELETE SET NULL,
  unit            TEXT NOT NULL DEFAULT 'und',
  stock           REAL NOT NULL DEFAULT 0,
  min_stock       REAL NOT NULL DEFAULT 0,
  track_stock     INTEGER NOT NULL DEFAULT 1,
  station         TEXT CHECK (station IN ('bar','kitchen','none')),
  is_favorite     INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active, type);

CREATE TABLE IF NOT EXISTS recipe_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity      REAL NOT NULL CHECK (quantity > 0),
  UNIQUE (product_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_recipe_product ON recipe_items(product_id);

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  document    TEXT,
  phone       TEXT,
  email       TEXT,
  birthdate   TEXT,
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- ---------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_registers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_by         INTEGER NOT NULL REFERENCES users(id),
  closed_by         INTEGER REFERENCES users(id),
  opening_amount    REAL NOT NULL DEFAULT 0,
  counted_amount    REAL,
  expected_amount   REAL,
  difference        REAL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  notes             TEXT,
  opened_at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_status ON cash_registers(status);

CREATE TABLE IF NOT EXISTS cash_movements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_register_id  INTEGER NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  type              TEXT NOT NULL CHECK (type IN ('sale','income','withdrawal','expense','refund')),
  amount            REAL NOT NULL,
  concept           TEXT,
  reference_type    TEXT,
  reference_id      INTEGER,
  payment_method_id INTEGER REFERENCES payment_methods(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cashmov_reg ON cash_movements(cash_register_id);

-- ---------------------------------------------------------------------
-- Ordenes / ventas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  number            INTEGER NOT NULL UNIQUE,
  table_id          INTEGER REFERENCES tables(id) ON DELETE SET NULL,
  waiter_id         INTEGER REFERENCES users(id),
  customer_id       INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  cash_register_id  INTEGER REFERENCES cash_registers(id),
  type              TEXT NOT NULL DEFAULT 'table' CHECK (type IN ('table','counter','takeaway')),
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','bill_requested','paid','void')),
  guests            INTEGER NOT NULL DEFAULT 1,
  subtotal          REAL NOT NULL DEFAULT 0,
  discount_type     TEXT CHECK (discount_type IN ('percent','amount','courtesy')),
  discount_value    REAL NOT NULL DEFAULT 0,
  discount_amount   REAL NOT NULL DEFAULT 0,
  discount_reason   TEXT,
  discount_by       INTEGER REFERENCES users(id),
  tax_amount        REAL NOT NULL DEFAULT 0,
  service_amount    REAL NOT NULL DEFAULT 0,
  total             REAL NOT NULL DEFAULT 0,
  paid_amount       REAL NOT NULL DEFAULT 0,
  notes             TEXT,
  void_reason       TEXT,
  voided_by         INTEGER REFERENCES users(id),
  voided_at         TEXT,
  opened_at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_closed ON orders(closed_at);
CREATE INDEX IF NOT EXISTS idx_orders_waiter ON orders(waiter_id);

CREATE TABLE IF NOT EXISTS order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  product_name  TEXT NOT NULL,
  station       TEXT NOT NULL DEFAULT 'bar',
  quantity      REAL NOT NULL CHECK (quantity > 0),
  unit_price    REAL NOT NULL CHECK (unit_price >= 0),
  unit_cost     REAL NOT NULL DEFAULT 0,
  tax_rate      REAL NOT NULL DEFAULT 0,
  discount      REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  notes         TEXT,
  kds_status    TEXT NOT NULL DEFAULT 'pending'
                CHECK (kds_status IN ('pending','preparing','ready','delivered')),
  sent_at       TEXT,
  paid_split    INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_kds ON order_items(kds_status, station);

CREATE TABLE IF NOT EXISTS payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id),
  cash_register_id  INTEGER REFERENCES cash_registers(id),
  amount            REAL NOT NULL CHECK (amount > 0),
  received          REAL,
  change_given      REAL NOT NULL DEFAULT 0,
  reference         TEXT,
  user_id           INTEGER REFERENCES users(id),
  is_void           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);

-- ---------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN
                ('purchase','sale','adjustment','loss','damage','internal','return','initial','void_return')),
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  quantity      REAL NOT NULL CHECK (quantity > 0),
  balance       REAL NOT NULL,
  unit_cost     REAL NOT NULL DEFAULT 0,
  reason        TEXT,
  reference_type TEXT,
  reference_id  INTEGER,
  user_id       INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_invmov_product ON inventory_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invmov_created ON inventory_movements(created_at);

-- ---------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id       INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  invoice_number    TEXT,
  payment_method_id INTEGER REFERENCES payment_methods(id),
  subtotal          REAL NOT NULL DEFAULT 0,
  tax_amount        REAL NOT NULL DEFAULT 0,
  total             REAL NOT NULL DEFAULT 0,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','void')),
  user_id           INTEGER REFERENCES users(id),
  purchase_date     TEXT NOT NULL DEFAULT (date('now','localtime')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  quantity    REAL NOT NULL CHECK (quantity > 0),
  unit_cost   REAL NOT NULL CHECK (unit_cost >= 0),
  tax_rate    REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchitems ON purchase_items(purchase_id);

-- ---------------------------------------------------------------------
-- Gastos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS expenses (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_category_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
  description         TEXT NOT NULL,
  amount              REAL NOT NULL CHECK (amount > 0),
  payment_method_id   INTEGER REFERENCES payment_methods(id),
  cash_register_id    INTEGER REFERENCES cash_registers(id),
  receipt_path        TEXT,
  user_id             INTEGER REFERENCES users(id),
  expense_date        TEXT NOT NULL DEFAULT (date('now','localtime')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

-- ---------------------------------------------------------------------
-- Contadores (numeracion de ventas)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS counters (
  name    TEXT PRIMARY KEY,
  value   INTEGER NOT NULL DEFAULT 0
);
