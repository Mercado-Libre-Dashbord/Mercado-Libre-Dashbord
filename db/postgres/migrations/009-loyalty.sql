-- Programa de fidelización. Todo transcurre dentro de Mercado Libre: las
-- misiones son acciones en la plataforma y el premio es un cupón oficial de
-- ML emitido por su propia API.
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.

-- Configuración del programa, una por cuenta.
CREATE TABLE IF NOT EXISTS loyalty_programs (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  active BOOLEAN NOT NULL DEFAULT false,
  -- Puntos por misión, como JSON para poder sumar misiones sin migrar.
  points JSONB NOT NULL DEFAULT '{}'::jsonb,
  reward_threshold INTEGER NOT NULL DEFAULT 1500,
  reward_amount DOUBLE PRECISION NOT NULL DEFAULT 2000,
  reward_min_purchase DOUBLE PRECISION NOT NULL DEFAULT 10000,
  -- Tope de gasto de la campaña de cupones en ML.
  reward_budget DOUBLE PRECISION NOT NULL DEFAULT 100000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un comprador que entró al programa. El id externo lo define quien capta al
-- comprador (la app de Wallet): acá solo se lo referencia.
CREATE TABLE IF NOT EXISTS loyalty_members (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  member_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cupón entregado al alcanzar el objetivo. Null mientras no lo alcanzó.
  reward_coupon_code TEXT,
  reward_granted_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, member_id)
);

-- Misiones completadas. La clave primaria evita que una misma misión sume
-- puntos dos veces si se reintenta el pedido.
CREATE TABLE IF NOT EXISTS loyalty_completions (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  member_id TEXT NOT NULL,
  mission TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, member_id, mission)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_completions_member ON loyalty_completions(account_id, member_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loyalty_programs', 'loyalty_members', 'loyalty_completions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (account_id = app_current_account_id()) WITH CHECK (account_id = app_current_account_id())',
      t || '_isolation', t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END
$$;

-- Verificación: 3 filas.
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('loyalty_programs', 'loyalty_members', 'loyalty_completions');
