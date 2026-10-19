// Van an toàn gọi Ads API theo app (tầng C, docs/ADS-NHIP-CANH-BAO.md) — phần thuần.
import { describe, expect, it } from "vitest";
import { acquireApiToken, isRateLimitStorm, lazadaShopKey, pauseMsForLevel, shopCallWaitMs, type RateLimitHit } from "../api-budget";
import { breakerSignalLevel } from "../platform-health";
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

describe("shopCallWaitMs — giãn lệnh trong một xung của cùng gian (lát 2, ADS_SHOP_CALL_GAP_SEC)", () => {
  it("tắt (gap 0) hoặc gian chưa gọi lần nào → gọi ngay", () => {
    expect(shopCallWaitMs(1_000, 1_500, 0)).toBe(0);
    expect(shopCallWaitMs(undefined, 1_500, 5_000)).toBe(0);
  });
  it("lệnh trước 1 s trước, gap 5 s → chờ 4 s; đã quá gap → 0", () => {
    expect(shopCallWaitMs(10_000, 11_000, 5_000)).toBe(4_000);
    expect(shopCallWaitMs(10_000, 20_000, 5_000)).toBe(0);
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

describe("isRateLimitStorm — nhiều GIAN KHÁC NHAU cùng 429 trong cửa sổ mới đóng cầu dao chung", () => {
  const M = 60_000;
  it("3 gian khác nhau trong 10' → bão; 2 gian → chưa", () => {
    const hits: RateLimitHit[] = [];
    expect(isRateLimitStorm(hits, 0, "A")).toBe(false);
    expect(isRateLimitStorm(hits, 4 * M, "B")).toBe(false);
    expect(isRateLimitStorm(hits, 9 * M, "C")).toBe(true);
  });
  it("MỘT gian dính 429 liên tiếp trong một xung (ví, GMS, cờ ví — sự cố 16/10) → KHÔNG bão", () => {
    const hits: RateLimitHit[] = [];
    expect(isRateLimitStorm(hits, 0, "A")).toBe(false);
    expect(isRateLimitStorm(hits, 1_000, "A")).toBe(false);
    expect(isRateLimitStorm(hits, 2_000, "A")).toBe(false);
    expect(isRateLimitStorm(hits, 3_000, "A")).toBe(false);
    // Thêm gian thứ hai vẫn chưa đủ 3 gian.
    expect(isRateLimitStorm(hits, 4_000, "B")).toBe(false);
    expect(isRateLimitStorm(hits, 5_000, "B")).toBe(false);
    // Gian thứ ba → bão thật.
    expect(isRateLimitStorm(hits, 6_000, "C")).toBe(true);
  });
  it("429 rời rạc như sự cố 28/09 (00:50, 04:06, 13:18, 18:45, 20:28, 20:48, 21:32, 7 gian) → không bao giờ bão", () => {
    const hits: RateLimitHit[] = [];
    const times = [50, 246, 798, 1125, 1228, 1248, 1292].map((m) => m * M);
    expect(times.map((t, i) => isRateLimitStorm(hits, t, `shop-${i}`)).some(Boolean)).toBe(false);
  });
  it("mốc cũ ngoài cửa sổ bị loại", () => {
    const hits: RateLimitHit[] = [];
    isRateLimitStorm(hits, 0, "A");
    isRateLimitStorm(hits, 1 * M, "B");
    expect(isRateLimitStorm(hits, 12 * M, "C")).toBe(false);
    expect(hits).toEqual([{ shop: "C", at: 12 * M }]);
  });
});

describe("isRateLimitStorm — tỷ lệ theo số gian đã gọi (17/10: 29 gian đóng ~8 lần/ngày)", () => {
  it("29 gian đã gọi: 3–5 gian dính lẻ tẻ → chưa bão; 6 gian (≥20 %) → bão", () => {
    const hits: RateLimitHit[] = [];
    for (const s of ["A", "B", "C", "D", "E"]) expect(isRateLimitStorm(hits, 1_000, s, 29)).toBe(false);
    expect(isRateLimitStorm(hits, 2_000, "F", 29)).toBe(true);
  });
  it("50.000 gian: 3 gian không là gì; vẫn cần 20 % (10.000 gian)", () => {
    const hits: RateLimitHit[] = [];
    for (let i = 0; i < 9_999; i++) expect(isRateLimitStorm(hits, 1_000, `s${i}`, 50_000)).toBe(false);
    expect(isRateLimitStorm(hits, 1_000, "s9999", 50_000)).toBe(true);
  });
  it("ít gian (5 đã gọi): sàn tối thiểu 3 gian vẫn giữ", () => {
    const hits: RateLimitHit[] = [];
    expect(isRateLimitStorm(hits, 0, "A", 5)).toBe(false);
    expect(isRateLimitStorm(hits, 0, "B", 5)).toBe(false);
    expect(isRateLimitStorm(hits, 0, "C", 5)).toBe(true);
  });
});

describe("lazadaShopKey — không để access_token lọt ra log / lý do cầu dao", () => {
  it("băm ổn định, không chứa token gốc", () => {
    const k = lazadaShopKey("50000000abcSECRETtoken");
    expect(k).toMatch(/^lzd#[0-9a-f]{10}$/);
    expect(k).not.toContain("SECRET");
    expect(lazadaShopKey("50000000abcSECRETtoken")).toBe(k);
    expect(lazadaShopKey(undefined)).toBeUndefined();
  });
});

describe("breakerSignalLevel — bão bậc 0 chỉ vàng", () => {
  it("bão 429 bậc 0 đang đóng → warn; bậc ≥1 hoặc vượt trần app thật → crit", () => {
    expect(breakerSignalLevel([{ reason: "Bão 429: 6/29 gian ...", level: 0 }], 1, 3)).toBe("warn");
    expect(breakerSignalLevel([{ reason: "Bão 429: 6/29 gian ...", level: 1 }], 2, 3)).toBe("crit");
    expect(breakerSignalLevel([{ reason: "ads.rate_limit.exceed_partner_api", level: 0 }], 1, 3)).toBe("crit");
    expect(breakerSignalLevel([{ reason: null, level: 0 }], 1, 3)).toBe("crit");
  });
  it("không đóng: theo số lần 24h", () => {
    expect(breakerSignalLevel([], 0, 3)).toBe("ok");
    expect(breakerSignalLevel([], 3, 3)).toBe("warn");
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
