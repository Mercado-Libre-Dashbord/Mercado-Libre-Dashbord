-- Credencial para que la app de la billetera pueda registrar misiones.
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.
--
-- Hasta ahora POST /api/loyalty/members exigía la sesión del vendedor
-- logueado. Un comprador que escanea un QR no tiene sesión, así que ninguna
-- app externa podía llamarla: el circuito de fidelización estaba cortado
-- justo en el punto de entrada.
--
-- Se guarda el HASH de la clave, no la clave. Si alguien se lleva una copia
-- de la base, no se lleva credenciales usables. La clave en claro se muestra
-- una sola vez, cuando se genera.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loyalty_api_key_hash TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loyalty_api_key_created_at TIMESTAMPTZ;

-- Búsqueda por hash en cada request de la billetera: sin índice es un scan
-- de toda la tabla de cuentas por cada misión cumplida.
CREATE INDEX IF NOT EXISTS idx_accounts_loyalty_api_key
  ON accounts(loyalty_api_key_hash) WHERE loyalty_api_key_hash IS NOT NULL;

-- La app de la billetera no tiene sesión de usuario, así que la política de
-- `accounts` (admin, o dueño por email) no le deja ver ninguna fila. En vez de
-- abrir la tabla, se agrega una tercera vía: quien ya conoce el hash de la
-- clave puede ver LA cuenta de esa clave y ninguna otra. RLS sigue decidiendo.
CREATE OR REPLACE FUNCTION app_current_loyalty_key_hash() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.loyalty_key_hash', true), '');
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION app_current_loyalty_key_hash() TO app_user;

DROP POLICY IF EXISTS accounts_select ON accounts;
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (
    app_is_admin()
    OR owner_email = app_current_user_email()
    OR (loyalty_api_key_hash IS NOT NULL AND loyalty_api_key_hash = app_current_loyalty_key_hash())
  );

-- Verificación: tienen que salir 2 filas.
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'accounts'
   AND column_name IN ('loyalty_api_key_hash', 'loyalty_api_key_created_at');
