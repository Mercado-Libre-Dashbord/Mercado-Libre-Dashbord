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
  getStoreVisits,
  getProductsByIds,
  clampToAdsWindow,
  ADS_LOOKBACK_DAYS,
  getFullStock,
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
      categoryId: null, categoryName: null, thumbnail: null, logisticType: null, inventoryId: null,
    });
  });

  it("reconoce un producto en Full por shipping.logistic_type, e ítems con variantes por variations[0].inventory_id", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: ["MLA1", "MLA2"] })
      .mockResolvedValueOnce([
        { body: { id: "MLA1", title: "A", price: 1, available_quantity: 1, permalink: "", shipping: { logistic_type: "fulfillment" }, inventory_id: "INV1" } },
        { body: { id: "MLA2", title: "B", price: 1, available_quantity: 1, permalink: "", shipping: { logistic_type: "drop_off" }, variations: [{ inventory_id: "INV2" }] } },
      ]);

    const products = await listProducts("acc1", "123");

    expect(products[0]).toMatchObject({ logisticType: "fulfillment", inventoryId: "INV1" });
    expect(products[1]).toMatchObject({ logisticType: "drop_off", inventoryId: "INV2" });
  });

  it("avisa si ningún producto trae shipping.logistic_type reconocible", async () => {
    // Sin confirmar todavía contra una respuesta real: si el campo cambió de
    // nombre o de lugar, este aviso lo va a decir con las claves reales.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: ["MLA1"] })
      .mockResolvedValueOnce([{ body: { id: "MLA1", title: "A", price: 1, available_quantity: 1, permalink: "" } }]);

    await listProducts("acc1", "123");

    const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain("logistic_type");
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

  it("pages through items/search with scroll_id when there are more results than one page", async () => {
    const firstPageIds = Array.from({ length: 50 }, (_, i) => `MLA${i}`);
    const secondPageIds = ["MLA50", "MLA51"];
    const allIds = [...firstPageIds, ...secondPageIds];
    const detailsFor = (ids: string[]) =>
      ids.map((id) => ({ body: { id, title: id, price: 1, available_quantity: 1, permalink: "" } }));

    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: firstPageIds, scroll_id: "scroll-1" })
      .mockResolvedValueOnce({ results: secondPageIds, scroll_id: "scroll-1" })
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce(detailsFor(allIds.slice(0, 20)))
      .mockResolvedValueOnce(detailsFor(allIds.slice(20, 40)))
      .mockResolvedValueOnce(detailsFor(allIds.slice(40)));

    const products = await listProducts("acc1", "123");

    expect(products).toHaveLength(52);
    expect(vi.mocked(mlFetch).mock.calls[0][0]).toContain("search_type=scan");
    expect(vi.mocked(mlFetch).mock.calls[0][0]).not.toContain("scroll_id");
    expect(vi.mocked(mlFetch).mock.calls[1][0]).toContain("scroll_id=scroll-1");
    expect(vi.mocked(mlFetch).mock.calls[2][0]).toContain("scroll_id=scroll-1");
  });

  it("stops as soon as a page comes back without a scroll_id, even mid-catalog", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: ["MLA1"] }) // sin scroll_id: no hay más para pedir
      .mockResolvedValueOnce([{ body: { id: "MLA1", title: "A", price: 1, available_quantity: 1, permalink: "" } }]);

    const products = await listProducts("acc1", "123");

    expect(products).toHaveLength(1);
    expect(vi.mocked(mlFetch)).toHaveBeenCalledTimes(2);
  });

  it("no se corta con el límite clásico de offset+limit<=1000 de ML: un catálogo grande sigue paginando por scroll_id", async () => {
    // Reproduce el caso real: una cuenta con más de 1000 publicaciones entre
    // activas/pausadas/cerradas. Con offset esto tiraba 400 "Invalid limit
    // and offset values" apenas offset pasaba de 1000 y el sync se caía
    // entero; con scroll_id no hay ese techo.
    const TOTAL_ITEMS = 1050;
    const allIds = Array.from({ length: TOTAL_ITEMS }, (_, i) => `MLA${i}`);
    const PAGE_SIZE = 50;
    for (let i = 0; i < TOTAL_ITEMS; i += PAGE_SIZE) {
      const page = allIds.slice(i, i + PAGE_SIZE);
      const isLast = i + PAGE_SIZE >= TOTAL_ITEMS;
      vi.mocked(mlFetch).mockResolvedValueOnce({ results: page, scroll_id: isLast ? undefined : "scroll-x" });
    }
    for (let i = 0; i < TOTAL_ITEMS; i += 20) {
      vi.mocked(mlFetch).mockResolvedValueOnce(
        allIds.slice(i, i + 20).map((id) => ({ body: { id, title: id, price: 1, available_quantity: 1, permalink: "" } }))
      );
    }

    const products = await listProducts("acc1", "123");

    expect(products).toHaveLength(TOTAL_ITEMS);
    const searchCalls = vi.mocked(mlFetch).mock.calls.map((c) => String(c[0])).filter((u) => u.includes("items/search"));
    expect(searchCalls.every((u) => !u.includes("offset="))).toBe(true);
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

/** Fecha de hace N días, en el formato que usa la API. */
function haceDias(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

describe("getAdsSpend", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty array when the account has no Product Ads advertiser", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ advertisers: [] });
    expect(await getAdsSpend("acc1", "123", haceDias(30), haceDias(1))).toEqual([]);
    expect(vi.mocked(mlFetch)).toHaveBeenCalledTimes(1);
  });

  it("returns no ad spend instead of failing the whole sync on a 404", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockRejectedValueOnce(new MlApiError(404, "advertiser_campaigns_not_found"));

    expect(await getAdsSpend("acc1", "123", haceDias(30), haceDias(1))).toEqual([]);
  });

  it("resolves the advertiser id and site id before listing campaigns", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockResolvedValueOnce({ results: [{ metrics: { cost: 100 } }] });

    const rows = await getAdsSpend("acc1", "123", haceDias(2), haceDias(1));

    // Confirmado con un log real de producción: ML da un total agregado del
    // rango completo por campaña ("metrics.cost"), no un desglose por día ni
    // por publicación. Se reparte en partes iguales entre los días del rango,
    // sin producto asociado (product_id null), igual que la publicidad que se
    // carga a mano.
    expect(rows).toEqual([
      { productId: null, date: haceDias(2), amount: 50 },
      { productId: null, date: haceDias(1), amount: 50 },
    ]);
    expect(vi.mocked(mlFetch).mock.calls[1][0]).toBe(
      `/marketplace/advertising/MLA/advertisers/999/product_ads/campaigns/search?date_from=${haceDias(2)}&date_to=${haceDias(1)}&metrics=cost`
    );
    expect(vi.mocked(mlFetch).mock.calls[1][2]).toEqual(expect.objectContaining({ headers: { "Api-Version": "2" } }));
  });

  it("suma el costo de todas las campañas del rango antes de repartirlo", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockResolvedValueOnce({ results: [{ metrics: { cost: 60 } }, { metrics: { cost: 40 } }] });

    const rows = await getAdsSpend("acc1", "123", haceDias(1), haceDias(1));

    expect(rows).toEqual([{ productId: null, date: haceDias(1), amount: 100 }]);
  });

  it("parte un historial largo en ventanas cortas en vez de comerse un 400", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockResolvedValue({ results: [] });

    await getAdsSpend("acc1", "123", haceDias(2000), haceDias(0));

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
        { key: "2026-07-01", period: { date_from: "2026-07-01", date_to: "2026-07-31" }, amount: 1234.5, period_status: "CLOSED" },
        { period: { date_from: null, date_to: null }, amount: 0 },
      ],
    });

    const periods = await listBillingPeriods("acc1");

    expect(periods).toEqual([
      { key: "2026-07-01", dateFrom: "2026-07-01", dateTo: "2026-07-31", amount: 1234.5, periodStatus: "CLOSED" },
    ]);
  });
});

