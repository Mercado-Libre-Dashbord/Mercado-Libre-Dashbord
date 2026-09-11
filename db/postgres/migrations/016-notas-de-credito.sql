-- Notas de crédito de Mercado Libre: cuando un comprador devuelve un
-- producto, ML reintegra la comisión con una nota de crédito aparte de la
-- factura original. Sin distinguirla, el saldo del período queda inflado: se
-- ve la comisión cobrada pero no la que volvió, y el vendedor cree que debe
-- más de lo que debe.
--
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.

ALTER TABLE billing_charges ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'BILL';

-- Para el detalle por orden del módulo de Facturación: cruzar la nota de
-- crédito contra el cargo original de esa misma venta.
CREATE INDEX IF NOT EXISTS idx_billing_charges_account_doc
  ON billing_charges(account_id, document_type);

-- Verificación: 1 fila.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'billing_charges' AND column_name = 'document_type';
