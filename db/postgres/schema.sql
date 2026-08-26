-- Run this whole file once in the Supabase SQL Editor (or against any plain
-- Postgres instance) as the project owner / superuser. It is safe to re-run:
-- every statement is idempotent (CREATE ... IF NOT EXISTS / OR REPLACE).
--
-- OJO: el SQL Editor de Supabase corre todo lo pegado como UNA transacción.
-- Si un solo statement falla (p. ej. el CREATE ROLE de abajo, o un GRANT
-- sobre una tabla ajena), se hace rollback de TODO el archivo y parece que
-- "corrió" cuando en realidad no aplicó nada. Si sólo necesitás las columnas
-- nuevas, corré db/postgres/migrations/001-tax.sql, que son dos ALTER sueltos
-- sin esa dependencia.
--
-- Security model: the app never connects as `postgres` or Supabase's
-- `service_role` (both bypass Row Level Security). It connects as the
-- `app_user` role created below, which is a non-superuser, non-owner role —
-- so every query it runs is subject to the RLS policies defined here, even
-- if a future bug in the app code forgets to filter by account_id.

-- ── Application role ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'change-me-see-below';
  END IF;
END
$$;

-- ── Session-variable helpers used by every RLS policy ───────────────────
-- The app sets these per-request with `SET LOCAL` inside a transaction
-- (see db/client.ts's withAccountScope) before running any query.
CREATE OR REPLACE FUNCTION app_current_account_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.current_account_id', true), '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean AS $$
  SELECT COALESCE(current_setting('app.is_admin', true), 'false') = 'true';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_current_user_email() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.current_user_email', true), '');
$$ LANGUAGE sql STABLE;

-- ── Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_email TEXT NOT NULL UNIQUE,
  ml_seller_id TEXT,
  -- Otros impuestos (IIBB, internos) como % de la facturación. Es una sola
  -- configuración por cuenta y no un campo por producto: son alícuotas que
  -- dependen de la jurisdicción del vendedor, no del artículo, y cargarlas
  -- producto por producto era trabajo repetido garantizado.
  other_tax_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS other_tax_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tax_condition TEXT NOT NULL DEFAULT 'responsable_inscripto';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS point_of_sale INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cuit TEXT;

CREATE TABLE IF NOT EXISTS products (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  sku TEXT,
  current_price DOUBLE PRECISION,
  stock INTEGER,
  permalink TEXT,
  category_id TEXT,
  category_name TEXT,
  thumbnail TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, id)
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_name TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS thumbnail TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'mercado_libre';

CREATE TABLE IF NOT EXISTS product_costs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  product_id TEXT NOT NULL,
  cost DOUBLE PRECISION NOT NULL,
  tax DOUBLE PRECISION NOT NULL DEFAULT 0,
  valid_from TIMESTAMPTZ NOT NULL
);
ALTER TABLE product_costs ADD COLUMN IF NOT EXISTS tax DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS orders (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  id TEXT NOT NULL,
  date_created TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  buyer_total DOUBLE PRECISION,
  -- Con qué versión de la lógica de sincronización se procesó esta orden.
  -- Permite que un solo botón "Sincronizar" recorra todo el historial sin
  -- volver a pedirle a la API las órdenes que ya están al día, y que al
  -- cambiar la lógica (subiendo ORDER_SYNC_VERSION) se reparen solas.
  sync_version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, id)
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sync_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'mercado_libre';

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  unit_price DOUBLE PRECISION NOT NULL,
  quantity INTEGER NOT NULL,
  ml_commission DOUBLE PRECISION NOT NULL,
  shipping_cost DOUBLE PRECISION NOT NULL,
  ads_cost_allocated DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_applied DOUBLE PRECISION,
  tax_applied DOUBLE PRECISION,
  iva_applied DOUBLE PRECISION,
  net_profit DOUBLE PRECISION
);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax_applied DOUBLE PRECISION;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS iva_applied DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS ads_spend (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  product_id TEXT,
  date DATE NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  channel TEXT NOT NULL DEFAULT 'mercado_ads'
);
-- channel: 'mercado_ads' (por producto, sincronizado automático) |
-- 'meta' | 'google' | 'tiktok' (cargados a mano, a nivel cuenta, product_id NULL)

