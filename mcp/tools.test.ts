import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ml-client", () => ({ mlFetch: vi.fn() }));
vi.mock("./auth", () => ({ getValidAccessToken: vi.fn().mockResolvedValue("token") }));

import { listProducts, getOrderDetail, listOrders } from "./tools";
import { mlFetch } from "./ml-client";

describe("listProducts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty array when the seller has no active items", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ results: [] });
    expect(await listProducts("acc1", "123")).toEqual([]);
  });

  it("fetches details for each item id found in the search", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: ["MLA1", "MLA2"] })
      .mockResolvedValueOnce([
        { body: { id: "MLA1", title: "Producto 1", seller_custom_field: "SKU1", price: 1000, available_quantity: 5, permalink: "url1" } },
        { body: { id: "MLA2", title: "Producto 2", seller_custom_field: null, price: 2000, available_quantity: 3, permalink: "url2" } },
      ]);
    const products = await listProducts("acc1", "123");
    expect(products).toHaveLength(2);
    expect(products[0]).toEqual({ id: "MLA1", title: "Producto 1", sku: "SKU1", price: 1000, stock: 5, permalink: "url1" });
  });

  it("batches the /items lookup in groups of 20 ids", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `MLA${i}`);
    const firstBatch = ids.slice(0, 20).map((id) => ({ body: { id, title: id, price: 1, available_quantity: 1, permalink: "" } }));
    const secondBatch = ids.slice(20).map((id) => ({ body: { id, title: id, price: 1, available_quantity: 1, permalink: "" } }));
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: ids })
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);

    const products = await listProducts("acc1", "123");

    expect(products).toHaveLength(25);
    expect(vi.mocked(mlFetch)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(mlFetch).mock.calls[1][0]).toContain(ids.slice(0, 20).join(","));
    expect(vi.mocked(mlFetch).mock.calls[2][0]).toContain(ids.slice(20).join(","));
  });

  it("pages through items/search when there are more results than one page", async () => {
    const firstPageIds = Array.from({ length: 50 }, (_, i) => `MLA${i}`);
    const secondPageIds = ["MLA50", "MLA51"];
    const allIds = [...firstPageIds, ...secondPageIds];
    const detailsFor = (ids: string[]) =>
      ids.map((id) => ({ body: { id, title: id, price: 1, available_quantity: 1, permalink: "" } }));

    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: firstPageIds, paging: { total: 52 } })
      .mockResolvedValueOnce({ results: secondPageIds, paging: { total: 52 } })
      .mockResolvedValueOnce(detailsFor(allIds.slice(0, 20)))
      .mockResolvedValueOnce(detailsFor(allIds.slice(20, 40)))
      .mockResolvedValueOnce(detailsFor(allIds.slice(40)));

    const products = await listProducts("acc1", "123");

    expect(products).toHaveLength(52);
    expect(vi.mocked(mlFetch).mock.calls[0][0]).toContain("offset=0");
    expect(vi.mocked(mlFetch).mock.calls[1][0]).toContain("offset=50");
  });
});

describe("getOrderDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps order items with the shared shipping cost per line", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({
      id: 999,
      date_created: "2026-01-01T00:00:00Z",
      status: "paid",
      total_amount: 1000,
      shipping: { cost: 90 },
      order_items: [{ item: { id: "MLA1" }, unit_price: 500, quantity: 2, sale_fee: 65 }],
    });
    const order = await getOrderDetail("acc1", "999");
    expect(order.items).toEqual([{ productId: "MLA1", unitPrice: 500, quantity: 2, mlCommission: 65, shippingCost: 90 }]);
  });

  it("defaults shipping cost to 0 when the order has no shipping info", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({
      id: 1000,
      date_created: "2026-01-01T00:00:00Z",
      status: "paid",
      total_amount: 500,
      order_items: [{ item: { id: "MLA1" }, unit_price: 500, quantity: 1, sale_fee: 65 }],
    });
    const order = await getOrderDetail("acc1", "1000");
    expect(order.items[0].shippingCost).toBe(0);
  });
});

describe("listOrders", () => {
  it("returns order ids from the search results", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ results: [{ id: 1 }, { id: 2 }] });
    expect(await listOrders("acc1", "123", "2026-01-01T00:00:00Z")).toEqual(["1", "2"]);
  });
});
