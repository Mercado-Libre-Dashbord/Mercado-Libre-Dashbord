import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ml-client", async () => {
  const actual = await vi.importActual<typeof import("./ml-client")>("./ml-client");
  return { ...actual, mlFetch: vi.fn() };
});
vi.mock("./auth", () => ({ getValidAccessToken: vi.fn().mockResolvedValue("token") }));

import {
  listProducts,
  getOrderDetail,
  listOrders,
  listUnansweredQuestions,
  answerQuestion,
  updateProductPriceStock,
  getAdsSpend,
  listCampaigns,
  setCampaignStatus,
  splitIntoWindows,
  createSellerCoupon,
  listBillingPeriods,
} from "./tools";
import { mlFetch, MlApiError } from "./ml-client";

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
    expect(products[0]).toEqual({
      id: "MLA1", title: "Producto 1", sku: "SKU1", price: 1000, stock: 5, permalink: "url1",
      categoryId: null, categoryName: null, thumbnail: null,
    });
  });

  it("prefers the https thumbnail so the browser does not block it", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: ["MLA1", "MLA2"] })
      .mockResolvedValueOnce([
        { body: { id: "MLA1", title: "A", price: 1, available_quantity: 1, permalink: "", secure_thumbnail: "https://x/a.jpg", thumbnail: "http://x/a.jpg" } },
        { body: { id: "MLA2", title: "B", price: 1, available_quantity: 1, permalink: "", thumbnail: "http://x/b.jpg" } },
      ]);

    const products = await listProducts("acc1", "123");

    expect(products[0].thumbnail).toBe("https://x/a.jpg");
    expect(products[1].thumbnail).toBe("http://x/b.jpg");
  });

  it("resolves each category name once, not once per product", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: ["MLA1", "MLA2", "MLA3"] })
      .mockResolvedValueOnce([
        { body: { id: "MLA1", title: "A", price: 1, available_quantity: 1, permalink: "", category_id: "MLA111" } },
        { body: { id: "MLA2", title: "B", price: 1, available_quantity: 1, permalink: "", category_id: "MLA111" } },
        { body: { id: "MLA3", title: "C", price: 1, available_quantity: 1, permalink: "", category_id: "MLA222" } },
      ])
      .mockResolvedValueOnce({ name: "Camping" })
      .mockResolvedValueOnce({ name: "Cocina" });

    const products = await listProducts("acc1", "123");

    const categoryCalls = vi.mocked(mlFetch).mock.calls.filter((c) => String(c[0]).startsWith("/categories/"));
    expect(categoryCalls).toHaveLength(2);
    expect(products.map((p) => p.categoryName).sort()).toEqual(["Camping", "Camping", "Cocina"]);
  });

  it("keeps the product when its category name cannot be resolved", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: ["MLA1"] })
      .mockResolvedValueOnce([
        { body: { id: "MLA1", title: "A", price: 1, available_quantity: 1, permalink: "", category_id: "MLA111" } },
      ])
      .mockRejectedValueOnce(new MlApiError(404, "not found"));

    const products = await listProducts("acc1", "123");

    expect(products).toHaveLength(1);
    expect(products[0].categoryId).toBe("MLA111");
    expect(products[0].categoryName).toBeNull();
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

describe("listOrders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns order ids from the search results", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ results: [{ id: 1 }, { id: 2 }], paging: { total: 2 } });
    expect(await listOrders("acc1", "123", "2026-01-01T00:00:00Z")).toEqual(["1", "2"]);
  });

  it("pages through every order instead of stopping at the first 50", async () => {
    const page = (n: number, from: number) => ({
      results: Array.from({ length: n }, (_, i) => ({ id: from + i })),
      paging: { total: 120 },
    });
    vi.mocked(mlFetch)
      .mockResolvedValueOnce(page(50, 1))
      .mockResolvedValueOnce(page(50, 51))
      .mockResolvedValueOnce(page(20, 101));

    const ids = await listOrders("acc1", "S1", "2020-01-01T00:00:00Z");

    expect(ids).toHaveLength(120);
    expect(vi.mocked(mlFetch).mock.calls[1][0]).toContain("offset=50");
  });
});

