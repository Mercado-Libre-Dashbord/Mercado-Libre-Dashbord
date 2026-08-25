import type { QueryExecutor } from "@/db/client";
import { listProducts, listOrders, getOrderDetail, getAdsSpend, listBillingPeriods, getBillingCharges } from "@/mcp/tools";
import { getCostEntryAtDate, allocateAdsCost, calculateNetProfit, calculateIva } from "./profitability";
import { hasColumn } from "@/db/schema-capabilities";

export interface SyncResult {
  productsSynced: number;
  ordersSynced: number;
  adsRowsSynced: number;
  billingChargesSynced: number;
}

/** Sincroniza el catálogo. Barato: una llamada paginada + un upsert por producto. */
export async function syncProducts(db: QueryExecutor, accountId: string, sellerId: string): Promise<number> {
  const now = new Date().toISOString();
  const hasCategory = await hasColumn(db, "products", "category_id");
  const hasThumbnail = await hasColumn(db, "products", "thumbnail");
  const products = await listProducts(accountId, sellerId);
  for (const p of products) {
    await db.query(
      `INSERT INTO products (account_id, id, title, sku, current_price, stock, permalink, updated_at${hasCategory ? ", category_id, category_name" : ""}${hasThumbnail ? ", thumbnail" : ""})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8${hasCategory ? ", $9, $10" : ""}${hasThumbnail ? `, $${hasCategory ? 11 : 9}` : ""})
       ON CONFLICT (account_id, id) DO UPDATE SET
         title = excluded.title, sku = excluded.sku, current_price = excluded.current_price,
         stock = excluded.stock, permalink = excluded.permalink, updated_at = excluded.updated_at${
           hasCategory ? ", category_id = excluded.category_id, category_name = excluded.category_name" : ""
         }${hasThumbnail ? ", thumbnail = excluded.thumbnail" : ""}`,
      [
        accountId, p.id, p.title, p.sku, p.price, p.stock, p.permalink, now,
        ...(hasCategory ? [p.categoryId, p.categoryName] : []),
        ...(hasThumbnail ? [p.thumbnail] : []),
      ]
    );
  }
  return products.length;
}

/**
 * Procesa un lote concreto de órdenes. Es la parte cara —cada orden son dos
 * llamadas a la API de ML— así que el recálculo del historial la invoca por
 * tandas chicas en vez de todo de una.
 */
export async function syncOrders(
  db: QueryExecutor,
  accountId: string,
  orderIds: string[],
  hasIva: boolean,
  otherTaxRate = 0
): Promise<number> {
  let synced = 0;
  for (const orderId of orderIds) {
    const order = await getOrderDetail(accountId, orderId);
    await db.query(
      `INSERT INTO orders (account_id, id, date_created, status, buyer_total) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id, id) DO UPDATE SET status = excluded.status, buyer_total = excluded.buyer_total`,
      [accountId, order.id, order.dateCreated, order.status, order.buyerTotal]
    );
    await db.query(`DELETE FROM order_items WHERE account_id = $1 AND order_id = $2`, [accountId, order.id]);

    for (const item of order.items) {
      const costsResult = await db.query<{ cost: number; tax: number; validfrom: string | Date }>(
        `SELECT cost, tax, valid_from as validFrom FROM product_costs WHERE account_id = $1 AND product_id = $2`,
        [accountId, item.productId]
      );
      const costs = costsResult.rows.map((r) => ({
        cost: Number(r.cost),
        tax: Number(r.tax),
        validFrom: new Date(r.validfrom).toISOString(),
      }));
      const entry = getCostEntryAtDate(costs, order.dateCreated);
      const profitInput = {
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        mlCommission: item.mlCommission,
        shippingCost: item.shippingCost,
        adsCostAllocated: 0,
        costApplied: entry?.cost ?? null,
        // Otros impuestos salen de la alícuota de la cuenta aplicada al precio,
        // no de un valor cargado producto por producto.
        taxApplied: item.unitPrice * otherTaxRate,
      };
      await db.query(
        `INSERT INTO order_items
           (account_id, order_id, product_id, unit_price, quantity, ml_commission, shipping_cost, ads_cost_allocated, cost_applied, tax_applied${hasIva ? ", iva_applied" : ""}, net_profit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10${hasIva ? ", $12" : ""}, $11)`,
        [
          accountId, order.id, item.productId, item.unitPrice, item.quantity,
          item.mlCommission, item.shippingCost, 0,
          entry?.cost ?? null, profitInput.taxApplied,
          calculateNetProfit(profitInput),
          ...(hasIva ? [calculateIva(profitInput)] : []),
        ]
      );
    }
    synced += 1;
  }
  return synced;
}

