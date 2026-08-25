-- Marca con qué versión de la lógica se procesó cada orden, para que un solo
-- botón "Sincronizar" pueda recorrer todo el historial salteando lo que ya
-- está al día. Correr tal cual en Supabase. Idempotente.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS sync_version INTEGER NOT NULL DEFAULT 0;

-- Verificación: 1 fila.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'sync_version';
