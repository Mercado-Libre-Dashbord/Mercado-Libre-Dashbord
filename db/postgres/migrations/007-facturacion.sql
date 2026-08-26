-- Comprobantes electrónicos (ARCA, ex AFIP) emitidos por cada venta.
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.

-- Condición del vendedor frente al IVA: define si emite A/B o C.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tax_condition TEXT NOT NULL DEFAULT 'responsable_inscripto';
-- Punto de venta habilitado en ARCA para facturación electrónica.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS point_of_sale INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cuit TEXT;

CREATE TABLE IF NOT EXISTS invoices (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  order_id TEXT NOT NULL,
  -- Código de comprobante de ARCA: 1=Factura A, 6=B, 11=C.
  invoice_type INTEGER NOT NULL,
  doc_type INTEGER NOT NULL,
  doc_number TEXT NOT NULL,
  buyer_iva_condition INTEGER NOT NULL,
  total DOUBLE PRECISION NOT NULL,
  net DOUBLE PRECISION NOT NULL,
  iva DOUBLE PRECISION NOT NULL,
  invoice_date DATE NOT NULL,
  -- 'draft' | 'issued' | 'error'. Solo 'issued' tiene CAE.
  status TEXT NOT NULL DEFAULT 'draft',
  point_of_sale INTEGER,
  number INTEGER,
  cae TEXT,
  cae_expires_at DATE,
  provider TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Una venta, un comprobante: la clave primaria evita facturar dos veces la
  -- misma orden si se aprieta el botón dos veces o se reintenta un webhook.
  PRIMARY KEY (account_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_account_status ON invoices(account_id, status);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_isolation ON invoices;
CREATE POLICY invoices_isolation ON invoices
  USING (account_id = app_current_account_id())
  WITH CHECK (account_id = app_current_account_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO app_user;

-- Verificación: 1 fila.
SELECT count(*) AS tabla_invoices FROM information_schema.tables WHERE table_name = 'invoices';