describe("getOrderDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps order items, with no shipping charge when the order has no shipment", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({
      id: 999,
      date_created: "2026-01-01T00:00:00Z",
      status: "paid",
      total_amount: 1000,
      order_items: [{ item: { id: "MLA1" }, unit_price: 500, quantity: 2, sale_fee: 65 }],
    });
    const order = await getOrderDetail("acc1", "999");
    // Sin título en la respuesta de ML, el id es el fallback: preferimos un
    // nombre feo antes que una ficha de producto sin nombre.
    expect(order.items).toEqual([{ productId: "MLA1", productTitle: "MLA1", unitPrice: 500, quantity: 2, mlCommission: 65, shippingCost: 0 }]);
    // Sin shipment no se pide /shipments/.../costs.
    expect(vi.mocked(mlFetch)).toHaveBeenCalledTimes(1);
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

describe("listUnansweredQuestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps ML's question shape to our own", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({
      questions: [{ id: 55, item_id: "MLA1", text: "¿Tiene stock?", date_created: "2026-01-01T00:00:00Z" }],
    });
    const questions = await listUnansweredQuestions("acc1", "123");
    expect(questions).toEqual([{ id: 55, productId: "MLA1", text: "¿Tiene stock?", dateCreated: "2026-01-01T00:00:00Z" }]);
  });

  it("returns an empty array when there are no unanswered questions", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ questions: [] });
    expect(await listUnansweredQuestions("acc1", "123")).toEqual([]);
  });
});

describe("answerQuestion", () => {
  it("posts the question id and text to /answers", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({});
    await answerQuestion("acc1", 55, "Sí, tenemos stock.");
    expect(vi.mocked(mlFetch)).toHaveBeenCalledWith(
      "/answers",
      "token",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ question_id: 55, text: "Sí, tenemos stock." }) })
    );
  });
});

describe("updateProductPriceStock", () => {
  it("PUTs only the fields that were passed", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({});
    await updateProductPriceStock("acc1", "MLA1", { price: 21500 });
    expect(vi.mocked(mlFetch)).toHaveBeenCalledWith(
      "/items/MLA1",
      "token",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ price: 21500 }) })
    );
  });

  it("PUTs stock as available_quantity", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({});
    await updateProductPriceStock("acc1", "MLA1", { stock: 10 });
    expect(vi.mocked(mlFetch)).toHaveBeenCalledWith(
      "/items/MLA1",
      "token",
      expect.objectContaining({ body: JSON.stringify({ available_quantity: 10 }) })
    );
  });
});

describe("getOrderDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the seller's shipping cost from /shipments/{id}/costs, not from the order", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({
        id: 999,
        date_created: "2026-01-05T10:00:00Z",
        status: "paid",
        total_amount: 1000,
        shipping: { id: 5551 },
        order_items: [{ item: { id: "MLA1" }, unit_price: 1000, quantity: 1, sale_fee: 130 }],
      })
      .mockResolvedValueOnce({ senders: [{ cost: 420 }] });

    const order = await getOrderDetail("acc1", "999");

    expect(vi.mocked(mlFetch).mock.calls[1][0]).toBe("/shipments/5551/costs");
    expect(order.items[0].shippingCost).toBe(420);
  });

  it("splits one order's shipping across its lines instead of charging it to each", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({
        id: 999,
        date_created: "2026-01-05T10:00:00Z",
        status: "paid",
        total_amount: 1000,
        shipping: { id: 5551 },
        order_items: [
          { item: { id: "MLA1" }, unit_price: 750, quantity: 1, sale_fee: 100 },
          { item: { id: "MLA2" }, unit_price: 250, quantity: 1, sale_fee: 30 },
        ],
      })
      .mockResolvedValueOnce({ senders: [{ cost: 400 }] });

    const order = await getOrderDetail("acc1", "999");

    expect(order.items[0].shippingCost).toBeCloseTo(300);
    expect(order.items[1].shippingCost).toBeCloseTo(100);
    const total = order.items.reduce((s, i) => s + i.shippingCost, 0);
    expect(total).toBeCloseTo(400);
  });

  it("falls back to zero shipping instead of failing the order when the shipment lookup errors", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({
        id: 999,
        date_created: "2026-01-05T10:00:00Z",
        status: "paid",
        total_amount: 1000,
        shipping: { id: 5551 },
        order_items: [{ item: { id: "MLA1" }, unit_price: 1000, quantity: 1, sale_fee: 130 }],
      })
      .mockRejectedValueOnce(new MlApiError(403, "forbidden"));

    const order = await getOrderDetail("acc1", "999");
    expect(order.items[0].shippingCost).toBe(0);
  });

  it("charges no shipping when the buyer paid it (empty senders)", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({
        id: 999,
        date_created: "2026-01-05T10:00:00Z",
        status: "paid",
        total_amount: 1000,
        shipping: { id: 5551 },
        order_items: [{ item: { id: "MLA1" }, unit_price: 1000, quantity: 1, sale_fee: 130 }],
      })
      .mockResolvedValueOnce({ senders: [], receiver: { cost: 400 } });

    const order = await getOrderDetail("acc1", "999");
    expect(order.items[0].shippingCost).toBe(0);
  });
});

