import { describe, expect, it } from "vitest";

import { EXPRESS_KEYWORDS, isExpressShipping, isSameDayShipping } from "../../services/shipping";

/**
 * Danh mục hãng/kênh hỏa tốc theo tài liệu chính thức 3 sàn (khảo sát 08/09/2026)
 * — test này là hàng rào để lần sau sửa từ khoá không làm rớt hãng nào.
 */
describe("isExpressShipping — nhận diện hỏa tốc từ tên hãng/phương thức", () => {
  it("bắt đủ 5 hãng nhóm Hỏa Tốc Shopee + tên kênh", () => {
    for (const n of [
      "SPX Instant",
      "GrabExpress",
      "beDelivery",
      "Ahamove",
      "Xanh SM",
      "Green SM",
      "Hỏa Tốc",
      "Hỏa Tốc - Ưu Tiên",
    ]) {
      expect(isExpressShipping(n), n).toBe(true);
    }
  });

  it("TikTok: 'Hỏa tốc · hãng' là hỏa tốc; 'Giao Trong Ngày · J&T' KHÔNG (anh Trung chốt 08/09)", () => {
    for (const n of ["Hỏa tốc · Ahamove", "Instant · BeDelivery"]) {
      expect(isExpressShipping(n), n).toBe(true);
      expect(isSameDayShipping(n), n).toBe(false);
    }
    for (const n of ["Giao Trong Ngày · J&T Express", "Sameday · J&T Express", "Trong Ngày", "Same-day · SPX Express"]) {
      expect(isExpressShipping(n), n).toBe(false);
      expect(isSameDayShipping(n), n).toBe(true);
    }
    // Tên cũ Shopee vừa Hỏa Tốc vừa Trong Ngày → hỏa tốc thắng
    expect(isExpressShipping("Hỏa Tốc - Trong Ngày")).toBe(true);
    expect(isSameDayShipping("Hỏa Tốc - Trong Ngày")).toBe(false);
    expect(isSameDayShipping("J&T Express")).toBe(false);
  });

  it("KHÔNG bắt hãng giao thường — 'express' trần không phải hỏa tốc", () => {
    for (const n of [
      "SPX Express",
      "J&T Express",
      "Giao Hàng Nhanh",
      "GHN",
      "Ninja Van",
      "BEST Express",
      "Viettel Post",
      "Giao Hàng Tiết Kiệm",
      "LEX VN",
      "Lazada Express",
      "Standard Delivery",
      "",
      null,
    ]) {
      expect(isExpressShipping(n), String(n)).toBe(false);
    }
  });

  it("không có từ khoá quá rộng dễ báo oan", () => {
    for (const k of EXPRESS_KEYWORDS) {
      expect(["express", "spx", "sm", "be", "nhanh"]).not.toContain(k);
    }
  });
});
