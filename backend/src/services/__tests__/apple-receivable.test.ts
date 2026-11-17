import { describe, expect, it } from "vitest";
import { isAppleReceivable, ledgerCashTotals } from "../apple-receivable";

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
