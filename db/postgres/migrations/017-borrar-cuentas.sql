-- Permite al admin editar y borrar cuentas desde /admin.
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.
--
-- Editar (nombre, email del dueño) ya funcionaba con la política
-- accounts_update que ya existe. Lo que faltaba era borrar: sin una
-- política de DELETE, y con FORCE ROW LEVEL SECURITY, ningún borrado podía
-- pasar nunca — RLS deniega por default cuando no hay política para ese
-- comando, no hace falta agregar nada más para que sea seguro.
--
-- El borrado en sí lo protegen las foreign keys ya existentes: casi toda
-- tabla de datos (products, orders, order_items, etc.) referencia
-- accounts(id) sin ON DELETE CASCADE, así que Postgres rechaza borrar una
-- cuenta con historial real con un error de foreign key — a propósito, para
-- no poder voltear de un click todo el negocio de un cliente real. Solo se
-- puede borrar una cuenta genuinamente vacía (creada por error, nunca
-- sincronizada).

DROP POLICY IF EXISTS accounts_delete ON accounts;
CREATE POLICY accounts_delete ON accounts FOR DELETE
  USING (app_is_admin());

-- Verificación: 1 fila.
SELECT policyname FROM pg_policies WHERE tablename = 'accounts' AND policyname = 'accounts_delete';
