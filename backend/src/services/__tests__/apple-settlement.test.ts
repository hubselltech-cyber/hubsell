import { describe, expect, it } from "vitest";
import { AppleSettlementError, computeSettlement } from "../apple-settlement";
import { ledgerCashTotals } from "../apple-receivable";

describe("computeSettlement — hoa hồng = tổng khách trả − tiền về − thuế", () => {
  it("5 khoản tháng 11 (1.656.000), Apple giữ 30 %, không tách thuế", () => {
    const m = computeSettlement(1_656_000, 1_159_200, 0);
    expect(m.commission).toBe(496_800);
    expect(m.commissionRate).toBeCloseTo(0.3, 5);
    expect(m.unusualRate).toBe(false);
  });

  it("có thuế Apple trừ: tách riêng khỏi hoa hồng, tổng vẫn khớp", () => {
    const m = computeSettlement(1_656_000, 1_400_000, 12_420);
    expect(m.commission).toBe(243_580);
    expect(m.commission + m.bank + m.tax).toBe(m.gross);
  });

  it("tỷ lệ lạ (nhập nhầm số) → hỏi lại, không chặn", () => {
    expect(computeSettlement(1_656_000, 1_600_000, 0).unusualRate).toBe(true); // ~3 %
    expect(computeSettlement(1_656_000, 900_000, 0).unusualRate).toBe(true); // ~46 %
  });

  it("tiền về + thuế lớn hơn tổng khách trả → lỗi", () => {
    expect(() => computeSettlement(1_656_000, 1_700_000, 0)).toThrow(AppleSettlementError);
  });

  it("số tiền không hợp lệ → lỗi", () => {
    expect(() => computeSettlement(1_656_000, 0, 0)).toThrow(AppleSettlementError);
    expect(() => computeSettlement(1_656_000, 1_000_000.5, 0)).toThrow(AppleSettlementError);
    expect(() => computeSettlement(1_656_000, 1_000_000, -1)).toThrow(AppleSettlementError);
    expect(() => computeSettlement(0, 1_000_000, 0)).toThrow(AppleSettlementError);
  });
});

describe("ledgerCashTotals sau khi Apple chuyển — tiền quỹ đi qua bút toán của đợt", () => {
  const APPLE = { method: "APPLE_IAP" };
  it("khoản bán đã trả không còn chờ, không tính tiền; thu − chi của đợt = đúng tiền về", () => {
    const t = ledgerCashTotals([
      { direction: "IN", amount: 829_000, packagePayment: APPLE, appleSettlementId: "s1" },
      { direction: "IN", amount: 827_000, packagePayment: APPLE, appleSettlementId: "s1" },
      { direction: "IN", amount: 119_000, packagePayment: APPLE, appleSettlementId: null },
      // bút toán của đợt s1
      { direction: "IN", amount: 1_656_000, packagePayment: null, appleSettlementId: "s1" },
      { direction: "OUT", amount: 496_800, packagePayment: null, appleSettlementId: "s1" },
    ]);
    expect(t.in).toBe(1_656_000);
    expect(t.out).toBe(496_800);
    expect(t.net).toBe(1_159_200);
    expect(t.appleAwaiting).toBe(119_000);
    expect(t.appleAwaitingCount).toBe(1);
  });
});
