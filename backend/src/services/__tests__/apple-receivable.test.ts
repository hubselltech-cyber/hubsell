import { describe, expect, it } from "vitest";
import { estimateApplePayout, groupApplePayouts, isAppleReceivable, ledgerCashTotals } from "../apple-receivable";

describe("estimateApplePayout — ngày Apple chuyển dự kiến (ước)", () => {
  it("khoản 10–14/11/2026 giờ Việt Nam thuộc tháng tài chính 11 → ~31/12/2026, hạn 12/01/2027", () => {
    // 06:10 11/11 giờ VN = 23:10 10/11 UTC (khoản thật của khách)
    for (const iso of ["2026-11-10T07:58:00Z", "2026-11-10T23:10:00Z", "2026-11-14T02:10:00Z"]) {
      expect(estimateApplePayout(new Date(iso))).toEqual({
        fiscalMonthEnd: "2026-11-28",
        expected: "2026-12-31",
        deadline: "2027-01-12",
      });
    }
  });

  it("ranh tháng tính theo giờ Thái Bình Dương: 08:00 29/11 giờ VN vẫn là 28/11 bên Apple", () => {
    expect(estimateApplePayout(new Date("2026-11-29T01:00:00Z"))?.fiscalMonthEnd).toBe("2026-11-28");
    expect(estimateApplePayout(new Date("2026-11-29T09:00:00Z"))?.fiscalMonthEnd).toBe("2026-12-26");
  });

  it("tháng tài chính 10 (27/09 → 31/10) → ~03/12/2026", () => {
    expect(estimateApplePayout(new Date("2026-10-15T05:00:00Z"))?.expected).toBe("2026-12-03");
  });

  it("ngoài bảng lịch thì không đoán", () => {
    expect(estimateApplePayout(new Date("2027-10-15T05:00:00Z"))).toBeNull();
    expect(estimateApplePayout(new Date("2026-08-01T05:00:00Z"))).toBeNull();
  });

  it("gom theo đợt chuyển, sớm trước", () => {
    const g = groupApplePayouts([
      { occurredAt: new Date("2026-12-02T05:00:00Z"), amount: 119_000 },
      { occurredAt: new Date("2026-11-10T07:58:00Z"), amount: 829_000 },
      { occurredAt: new Date("2026-11-14T02:10:00Z"), amount: 470_000 },
    ]);
    expect(g.map((x) => [x.expected, x.amount, x.count])).toEqual([
      ["2026-12-31", 1_299_000, 2],
      ["2027-01-28", 119_000, 1],
    ]);
  });
});

// Số lấy theo sổ quỹ prod 10–14/11/2026: 5 khoản App Store + một khoản chuyển
// khoản thường + một phiếu chi.
const APPLE = { method: "APPLE_IAP" };
const BANK = { method: "BANK_TRANSFER" };

describe("ledgerCashTotals — khoản App Store không vào tiền quỹ", () => {
  const entries = [
    { direction: "IN" as const, amount: 829_000, packagePayment: APPLE },
    { direction: "IN" as const, amount: 119_000, packagePayment: APPLE },
    { direction: "IN" as const, amount: 119_000, packagePayment: APPLE },
    { direction: "IN" as const, amount: 470_000, packagePayment: APPLE },
    { direction: "IN" as const, amount: 119_000, packagePayment: APPLE },
    { direction: "IN" as const, amount: 699_000, packagePayment: BANK },
    { direction: "IN" as const, amount: 366, packagePayment: null },
    { direction: "OUT" as const, amount: 75_122, packagePayment: null },
  ];

  it("THU chỉ gồm tiền đã vào tài khoản; Apple tách riêng", () => {
    const t = ledgerCashTotals(entries);
    expect(t.in).toBe(699_366);
    expect(t.out).toBe(75_122);
    expect(t.net).toBe(624_244);
    expect(t.appleAwaiting).toBe(1_656_000);
    expect(t.appleAwaitingCount).toBe(5);
  });

  it("sổ không có khoản Apple thì số cũ giữ nguyên", () => {
    const t = ledgerCashTotals(entries.filter((e) => e.packagePayment !== APPLE));
    expect(t.in).toBe(699_366);
    expect(t.appleAwaiting).toBe(0);
    expect(t.appleAwaitingCount).toBe(0);
  });

  it("chỉ bút toán THU của App Store mới là phải thu", () => {
    expect(isAppleReceivable({ direction: "IN", amount: 1, packagePayment: APPLE })).toBe(true);
    expect(isAppleReceivable({ direction: "OUT", amount: 1, packagePayment: APPLE })).toBe(false);
    expect(isAppleReceivable({ direction: "IN", amount: 1, packagePayment: BANK })).toBe(false);
    expect(isAppleReceivable({ direction: "IN", amount: 1, packagePayment: null })).toBe(false);
  });
});
