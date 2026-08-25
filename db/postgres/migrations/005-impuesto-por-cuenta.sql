-- Otros impuestos (IIBB, internos) pasan de cargarse producto por producto a
-- una sola alícuota por cuenta, en % de la facturación.
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS other_tax_rate DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Verificación: 1 fila.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'accounts' AND column_name = 'other_tax_rate';
