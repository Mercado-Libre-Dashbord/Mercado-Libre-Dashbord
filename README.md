# Dashboard de Rentabilidad ML

App multi-cuenta (Next.js) que sincroniza productos, órdenes y publicidad desde
Mercado Libre a través de un servidor MCP embebido, y calcula la rentabilidad
real de cada cuenta usando el costo final que su dueño carga por producto.

Cada cliente entra con su cuenta de Google y ve solo su propia cuenta de
Mercado Libre; el/los email(s) en `ADMIN_EMAILS` pueden ver y crear cualquier
cuenta (switcher en la barra de navegación + pantalla `/admin`).

## Setup

1. `npm install`
2. Copiá `.env.example` a `.env` y completá:
   - `ML_CLIENT_ID` / `ML_CLIENT_SECRET`: de tu app en developers.mercadolibre.com
     (una sola app sirve para todas las cuentas/clientes).
   - `ML_REDIRECT_URI`: debe coincidir exactamente con el configurado en la app
     de ML (por defecto `http://localhost:3000/api/ml/callback`).
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: credenciales OAuth de Google
     Cloud Console (tipo "Web application"), con `http://localhost:3000/api/auth/callback/google`
     como redirect URI autorizado.
   - `NEXTAUTH_SECRET`: cualquier string random largo (`openssl rand -base64 32`).
   - `ADMIN_EMAILS`: tu email de Google, separado por coma si hay más de un admin.
   - En local dejá `DATABASE_URL` vacío (usa el archivo de `DB_PATH`). En
     producción (Vercel) completá `DATABASE_URL`/`DATABASE_AUTH_TOKEN` con una
     base Turso, porque el filesystem de Vercel no persiste entre requests.
3. `npm run dev`
4. Entrá a `http://localhost:3000`, iniciá sesión con Google.
5. Si sos admin: andá a `/admin` y creá una cuenta por cada cliente (nombre +
   email de Google con el que va a entrar).
6. Cada cliente entra con su Google, ve el banner "Conectar Mercado Libre" en
   Resumen y autoriza su propia cuenta de ML.
7. Entrá a "Productos" y cargá el costo de cada uno, después apretá
   "Sincronizar" en Resumen.

## Tests

`npm test`

## Notas

- Los tokens de Mercado Libre y los datos de cada cuenta viven en la base
  (SQLite local en dev, Turso en producción), nunca se commitean.
- Si `getAdsSpend` (en `mcp/tools.ts`) no coincide con la respuesta real de la API de
  Mercado Ads en una cuenta, ajustá el mapeo de campos ahí — es el único punto marcado
  como "a validar" en el plan de implementación.

## Publicidad externa (Meta / Google / TikTok)

El gasto de Mercado Ads se sincroniza solo con el botón "Sincronizar". El gasto
de Meta, Google Ads y TikTok se carga a mano desde la sección "Cargar publicidad
externa" en el Resumen (no hay integración por API con esas plataformas — ver
la adenda del spec para el porqué). Ese gasto entra en Ad Spend/MER/ROAS/CPA a
nivel cuenta, pero no se prorratea por producto porque no tenemos forma de saber
qué venta vino de qué canal sin datos de atribución.
