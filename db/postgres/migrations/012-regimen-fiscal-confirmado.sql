-- Marca si el vendedor ya eligió su régimen fiscal, para poder preguntárselo
-- una sola vez a las cuentas nuevas. Correr tal cual en el SQL Editor de
-- Supabase. Idempotente.
--
-- La migración 011 le puso un default ('responsable_inscripto') a
-- tax_condition, pero ese default es indistinguible de una elección real: no
-- hay forma de saber si una cuenta nueva ya contestó o si nadie le preguntó
-- todavía. El caso real que lo mostró: un cliente Monotributista estuvo
-- semanas con el IVA mal calculado porque nadie le preguntó su régimen al
-- conectar la cuenta, y Configuración no es un lugar que un vendedor nuevo
-- visite antes de mirar sus números.
--
-- Las cuentas que YA EXISTEN quedan marcadas como confirmadas: llevan
-- sincronizado con el régimen por default (u otro que ya hayan elegido a
-- mano) y no corresponde interrumpirlas con una pregunta retroactiva. Las
-- cuentas que se creen de acá en más arrancan sin confirmar, así el próximo
-- login le pregunta antes de mostrar cualquier número.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tax_condition_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE accounts SET tax_condition_confirmed = TRUE WHERE tax_condition_confirmed = FALSE;

-- Verificación: 1 fila.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'accounts' AND column_name = 'tax_condition_confirmed';
