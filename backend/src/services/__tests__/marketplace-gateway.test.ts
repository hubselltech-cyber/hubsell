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
  endpointLimit,
  gatewayLimits,
  GatewayDeferError,
  MemoryRateStore,
  DistinctShopStorm,
  shopEndpointLimit,
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
  it("khóa: app + gian + endpoint (+ gian × endpoint cho nhóm Ads Shopee — A2); trần chỉ ở nơi có bằng chứng", () => {
    const ks = gatewayLimits(shopee("1", "/api/v2/ads/get_all_cpc_ads_daily_performance"));
    expect(ks.map((k) => k.key)).toEqual([
      "SHOPEE:2040029",
      "SHOPEE:2040029|shop:1",
      "SHOPEE:2040029|ep:/api/v2/ads/get_all_cpc_ads_daily_performance",
      "SHOPEE:2040029|shop:1|ep:/api/v2/ads/get_all_cpc_ads_daily_performance",
    ]);
    expect(ks.map((k) => k.emissionMs)).toEqual([0, 0, 1000, 300_000]);
    // Ngoài nhóm Ads: không có khóa gian × endpoint.
    expect(gatewayLimits(shopee("1")).map((k) => k.key)).toEqual(["SHOPEE:2040029", "SHOPEE:2040029|shop:1", "SHOPEE:2040029|ep:/api/v2/order/get_order_list"]);
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

  it("H4: error_rate_limit (không rõ tầng) trên lệnh KHÔNG có khóa gian × endpoint → gian lùi + endpoint hạ nhịp AIMD", async () => {
    const h = harness();
    const ep = "/api/v2/order/get_order_list";
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
    // Trần endpoint 1/s dồn 2: lượt thứ 3 cùng lúc chờ 1 s ≤ 2 s → ngủ tại chỗ rồi gọi (lệnh không gian → không khóa gian × endpoint).
    const ep = "/api/v2/ads/get_all_cpc_ads_daily_performance";
    for (let i = 0; i < 3; i++) await callMarketplace({ platform: "SHOPEE", app: "2040029", endpoint: ep }, async () => i, h.deps);
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

describe("13.9 bước A — trần khởi điểm cho MỌI endpoint Ads Shopee (tiền tố), để AIMD có tác dụng", () => {
  it("dòng riêng thắng tiền tố: get_all_cpc giữ 1/s (H4); endpoint Ads khác theo tiền tố 2/s burst 2", () => {
    expect(endpointLimit("SHOPEE", "/api/v2/ads/get_all_cpc_ads_daily_performance")).toEqual({ perSec: 1, burst: 2 });
    expect(endpointLimit("SHOPEE", "/api/v2/ads/get_total_balance")).toEqual({ perSec: 2, burst: 2 });
    expect(endpointLimit("SHOPEE", "/api/v2/ads/edit_manual_product_ads")).toEqual({ perSec: 2, burst: 2 });
  });
  it("ngoài nhóm Ads (đơn hàng) và sàn khác: không trần → chỉ lùi + đo", () => {
    expect(endpointLimit("SHOPEE", "/api/v2/order/get_order_list")).toBeUndefined();
    expect(endpointLimit("LAZADA", "/api/v2/ads/x")).toBeUndefined();
  });
  it("tiền tố dài nhất thắng khi lồng nhau", () => {
    const limits = {
      app: {},
      shop: {},
      endpoint: {},
      endpointPrefix: { "SHOPEE /api/v2/ads/": { perSec: 2, burst: 2 }, "SHOPEE /api/v2/ads/get_gms_": { perSec: 5, burst: 1 } },
      shopEndpoint: {},
      shopEndpointPrefix: {},
    };
    expect(endpointLimit("SHOPEE", "/api/v2/ads/get_gms_item_performance", limits)).toEqual({ perSec: 5, burst: 1 });
    expect(gatewayLimits(shopee("1", "/api/v2/ads/get_total_balance"), limits).map((k) => k.emissionMs)).toEqual([0, 0, 500]);
  });
});

describe("13.9 bước A2 (22/10/2026) — trần theo GIAN × endpoint cho nhóm Ads Shopee: 429 lùi đúng gian × endpoint, không hạ cả app", () => {
  const ALL_CPC = "/api/v2/ads/get_all_cpc_ads_daily_performance";
  const SETTING = "/api/v2/ads/get_product_level_campaign_setting_info";
  const E429 = "Shopee get_all_cpc_ads_daily_performance lỗi: HTTP 429 — vượt trần gọi API (error_rate_limit Too many requests)";

  it("trần khởi điểm: get_all_cpc 1 lệnh/5' không dồn; endpoint Ads khác CHỈ ĐO (perSec 0, có khóa, không chặn trước); ngoài nhóm Ads không có", () => {
    expect(shopEndpointLimit("SHOPEE", ALL_CPC)).toEqual({ perSec: 0.2 / 60, burst: 1 });
    expect(shopEndpointLimit("SHOPEE", SETTING)).toEqual({ perSec: 0, burst: 1 });
    expect(shopEndpointLimit("SHOPEE", "/api/v2/order/get_order_list")).toBeUndefined();
    expect(shopEndpointLimit("LAZADA", ALL_CPC)).toBeUndefined();
    // Khóa gian × endpoint vẫn có mặt cho setting_info (để phạt đúng chỗ khi 429) nhưng emission 0.
    const ks = gatewayLimits(shopee("A", SETTING));
    expect(ks.map((k) => k.key)).toContain(`SHOPEE:2040029|shop:A|ep:${SETTING}`);
    expect(ks.find((k) => k.key.endsWith(`|shop:A|ep:${SETTING}`))!.emissionMs).toBe(0);
  });

  it("★ 22/10 10:00 — bước nhiều trang cùng gian × endpoint (gian > 100 chiến dịch: id_list 2–10 trang) đi liền, KHÔNG bị cổng hoãn → hết vòng lặp 80 s; 429 trên trang nào vẫn phạt đúng khóa gian × endpoint", async () => {
    const h = harness();
    const ID_LIST = "/api/v2/ads/get_product_level_campaign_id_list";
    let pages = 0;
    for (let i = 0; i < 10; i++) {
      expect(await callMarketplace(shopee("A", ID_LIST), async () => ++pages, h.deps)).toBe(i + 1);
      h.advance(300);
    }
    expect(pages).toBe(10);
    // Chỉ còn chờ lượt app × endpoint (2/s) tính bằng trăm ms — không có lần nào bị hoãn 60 s về làn.
    expect(Math.max(0, ...h.slept)).toBeLessThan(2_000);
    // Trang 11 bị sàn 429 → khóa gian A × id_list lùi 60 s; gian B vẫn gọi id_list ngay; app × endpoint không hạ.
    await expect(
      callMarketplace(shopee("A", ID_LIST), fail("Shopee get_product_level_campaign_id_list lỗi: HTTP 429 — vượt trần gọi API (error_rate_limit)"), h.deps)
    ).rejects.toMatchObject({ reason: "rate_limit", key: `SHOPEE:2040029|shop:A|ep:${ID_LIST}`, waitMs: 60_000 });
    expect(await callMarketplace(shopee("B", ID_LIST), async () => "B", h.deps)).toBe("B");
    expect(h.store.keys.get(`SHOPEE:2040029|ep:${ID_LIST}`)?.factor ?? 1).toBe(1);
  });

  it("gian A dính 429 trên get_all_cpc → CHỈ khóa gian A × get_all_cpc lùi 60 s + hạ nhịp 0,5; khóa app × endpoint, khóa gian chung, khóa app KHÔNG đụng", async () => {
    const h = harness();
    await expect(callMarketplace(shopee("A", ALL_CPC), fail(E429), h.deps)).rejects.toMatchObject({
      reason: "rate_limit",
      key: `SHOPEE:2040029|shop:A|ep:${ALL_CPC}`,
      waitMs: 60_000,
    });
    const se = h.store.keys.get(`SHOPEE:2040029|shop:A|ep:${ALL_CPC}`)!;
    expect(se.failures).toBe(1);
    expect(se.factor).toBe(0.5);
    expect(se.blockedUntilMs).toBe(h.now() + 60_000);
    expect(h.store.keys.get(`SHOPEE:2040029|ep:${ALL_CPC}`)?.factor ?? 1).toBe(1);
    expect(h.store.keys.get(`SHOPEE:2040029|ep:${ALL_CPC}`)?.failures ?? 0).toBe(0);
    expect(h.store.keys.get("SHOPEE:2040029|shop:A")?.failures ?? 0).toBe(0);
    expect(h.store.keys.get("SHOPEE:2040029")).toBeUndefined();
  });

  it("gian A đang lùi: gian B gọi cùng endpoint đi ngay; gian A gọi endpoint KHÁC (setting_info) cũng đi ngay — chỉ đúng gian × endpoint bị chặn", async () => {
    const h = harness();
    await callMarketplace(shopee("A", ALL_CPC), fail(E429), h.deps).catch(() => {});
    expect(await callMarketplace(shopee("B", ALL_CPC), async () => "B", h.deps)).toBe("B");
    expect(await callMarketplace(shopee("A", SETTING), async () => "A-setting", h.deps)).toBe("A-setting");
    // Gian A gọi lại get_all_cpc trong lúc lùi → cổng trả về cho làn (chờ 60 s > 2 s), KHÔNG gọi sàn.
    let called = 0;
    await expect(
      callMarketplace(shopee("A", ALL_CPC), async () => void called++, h.deps)
    ).rejects.toMatchObject({ reason: "throttled" });
    expect(called).toBe(0);
    expect(h.slept).toEqual([]);
  });

  it("429 lần 2 liên tiếp → lùi 120 s (gốc × 2), lần 3 → 240 s; thành công → xóa đếm, nhịp hồi dần", async () => {
    const h = harness();
    const key = `SHOPEE:2040029|shop:A|ep:${ALL_CPC}`;
    await callMarketplace(shopee("A", ALL_CPC), fail(E429), h.deps).catch(() => {});
    // Sau 429 nhịp gian × endpoint còn 1 lệnh/10' (hệ số 0,5) — 60 s sau cổng chỉ bảo chờ, KHÔNG gọi sàn (không sinh 429 mới).
    h.advance(60_000);
    await expect(callMarketplace(shopee("A", ALL_CPC), fail(E429), h.deps)).rejects.toMatchObject({ reason: "throttled" });
    expect(h.store.keys.get(key)!.failures).toBe(1);
    // Tới lượt (hệ số hồi hết sau 60') mà sàn vẫn 429 → lùi 120 s (gốc × 2), rồi 240 s.
    h.advance(60 * 60_000);
    await expect(callMarketplace(shopee("A", ALL_CPC), fail(E429), h.deps)).rejects.toMatchObject({ reason: "rate_limit", waitMs: 120_000 });
    h.advance(60 * 60_000);
    await expect(callMarketplace(shopee("A", ALL_CPC), fail(E429), h.deps)).rejects.toMatchObject({ reason: "rate_limit", waitMs: 240_000 });
    expect(h.store.keys.get(key)!.failures).toBe(3);
    // Hết lùi + hết nhịp → thành công → failures về 0.
    h.advance(60 * 60_000);
    expect(await callMarketplace(shopee("A", ALL_CPC), async () => "ok", h.deps)).toBe("ok");
    expect(h.store.keys.get(key)!.failures).toBe(0);
  });

  it("nhịp gian × endpoint: get_all_cpc lần 2 của CÙNG gian trong 5' → cổng bảo chờ (throttled), không gọi sàn, không phải 429", async () => {
    const h = harness();
    expect(await callMarketplace(shopee("A", ALL_CPC), async () => 1, h.deps)).toBe(1);
    h.advance(60_000);
    await expect(callMarketplace(shopee("A", ALL_CPC), async () => 2, h.deps)).rejects.toMatchObject({ reason: "throttled" });
    h.advance(4 * 60_000);
    expect(await callMarketplace(shopee("A", ALL_CPC), async () => 3, h.deps)).toBe(3);
  });

  it("bão theo GIAN KHÁC NHAU: 2 gian 429 cùng endpoint trong 60 s → app × endpoint chưa hạ; gian thứ 3 → hạ 0,5; một gian dính nhiều lần không tính", async () => {
    const h = harness();
    const storm = new DistinctShopStorm(3, 60_000);
    const deps = { ...h.deps, storm };
    const epKey = `SHOPEE:2040029|ep:${ALL_CPC}`;
    await callMarketplace(shopee("A", ALL_CPC), fail(E429), deps).catch(() => {});
    await callMarketplace(shopee("B", ALL_CPC), fail(E429), deps).catch(() => {});
    expect(h.store.keys.get(epKey)?.factor ?? 1).toBe(1);
    // Gian A dính lần 2 (sau khi hết lùi + hết nhịp) vẫn chỉ là 2 gian.
    expect(storm.note(epKey, "A", h.now() + 10_000)).toEqual({ shops: 2, storm: false });
    await callMarketplace(shopee("C", ALL_CPC), fail(E429), deps).catch(() => {});
    expect(h.store.keys.get(epKey)!.factor).toBe(0.5);
    // Cửa sổ trôi: 71 s sau (A ghi ở +10 s cũng đã quá 60 s) chỉ còn gian mới.
    expect(storm.note(epKey, "D", h.now() + 71_000)).toEqual({ shops: 1, storm: false });
  });

  it("mã cứng theo app (exceed_partner_api) trên lệnh Ads vẫn dừng CẢ app — khóa gian × endpoint không thay cầu dao mã cứng", async () => {
    const h = harness();
    await expect(callMarketplace(shopee("A", ALL_CPC), fail("ads.rate_limit.exceed_partner_api"), h.deps)).rejects.toMatchObject({ reason: "hard_app" });
    await expect(callMarketplace(shopee("B", SETTING), async () => "ok", h.deps)).rejects.toMatchObject({ reason: "throttled" });
  });
});
