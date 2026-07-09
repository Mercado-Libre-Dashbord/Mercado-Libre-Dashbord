import type { DatabaseSync } from "node:sqlite";
import { listProducts, listOrders, getOrderDetail, getAdsSpend } from "@/mcp/tools";
import { getCostAtDate, allocateAdsCost, calculateNetProfit } from "./profitability";

export interface SyncResult {
  productsSynced: number;
  ordersSynced: number;
  adsRowsSynced: number;
}

export async function runSync(db: DatabaseSync, sellerId: string, sinceIso: string): Promise<SyncResult> {
  const now = new Date().toISOString();

  const products = await listProducts(sellerId);
  const upsertProduct = db.prepare(
    `INSERT INTO products (id, title, sku, current_price, stock, permalink, updated_at)
     VALUES (@id, @title, @sku, @price, @stock, @permalink, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, sku = excluded.sku, current_price = excluded.current_price,
       stock = excluded.stock, permalink = excluded.permalink, updated_at = excluded.updated_at`
  );
  for (const p of products) {
    upsertProduct.run({ ...p, updated_at: now });
  }

  const orderIds = await listOrders(sellerId, sinceIso);
  const upsertOrder = db.prepare(
    `INSERT INTO orders (id, date_created, status, buyer_total) VALUES (@id, @date_created, @status, @buyer_total)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, buyer_total = excluded.buyer_total`
  );
  const deleteItemsForOrder = db.prepare(`DELETE FROM order_items WHERE order_id = ?`);
  const insertItem = db.prepare(
    `INSERT INTO order_items
      (order_id, product_id, unit_price, quantity, ml_commission, shipping_cost, ads_cost_allocated, cost_applied, net_profit)
     VALUES (@order_id, @product_id, @unit_price, @quantity, @ml_commission, @shipping_cost, @ads_cost_allocated, @cost_applied, @net_profit)`
  );
  const getCosts = db.prepare(`SELECT cost, valid_from as validFrom FROM product_costs WHERE product_id = ?`);

  let ordersSynced = 0;
  for (const orderId of orderIds) {
    const order = await getOrderDetail(orderId);
    upsertOrder.run({ id: order.id, date_created: order.dateCreated, status: order.status, buyer_total: order.buyerTotal });
    deleteItemsForOrder.run(order.id);

    for (const item of order.items) {
      const costs = getCosts.all(item.productId) as { cost: number; validFrom: string }[];
      const costApplied = getCostAtDate(costs, order.dateCreated);
      const netProfit = calculateNetProfit({
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        mlCommission: item.mlCommission,
        shippingCost: item.shippingCost,
        adsCostAllocated: 0,
        costApplied,
      });
      insertItem.run({
        order_id: order.id,
        product_id: item.productId,
        unit_price: item.unitPrice,
        quantity: item.quantity,
        ml_commission: item.mlCommission,
        shipping_cost: item.shippingCost,
        ads_cost_allocated: 0,
        cost_applied: costApplied,
        net_profit: netProfit,
      });
    }
    ordersSynced += 1;
  }

  let adsRowsSynced = 0;
  try {
    const dateTo = now.slice(0, 10);
    const adsRows = await getAdsSpend(sellerId, sinceIso.slice(0, 10), dateTo);
    // Solo borra filas de Mercado Ads: las cargadas a mano (Meta/Google/TikTok,
    // Task 15) tienen otro channel y no deben tocarse en un re-sync de ML.
    const deleteAdsForRange = db.prepare(
      `DELETE FROM ads_spend WHERE channel = 'mercado_ads' AND date >= ? AND date <= ?`
    );
    deleteAdsForRange.run(sinceIso.slice(0, 10), dateTo);
    const upsertAds = db.prepare(
      `INSERT INTO ads_spend (product_id, date, amount, channel) VALUES (?, ?, ?, 'mercado_ads')`
    );
    for (const row of adsRows) {
      upsertAds.run(row.productId, row.date, row.amount);
    }
    adsRowsSynced = adsRows.length;
  } catch (err) {
    // La sincronización de productos y órdenes ya se guardó arriba; si falla
    // Mercado Ads (ej. sin acceso a la API) el resto del dashboard sigue
    // funcionando, solo sin dato de publicidad hasta el próximo sync exitoso.
    console.error("No se pudo sincronizar publicidad, se continúa sin ese dato:", (err as Error).message);
  }

  reallocateAdsCosts(db);

  return { productsSynced: products.length, ordersSynced, adsRowsSynced };
}

function reallocateAdsCosts(db: DatabaseSync): void {
  const items = db
    .prepare(
      `SELECT oi.id, oi.product_id as productId, oi.quantity, o.date_created as dateCreated,
              oi.unit_price as unitPrice, oi.ml_commission as mlCommission,
              oi.shipping_cost as shippingCost, oi.cost_applied as costApplied
       FROM order_items oi JOIN orders o ON o.id = oi.order_id`
    )
    .all() as any[];

  const unitsSoldByProductDate = new Map<string, number>();
  for (const it of items) {
    const key = `${it.productId}|${it.dateCreated.slice(0, 10)}`;
    unitsSoldByProductDate.set(key, (unitsSoldByProductDate.get(key) ?? 0) + it.quantity);
  }

  const adsByProductDate = new Map<string, number>();
  for (const row of db
    .prepare(`SELECT product_id as productId, date, amount FROM ads_spend WHERE channel = 'mercado_ads'`)
    .all() as any[]) {
    adsByProductDate.set(`${row.productId}|${row.date}`, row.amount);
  }

  const updateItem = db.prepare(`UPDATE order_items SET ads_cost_allocated = ?, net_profit = ? WHERE id = ?`);

  for (const it of items) {
    const key = `${it.productId}|${it.dateCreated.slice(0, 10)}`;
    const dailySpend = adsByProductDate.get(key) ?? 0;
    const unitsSoldThatDay = unitsSoldByProductDate.get(key) ?? 0;
    const adsCostAllocated = allocateAdsCost(dailySpend, unitsSoldThatDay, it.quantity);
    const netProfit = calculateNetProfit({
      unitPrice: it.unitPrice,
      quantity: it.quantity,
      mlCommission: it.mlCommission,
      shippingCost: it.shippingCost,
      adsCostAllocated,
      costApplied: it.costApplied,
    });
    updateItem.run(adsCostAllocated, netProfit, it.id);
  }
}
