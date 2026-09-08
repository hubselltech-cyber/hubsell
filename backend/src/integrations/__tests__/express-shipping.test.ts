import { describe, expect, it } from "vitest";

import { EXPRESS_KEYWORDS, isExpressShipping } from "../../services/shipping";

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
      "Trong Ngày",
    ]) {
      expect(isExpressShipping(n), n).toBe(true);
    }
  });

  it("bắt hỏa tốc + giao trong ngày TikTok (tên phương thức ghi kèm hãng)", () => {
    for (const n of ["Hỏa tốc · Ahamove", "Instant · BeDelivery", "Giao Trong Ngày · J&T Express", "Sameday · J&T Express"]) {
      expect(isExpressShipping(n), n).toBe(true);
    }
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
