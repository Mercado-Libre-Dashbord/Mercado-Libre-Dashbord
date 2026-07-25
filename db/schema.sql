CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_email TEXT NOT NULL UNIQUE,
  ml_seller_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  sku TEXT,
  current_price REAL,
  stock INTEGER,
  permalink TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE IF NOT EXISTS product_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  product_id TEXT NOT NULL,
  cost REAL NOT NULL,
  valid_from TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  id TEXT NOT NULL,
  date_created TEXT NOT NULL,
  status TEXT NOT NULL,
  buyer_total REAL,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  ml_commission REAL NOT NULL,
  shipping_cost REAL NOT NULL,
  ads_cost_allocated REAL NOT NULL DEFAULT 0,
  cost_applied REAL,
  net_profit REAL
);

CREATE TABLE IF NOT EXISTS ads_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  product_id TEXT,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  channel TEXT NOT NULL DEFAULT 'mercado_ads'
);
-- channel: 'mercado_ads' (por producto, sincronizado automático) |
-- 'meta' | 'google' | 'tiktok' (cargados a mano, a nivel cuenta, product_id NULL)

CREATE TABLE IF NOT EXISTS auth_tokens (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_account_order ON order_items(account_id, order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_account_product ON order_items(account_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_costs_account_product ON product_costs(account_id, product_id);
CREATE INDEX IF NOT EXISTS idx_ads_spend_account_date ON ads_spend(account_id, date);
CREATE INDEX IF NOT EXISTS idx_orders_account_date ON orders(account_id, date_created);
