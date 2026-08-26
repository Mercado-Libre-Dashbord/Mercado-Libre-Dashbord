import { describe, it, expect, vi, beforeEach } from "vitest";
import { TiendaNubeChannel, normalizeStatus } from "./tiendanube";

const creds = async () => ({ storeId: "12345", accessToken: "tok" });

function mockFetch(response: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("normalizeStatus", () => {
  it("treats a cancelled order as cancelled whatever the payment says", () => {
    expect(normalizeStatus({ status: "cancelled", payment_status: "paid" })).toBe("cancelled");
  });

  it("only counts an order as paid when the payment went through", () => {
    expect(normalizeStatus({ status: "open", payment_status: "paid" })).toBe("paid");
    expect(normalizeStatus({ status: "open", payment_status: "pending" })).toBe("pending");
    expect(normalizeStatus({})).toBe("pending");
  });
});

describe("TiendaNubeChannel", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("authenticates the way this API expects, not the usual way", async () => {
    const fetchMock = mockFetch([]);
    await new TiendaNubeChannel(creds).listProducts("acc1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/12345/products");
    // Es "Authentication", no "Authorization": particularidad de Tienda Nube.
    expect(init.headers.Authentication).toBe("bearer tok");
    // Sin User-Agent la API responde 400.
    expect(init.headers["User-Agent"]).toBeTruthy();
  });

  it("splits one order's shipping across its lines", async () => {
    mockFetch({
      id: 9,
      created_at: "2026-08-01T10:00:00Z",
      status: "open",
      payment_status: "paid",
      total: 1000,
      shipping_cost_owner: "400",
      products: [
        { product_id: 1, price: "750", quantity: 1 },
        { product_id: 2, price: "250", quantity: 1 },
      ],
    });

    const order = await new TiendaNubeChannel(creds).getOrder("acc1", "9");

    expect(order.items[0].shippingCost).toBeCloseTo(300);
    expect(order.items[1].shippingCost).toBeCloseTo(100);
    expect(order.items.reduce((s, i) => s + i.shippingCost, 0)).toBeCloseTo(400);
  });

  it("reports no platform fee, because Tienda Nube charges subscription not commission", async () => {
    mockFetch({
      id: 9, created_at: "2026-08-01T10:00:00Z", status: "open", payment_status: "paid",
      total: 1000, products: [{ product_id: 1, price: "1000", quantity: 1 }],
    });

    const order = await new TiendaNubeChannel(creds).getOrder("acc1", "9");
    expect(order.items[0].platformFee).toBe(0);
  });

  it("reads a localised product name and the first variant's price and stock", async () => {
    mockFetch([
      {
        id: 7,
        name: { es: "Anafe Camping" },
        canonical_url: "https://tienda.com/anafe",
        variants: [{ sku: "ANF-1", price: "32000", stock: 96 }],
        images: [{ src: "https://cdn/anafe.jpg" }],
        categories: [{ id: 3, name: { es: "Camping" } }],
      },
    ]);

    const [product] = await new TiendaNubeChannel(creds).listProducts("acc1");

    expect(product).toMatchObject({
      id: "7", title: "Anafe Camping", sku: "ANF-1", price: 32000, stock: 96,
      categoryName: "Camping", thumbnail: "https://cdn/anafe.jpg",
    });
  });

  it("surfaces API errors instead of returning empty data", async () => {
    mockFetch({ message: "unauthorized" }, false, 401);
    await expect(new TiendaNubeChannel(creds).listProducts("acc1")).rejects.toThrow(/401/);
  });
});
