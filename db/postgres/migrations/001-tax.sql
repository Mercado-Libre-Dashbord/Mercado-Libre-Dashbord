-- Migración de impuestos por producto.
--
-- Correr TAL CUAL en el SQL Editor de Supabase. Son dos statements sueltos y
-- ambos son idempotentes: si ya están aplicados, no hacen nada.
--
-- Por qué existe este archivo aparte de schema.sql: el SQL Editor de Supabase
-- corre todo lo que le pegues como una sola transacción. Si CUALQUIER
-- statement de schema.sql falla (por ejemplo el CREATE ROLE, o un GRANT sobre
-- una tabla que no te pertenece), se hace rollback de TODO — incluidos estos
-- dos ALTER. Por eso "correr schema.sql" puede terminar sin aplicar nada y
-- sin que se note. Estas dos líneas solas no tienen esa dependencia.

ALTER TABLE product_costs ADD COLUMN IF NOT EXISTS tax DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax_applied DOUBLE PRECISION;

-- Verificación: tiene que devolver exactamente 2 filas.
SELECT table_name, column_name
FROM information_schema.columns
WHERE (table_name = 'product_costs' AND column_name = 'tax')
   OR (table_name = 'order_items' AND column_name = 'tax_applied');
