-- Marca hasta qué fecha ya se recorrió el historial completo de órdenes de la
-- cuenta. Correr tal cual en el SQL Editor de Supabase. Idempotente.
--
-- Una vez que una orden queda sincronizada, `pendingOrderIds` la descarta en
-- cada sync siguiente por su sync_version (no vuelve a comparar el estado
-- contra Mercado Libre) — así que recorrer TODO el historial (2020 a hoy)
-- buscando ids en cada sincronización era trabajo desperdiciado: casi todos
-- esos ids ya estaban al día y se iban a descartar igual. Guardando hasta
-- dónde ya está confirmado, el próximo sync puede arrancar cerca de ahí (con
-- un margen de unos días, para agarrar altas o cambios de estado tardíos) en
-- vez de siempre desde el arranque del historial.
--
-- NULL en una cuenta nueva o que nunca completó un sync entero: en ese caso
-- el próximo sync arranca del historial completo, como siempre.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS orders_synced_through DATE;

-- Verificación: 1 fila.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'accounts' AND column_name = 'orders_synced_through';