describe("getProductsByIds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("trae publicaciones que ya no aparecen en el listado del vendedor", async () => {
    // Es el caso que rompía el panel: un producto vendido y dado de baja no
    // vuelve en /users/{id}/items/search, pero /items sí lo devuelve.
    vi.mocked(mlFetch).mockResolvedValueOnce([
      {
        code: 200,
        body: {
          id: "MLA2293610632", title: "Luz De Emergencia", seller_custom_field: "SKU9",
          price: 12000, available_quantity: 0, permalink: "https://ml/p",
          category_id: "MLA1", secure_thumbnail: "https://https-thumb",
        },
      },
    ]);
    vi.mocked(mlFetch).mockResolvedValueOnce({ id: "MLA1", name: "Iluminación" });

    const products = await getProductsByIds("acc1", ["MLA2293610632"]);

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: "MLA2293610632",
      title: "Luz De Emergencia",
      thumbnail: "https://https-thumb",
      categoryName: "Iluminación",
    });
  });

  it("saltea los ids que ML no reconoce en vez de perder toda la tanda", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce([
      { code: 404, body: {} },
      { code: 200, body: { id: "MLA2", title: "Existe", price: 10, available_quantity: 1, permalink: "u" } },
    ]);

    const products = await getProductsByIds("acc1", ["MLA1", "MLA2"]);

    expect(products.map((p) => p.id)).toEqual(["MLA2"]);
  });

  it("no llama a la API cuando no hay ids que pedir", async () => {
    expect(await getProductsByIds("acc1", [])).toEqual([]);
    expect(vi.mocked(mlFetch)).not.toHaveBeenCalled();
  });

  it("pide de a 20, que es el máximo que acepta /items", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `MLA${i}`);
    vi.mocked(mlFetch).mockResolvedValue([]);

    await getProductsByIds("acc1", ids);

    const itemCalls = vi.mocked(mlFetch).mock.calls.filter((c) => String(c[0]).startsWith("/items?ids="));
    expect(itemCalls).toHaveLength(3);
    expect(String(itemCalls[0][0]).split(",")).toHaveLength(20);
  });
});