describe("splitIntoWindows", () => {
  it("keeps a short range as a single window", () => {
    expect(splitIntoWindows("2026-08-01", "2026-08-10")).toEqual([{ from: "2026-08-01", to: "2026-08-10" }]);
  });

  it("nunca arma una ventana que roce el límite de la API", () => {
    const windows = splitIntoWindows("2020-01-01", "2026-08-25");
    for (const w of windows) {
      const days = (Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / 86400000;
      // Con margen: la API rechazó un rango de 90 días contados inclusive.
      expect(days).toBeLessThanOrEqual(79);
    }
  });

  it("covers the range end to end with no gaps or overlaps", () => {
    const windows = splitIntoWindows("2026-01-01", "2026-08-25");
    expect(windows[0].from).toBe("2026-01-01");
    expect(windows[windows.length - 1].to).toBe("2026-08-25");
    for (let i = 1; i < windows.length; i += 1) {
      const prevEnd = Date.parse(`${windows[i - 1].to}T00:00:00Z`);
      const thisStart = Date.parse(`${windows[i].from}T00:00:00Z`);
      expect(thisStart - prevEnd).toBe(86400000);
    }
  });

  it("returns nothing for an inverted or invalid range", () => {
    expect(splitIntoWindows("2026-08-25", "2026-01-01")).toEqual([]);
    expect(splitIntoWindows("no-es-fecha", "2026-01-01")).toEqual([]);
  });
});

describe("getAdsSpend", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty array when the account has no Product Ads advertiser", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ advertisers: [] });
    expect(await getAdsSpend("acc1", "123", "2026-01-01", "2026-01-31")).toEqual([]);
    expect(vi.mocked(mlFetch)).toHaveBeenCalledTimes(1);
  });

  it("returns no ad spend instead of failing the whole sync on a 404", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockRejectedValueOnce(new MlApiError(404, "advertiser_campaigns_not_found"));

    expect(await getAdsSpend("acc1", "123", "2026-01-01", "2026-01-31")).toEqual([]);
  });

  it("resolves the advertiser id and site id before listing campaigns", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockResolvedValueOnce({
        results: [{ metrics_by_day: [{ item_id: "MLA1", date: "2026-01-05", cost: 100 }] }],
      });

    const rows = await getAdsSpend("acc1", "123", "2026-01-01", "2026-01-31");

    expect(rows).toEqual([{ productId: "MLA1", date: "2026-01-05", amount: 100 }]);
    expect(vi.mocked(mlFetch).mock.calls[1][0]).toBe(
      "/marketplace/advertising/MLA/advertisers/999/product_ads/campaigns/search?date_from=2026-01-01&date_to=2026-01-31&metrics=cost"
    );
    expect(vi.mocked(mlFetch).mock.calls[1][2]).toEqual(expect.objectContaining({ headers: { "Api-Version": "2" } }));
  });

  it("parte un historial largo en ventanas cortas en vez de comerse un 400", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockResolvedValue({ results: [] });

    await getAdsSpend("acc1", "123", "2026-01-01", "2026-08-25");

    const searchCalls = vi.mocked(mlFetch).mock.calls.filter((c) => String(c[0]).includes("campaigns/search"));
    expect(searchCalls.length).toBeGreaterThan(1);
    for (const call of searchCalls) {
      const url = new URL(`https://x${call[0]}`);
      const from = Date.parse(`${url.searchParams.get("date_from")}T00:00:00Z`);
      const to = Date.parse(`${url.searchParams.get("date_to")}T00:00:00Z`);
      expect((to - from) / 86400000).toBeLessThanOrEqual(89);
    }
  });
});

