import type { Client } from "@libsql/client";
import { listProducts, listOrders, getOrderDetail, getAdsSpend } from "@/mcp/tools";
import { getCostAtDate, allocateAdsCost, calculateNetProfit } from "./profitability";

export interface SyncResult {
  productsSynced: number;
  ordersSynced: number;
  adsRowsSynced: number;
}

export async function runSync(
  db: Client,
  accountId: string,
  sellerId: string,
  sinceIso: string
): Promise<SyncResult> {
  const now = new Date().toISOString();

  const products = await listProducts(accountId, sellerId);
  for (const p of products) {
    await db.execute({
      sql: `INSERT INTO products (account_id, id, title, sku, current_price, stock, permalink, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id, id) DO UPDATE SET
              title = excluded.title, sku = excluded.sku, current_price = excluded.current_price,
              stock = excluded.stock, permalink = excluded.permalink, updated_at = excluded.updated_at`,
      args: [accountId, p.id, p.title, p.sku, p.price, p.stock, p.permalink, now],
    });
  }

  const orderIds = await listOrders(accountId, sellerId, sinceIso);
  let ordersSynced = 0;
  for (const orderId of orderIds) {
    const order = await getOrderDetail(accountId, orderId);
    await db.execute({
      sql: `INSERT INTO orders (account_id, id, date_created, status, buyer_total) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(account_id, id) DO UPDATE SET status = excluded.status, buyer_total = excluded.buyer_total`,
      args: [accountId, order.id, order.dateCreated, order.status, order.buyerTotal],
    });
    await db.execute({
      sql: `DELETE FROM order_items WHERE account_id = ? AND order_id = ?`,
      args: [accountId, order.id],
    });

    for (const item of order.items) {
      const costsResult = await db.execute({
        sql: `SELECT cost, valid_from as validFrom FROM product_costs WHERE account_id = ? AND product_id = ?`,
        args: [accountId, item.productId],
      });
      const costs = costsResult.rows as unknown as { cost: number; validFrom: string }[];
      const costApplied = getCostAtDate(costs, order.dateCreated);
      const netProfit = calculateNetProfit({
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        mlCommission: item.mlCommission,
        shippingCost: item.shippingCost,
        adsCostAllocated: 0,
        costApplied,
      });
      await db.execute({
        sql: `INSERT INTO order_items
                (account_id, order_id, product_id, unit_price, quantity, ml_commission, shipping_cost, ads_cost_allocated, cost_applied, net_profit)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
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
        ],
      });
    }
    ordersSynced += 1;
  }

  let adsRowsSynced = 0;
  try {
    const dateTo = now.slice(0, 10);
    const adsRows = await getAdsSpend(accountId, sellerId, sinceIso.slice(0, 10), dateTo);
    // Solo borra filas de Mercado Ads: las cargadas a mano (Meta/Google/TikTok)
    // tienen otro channel y no deben tocarse en un re-sync de ML.
    await db.execute({
      sql: `DELETE FROM ads_spend WHERE account_id = ? AND channel = 'mercado_ads' AND date >= ? AND date <= ?`,
      args: [accountId, sinceIso.slice(0, 10), dateTo],
    });
    for (const row of adsRows) {
      await db.execute({
        sql: `INSERT INTO ads_spend (account_id, product_id, date, amount, channel) VALUES (?, ?, ?, ?, 'mercado_ads')`,
        args: [accountId, row.productId, row.date, row.amount],
      });
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

async function reallocateAdsCosts(db: Client, accountId: string): Promise<void> {
  const itemsResult = await db.execute({
    sql: `SELECT oi.id, oi.product_id as productId, oi.quantity, o.date_created as dateCreated,
                 oi.unit_price as unitPrice, oi.ml_commission as mlCommission,
                 oi.shipping_cost as shippingCost, oi.cost_applied as costApplied
          FROM order_items oi JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
          WHERE oi.account_id = ?`,
    args: [accountId],
  });
  const items = itemsResult.rows as unknown as {
    id: number;
    productId: string;
    quantity: number;
    dateCreated: string;
    unitPrice: number;
    mlCommission: number;
    shippingCost: number;
    costApplied: number | null;
  }[];

  const unitsSoldByProductDate = new Map<string, number>();
  for (const it of items) {
    const key = `${it.productId}|${String(it.dateCreated).slice(0, 10)}`;
    unitsSoldByProductDate.set(key, (unitsSoldByProductDate.get(key) ?? 0) + Number(it.quantity));
  }

  const adsResult = await db.execute({
    sql: `SELECT product_id as productId, date, amount FROM ads_spend WHERE account_id = ? AND channel = 'mercado_ads'`,
    args: [accountId],
  });
  const adsByProductDate = new Map<string, number>();
  for (const row of adsResult.rows as unknown as { productId: string; date: string; amount: number }[]) {
    adsByProductDate.set(`${row.productId}|${row.date}`, Number(row.amount));
  }

  for (const it of items) {
    const key = `${it.productId}|${String(it.dateCreated).slice(0, 10)}`;
    const dailySpend = adsByProductDate.get(key) ?? 0;
    const unitsSoldThatDay = unitsSoldByProductDate.get(key) ?? 0;
    const adsCostAllocated = allocateAdsCost(dailySpend, unitsSoldThatDay, Number(it.quantity));
    const netProfit = calculateNetProfit({
      unitPrice: Number(it.unitPrice),
      quantity: Number(it.quantity),
      mlCommission: Number(it.mlCommission),
      shippingCost: Number(it.shippingCost),
      adsCostAllocated,
      costApplied: it.costApplied === null ? null : Number(it.costApplied),
    });
    await db.execute({
      sql: `UPDATE order_items SET ads_cost_allocated = ?, net_profit = ? WHERE id = ?`,
      args: [adsCostAllocated, netProfit, it.id],
    });
  }
}
