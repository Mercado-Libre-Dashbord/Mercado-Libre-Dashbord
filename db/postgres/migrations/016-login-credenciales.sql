-- Login con email y contraseña, para clientes que no usan cuenta de Google
-- (ej. Hotmail/Outlook) y para los que no vale la pena todavía verificar la
-- app ante Microsoft/Azure por un solo cliente.
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.
--
-- No es un registro abierto: el cliente NUNCA elige su email libremente acá.
-- El admin genera una invitación de un solo uso para el owner_email exacto
-- de una cuenta ya creada (ver /admin), y le manda ese link por fuera de la
-- app (WhatsApp, mail, lo que sea). Solo con ese link se puede poner una
-- contraseña, y la invitación se quema al usarse. Así no hace falta mandar
-- mails desde el servidor para verificar que el email es de verdad suyo.
--
-- Contraseñas: se guarda un hash scrypt (con salt por usuario), nunca la
-- contraseña. scrypt es el módulo `crypto` nativo de Node — cero paquetes
-- nuevos, y hecho a propósito para ser lento de fuerza bruta.

CREATE TABLE IF NOT EXISTS credential_users (
  email TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  -- Bloqueo simple tras varios intentos fallidos seguidos: sin esto, un
  -- endpoint de login es una puerta abierta a fuerza bruta offline-friendly.
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS credential_invites (
  -- Se guarda el hash del token, nunca el token: mismo motivo que las
  -- contraseñas. El token en claro solo existe una vez, en la respuesta al
  -- admin que lo genera.
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_credential_invites_email ON credential_invites(email);

-- Dos formas de identificarse SIN sesión todavía, mismo mecanismo que ya
-- existe para la clave de la billetera (app_current_loyalty_key_hash):
-- quien manda el email candidato en un login, o quien conoce el token de
-- una invitación, puede ver EXACTAMENTE esa fila y ninguna otra. RLS sigue
-- siendo lo que decide, no el código de la app.
CREATE OR REPLACE FUNCTION app_credential_lookup_email() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.credential_lookup_email', true), '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_current_credential_invite_hash() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.credential_invite_hash', true), '');
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION app_credential_lookup_email(), app_current_credential_invite_hash() TO app_user;

ALTER TABLE credential_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credential_users_select ON credential_users;
CREATE POLICY credential_users_select ON credential_users FOR SELECT
  USING (app_is_admin() OR email = app_credential_lookup_email());

-- Solo se puede crear/actualizar la CONTRASEÑA de un email si existe una
-- invitación válida (no usada, no vencida) para ESE email con el token que
-- se está presentando. Un admin no crea la fila directamente: crea la
-- invitación, y es el propio flujo de "poner contraseña" el que la usa.
--
-- OJO: esto es a propósito FOR ALL sin más políticas de UPDATE encima. Si se
-- agregara otra política de UPDATE permisiva (p. ej. "dejame tocar mi propia
-- fila para actualizar el contador de intentos"), Postgres las combina con
-- OR — y esa segunda política, pensada solo para el contador, terminaría
-- dejando cambiar TAMBIÉN password_hash sin invitación, porque RLS filtra
-- filas, no columnas. Por eso el conteo de intentos fallidos/exitosos NO es
-- un UPDATE directo desde la app: son las funciones SECURITY DEFINER de
-- abajo, que solo saben tocar esas tres columnas puntuales y nada más.
-- El USING repite el mismo EXISTS que el WITH CHECK (no solo
-- "email = app_credential_lookup_email()") por un detalle no obvio de
-- Postgres: en un INSERT ... ON CONFLICT DO UPDATE, el USING también se
-- evalúa aunque termine tomando la rama de INSERT (sin conflicto real) —
-- sin este agregado, poner la contraseña por primera vez con SOLO el token
-- de invitación en el scope (sin credentialLookupEmail) fallaba con "new
-- row violates row-level security policy", confirmado reproduciendo el
-- caso a mano en psql antes de este fix.
DROP POLICY IF EXISTS credential_users_write ON credential_users;
CREATE POLICY credential_users_write ON credential_users FOR ALL
  USING (
    app_is_admin()
    OR email = app_credential_lookup_email()
    OR EXISTS (
      SELECT 1 FROM credential_invites ci
      WHERE ci.email = credential_users.email
        AND ci.token_hash = app_current_credential_invite_hash()
        AND ci.used_at IS NULL
        AND ci.expires_at > now()
    )
  )
  WITH CHECK (
    app_is_admin()
    OR EXISTS (
      SELECT 1 FROM credential_invites ci
      WHERE ci.email = credential_users.email
        AND ci.token_hash = app_current_credential_invite_hash()
        AND ci.used_at IS NULL
        AND ci.expires_at > now()
    )
  );

-- SECURITY DEFINER: corre con los privilegios de quien la creó (dueño de la
-- base), no con los de app_user, así que puede tocar credential_users
-- aunque no exista ninguna invitación vigente — es exactamente lo que hace
-- falta para trackear intentos de login mucho después de que la invitación
-- ya se usó. A propósito solo puede tocar estas tres columnas: no reemplaza
-- ninguna política de arriba, es la única vía para este caso puntual.
CREATE OR REPLACE FUNCTION credential_record_failed_login(p_email TEXT, p_max_attempts INTEGER, p_lockout_minutes INTEGER)
RETURNS void AS $$
  UPDATE credential_users
     SET failed_attempts = failed_attempts + 1,
         locked_until = CASE
           WHEN failed_attempts + 1 >= p_max_attempts THEN now() + (p_lockout_minutes || ' minutes')::interval
           ELSE locked_until
         END
   WHERE email = p_email;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION credential_record_successful_login(p_email TEXT)
RETURNS void AS $$
  UPDATE credential_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE email = p_email;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION credential_record_failed_login(text, integer, integer), credential_record_successful_login(text) TO app_user;

ALTER TABLE credential_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_invites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credential_invites_select ON credential_invites;
CREATE POLICY credential_invites_select ON credential_invites FOR SELECT
  USING (app_is_admin() OR token_hash = app_current_credential_invite_hash());

DROP POLICY IF EXISTS credential_invites_insert ON credential_invites;
CREATE POLICY credential_invites_insert ON credential_invites FOR INSERT
  WITH CHECK (app_is_admin());

-- El propio flujo de "poner contraseña" marca su invitación como usada
-- (used_at) sin ser admin — solo puede tocar la fila cuyo token ya conoce.
DROP POLICY IF EXISTS credential_invites_update ON credential_invites;
CREATE POLICY credential_invites_update ON credential_invites FOR UPDATE
  USING (app_is_admin() OR token_hash = app_current_credential_invite_hash())
  WITH CHECK (app_is_admin() OR token_hash = app_current_credential_invite_hash());

DROP POLICY IF EXISTS credential_invites_delete ON credential_invites;
CREATE POLICY credential_invites_delete ON credential_invites FOR DELETE
  USING (app_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON credential_users TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON credential_invites TO app_user;

-- Verificación: 2 filas.
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('credential_users', 'credential_invites');
