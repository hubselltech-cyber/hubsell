import { describe, expect, it } from "vitest";

import { mapCqtStatus, seriesHasTaxCode } from "../invoice/cqt-status";

describe("mapCqtStatus — chuẩn hóa SendTaxStatus meInvoice", () => {
  it("ký hiệu CÓ MÃ: 0 chờ · 1 gửi lỗi · 2 đã cấp mã · 3 từ chối", () => {
    expect(mapCqtStatus(0, true)).toBe("WAITING");
    expect(mapCqtStatus(1, true)).toBe("SEND_ERROR");
    expect(mapCqtStatus(2, true)).toBe("ACCEPTED");
    expect(mapCqtStatus(3, true)).toBe("REJECTED");
  });

  it("ký hiệu KHÔNG MÃ: 0/1 chờ · 2 tiếp nhận · 3 không tiếp nhận · 4 lỗi", () => {
    expect(mapCqtStatus(0, false)).toBe("WAITING");
    expect(mapCqtStatus(1, false)).toBe("WAITING");
    expect(mapCqtStatus(2, false)).toBe("ACCEPTED");
    expect(mapCqtStatus(3, false)).toBe("REJECTED");
    expect(mapCqtStatus(4, false)).toBe("SEND_ERROR");
  });

  it("không có trường / mã lạ → null (giữ giá trị cũ, không ghi đè)", () => {
    expect(mapCqtStatus(null, true)).toBeNull();
    expect(mapCqtStatus(9, true)).toBeNull();
    expect(mapCqtStatus(9, false)).toBeNull();
  });

  it("seriesHasTaxCode đọc ký tự thứ 2 của ký hiệu TT78", () => {
    expect(seriesHasTaxCode("1C26TAA")).toBe(true);
    expect(seriesHasTaxCode("1K26TYY")).toBe(false);
    expect(seriesHasTaxCode(null)).toBe(false);
    expect(seriesHasTaxCode("")).toBe(false);
  });
});
