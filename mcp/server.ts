import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listProducts, listOrders, getOrderDetail, getAdsSpend } from "./tools";

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "ml-dashboard-mcp", version: "1.0.0" });

  server.tool("list_products", { sellerId: z.string() }, async ({ sellerId }) => ({
    content: [{ type: "text", text: JSON.stringify(await listProducts(sellerId)) }],
  }));

  server.tool(
    "list_orders",
    { sellerId: z.string(), sinceIso: z.string() },
    async ({ sellerId, sinceIso }) => ({
      content: [{ type: "text", text: JSON.stringify(await listOrders(sellerId, sinceIso)) }],
    })
  );

  server.tool("get_order_detail", { orderId: z.string() }, async ({ orderId }) => ({
    content: [{ type: "text", text: JSON.stringify(await getOrderDetail(orderId)) }],
  }));

  server.tool(
    "get_ads_spend",
    { sellerId: z.string(), dateFrom: z.string(), dateTo: z.string() },
    async ({ sellerId, dateFrom, dateTo }) => ({
      content: [{ type: "text", text: JSON.stringify(await getAdsSpend(sellerId, dateFrom, dateTo)) }],
    })
  );

  return server;
}
