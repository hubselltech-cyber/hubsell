// Lát C — trần ảnh theo gói (thuần). Dọn ảnh/HQ chạm DB, không test ở đây.
import { describe, expect, it } from "vitest";
import { imageQuotaForTier, PRODUCT_IMAGE_QUOTA, quotaExceeded } from "../images";

describe("imageQuotaForTier", () => {
  it("bậc 1–5 có trần tăng dần, bậc 6 (và cao hơn) không giới hạn, không gói = không giới hạn", () => {
    expect(imageQuotaForTier(1)).toBe(200);
    expect(imageQuotaForTier(5)).toBe(30_000);
    expect(imageQuotaForTier(6)).toBeNull();
    expect(imageQuotaForTier(9)).toBeNull();
    expect(imageQuotaForTier(null)).toBeNull();
    expect(imageQuotaForTier(undefined)).toBeNull();
    for (let t = 1; t < 5; t++) expect(PRODUCT_IMAGE_QUOTA[t]!).toBeLessThan(PRODUCT_IMAGE_QUOTA[t + 1]!);
  });
  it("bậc lạ (0, âm) rơi về trần bậc 1 — không bao giờ mở vô hạn do dữ liệu lỗi", () => {
    expect(imageQuotaForTier(0)).toBe(200);
    expect(imageQuotaForTier(-3)).toBe(200);
  });
  it("quotaExceeded: chạm trần là chặn; không trần thì không bao giờ chặn", () => {
    expect(quotaExceeded({ used: 199, max: 200 })).toBe(false);
    expect(quotaExceeded({ used: 200, max: 200 })).toBe(true);
    expect(quotaExceeded({ used: 1_000_000, max: null })).toBe(false);
  });
});
