import type { QueryExecutor } from "@/db/client";
import { listProducts, listOrders, getOrderDetail, getAdsSpend } from "@/mcp/tools";
import { getCostAtDate, allocateAdsCost, calculateNetProfit } from "./profitability";

export interface SyncResult {
  productsSynced: number;
  ordersSynced: number;
  adsRowsSynced: number;
}

export async function runSync(
  db: QueryExecutor,
  accountId: string,
  sellerId: string,
  sinceIso: string
): Promise<SyncResult> {
  const now = new Date().toISOString();

  const products = await listProducts(accountId, sellerId);
  for (const p of products) {
    await db.query(
      `INSERT INTO products (account_id, id, title, sku, current_price, stock, permalink, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (account_id, id) DO UPDATE SET
         title = excluded.title, sku = excluded.sku, current_price = excluded.current_price,
         stock = excluded.stock, permalink = excluded.permalink, updated_at = excluded.updated_at`,
      [accountId, p.id, p.title, p.sku, p.price, p.stock, p.permalink, now]
    );
  }

  const orderIds = await listOrders(accountId, sellerId, sinceIso);
  let ordersSynced = 0;
  for (const orderId of orderIds) {
    const order = await getOrderDetail(accountId, orderId);
    await db.query(
      `INSERT INTO orders (account_id, id, date_created, status, buyer_total) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id, id) DO UPDATE SET status = excluded.status, buyer_total = excluded.buyer_total`,
      [accountId, order.id, order.dateCreated, order.status, order.buyerTotal]
    );
    await db.query(`DELETE FROM order_items WHERE account_id = $1 AND order_id = $2`, [accountId, order.id]);

    for (const item of order.items) {
      const costsResult = await db.query<{ cost: number; validfrom: string | Date }>(
        `SELECT cost, valid_from as validFrom FROM product_costs WHERE account_id = $1 AND product_id = $2`,
        [accountId, item.productId]
      );
      const costs = costsResult.rows.map((r) => ({ cost: Number(r.cost), validFrom: new Date(r.validfrom).toISOString() }));
      const costApplied = getCostAtDate(costs, order.dateCreated);
      const netProfit = calculateNetProfit({
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        mlCommission: item.mlCommission,
        shippingCost: item.shippingCost,
        adsCostAllocated: 0,
        costApplied,
      });
      await db.query(
        `INSERT INTO order_items
           (account_id, order_id, product_id, unit_price, quantity, ml_commission, shipping_cost, ads_cost_allocated, cost_applied, net_profit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          accountId,
          order.id,
          item.productId,
          item.unitPrice,
          item.quantity,
          item.mlCommission,
          item.shippingCost,
          0,
          costApplied,
          netProfit,
        ]
      );
    }
    ordersSynced += 1;
  }

  let adsRowsSynced = 0;
  try {
    const dateTo = now.slice(0, 10);
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
    adsRowsSynced = adsRows.length;
  } catch (err) {
    // La sincronización de productos y órdenes ya se guardó arriba; si falla
    // Mercado Ads (ej. sin acceso a la API) el resto del dashboard sigue
    // funcionando, solo sin dato de publicidad hasta el próximo sync exitoso.
    console.error("No se pudo sincronizar publicidad, se continúa sin ese dato:", (err as Error).message);
  }

  await reallocateAdsCosts(db, accountId);

  return { productsSynced: products.length, ordersSynced, adsRowsSynced };
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

async function reallocateAdsCosts(db: QueryExecutor, accountId: string): Promise<void> {
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
  const costsResult = await db.query<{ productid: string; cost: number; validfrom: string | Date }>(
    `SELECT product_id as productId, cost, valid_from as validFrom FROM product_costs WHERE account_id = $1`,
    [accountId]
  );
  const costsByProduct = new Map<string, { cost: number; validFrom: string }[]>();
  for (const row of costsResult.rows) {
    const list = costsByProduct.get(row.productid) ?? [];
    list.push({ cost: Number(row.cost), validFrom: new Date(row.validfrom).toISOString() });
    costsByProduct.set(row.productid, list);
  }

  for (const it of items) {
    const key = `${it.productid}|${new Date(it.datecreated).toISOString().slice(0, 10)}`;
    const dailySpend = adsByProductDate.get(key) ?? 0;
    const unitsSoldThatDay = unitsSoldByProductDate.get(key) ?? 0;
    const adsCostAllocated = allocateAdsCost(dailySpend, unitsSoldThatDay, Number(it.quantity));
    const costApplied = getCostAtDate(costsByProduct.get(it.productid) ?? [], new Date(it.datecreated).toISOString());
    const netProfit = calculateNetProfit({
      unitPrice: Number(it.unitprice),
      quantity: Number(it.quantity),
      mlCommission: Number(it.mlcommission),
      shippingCost: Number(it.shippingcost),
      adsCostAllocated,
      costApplied,
    });
    await db.query(`UPDATE order_items SET ads_cost_allocated = $1, net_profit = $2, cost_applied = $3 WHERE id = $4`, [
      adsCostAllocated,
      netProfit,
      costApplied,
      it.id,
    ]);
  }
}
