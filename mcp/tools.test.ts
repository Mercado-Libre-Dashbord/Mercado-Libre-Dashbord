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
    expect(vi.mocked(mlFetch).mock.calls[1][0]).toMatch(
      /^\/marketplace\/advertising\/MLA\/advertisers\/999\/product_ads\/campaigns\/search\?date_from=.+&date_to=.+$/
    );
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