describe("listCampaigns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty array when there is no advertiser", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ advertisers: [] });
    expect(await listCampaigns("acc1")).toEqual([]);
  });

  it("treats a 404 from Mercado Libre as 'no campaigns yet', not an error", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockRejectedValueOnce(new MlApiError(404, "advertiser_campaigns_not_found"));

    expect(await listCampaigns("acc1")).toEqual([]);
  });

  it("maps campaign fields", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockResolvedValueOnce({ results: [{ id: 1, name: "Campaña 1", status: "active", budget: 5000 }] });

    expect(await listCampaigns("acc1")).toEqual([{ id: "1", name: "Campaña 1", status: "active", budget: 5000 }]);
    const url = new URL(`https://x${vi.mocked(mlFetch).mock.calls[1][0]}`);
    expect(url.pathname).toBe("/marketplace/advertising/MLA/advertisers/999/product_ads/campaigns/search");
    // La API rechaza con 400 cualquier rango de más de 90 días.
    const from = Date.parse(`${url.searchParams.get("date_from")}T00:00:00Z`);
    const to = Date.parse(`${url.searchParams.get("date_to")}T00:00:00Z`);
    expect((to - from) / 86400000).toBeLessThanOrEqual(89);
  });
});

describe("setCampaignStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when there is no advertiser", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ advertisers: [] });
    await expect(setCampaignStatus("acc1", "1", "paused")).rejects.toBeInstanceOf(MlApiError);
  });

  it("PUTs the new status for the campaign", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockResolvedValueOnce({});

    await setCampaignStatus("acc1", "1", "paused");

    expect(vi.mocked(mlFetch)).toHaveBeenCalledWith(
      "/marketplace/advertising/MLA/advertisers/999/product_ads/campaigns/1",
      "token",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: "paused" }) })
    );
  });
});

describe("createSellerCoupon", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a real Mercado Libre coupon campaign", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ id: 55, coupon_code: "GRACIAS", status: "active" });

    const coupon = await createSellerCoupon("acc1", {
      name: "Programa de fidelidad",
      amount: 2000,
      minPurchase: 10000,
      budget: 100000,
      durationDays: 30,
    });

    expect(coupon).toEqual({ id: "55", code: "GRACIAS", status: "active" });

    const [url, , init] = vi.mocked(mlFetch).mock.calls[0];
    expect(url).toBe("/seller-promotions/promotions");
    const body = JSON.parse((init as any).body);
    expect(body.promotion_type).toBe("SELLER_COUPON_CAMPAIGN");
    expect(body.fixed_amount).toBe(2000);
    expect(body.min_purchase_amount).toBe(10000);
    // El presupuesto es el tope duro: sin él un error de configuración podría
    // descontar sin límite.
    expect(body.budget).toBe(100000);
  });

  it("sets the campaign window from today for the requested days", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ id: 1 });

    await createSellerCoupon("acc1", { name: "x", amount: 1, minPurchase: 2, budget: 3, durationDays: 30 });

    const body = JSON.parse((vi.mocked(mlFetch).mock.calls[0][2] as any).body);
    const days = (Date.parse(body.finish_date) - Date.parse(body.start_date)) / 86400000;
    expect(days).toBeCloseTo(30, 1);
  });
});

describe("listBillingPeriods", () => {
  beforeEach(() => vi.clearAllMocks());

  it("manda document_type, que la API exige", async () => {
    // Sin este parámetro ML responde 422 y la conciliación con la factura
    // quedaba vacía sin que nada lo dijera: el sync captura el error y sigue.
    vi.mocked(mlFetch).mockResolvedValueOnce({ results: [] });

    await listBillingPeriods("acc1");

    const url = vi.mocked(mlFetch).mock.calls[0][0] as string;
    expect(url).toContain("document_type=BILL");
    expect(url).toContain("group=ML");
  });

  it("mapea los períodos y descarta los que no traen clave", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({
      results: [
        { key: "2026-07-01", period: { date_from: "2026-07-01", date_to: "2026-07-31" }, amount: 1234.5 },
        { period: { date_from: null, date_to: null }, amount: 0 },
      ],
    });

    const periods = await listBillingPeriods("acc1");

    expect(periods).toEqual([
      { key: "2026-07-01", dateFrom: "2026-07-01", dateTo: "2026-07-31", amount: 1234.5 },
    ]);
  });
});