export async function syncAds(
  db: QueryExecutor,
  accountId: string,
  sellerId: string,
  sinceIso: string
): Promise<number> {
  try {
    const dateTo = new Date().toISOString().slice(0, 10);
    const adsRows = await getAdsSpend(accountId, sellerId, sinceIso.slice(0, 10), dateTo);
    // Solo borra filas de Mercado Ads: las cargadas a mano (Meta/Google/TikTok)
    // tienen otro channel y no deben tocarse en un re-sync de ML.
    await db.query(
      `DELETE FROM ads_spend WHERE account_id = $1 AND channel = 'mercado_ads' AND date >= $2::date AND date <= $3::date`,
      [accountId, sinceIso.slice(0, 10), dateTo]
    );
    for (const row of adsRows) {
      await db.query(
        `INSERT INTO ads_spend (account_id, product_id, date, amount, channel) VALUES ($1, $2, $3, $4, 'mercado_ads')`,
        [accountId, row.productId, row.date, row.amount]
      );
    }
    return adsRows.length;
  } catch (err) {
    // Productos y órdenes ya se guardaron; si falla Mercado Ads el resto del
    // dashboard sigue funcionando, solo sin dato de publicidad.
    console.error("No se pudo sincronizar publicidad, se continúa sin ese dato:", (err as Error).message);
    return 0;
  }
}

export async function recalculate(db: QueryExecutor, accountId: string, hasIva: boolean, otherTaxRate = 0): Promise<void> {
  await reallocateAdsCosts(db, accountId, hasIva, otherTaxRate);
}

export async function runSync(
  db: QueryExecutor,
  accountId: string,
  sellerId: string,
  sinceIso: string,
  otherTaxRate = 0
): Promise<SyncResult> {
  const hasIva = await hasColumn(db, "order_items", "iva_applied");

  const productsSynced = await syncProducts(db, accountId, sellerId);
  const orderIds = await listOrders(accountId, sellerId, sinceIso);
  const ordersSynced = await syncOrders(db, accountId, orderIds, hasIva, otherTaxRate);
  const adsRowsSynced = await syncAds(db, accountId, sellerId, sinceIso);
  await recalculate(db, accountId, hasIva, otherTaxRate);
  const billingChargesSynced = await syncBillingCharges(db, accountId);

  return { productsSynced, ordersSynced, adsRowsSynced, billingChargesSynced };
}

/**
 * Trae los cargos reales que Mercado Libre facturó (comisiones, envíos,
 * percepciones impositivas, Product Ads) para los últimos períodos.
 *
 * Es informativo por ahora: alimenta la conciliación "lo que ML te cobró vs.
 * lo que calculamos", pero NO entra todavía en la ganancia neta, porque
 * duplicaría la comisión y el envío que ya se descuentan por orden.
 *
 * Como todo lo de facturación puede fallar por permisos, un error acá no
 * rompe el resto del sync que ya se guardó.
 */
export async function syncBillingCharges(db: QueryExecutor, accountId: string): Promise<number> {
  try {
    if (!(await hasColumn(db, "billing_charges", "detail_id"))) return 0;

    const periods = await listBillingPeriods(accountId);
    // Los últimos 3 meses alcanzan para conciliar y acotan el volumen: los
    // períodos viejos ya están cerrados y no cambian.
    let saved = 0;
    for (const period of periods.slice(0, 3)) {
      for (const c of await getBillingCharges(accountId, period.key)) {
        await db.query(
          `INSERT INTO billing_charges
             (account_id, detail_id, period_key, detail_type, detail_sub_type, concept, order_id, amount, charged_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (account_id, detail_id) DO UPDATE SET
             period_key = excluded.period_key, detail_type = excluded.detail_type,
             detail_sub_type = excluded.detail_sub_type, concept = excluded.concept,
             order_id = excluded.order_id, amount = excluded.amount, charged_at = excluded.charged_at`,
          [accountId, c.detailId, c.periodKey, c.detailType, c.detailSubType, c.concept, c.orderId, c.amount, c.chargedAt]
        );
        saved += 1;
      }
    }
    return saved;
  } catch (err) {
    console.error("No se pudo sincronizar la facturación de ML, se continúa sin ese dato:", (err as Error).message);
    return 0;
  }
}

