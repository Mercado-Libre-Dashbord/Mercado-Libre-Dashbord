-- Umbral de stock bajo por producto, para poder avisar cuando conviene
-- reponer. Correr tal cual en el SQL Editor de Supabase. Idempotente.
--
-- Es opt-in por producto (NULL = sin alerta configurada) en vez de un umbral
-- único para toda la cuenta: un best-seller y un producto de nicho no tienen
-- el mismo punto de "me estoy por quedar sin stock".

ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER;

-- Verificación: 1 fila.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'low_stock_threshold';
