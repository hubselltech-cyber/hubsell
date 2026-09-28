// Van an toàn gọi Ads API theo app (tầng C, docs/ADS-NHIP-CANH-BAO.md) — phần thuần.
import { describe, expect, it } from "vitest";
import { acquireApiToken, isRateLimitStorm, pauseMsForLevel } from "../api-budget";
import { classifyShopeeAdsRateLimit } from "../../integrations/shopee/client";
import { classifyLazadaAdsRateLimit } from "../../integrations/lazada/client";

describe("pauseMsForLevel — cầu dao nghỉ 5' × 2^level, trần 60'", () => {
  it("bậc 0 = 5', bậc 1 = 10', bậc 2 = 20', bậc 3 = 40', bậc 4+ = 60'", () => {
    expect(pauseMsForLevel(0)).toBe(5 * 60_000);
    expect(pauseMsForLevel(1)).toBe(10 * 60_000);
    expect(pauseMsForLevel(3)).toBe(40 * 60_000);
    expect(pauseMsForLevel(4)).toBe(60 * 60_000);
    expect(pauseMsForLevel(9)).toBe(60 * 60_000);
    expect(pauseMsForLevel(-2)).toBe(5 * 60_000);
  });
});

describe("classifyShopeeAdsRateLimit — 3 tầng mã lỗi Ads API", () => {
  it("vượt trần theo APP / toàn hệ thống → partner (đóng cầu dao)", () => {
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: ads.rate_limit.exceed_partner_api — Too many"))).toBe("partner");
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: ads.rate_limit.exceed_api — Too many"))).toBe("partner");
    // 429 kèm thân có mã partner (client.ts đọc thân từ 28/09) → vẫn partner.
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: HTTP 429 — vượt trần gọi API (ads.rate_limit.exceed_partner_api request_id=abc)"))).toBe("partner");
  });
  it("vượt trần theo SHOP hoặc HTTP 429 trần → shop (chỉ lùi gian) — sự cố 28/09", () => {
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: ads.rate_limit.exceed_shop_api — ..."))).toBe("shop");
    expect(classifyShopeeAdsRateLimit(new Error("Shopee get_all_cpc_ads_daily_performance lỗi: HTTP 429 — vượt trần gọi API"))).toBe("shop");
  });
  it("lỗi khác (kể cả error_rate_limit chung của API đơn/kho) → null", () => {
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: error_rate_limit — ..."))).toBe(null);
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: error_param — ..."))).toBe(null);
  });
});

describe("classifyLazadaAdsRateLimit", () => {
  it("ApiCallLimit → partner; HTTP 429 / 901 → shop; khác → null", () => {
    expect(classifyLazadaAdsRateLimit(new Error("Lazada x lỗi: ApiCallLimit — ..."))).toBe("partner");
    expect(classifyLazadaAdsRateLimit(new Error("Lazada x lỗi: HTTP 429 — ..."))).toBe("shop");
    expect(classifyLazadaAdsRateLimit(new Error("Lazada x lỗi: 901 — retry in the next second"))).toBe("shop");
    expect(classifyLazadaAdsRateLimit(new Error("Lazada x lỗi: IllegalAccessToken — ..."))).toBe(null);
  });
});

describe("isRateLimitStorm — nhiều gian cùng 429 trong cửa sổ mới đóng cầu dao chung", () => {
  const M = 60_000;
  it("3 lần trong 10' → bão; 2 lần → chưa", () => {
    const hits: number[] = [];
    expect(isRateLimitStorm(hits, 0)).toBe(false);
    expect(isRateLimitStorm(hits, 4 * M)).toBe(false);
    expect(isRateLimitStorm(hits, 9 * M)).toBe(true);
  });
  it("429 rời rạc như sự cố 28/09 (00:50, 04:06, 13:18, 18:45, 20:28, 20:48, 21:32) → không bao giờ bão", () => {
    const hits: number[] = [];
    const times = [50, 246, 798, 1125, 1228, 1248, 1292].map((m) => m * M);
    expect(times.map((t) => isRateLimitStorm(hits, t)).some(Boolean)).toBe(false);
  });
  it("mốc cũ ngoài cửa sổ bị loại", () => {
    const hits: number[] = [];
    isRateLimitStorm(hits, 0);
    isRateLimitStorm(hits, 1 * M);
    expect(isRateLimitStorm(hits, 12 * M)).toBe(false);
    expect(hits).toEqual([12 * M]);
  });
});

describe("acquireApiToken — token bucket theo app", () => {
  it("burst 2 giây rồi phải chờ theo QPS", async () => {
    const app = `test-app-${Date.now()}`;
    const qps = 5; // burst 10
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) await acquireApiToken(app, qps);
    expect(Date.now() - t0).toBeLessThan(150); // 10 token đầu không chờ
    await acquireApiToken(app, qps); // token thứ 11 phải chờ ~200ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
  });
});
