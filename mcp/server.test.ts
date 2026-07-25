import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("./tools", () => ({
  listProducts: vi.fn().mockResolvedValue([{ id: "MLA1", title: "Producto 1" }]),
  listOrders: vi.fn(),
  getOrderDetail: vi.fn(),
  getAdsSpend: vi.fn(),
}));

import { createMcpServer } from "./server";

describe("createMcpServer", () => {
  it("exposes list_products as a callable MCP tool", async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "list_products", arguments: { accountId: "acc1", sellerId: "123" } });
    const text = (result.content as any[])[0].text;
    expect(JSON.parse(text)).toEqual([{ id: "MLA1", title: "Producto 1" }]);
  });
});
