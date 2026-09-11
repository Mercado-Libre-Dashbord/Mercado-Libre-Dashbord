# Login con Microsoft (Hotmail / Outlook / Entra ID)

Cómo habilitar el botón "Microsoft" de la pantalla de login, al lado del de
Google. Los dos conviven: el vendedor elige con cuál entrar y, si el email es
el mismo, cae en la misma cuenta.

El login de Google sigue funcionando igual sin tocar nada. Si no completás las
variables de acá, el botón de Microsoft directamente no se muestra.

---

## 1. Registrar la aplicación en el Azure Portal

1. Entrá a [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID**
   → **App registrations** → **New registration**.
2. **Name**: el nombre que va a ver el usuario en la pantalla de consentimiento
   (por ejemplo, `Dashboard Rentabilidad ML`).
3. **Supported account types**: esta elección es la que decide quién puede
   entrar.

   | Opción | Quién entra | Cuándo usarla |
   |---|---|---|
   | Accounts in any organizational directory **and personal Microsoft accounts** | Empresas + Hotmail/Outlook/Live | **La recomendada acá**: es la única que deja entrar con Hotmail |
   | Accounts in this organizational directory only | Solo tu propia empresa | Si el dashboard es interno |
   | Accounts in any organizational directory | Cualquier empresa, sin cuentas personales | Rara vez |

4. **Redirect URI**: elegí plataforma **Web** y poné exactamente:

   ```
   https://TU-DOMINIO/api/auth/callback/azure-ad
   ```

   Para desarrollo agregá también `http://localhost:3000/api/auth/callback/azure-ad`.
   El path `/api/auth/callback/azure-ad` no es configurable: lo arma NextAuth a
   partir del id del proveedor. Si no coincide carácter por carácter, Microsoft
   corta el login con `AADSTS50011`.

5. **Register**.

## 2. Sacar el Client ID y el Client Secret

- El **Client ID** está en **Overview** → *Application (client) ID*.
- El **Client Secret** se crea en **Certificates & secrets** → **New client
  secret**. Copiá la columna **Value** (no el *Secret ID*) **en ese momento**:
  después Azure la oculta para siempre y hay que generar otra.
- Anotá la fecha de vencimiento que le pusiste. Un secret vencido rompe el
  login de todos los usuarios de Microsoft de golpe y sin aviso previo.

## 3. Habilitar el claim `xms_edov` (importante)

En **Token configuration** → **Add optional claim** → tipo **ID** → marcá
**`xms_edov`** → **Add**. Si Azure ofrece activar los permisos de Microsoft
Graph asociados, aceptá.

Este claim es el que le dice a la app que el dominio del email del usuario está
verificado por su directorio. Sin él, los logins de cuentas **de empresa** se
rechazan (las personales de Hotmail/Outlook entran igual). El porqué está abajo,
en *Cómo se vinculan las cuentas*.

## 4. Variables de entorno

```bash
AZURE_AD_CLIENT_ID=el-application-client-id
AZURE_AD_CLIENT_SECRET=el-value-del-secret
AZURE_AD_TENANT_ID=common
```

`common` admite cuentas personales y de empresa — es lo que corresponde si en
el paso 1 elegiste la opción recomendada. Si registraste la app para una sola
organización, poné acá el **Directory (tenant) ID** de esa organización en vez
de `common`.

Reiniciá la app. El botón de Microsoft aparece solo.

---

## Cómo se vinculan las cuentas entre Google y Microsoft

No hay nada que vincular a mano: **la cuenta se identifica por email**.
`accounts.owner_email` es único, las políticas de Row Level Security comparan
contra ese email y `ADMIN_EMAILS` también. Si `vendedor@gmail.com` entra hoy
con Google y mañana con una cuenta de Microsoft armada sobre ese mismo mail, ve
exactamente los mismos datos: es la misma fila de `accounts`.

Eso es cómodo, y es justamente lo que obliga a ser estricto con el email.

En una app multi-tenant, el claim `email` de Entra ID **puede venir de un
dominio que nadie verificó**: cualquiera que pueda crear un tenant propio (es
gratis) pone ahí el email de otra persona y, si la app le creyera, entraría a
la cuenta de esa persona. Y si ese email está en `ADMIN_EMAILS`, a todas las
cuentas. Microsoft publicó el problema como **nOAuth** y su propia guía dice no
usar `email` como identificador sin verificar.

Por eso `lib/auth-identity.ts` acepta el email de Microsoft solo en tres casos:

1. **`xms_edov=true`** — Entra ID confirma que el dominio del email está
   verificado. Es la señal fuerte, y el motivo del paso 3.
2. **Cuenta personal** (Hotmail, Outlook.com, Live) — el tenant de
   consumidores es uno solo y Microsoft valida el buzón al crear la cuenta.
3. **App de un solo tenant** y el token viene de ese mismo tenant — el
   directorio es el de la propia empresa.

Cualquier otro caso se rechaza y el usuario ve "no pudimos verificar tu email".
El motivo exacto queda en el log del servidor: mostrarlo en pantalla le diría a
un atacante qué claim le falta falsear.

Para Google la regla equivalente es `email_verified=true`.

---

## Problemas frecuentes

| Síntoma | Causa |
|---|---|
| `AADSTS50011: redirect URI does not match` | El Redirect URI del portal no es idéntico al de la app. Revisá http vs https, el dominio y que termine en `/api/auth/callback/azure-ad` |
| El login vuelve a `/login` con "no pudimos verificar tu email" | Falta el claim `xms_edov` (paso 3), o es una cuenta de empresa de un tenant ajeno con dominio sin verificar |
| `AADSTS7000215: Invalid client secret` | Se copió el *Secret ID* en lugar del *Value*, o el secret venció |
| El botón de Microsoft no aparece | Faltan `AZURE_AD_CLIENT_ID` o `AZURE_AD_CLIENT_SECRET`, o no se reinició la app |
| Un usuario entra pero ve "todavía no tenés cuenta" | El login funcionó: falta darlo de alta en **Cuentas** con ese mismo email |