interface OrderItemRow {
  id: number;
  productid: string;
  quantity: number;
  datecreated: string | Date;
  unitprice: number;
  mlcommission: number;
  shippingcost: number;
}

async function reallocateAdsCosts(db: QueryExecutor, accountId: string, hasIva: boolean, otherTaxRate = 0): Promise<void> {
  const itemsResult = await db.query<OrderItemRow>(
    `SELECT oi.id, oi.product_id as productId, oi.quantity, o.date_created as dateCreated,
            oi.unit_price as unitPrice, oi.ml_commission as mlCommission,
            oi.shipping_cost as shippingCost
     FROM order_items oi JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
     WHERE oi.account_id = $1`,
    [accountId]
  );
  const items = itemsResult.rows;

  const unitsSoldByProductDate = new Map<string, number>();
  for (const it of items) {
    const key = `${it.productid}|${new Date(it.datecreated).toISOString().slice(0, 10)}`;
    unitsSoldByProductDate.set(key, (unitsSoldByProductDate.get(key) ?? 0) + Number(it.quantity));
  }

  const adsResult = await db.query<{ productid: string; date: string | Date; amount: number }>(
    `SELECT product_id as productId, date, amount FROM ads_spend WHERE account_id = $1 AND channel = 'mercado_ads'`,
    [accountId]
  );
  const adsByProductDate = new Map<string, number>();
  for (const row of adsResult.rows) {
    const dateStr = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10);
    adsByProductDate.set(`${row.productid}|${dateStr}`, Number(row.amount));
  }

  // Recalculamos cost_applied acá también (no solo al insertar la orden): un
  // sync normal solo trae órdenes nuevas (ver sinceIso en /api/sync), así que
  // si cargás el costo de un producto después, las ventas viejas de ese
  // producto nunca se reinsertan — sin esto, se quedarían con cost_applied
  // congelado en null para siempre en vez de tomar el costo recién cargado.
  const costsResult = await db.query<{ productid: string; cost: number; tax: number; validfrom: string | Date }>(
    `SELECT product_id as productId, cost, tax, valid_from as validFrom FROM product_costs WHERE account_id = $1`,
    [accountId]
  );
  const costsByProduct = new Map<string, { cost: number; tax: number; validFrom: string }[]>();
  for (const row of costsResult.rows) {
    const list = costsByProduct.get(row.productid) ?? [];
    list.push({ cost: Number(row.cost), tax: Number(row.tax), validFrom: new Date(row.validfrom).toISOString() });
    costsByProduct.set(row.productid, list);
  }

  for (const it of items) {
    const key = `${it.productid}|${new Date(it.datecreated).toISOString().slice(0, 10)}`;
    const dailySpend = adsByProductDate.get(key) ?? 0;
    const unitsSoldThatDay = unitsSoldByProductDate.get(key) ?? 0;
    const adsCostAllocated = allocateAdsCost(dailySpend, unitsSoldThatDay, Number(it.quantity));
    const entry = getCostEntryAtDate(costsByProduct.get(it.productid) ?? [], new Date(it.datecreated).toISOString());
    const profitInput = {
      unitPrice: Number(it.unitprice),
      quantity: Number(it.quantity),
      mlCommission: Number(it.mlcommission),
      shippingCost: Number(it.shippingcost),
      adsCostAllocated,
      costApplied: entry?.cost ?? null,
      taxApplied: Number(it.unitprice) * otherTaxRate,
    };
    const netProfit = calculateNetProfit(profitInput);
    await db.query(
      `UPDATE order_items SET ads_cost_allocated = $1, net_profit = $2, cost_applied = $3, tax_applied = $4${hasIva ? ", iva_applied = $6" : ""} WHERE id = $5`,
      [adsCostAllocated, netProfit, entry?.cost ?? null, profitInput.taxApplied, it.id, ...(hasIva ? [calculateIva(profitInput)] : [])]
    );
  }
}
