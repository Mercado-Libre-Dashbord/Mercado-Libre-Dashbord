import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listProducts, listOrders, getOrderDetail, getAdsSpend } from "./tools";

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "ml-dashboard-mcp", version: "1.0.0" });

  server.tool(
    "list_products",
    { accountId: z.string(), sellerId: z.string() },
    async ({ accountId, sellerId }) => ({
      content: [{ type: "text", text: JSON.stringify(await listProducts(accountId, sellerId)) }],
    })
  );

  server.tool(
    "list_orders",
    { accountId: z.string(), sellerId: z.string(), sinceIso: z.string() },
    async ({ accountId, sellerId, sinceIso }) => ({
      content: [{ type: "text", text: JSON.stringify(await listOrders(accountId, sellerId, sinceIso)) }],
    })
  );

  server.tool(
    "get_order_detail",
    { accountId: z.string(), orderId: z.string() },
    async ({ accountId, orderId }) => ({
      content: [{ type: "text", text: JSON.stringify(await getOrderDetail(accountId, orderId)) }],
    })
  );

  server.tool(
    "get_ads_spend",
    { accountId: z.string(), sellerId: z.string(), dateFrom: z.string(), dateTo: z.string() },
    async ({ accountId, sellerId, dateFrom, dateTo }) => ({
      content: [{ type: "text", text: JSON.stringify(await getAdsSpend(accountId, sellerId, dateFrom, dateTo)) }],
    })
  );

  return server;
}
