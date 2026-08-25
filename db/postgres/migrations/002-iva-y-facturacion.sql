-- IVA por línea de venta + cargos reales de la API de facturación de ML.
-- Correr tal cual en el SQL Editor de Supabase. Todo es idempotente.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS iva_applied DOUBLE PRECISION;

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

CREATE INDEX IF NOT EXISTS idx_billing_charges_account_period ON billing_charges(account_id, period_key);
CREATE INDEX IF NOT EXISTS idx_billing_charges_account_order ON billing_charges(account_id, order_id);

ALTER TABLE billing_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_charges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_charges_isolation ON billing_charges;
CREATE POLICY billing_charges_isolation ON billing_charges
  USING (account_id = app_current_account_id())
  WITH CHECK (account_id = app_current_account_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON billing_charges TO app_user;

-- Verificación: 1 fila para iva_applied, 1 para la tabla nueva.
SELECT 'order_items.iva_applied' AS check, count(*) FROM information_schema.columns
  WHERE table_name = 'order_items' AND column_name = 'iva_applied'
UNION ALL
SELECT 'billing_charges', count(*) FROM information_schema.tables
  WHERE table_name = 'billing_charges';
