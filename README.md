# Dashboard de Rentabilidad ML

App local (Next.js) que sincroniza productos, órdenes y publicidad desde Mercado
Libre a través de un servidor MCP embebido, y calcula la rentabilidad real de la
cuenta usando el costo final que vos cargás por producto.

## Setup

1. `npm install`
2. Copiá `.env.example` a `.env` y completá:
   - `ML_CLIENT_ID` / `ML_CLIENT_SECRET`: de tu app en developers.mercadolibre.com
   - `ML_REDIRECT_URI`: debe coincidir exactamente con el configurado en la app de ML (por defecto `http://localhost:3000/api/auth/callback`)
   - `ML_SELLER_ID`: tu user id de Mercado Libre
3. `npm run dev`
4. Andá a `http://localhost:3000/api/auth/login` y autorizá la app.
5. Volvé a `http://localhost:3000/`, entrá a "Productos" y cargá el costo de cada uno.
6. Apretá "Sincronizar" en la pantalla de Resumen.

## Tests

`npm test`

## Notas

- Los tokens y la base SQLite (`data/ml-dashboard.db`) son locales, nunca se commitean.
- Si `getAdsSpend` (en `mcp/tools.ts`) no coincide con la respuesta real de la API de
  Mercado Ads en tu cuenta, ajustá el mapeo de campos ahí — es el único punto marcado
  como "a validar" en el plan de implementación.

## Publicidad externa (Meta / Google / TikTok)

El gasto de Mercado Ads se sincroniza solo con el botón "Sincronizar". El gasto
de Meta, Google Ads y TikTok se carga a mano desde la sección "Cargar publicidad
externa" en el Resumen (no hay integración por API con esas plataformas — ver
la adenda del spec para el porqué). Ese gasto entra en Ad Spend/MER/ROAS/CPA a
nivel cuenta, pero no se prorratea por producto porque no tenemos forma de saber
qué venta vino de qué canal sin datos de atribución.
