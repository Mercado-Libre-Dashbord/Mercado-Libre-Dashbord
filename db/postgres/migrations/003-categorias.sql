-- Categoría de cada publicación, para el gráfico de categorías más vendidas.
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.

ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_name TEXT;

-- Verificación: tiene que devolver 2 filas.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'products' AND column_name IN ('category_id', 'category_name');
