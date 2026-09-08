-- Régimen fiscal de la cuenta, para saber si corresponde calcular IVA.
-- Correr tal cual en el SQL Editor de Supabase. Idempotente.
--
-- Hasta ahora el IVA se calculaba igual para TODAS las cuentas, asumiendo
-- Responsable Inscripto. Un vendedor Monotributista o exento no tiene débito
-- ni crédito fiscal: el precio que publica no "incluye" un IVA que después
-- haya que separar. Restarle un saldo de IVA que no existe le infla el costo
-- y le esconde ganancia real — es exactamente el caso que encontramos con el
-- primer cliente Monotributista que conectamos.
--
-- La columna ya existía en el esquema canónico (quedó reservada al armar el
-- núcleo de facturación/ARCA, que la va a necesitar también para decidir tipo
-- de comprobante) pero nunca tuvo su propia migración ni se usaba en ningún
-- lado del código. Ahora entra en producción para esto.
--
-- Default 'responsable_inscripto': ninguna cuenta existente cambia de
-- comportamiento hasta que alguien la pase a otro régimen a mano.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tax_condition TEXT NOT NULL DEFAULT 'responsable_inscripto';

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_tax_condition_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_tax_condition_check
  CHECK (tax_condition IN ('responsable_inscripto', 'monotributo', 'exento'));

-- Verificación: 1 fila.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'accounts' AND column_name = 'tax_condition';
