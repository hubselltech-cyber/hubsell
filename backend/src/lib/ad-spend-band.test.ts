import { describe, expect, it } from "vitest";

import { AD_SPEND_BANDS, isHighAdSpend, parseAdSpendBand } from "./ad-spend-band";

describe("parseAdSpendBand", () => {
  it("nhận đúng 5 giá trị hợp lệ", () => {
    for (const b of AD_SPEND_BANDS) expect(parseAdSpendBand(b)).toBe(b);
  });

  it("sai / thiếu / sai kiểu → null (không chặn đăng ký)", () => {
    for (const raw of [undefined, null, "", "m10_30", "10-30", 10, {}, ["M10_30"]]) {
      expect(parseAdSpendBand(raw)).toBeNull();
    }
  });
});

describe("isHighAdSpend", () => {
  it("chỉ nhóm ≥10 triệu là cao", () => {
    expect(isHighAdSpend("M10_30")).toBe(true);
    expect(isHighAdSpend("GT_30M")).toBe(true);
    for (const b of ["NONE", "LT_5M", "M5_10", null, undefined]) {
      expect(isHighAdSpend(b)).toBe(false);
    }
  });
});
