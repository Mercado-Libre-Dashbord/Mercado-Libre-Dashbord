-- Desde cuándo sabemos que un producto está guardado en Mercado Envíos Full,
-- para poder estimar antigüedad y el riesgo de cargo por "stock antiguo".
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.
--
-- ML no expone la fecha real de ingreso al depósito por API (no encontramos
-- ese dato documentado). Esto no es esa fecha: es la primera vez que
-- NUESTRO sync vio a ese producto con stock en Full. Para un producto que ya
-- estaba en Full antes de instalar esto, la antigüedad real es mayor a la
-- que va a mostrar el dashboard — se explica así en la pantalla, no como un
-- dato exacto de ML.

ALTER TABLE products ADD COLUMN IF NOT EXISTS full_since TIMESTAMPTZ;

-- Verificación: 1 fila.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'full_since';
