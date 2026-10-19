// ============================================================
// CỔNG GỌI SÀN trên kho RAM + đồng hồ giả: một gian 429 không kéo gian khác,
// lỗi cứng app dừng cả app, Retry-After được tôn trọng, thành công xóa đếm lỗi,
// phân loại lỗi đúng bảng từng sàn (Pha B lát B2, docs mục 5b).
// ============================================================

import { describe, expect, it } from "vitest";
import {
  callMarketplace,
  classifyLazada,
  classifyShopee,
  classifyTiktok,
  gatewayLimits,
  GatewayDeferError,
  MemoryRateStore,
  type GatewayCall,
  type GatewayDeps,
} from "../marketplace-gateway";
import { TiktokRateLimitError } from "../../integrations/tiktok/rate-limit";

function harness() {
  let now = 1_000_000;
  const store = new MemoryRateStore(() => now, () => 1);
  const slept: number[] = [];
  const deps: GatewayDeps = {
    store,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  };
  return { store, deps, slept, advance: (ms: number) => (now += ms), now: () => now };
}

const shopee = (shop: string, endpoint = "/api/v2/order/get_order_list"): GatewayCall => ({
  platform: "SHOPEE",
  app: "2040029",
  shop,
  endpoint,
});

const fail = (msg: string) => async () => {
  throw new Error(msg);
};

describe("cổng gọi sàn", () => {
  it("khóa: app + gian + endpoint; trần chỉ ở nơi có bằng chứng", () => {
    const ks = gatewayLimits(shopee("1", "/api/v2/ads/get_all_cpc_ads_daily_performance"));
    expect(ks.map((k) => k.key)).toEqual([
      "SHOPEE:2040029",
      "SHOPEE:2040029|shop:1",
      "SHOPEE:2040029|ep:/api/v2/ads/get_all_cpc_ads_daily_performance",
    ]);
    expect(ks.map((k) => k.emissionMs)).toEqual([0, 0, 1000]);
    expect(gatewayLimits({ platform: "TIKTOK", app: "x", shop: "9", endpoint: "/o" })[1].emissionMs).toBeCloseTo(333.33, 1);
  });

  it("429 tầng gian (exceed_shop_api): chỉ gian đó lùi, gian khác gọi ngay", async () => {
    const h = harness();
    await expect(callMarketplace(shopee("A"), fail("ads.rate_limit.exceed_shop_api"), h.deps)).rejects.toBeInstanceOf(GatewayDeferError);
    expect(await callMarketplace(shopee("B"), async () => "ok", h.deps)).toBe("ok");
    expect(h.slept).toEqual([]); // B không chờ
    expect(await callMarketplace(shopee("A"), async () => "ok", h.deps)).toBe("ok");
    expect(h.slept).toEqual([1000]); // A chờ đúng mốc lùi (≤ 2 s → ngủ tại chỗ)
    // Lỗi liên tiếp → lùi 2^n vượt ngưỡng chờ tại chỗ → trả về cho làn xếp lại.
    for (let i = 0; i < 3; i++) await callMarketplace(shopee("A"), fail("exceed_shop_api"), h.deps).catch(() => {});
    await expect(callMarketplace(shopee("A"), async () => "ok", h.deps)).rejects.toMatchObject({ reason: "throttled" });
  });

  it("H4: error_rate_limit (không rõ tầng) → gian lùi + endpoint hạ nhịp AIMD", async () => {
    const h = harness();
    const ep = "/api/v2/ads/get_all_cpc_ads_daily_performance";
    await expect(callMarketplace(shopee("A", ep), fail("error_rate_limit: HTTP 429"), h.deps)).rejects.toMatchObject({
      reason: "rate_limit",
    });
    const epState = h.store.keys.get(`SHOPEE:2040029|ep:${ep}`)!;
    expect(epState.factor).toBe(0.5);
    expect(h.store.keys.get("SHOPEE:2040029|shop:A")!.failures).toBe(1);
    expect(h.store.keys.get("SHOPEE:2040029")).toBeUndefined();
  });

  it("lỗi cứng theo app (exceed_partner_api): MỌI gian dừng tới hết hạn, rồi chạy lại", async () => {
    const h = harness();
    await expect(callMarketplace(shopee("A"), fail("ads.rate_limit.exceed_partner_api"), h.deps)).rejects.toMatchObject({
      reason: "hard_app",
      waitMs: 5 * 60_000,
    });
    await expect(callMarketplace(shopee("B"), async () => "ok", h.deps)).rejects.toMatchObject({ reason: "throttled" });
    h.advance(5 * 60_000);
    expect(await callMarketplace(shopee("B"), async () => "ok", h.deps)).toBe("ok");
  });

  it("Retry-After của TikTok là sàn dưới thời gian lùi", async () => {
    const h = harness();
    const err = new TiktokRateLimitError(
      { path: "/o", kind: "read", httpStatus: 429, code: 36009002, requestId: null, retryAfterMs: 30_000, attempts: 1 },
      "429"
    );
    const call: GatewayCall = { platform: "TIKTOK", app: "t", shop: "S", endpoint: "/o" };
    await expect(
      callMarketplace(call, async () => {
        throw err;
      }, h.deps)
    ).rejects.toMatchObject({ waitMs: 30_000 });
  });

  it("chờ ngắn thì ngủ tại chỗ, thành công xóa đếm lỗi", async () => {
    const h = harness();
    await expect(callMarketplace(shopee("A"), fail("exceed_shop_api"), h.deps)).rejects.toBeInstanceOf(GatewayDeferError);
    h.advance(1_000); // hết lùi (rand = 1 → đúng 1 s)
    expect(await callMarketplace(shopee("A"), async () => 1, h.deps)).toBe(1);
    expect(h.store.keys.get("SHOPEE:2040029|shop:A")!.failures).toBe(0);
    // Trần endpoint 1/s dồn 2: lượt thứ 3 cùng lúc chờ 1 s ≤ 2 s → ngủ tại chỗ rồi gọi.
    const ep = "/api/v2/ads/get_all_cpc_ads_daily_performance";
    for (let i = 0; i < 3; i++) await callMarketplace(shopee("C", ep), async () => i, h.deps);
    expect(h.slept).toEqual([1000]);
  });

  it("lỗi không phải rate limit ném nguyên vẹn, không lùi khóa nào", async () => {
    const h = harness();
    await expect(callMarketplace(shopee("A"), fail("invalid_access_token"), h.deps)).rejects.toThrow("invalid_access_token");
    expect(h.store.keys.size).toBe(0);
  });

  it("bảng phân loại 3 sàn", () => {
    const e = (m: string) => new Error(m);
    expect(classifyShopee(e("exceed_api"))).toEqual({ kind: "hard_app" });
    expect(classifyShopee(e("error_rate_limit"))).toMatchObject({ kind: "rate_limit", scope: "unknown" });
    expect(classifyShopee(e("fetch failed"))).toEqual({ kind: "transient" });
    expect(classifyTiktok(e("code 36009002"))).toMatchObject({ kind: "rate_limit", scope: "shop" });
    expect(classifyLazada(e("ApiCallLimit"))).toEqual({ kind: "hard_app" });
    expect(classifyLazada(e("code 901 retry in the next second"))).toMatchObject({ kind: "rate_limit", scope: "unknown" });
    expect(classifyLazada(e("IllegalAccessToken"))).toEqual({ kind: "auth" });
  });
});
