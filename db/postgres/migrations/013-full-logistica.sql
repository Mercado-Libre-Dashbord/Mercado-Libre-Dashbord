-- Tipo de logística, id de inventario y stock guardado en Mercado Envíos
-- Full de cada publicación. Correr tal cual en el SQL Editor de Supabase.
-- Idempotente.
--
-- "logistic_type" viene en el mismo /items que ya se pide para el catálogo
-- (shipping.logistic_type) — no hace falta un llamado extra a la API para
-- saber que un producto está en Full. "inventory_id" es lo que hace falta
-- para después consultar /inventories/{inventory_id}/stock/fulfillment y
-- traer full_stock_qty / full_stock_unavailable_qty: con eso, multiplicado
-- por el costo ya cargado del producto, sale cuánto capital hay inmovilizado
-- guardado en los depósitos de ML.
--
-- Ninguno de estos nombres de campo está confirmado contra una respuesta
-- real de la API todavía: quedan NULL sin romper nada si el nombre real
-- resulta ser otro, y el sync loguea un aviso de diagnóstico en ese caso.

ALTER TABLE products ADD COLUMN IF NOT EXISTS logistic_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS inventory_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS full_stock_qty INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS full_stock_unavailable_qty INTEGER;

-- Verificación: 4 filas.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'products'
  AND column_name IN ('logistic_type', 'inventory_id', 'full_stock_qty', 'full_stock_unavailable_qty');
