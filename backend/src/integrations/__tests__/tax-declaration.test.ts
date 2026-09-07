import { describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";

import {
  HOUSEHOLD_TAX_FREE_THRESHOLD,
  HOUSEHOLD_TIER2_MAX,
  householdTier,
} from "../../config/tax-config";
import {
  aggregateDeclaration,
  currentPeriod,
  daysUntil,
  filingDeadline,
  parseDeclarationPeriod,
  periodRange,
  previousQuarter,
  splitWithheld,
  sumRows,
} from "../../services/tax-declaration";
import { buildReminder } from "../../workers/tax-deadline-reminder";

/** 10:00 giờ VN ngày y-m-d. */
const vn = (y: number, m: number, d: number, h = 10) => new Date(Date.UTC(y, m - 1, d, h - 7));

describe("kỳ kê khai theo giờ VN", () => {
  it("quý 3/2026 = 01/07 00:00 VN → 30/09 23:59:59.999 VN", () => {
    const r = periodRange({ year: 2026, quarter: 3 });
    expect(r.gte.toISOString()).toBe("2026-06-30T17:00:00.000Z");
    expect(r.lte.toISOString()).toBe("2026-09-30T16:59:59.999Z");
  });

  it("cả năm 2026 phủ trọn 31/12 giờ VN", () => {
    const r = periodRange({ year: 2026, quarter: null });
    expect(r.gte.toISOString()).toBe("2025-12-31T17:00:00.000Z");
    expect(r.lte.toISOString()).toBe("2026-12-31T16:59:59.999Z");
  });

  it("đêm 30/09 23:30 VN vẫn là quý 3 (không dạt sang quý 4 theo UTC)", () => {
    expect(currentPeriod(vn(2026, 9, 30, 23))).toEqual({ year: 2026, quarter: 3 });
    // 01/01 02:00 VN = 31/12 19:00 UTC — phải là quý 1 năm mới.
    expect(currentPeriod(vn(2027, 1, 1, 2))).toEqual({ year: 2027, quarter: 1 });
  });

  it("quý trước của quý 1 là quý 4 năm trước", () => {
    expect(previousQuarter(vn(2027, 1, 15))).toEqual({ year: 2026, quarter: 4 });
    expect(previousQuarter(vn(2026, 8, 1))).toEqual({ year: 2026, quarter: 2 });
  });

  it("đọc query: mặc định quý hiện tại, all = cả năm, sai → null", () => {
    expect(parseDeclarationPeriod({}, vn(2026, 9, 7))).toEqual({ year: 2026, quarter: 3 });
    expect(parseDeclarationPeriod({ year: "2026", quarter: "all" })).toEqual({ year: 2026, quarter: null });
    expect(parseDeclarationPeriod({ year: "2026", quarter: "2" })).toEqual({ year: 2026, quarter: 2 });
    expect(parseDeclarationPeriod({ year: "2026", quarter: "5" })).toBeNull();
    expect(parseDeclarationPeriod({ year: "abc" })).toBeNull();
  });
});

describe("hạn nộp tờ khai", () => {
  it("quý → ngày cuối tháng đầu quý sau; quý 4 gộp nhắc doanh thu năm", () => {
    expect(filingDeadline({ year: 2026, quarter: 1 }).label).toBe("30/04/2026");
    expect(filingDeadline({ year: 2026, quarter: 2 }).label).toBe("31/07/2026");
    expect(filingDeadline({ year: 2026, quarter: 3 }).label).toBe("31/10/2026");
    const q4 = filingDeadline({ year: 2026, quarter: 4 });
    expect(q4.label).toBe("31/01/2027");
    expect(q4.description).toContain("doanh thu năm 2026");
    expect(filingDeadline({ year: 2026, quarter: null }).label).toBe("31/01/2027");
  });

  it("daysUntil đếm theo ngày VN, âm khi đã qua hạn", () => {
    const dl = filingDeadline({ year: 2026, quarter: 3 }).date;
    expect(daysUntil(dl, vn(2026, 10, 24))).toBe(7);
    expect(daysUntil(dl, vn(2026, 10, 30, 23))).toBe(1);
    expect(daysUntil(dl, vn(2026, 10, 31))).toBe(0);
    expect(daysUntil(dl, vn(2026, 11, 2))).toBe(-2);
  });
});

describe("gom số kê khai theo sàn", () => {
  const base = {
    shippingStatus: ShippingStatus.DELIVERED,
    isSettled: true,
    sellerVoucher: 0,
    refundedAmount: 0,
    platformTax: 0,
  };

  it("doanh thu tính thuế = tiền hàng − voucher người bán − hoàn; đơn hủy loại", () => {
    const rows = aggregateDeclaration([
      { ...base, channelName: "SHOPEE", revenueGross: 200_000, sellerVoucher: 10_000, platformTax: 2_850 },
      { ...base, channelName: "SHOPEE", revenueGross: 100_000, refundedAmount: 100_000, platformTax: 0 },
      { ...base, channelName: "SHOPEE", revenueGross: 999_999, shippingStatus: ShippingStatus.CANCELLED },
      { ...base, channelName: "LAZADA", revenueGross: 79_000, isSettled: false, platformTax: 1_185 },
    ]);
    expect(rows.map((r) => r.channelName)).toEqual(["SHOPEE", "LAZADA"]);
    const sp = rows[0];
    expect(sp.orderCount).toBe(2);
    expect(sp.taxableRevenue).toBe(190_000);
    expect(sp.refundedAmount).toBe(100_000);
    expect(sp.taxWithheldActual).toBe(2_850);
    const lz = rows[1];
    expect(lz.settledCount).toBe(0);
    expect(lz.unsettledTaxableRevenue).toBe(79_000);
    expect(lz.taxWithheldActual).toBe(0);
    expect(lz.taxWithheldEstimated).toBe(1_185);
    const total = sumRows(rows);
    expect(total.orderCount).toBe(3);
    expect(total.taxableRevenue).toBe(269_000);
  });

  it("hoàn nhiều hơn tiền hàng không sinh doanh thu âm", () => {
    const [r] = aggregateDeclaration([
      { ...base, channelName: "TIKTOK", revenueGross: 50_000, refundedAmount: 80_000 },
    ]);
    expect(r.taxableRevenue).toBe(0);
  });

  it("tách 1,5% thành GTGT 1% : TNCN 0,5% và cộng lại đúng tổng", () => {
    expect(splitWithheld(3_000)).toEqual({ vat: 2_000, pit: 1_000 });
    const s = splitWithheld(1_001);
    expect(s.vat + s.pit).toBe(1_001);
  });
});

describe("phân nhóm hộ kinh doanh theo NĐ 68/141/2026", () => {
  it("ngưỡng miễn là 1 tỷ (không còn 500 triệu)", () => {
    expect(HOUSEHOLD_TAX_FREE_THRESHOLD).toBe(1_000_000_000);
    expect(householdTier(600_000_000).tier).toBe(1);
    expect(householdTier(1_000_000_000).tier).toBe(1);
    expect(householdTier(1_000_000_001).tier).toBe(2);
    expect(householdTier(HOUSEHOLD_TIER2_MAX + 1).tier).toBe(3);
    expect(householdTier(60_000_000_000).tier).toBe(4);
    expect(householdTier(60_000_000_000).nextThreshold).toBeNull();
  });
});

describe("chuông nhắc hạn", () => {
  it("bắn đúng mốc 7 ngày và 1 ngày trước hạn quý trước, im ngày khác", () => {
    // Quý 3/2026 hết → hạn 31/10/2026.
    const r7 = buildReminder(vn(2026, 10, 24));
    expect(r7?.daysLeft).toBe(7);
    expect(r7?.title).toContain("quý 3/2026");
    expect(r7?.link).toBe("/invoicing/history?period=2026-Q3");
    const r1 = buildReminder(vn(2026, 10, 30));
    expect(r1?.daysLeft).toBe(1);
    expect(r1?.title).toContain("Ngày mai 31/10/2026");
    expect(buildReminder(vn(2026, 10, 20))).toBeNull();
    expect(buildReminder(vn(2026, 10, 31))).toBeNull();
  });

  it("quý 4 nhắc kèm thông báo doanh thu năm", () => {
    const r = buildReminder(vn(2027, 1, 24));
    expect(r?.title).toContain("quý 4/2026");
    expect(r?.body).toContain("doanh thu năm 2026");
  });
});