CREATE TABLE IF NOT EXISTS question_drafts (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  ml_question_id BIGINT NOT NULL,
  product_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  draft_answer TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'sent'
  date_created TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, ml_question_id)
);

-- Cargos reales facturados por Mercado Libre (API de facturación). A
-- diferencia del resto de las tablas, esto no se calcula: es lo que ML dice
-- que efectivamente te cobró, y sirve para conciliar contra lo que estimamos.
CREATE TABLE IF NOT EXISTS billing_charges (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  detail_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  detail_type TEXT,
  detail_sub_type TEXT,
  concept TEXT,
  order_id TEXT,
  amount DOUBLE PRECISION NOT NULL,
  charged_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, detail_id)
);

-- Comprobantes electrónicos emitidos ante ARCA. Una venta, un comprobante:
-- la clave primaria por (cuenta, orden) evita facturar dos veces lo mismo.
CREATE TABLE IF NOT EXISTS invoices (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  order_id TEXT NOT NULL,
  invoice_type INTEGER NOT NULL,
  doc_type INTEGER NOT NULL,
  doc_number TEXT NOT NULL,
  buyer_iva_condition INTEGER NOT NULL,
  total DOUBLE PRECISION NOT NULL,
  net DOUBLE PRECISION NOT NULL,
  iva DOUBLE PRECISION NOT NULL,
  invoice_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  point_of_sale INTEGER,
  number INTEGER,
  cae TEXT,
  cae_expires_at DATE,
  provider TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, order_id)
);

-- Credenciales por canal de venta. Aparte de auth_tokens (que es solo de ML)
-- para no forzar el modelo de OAuth de ML sobre canales que funcionan
-- distinto: el token de Tienda Nube no expira ni tiene refresh.
CREATE TABLE IF NOT EXISTS channel_connections (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  channel TEXT NOT NULL,
  external_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, channel)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_account_order ON order_items(account_id, order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_account_product ON order_items(account_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_costs_account_product ON product_costs(account_id, product_id);
CREATE INDEX IF NOT EXISTS idx_ads_spend_account_date ON ads_spend(account_id, date);
CREATE INDEX IF NOT EXISTS idx_orders_account_date ON orders(account_id, date_created);
CREATE INDEX IF NOT EXISTS idx_question_drafts_account_status ON question_drafts(account_id, status);
CREATE INDEX IF NOT EXISTS idx_billing_charges_account_period ON billing_charges(account_id, period_key);
CREATE INDEX IF NOT EXISTS idx_billing_charges_account_order ON billing_charges(account_id, order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_account_status ON invoices(account_id, status);
CREATE INDEX IF NOT EXISTS idx_products_account_channel ON products(account_id, channel);
CREATE INDEX IF NOT EXISTS idx_orders_account_channel ON orders(account_id, channel);

-- ── Row Level Security ───────────────────────────────────────────────────
-- FORCE (not just ENABLE) matters: without FORCE, the table *owner* still
-- bypasses RLS. app_user isn't the owner here (whoever runs this script is),
-- so ENABLE alone would already be enough for app_user — FORCE is added as
-- belt-and-suspenders in case ownership ever changes.

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounts_select ON accounts;
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (app_is_admin() OR owner_email = app_current_user_email());
DROP POLICY IF EXISTS accounts_insert ON accounts;
CREATE POLICY accounts_insert ON accounts FOR INSERT
  WITH CHECK (app_is_admin());
DROP POLICY IF EXISTS accounts_update ON accounts;
CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (app_is_admin() OR owner_email = app_current_user_email())
  WITH CHECK (app_is_admin() OR owner_email = app_current_user_email());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'product_costs', 'orders', 'order_items', 'ads_spend', 'auth_tokens', 'question_drafts', 'billing_charges', 'invoices', 'channel_connections']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (account_id = app_current_account_id()) WITH CHECK (account_id = app_current_account_id())',
      t || '_isolation', t
    );
  END LOOP;
END
$$;

-- ── Grants ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION app_current_account_id(), app_is_admin(), app_current_user_email() TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
