-- Foto de cada publicación, para la lista de productos más vendidos.
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.

ALTER TABLE products ADD COLUMN IF NOT EXISTS thumbnail TEXT;

-- Verificación: tiene que devolver 1 fila.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'thumbnail';
