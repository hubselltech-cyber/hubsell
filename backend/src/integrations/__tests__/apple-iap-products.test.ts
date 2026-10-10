import { describe, expect, it } from "vitest";
import {
  appleProductId,
  isAppleSellablePlanCode,
  parseAppleProductId,
} from "../apple-iap/products";

describe("apple-iap/products — mã sản phẩm App Store ↔ (gói, kỳ)", () => {
  it("sinh mã theo khuôn vn.hubsell.app.<code thường>.<kỳ>", () => {
    expect(appleProductId("STARTER", "MONTHLY")).toBe("vn.hubsell.app.starter.monthly");
    expect(appleProductId("Pro", "QUARTERLY")).toBe("vn.hubsell.app.pro.quarterly");
    expect(appleProductId("BUSINESS", "SEMIANNUAL")).toBe("vn.hubsell.app.business.semiannual");
    expect(appleProductId("SCALE", "YEARLY")).toBe("vn.hubsell.app.scale.yearly");
  });

  it("Enterprise (bán bằng tư vấn) và mã có ký tự lạ không có sản phẩm", () => {
    expect(appleProductId("ENTERPRISE", "MONTHLY")).toBeNull();
    expect(appleProductId("PRO-2026", "MONTHLY")).toBeNull();
    expect(appleProductId("GÓI", "MONTHLY")).toBeNull();
    expect(isAppleSellablePlanCode("GROWTH")).toBe(true);
    expect(isAppleSellablePlanCode("enterprise")).toBe(false);
  });

  it("giải mã ngược đúng gói + kỳ, khứ hồi với sinh mã", () => {
    for (const code of ["STARTER", "GROWTH", "PRO", "BUSINESS", "SCALE"]) {
      for (const cycle of ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "YEARLY"] as const) {
        const id = appleProductId(code, cycle);
        expect(id).not.toBeNull();
        expect(parseAppleProductId(id)).toEqual({ planCodeLower: code.toLowerCase(), cycle });
      }
    }
  });

  it("từ chối mã không thuộc Hubsell hoặc sai kỳ", () => {
    expect(parseAppleProductId(null)).toBeNull();
    expect(parseAppleProductId("")).toBeNull();
    expect(parseAppleProductId("com.other.app.pro.monthly")).toBeNull();
    expect(parseAppleProductId("vn.hubsell.app.pro.weekly")).toBeNull();
    expect(parseAppleProductId("vn.hubsell.app.pro")).toBeNull();
    expect(parseAppleProductId("vn.hubsell.app.pro.monthly.extra")).toBeNull();
    expect(parseAppleProductId("vn.hubsell.app.PRO.monthly")).toBeNull();
  });
});
