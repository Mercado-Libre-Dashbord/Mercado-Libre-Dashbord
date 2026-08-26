-- Multicanal: de dónde vino cada producto y cada venta.
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.
--
-- El default 'mercado_libre' es a propósito: todo lo que ya está sincronizado
-- vino de ahí, así que las filas existentes quedan correctamente etiquetadas
-- sin necesidad de resincronizar nada.

ALTER TABLE products ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'mercado_libre';
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'mercado_libre';

-- Credenciales por canal. Separado de auth_tokens (que es solo de ML) para no
-- forzar el modelo de OAuth de ML sobre canales que funcionan distinto: el
-- token de Tienda Nube, por ejemplo, no expira y no tiene refresh.
CREATE TABLE IF NOT EXISTS channel_connections (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  channel TEXT NOT NULL,
  -- Id de la tienda en el canal (store_id en Tienda Nube, seller_id en ML).
  external_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_products_account_channel ON products(account_id, channel);
CREATE INDEX IF NOT EXISTS idx_orders_account_channel ON orders(account_id, channel);

ALTER TABLE channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_connections_isolation ON channel_connections;
CREATE POLICY channel_connections_isolation ON channel_connections
  USING (account_id = app_current_account_id())
  WITH CHECK (account_id = app_current_account_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON channel_connections TO app_user;

-- Verificación: 3 filas (products.channel, orders.channel, tabla nueva).
SELECT 'products.channel' AS item FROM information_schema.columns
  WHERE table_name='products' AND column_name='channel'
UNION ALL SELECT 'orders.channel' FROM information_schema.columns
  WHERE table_name='orders' AND column_name='channel'
UNION ALL SELECT 'channel_connections' FROM information_schema.tables
  WHERE table_name='channel_connections';
