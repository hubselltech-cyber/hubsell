// ============================================================
// ADAPTER 3 SÀN — ĐỌC TĂNG DẦN (lát 3.9 GĐ3, 05/11/2026). Sàn GIẢ (mock lớp client), không gọi mạng.
//
//   · Shopee: get_item_list vẫn đọc đủ id; chỉ gọi chi tiết cho sản phẩm sàn báo đổi từ mốc / chưa có
//     trong DB / lệch trạng thái / sàn không trả update_time.
//   · TikTok: products/search nhận update_time_ge; vượt 10.000 kết quả (12052180) thì lùi về toàn bộ.
//   · Lazada: /products/get nhận update_after.
//   · Có `since` → kết quả mang `incremental: true`; không có → KHÔNG mang (nơi gọi mới được gỡ theo vắng mặt).
// ============================================================
import "../../integrations/__tests__/load-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@prisma/client";

const m = vi.hoisted(() => ({
  getItemList: vi.fn(),
  getItemBaseInfo: vi.fn(),
  getModelList: vi.fn(),
  searchProducts: vi.fn(),
  getProduct: vi.fn(),
  getProducts: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("../../integrations/shopee/client", async (orig) => ({
  ...(await orig<typeof import("../../integrations/shopee/client")>()),
  getItemList: m.getItemList,
  getItemBaseInfo: m.getItemBaseInfo,
  getModelList: m.getModelList,
}));
vi.mock("../../integrations/shopee/service", () => ({
  getValidShopeeAccessToken: async () => ({ accessToken: "tok", shopId: "1" }),
}));
vi.mock("../../integrations/tiktok/client", async (orig) => ({
  ...(await orig<typeof import("../../integrations/tiktok/client")>()),
  searchProducts: m.searchProducts,
  getProduct: m.getProduct,
}));
vi.mock("../../integrations/tiktok/service", () => ({
  getValidAccessToken: async () => ({ accessToken: "tok", shopCipher: "cipher" }),
}));
vi.mock("../../integrations/lazada/client", async (orig) => ({
  ...(await orig<typeof import("../../integrations/lazada/client")>()),
  getProducts: m.getProducts,
}));
vi.mock("../../integrations/lazada/service", () => ({
  getValidLazadaAccessToken: async () => "tok",
}));
vi.mock("../../lib/prisma", () => ({
  prisma: { $queryRaw: m.queryRaw, channelProduct: { findMany: async () => [] } },
}));

import { lazadaProductAdapter, lazadaUpdatedAtSec } from "../adapters/lazada-adapter";
import { pickShopeeItemsToRefresh, shopeeProductAdapter } from "../adapters/shopee-adapter";
import { isTiktokSearchTooManyError, tiktokProductAdapter } from "../adapters/tiktok-adapter";

const channel = { id: "ch1", shopName: "TEST", userId: "u1" } as Channel;
const SINCE = new Date("2026-11-04T00:00:00Z");
const SINCE_SEC = Math.floor(SINCE.getTime() / 1000);

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("pickShopeeItemsToRefresh (thuần)", () => {
  const db = new Map<string, boolean>([
    ["1", true],
    ["2", true],
    ["3", true],
    ["4", false],
    ["5", true],
  ]);
  it("chỉ chọn: đổi từ mốc, chưa có trong DB, lệch trạng thái, sàn không trả update_time", () => {
    const r = pickShopeeItemsToRefresh(
      [
        { item_id: 1, item_status: "NORMAL", update_time: SINCE_SEC - 1 }, // không đổi
        { item_id: 2, item_status: "NORMAL", update_time: SINCE_SEC }, // đổi đúng mốc
        { item_id: 3, item_status: "UNLIST", update_time: SINCE_SEC - 500 }, // sàn ẩn, DB còn ACTIVE
        { item_id: 4, item_status: "NORMAL", update_time: SINCE_SEC - 500 }, // sàn bán lại, DB đang DELISTED
        { item_id: 5, item_status: "NORMAL" }, // sàn không trả update_time
        { item_id: 6, item_status: "NORMAL", update_time: SINCE_SEC - 500 }, // chưa có trong DB
        { item_id: 7, item_status: "DELETED", update_time: SINCE_SEC - 500 }, // đã xóa, DB chưa từng có → bỏ
        { item_id: 8, item_status: "BANNED", update_time: SINCE_SEC - 500 }, // bị khóa, DB chưa từng có → bỏ
      ],
      SINCE_SEC,
      db
    );
    expect(r.ids).toEqual([2, 3, 4, 5, 6]);
    expect(r.reasons).toEqual({ changed: 1, statusDiff: 2, noTime: 1, newToDb: 1 });
  });
  it("sàn ẩn và DB cũng đã DELISTED → không đọc lại", () => {
    const r = pickShopeeItemsToRefresh([{ item_id: 4, item_status: "UNLIST", update_time: SINCE_SEC - 9 }], SINCE_SEC, db);
    expect(r.ids).toEqual([]);
  });
});

describe("Shopee adapter", () => {
  /** 230 sản phẩm, 3 trang; chỉ id 5 và 150 đổi sau mốc; id 230 chưa có trong DB. */
  function seedList() {
    const all = Array.from({ length: 230 }, (_, i) => ({
      item_id: i + 1,
      item_status: "NORMAL",
      update_time: i + 1 === 5 || i + 1 === 150 ? SINCE_SEC + 60 : SINCE_SEC - 86_400,
    }));
    m.getItemList.mockImplementation(async ({ offset }: { offset: number }) => ({
      response: { item: all.slice(offset, offset + 100), has_next_page: offset + 100 < all.length, next_offset: offset + 100 },
    }));
    m.getItemBaseInfo.mockImplementation(async (_t: string, _s: string, ids: number[]) =>
      ids.map((id) => ({ item_id: id, item_name: `SP ${id}`, item_sku: `SKU-${id}`, item_status: "NORMAL", has_model: id === 150 }))
    );
    m.getModelList.mockImplementation(async (_t: string, _s: string, id: number) => [
      { model_id: 1, model_sku: `SKU-${id}-A`, model_name: "A" },
      { model_id: 2, model_sku: `SKU-${id}-B`, model_name: "B" },
    ]);
    m.queryRaw.mockResolvedValue(all.slice(0, 229).map((it) => ({ item: String(it.item_id), active: true })));
  }

  it("tăng dần: đọc đủ danh sách id (3 lệnh) nhưng chỉ gọi chi tiết cho 3 sản phẩm cần", async () => {
    seedList();
    const r = await shopeeProductAdapter.fetchProducts(channel, { since: SINCE });
    expect(m.getItemList).toHaveBeenCalledTimes(3);
    expect(m.getItemBaseInfo).toHaveBeenCalledTimes(1);
    expect(m.getItemBaseInfo.mock.calls[0][2]).toEqual([5, 150, 230]);
    expect(m.getModelList).toHaveBeenCalledTimes(1);
    expect(r.incremental).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.apiCalls).toBe(5);
    expect(r.products.map((p) => p.externalId)).toEqual(["5", "150-1", "150-2", "230"]);
    expect(r.products[0].sourceUpdatedAt).toBe(SINCE_SEC + 60);
  });

  it("tăng dần, không sản phẩm nào đổi → 0 lệnh chi tiết, vẫn mang cờ incremental", async () => {
    seedList();
    m.queryRaw.mockResolvedValue(Array.from({ length: 230 }, (_, i) => ({ item: String(i + 1), active: true })));
    const r = await shopeeProductAdapter.fetchProducts(channel, { since: new Date((SINCE_SEC + 3600) * 1000) });
    expect(r).toMatchObject({ products: [], complete: true, incremental: true, apiCalls: 3 });
    expect(m.getItemBaseInfo).not.toHaveBeenCalled();
  });

  it("sàn không trả update_time → coi như đổi hết (đọc chi tiết toàn bộ), không đoán", async () => {
    seedList();
    const plain = Array.from({ length: 60 }, (_, i) => ({ item_id: i + 1, item_status: "NORMAL" }));
    m.getItemList.mockResolvedValue({ response: { item: plain, has_next_page: false } });
    const r = await shopeeProductAdapter.fetchProducts(channel, { since: SINCE });
    expect(m.getItemBaseInfo).toHaveBeenCalledTimes(2); // 60 sản phẩm = 2 lô 50
    expect(r.incremental).toBe(true);
  });

  it("toàn bộ: đọc chi tiết mọi sản phẩm, KHÔNG mang cờ incremental; có shadowSince thì đánh dấu cửa sổ", async () => {
    seedList();
    const full = await shopeeProductAdapter.fetchProducts(channel);
    expect(full.incremental).toBeUndefined();
    expect(m.getItemBaseInfo).toHaveBeenCalledTimes(5); // 230 sản phẩm = 5 lô 50
    expect(full.products).toHaveLength(231); // 229 đơn + 2 phân loại của 150
    expect(full.products.every((p) => p.inIncrementalWindow === undefined)).toBe(true);
    expect(m.queryRaw).not.toHaveBeenCalled();

    const shadow = await shopeeProductAdapter.fetchProducts(channel, { shadowSince: SINCE });
    expect(shadow.incremental).toBeUndefined();
    const inWindow = shadow.products.filter((p) => p.inIncrementalWindow).map((p) => p.externalId);
    expect(inWindow).toEqual(["5", "150-1", "150-2", "230"]);
    expect(shadow.products.filter((p) => p.inIncrementalWindow === false)).toHaveLength(227);
  });
});

describe("TikTok adapter", () => {
  const prod = (id: string, updateTime: number) => ({
    id,
    title: `SP ${id}`,
    status: "ACTIVATE",
    update_time: updateTime,
    skus: [{ id: `${id}1`, seller_sku: `SKU-${id}`, inventory: [{ warehouse_id: "W", quantity: 3 }] }],
  });

  it("tăng dần: gửi update_time_ge = mốc (giây), kết quả mang incremental", async () => {
    m.searchProducts.mockResolvedValue({ products: [prod("9", SINCE_SEC + 5)] });
    const r = await tiktokProductAdapter.fetchProducts(channel, { since: SINCE, details: false });
    expect(m.searchProducts).toHaveBeenCalledTimes(1);
    expect(m.searchProducts.mock.calls[0][0]).toMatchObject({ updateTimeGe: SINCE_SEC, pageSize: 100 });
    expect(r).toMatchObject({ incremental: true, complete: true, apiCalls: 1 });
    expect(r.products[0]).toMatchObject({ externalId: "9-91", channelStock: 3, sourceUpdatedAt: SINCE_SEC + 5 });
  });

  it("toàn bộ: không gửi bộ lọc, không mang incremental", async () => {
    m.searchProducts.mockResolvedValue({ products: [prod("9", SINCE_SEC - 5)] });
    const r = await tiktokProductAdapter.fetchProducts(channel, { details: false });
    expect(m.searchProducts.mock.calls[0][0].updateTimeGe).toBeUndefined();
    expect(r.incremental).toBeUndefined();
  });

  it("phần thay đổi vượt 10.000 sản phẩm (12052180) → lùi về kéo toàn bộ trong cùng lượt", async () => {
    m.searchProducts
      .mockRejectedValueOnce(new Error("TikTok API lỗi (code 12052180): The total number of search results can not exceed 10000."))
      .mockResolvedValueOnce({ products: [prod("1", 1), prod("2", 2)] });
    const r = await tiktokProductAdapter.fetchProducts(channel, { since: SINCE, details: false });
    expect(m.searchProducts).toHaveBeenCalledTimes(2);
    expect(m.searchProducts.mock.calls[1][0].updateTimeGe).toBeUndefined();
    expect(r.incremental).toBeUndefined();
    expect(r.products).toHaveLength(2);
    expect(isTiktokSearchTooManyError(new Error("code 12019119"))).toBe(false);
  });

  it("lỗi khác ở lượt tăng dần ném thẳng, không lặng lẽ kéo toàn bộ", async () => {
    m.searchProducts.mockRejectedValue(new Error("TikTok API lỗi (code 12019119): search update time invalid"));
    await expect(tiktokProductAdapter.fetchProducts(channel, { since: SINCE, details: false })).rejects.toThrow("12019119");
  });
});

describe("Lazada adapter", () => {
  const item = (id: number, updatedMs: number) => ({
    item_id: id,
    status: "Active",
    updated_time: String(updatedMs),
    attributes: { name: `SP ${id}` },
    skus: [{ SkuId: id * 10, SellerSku: `SKU-${id}`, quantity: 4, price: 100000, Status: "active" }],
  });

  it("tăng dần: gửi update_after ISO, phân trang trong tập đã lọc, kết quả mang incremental", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => item(i + 1, SINCE.getTime() + 1000));
    m.getProducts.mockResolvedValueOnce({ total: 51, products: page1 }).mockResolvedValueOnce({ total: 51, products: [item(51, SINCE.getTime() + 2000)] });
    const r = await lazadaProductAdapter.fetchProducts(channel, { since: SINCE });
    expect(m.getProducts).toHaveBeenCalledTimes(2);
    expect(m.getProducts.mock.calls[0]).toEqual(["tok", 0, 50, undefined, SINCE.toISOString()]);
    expect(m.getProducts.mock.calls[1]).toEqual(["tok", 50, 50, undefined, SINCE.toISOString()]);
    expect(r).toMatchObject({ incremental: true, complete: true, apiCalls: 2 });
    expect(r.products).toHaveLength(51);
    expect(r.products[50].sourceUpdatedAt).toBe(SINCE_SEC + 2);
  });

  it("toàn bộ: không gửi update_after, không mang incremental", async () => {
    m.getProducts.mockResolvedValue({ total: 1, products: [item(1, 1)] });
    const r = await lazadaProductAdapter.fetchProducts(channel);
    expect(m.getProducts.mock.calls[0][4]).toBeUndefined();
    expect(r.incremental).toBeUndefined();
  });

  it("updated_time: mili-giây dạng chuỗi hoặc số; rỗng → null", () => {
    expect(lazadaUpdatedAtSec("1611554725000")).toBe(1611554725);
    expect(lazadaUpdatedAtSec(1611554725999)).toBe(1611554725);
    expect(lazadaUpdatedAtSec(undefined)).toBeNull();
    expect(lazadaUpdatedAtSec("")).toBeNull();
  });
});