describe("clampToAdsWindow", () => {
  const hoy = new Date("2026-08-30T12:00:00Z");

  it("adelanta una fecha vieja hasta donde la API contesta", () => {
    // Mercado Ads solo sirve métricas de los últimos 90 días corridos. El sync
    // del historial pedía desde 2020 y cada tramo viejo devolvía 400, así que
    // la publicidad no entraba nunca.
    expect(clampToAdsWindow("2020-01-01", hoy)).toBe(
      new Date(hoy.getTime() - ADS_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10)
    );
  });

  it("deja intacta una fecha que ya está dentro de la ventana", () => {
    expect(clampToAdsWindow("2026-08-20", hoy)).toBe("2026-08-20");
  });
});

describe("getAdsSpend fuera de la ventana", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no le pide métricas a la API cuando todo el rango es más viejo de lo que sirve", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] });

    const rows = await getAdsSpend("acc1", "123", "2020-01-01", "2020-03-31");

    expect(rows).toEqual([]);
    // Solo la llamada del advertiser: ninguna de campaigns/search.
    const searchCalls = vi.mocked(mlFetch).mock.calls.filter((c) => String(c[0]).includes("campaigns/search"));
    expect(searchCalls).toHaveLength(0);
  });
});

describe("getStoreVisits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("manda fecha simple YYYY-MM-DD, sin armar un timestamp encima", async () => {
    // Bug real, en producción, dos veces: primero con "-00:00" y después con
    // "Z" agregado a un timestamp completo — ambos rechazados por ML con
    // "Invalid request unknown date format" (confirmado en logs reales). El
    // problema nunca fue el offset: la documentación oficial de ML muestra
    // el ejemplo con fecha simple ("date_from=2021-01-01"), sin hora.
    vi.mocked(mlFetch).mockResolvedValueOnce({ total_visits: 120 });

    await getStoreVisits("acc1", "123", "2026-08-01", "2026-08-31");

    const url = decodeURIComponent(vi.mocked(mlFetch).mock.calls[0][0] as string);
    expect(url).toContain("date_from=2026-08-01");
    expect(url).toContain("date_to=2026-08-31");
    expect(url).not.toContain("T00:00:00");
    expect(url).not.toContain("T23:59:59");
  });

  it("devuelve null (no 0) si la API falla, para no mostrar una conversión imposible", async () => {
    vi.mocked(mlFetch).mockRejectedValueOnce(new Error("400"));
    expect(await getStoreVisits("acc1", "123", "2026-08-01", "2026-08-31")).toBeNull();
  });
});

