CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sku TEXT,
  current_price REAL,
  stock INTEGER,
  permalink TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id),
  cost REAL NOT NULL,
  valid_from TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  date_created TEXT NOT NULL,
  status TEXT NOT NULL,
  buyer_total REAL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
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
  product_id TEXT REFERENCES products(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  channel TEXT NOT NULL DEFAULT 'mercado_ads'
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
