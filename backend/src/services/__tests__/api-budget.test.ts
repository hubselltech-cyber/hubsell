// Van an toàn gọi Ads API theo app (tầng C, docs/ADS-NHIP-CANH-BAO.md) — phần thuần.
import { describe, expect, it } from "vitest";
import { acquireApiToken, pauseMsForLevel } from "../api-budget";
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
  it("vượt trần theo APP / toàn hệ thống / HTTP 429 → partner (đóng cầu dao)", () => {
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: ads.rate_limit.exceed_partner_api — Too many"))).toBe("partner");
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: ads.rate_limit.exceed_api — Too many"))).toBe("partner");
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: HTTP 429 — vượt trần"))).toBe("partner");
  });
  it("vượt trần theo SHOP → shop (chỉ lùi gian)", () => {
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: ads.rate_limit.exceed_shop_api — ..."))).toBe("shop");
  });
  it("lỗi khác (kể cả error_rate_limit chung của API đơn/kho) → null", () => {
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: error_rate_limit — ..."))).toBe(null);
    expect(classifyShopeeAdsRateLimit(new Error("Shopee x lỗi: error_param — ..."))).toBe(null);
  });
});

describe("classifyLazadaAdsRateLimit", () => {
  it("ApiCallLimit / HTTP 429 → partner; 901 → shop; khác → null", () => {
    expect(classifyLazadaAdsRateLimit(new Error("Lazada x lỗi: ApiCallLimit — ..."))).toBe("partner");
    expect(classifyLazadaAdsRateLimit(new Error("Lazada x lỗi: HTTP 429 — ..."))).toBe("partner");
    expect(classifyLazadaAdsRateLimit(new Error("Lazada x lỗi: 901 — retry in the next second"))).toBe("shop");
    expect(classifyLazadaAdsRateLimit(new Error("Lazada x lỗi: IllegalAccessToken — ..."))).toBe(null);
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