describe("getAdsSpend con campañas sin gasto reconocible", () => {
  beforeEach(() => vi.clearAllMocks());

  it("avisa con las claves reales de la respuesta cuando hay campañas pero ninguna aporta gasto", async () => {
    // Es el caso real que encontramos: la pantalla de Campañas mostraba
    // presupuestos reales, pero Ad Spend daba $0. Si el día de mañana ML
    // vuelve a cambiar la forma de la respuesta, este aviso va a decir cuál
    // es el campo real en vez de quedar en silencio total.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockResolvedValueOnce({ results: [{ id: "C1", name: "Campaña real", status: "active", budget: 20000 }] });

    const rows = await getAdsSpend("acc1", "123", haceDias(10), haceDias(1));

    expect(rows).toEqual([]);
    const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain("campaña(s)");
    expect(warned).toContain("Claves de la primera campaña: id, name, status, budget");
  });

  it("no avisa si la campaña trae metrics.cost, aunque el gasto real sea cero", async () => {
    // Un cero real (la campaña no gastó nada en el rango) no es lo mismo que
    // el campo no venir: eso sí sería una API que cambió de forma otra vez.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ advertisers: [{ advertiser_id: 999, site_id: "MLA" }] })
      .mockResolvedValueOnce({ results: [{ id: "C1", metrics: { cost: 0 } }] });

    const rows = await getAdsSpend("acc1", "123", haceDias(10), haceDias(1));

    expect(rows).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("getFullStock", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty array without calling the API when there are no inventory ids", async () => {
    expect(await getFullStock("acc1", [])).toEqual([]);
    expect(mlFetch).not.toHaveBeenCalled();
  });

  it("pide el stock de cada inventory_id por separado (sin multi-get)", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ available_quantity: 10, not_available_quantity: 2 })
      .mockResolvedValueOnce({ available_quantity: 5, not_available_quantity: 0 });

    const rows = await getFullStock("acc1", ["INV1", "INV2"]);

    expect(rows).toEqual(
      expect.arrayContaining([
        { inventoryId: "INV1", availableQuantity: 10, unavailableQuantity: 2 },
        { inventoryId: "INV2", availableQuantity: 5, unavailableQuantity: 0 },
      ])
    );
    expect(vi.mocked(mlFetch).mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["/inventories/INV1/stock/fulfillment", "/inventories/INV2/stock/fulfillment"])
    );
  });

  it("no cae de la sincronización si un inventory_id da 404 (todavía sin stock en Full)", async () => {
    vi.mocked(mlFetch)
      .mockRejectedValueOnce(new MlApiError(404, "not found"))
      .mockResolvedValueOnce({ available_quantity: 3, not_available_quantity: 0 });

    const rows = await getFullStock("acc1", ["INV1", "INV2"]);

    expect(rows).toEqual([{ inventoryId: "INV2", availableQuantity: 3, unavailableQuantity: 0 }]);
  });

  it("avisa si ningún inventory_id trae 'available_quantity' reconocible", async () => {
    // Sin confirmar todavía: si el nombre real es otro, este aviso lo va a
    // decir con las claves reales de la respuesta.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(mlFetch).mockResolvedValueOnce({ total_quantity: 12 });

    const rows = await getFullStock("acc1", ["INV1"]);

    expect(rows).toEqual([]);
    const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain("available_quantity");
    expect(warned).toContain("total_quantity");
  });
});
