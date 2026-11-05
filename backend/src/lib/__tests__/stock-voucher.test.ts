import { describe, expect, it } from "vitest";

import { parsePurchasePrice, PURCHASE_PRICE_MAX, sumVoucherCost, utcTimestampLiteral, weightedAveragePrice } from "../stock-voucher";

describe("sumVoucherCost — giá trị phiếu", () => {
  it("dòng có giá nhập dùng giá nhập, dòng chưa ghi lấy giá vốn mặc định", () => {
    expect(
      sumVoucherCost([
        { quantity: 300, unitCost: 36000, purchasePrice: 49800 },
        { quantity: 50, unitCost: 71000, purchasePrice: null },
        { quantity: 10, unitCost: 5000 },
      ])
    ).toBe(300 * 49800 + 50 * 71000 + 10 * 5000);
  });
  it("giá nhập 0 đồng (quà tặng) vẫn là giá nhập, không rơi về giá vốn", () => {
    expect(sumVoucherCost([{ quantity: 100, unitCost: 4500, purchasePrice: 0 }])).toBe(0);
  });
});

describe("parsePurchasePrice — giá nhập một dòng phiếu", () => {
  it("rỗng / thiếu → null (dòng không ghi giá)", () => {
    expect(parsePurchasePrice(undefined)).toBeNull();
    expect(parsePurchasePrice(null)).toBeNull();
    expect(parsePurchasePrice("")).toBeNull();
  });
  it("số hợp lệ, kể cả 0 đồng (quà tặng) và chuỗi số", () => {
    expect(parsePurchasePrice(0)).toBe(0);
    expect(parsePurchasePrice(52400)).toBe(52400);
    expect(parsePurchasePrice("49800")).toBe(49800);
    expect(parsePurchasePrice(49800.6)).toBe(49801);
  });
  it("âm, không phải số, vượt trần → null", () => {
    expect(parsePurchasePrice(-1)).toBeNull();
    expect(parsePurchasePrice("abc")).toBeNull();
    expect(parsePurchasePrice(Number.NaN)).toBeNull();
    expect(parsePurchasePrice(PURCHASE_PRICE_MAX + 1)).toBeNull();
  });
});

describe("weightedAveragePrice — bình quân theo số lượng", () => {
  it("ca mockup: 500×52.400 + 300×49.800 + 100×55.000 trên 900 cái = 51.822", () => {
    const value = 500 * 52400 + 300 * 49800 + 100 * 55000;
    expect(weightedAveragePrice(value, 900)).toBe(51822);
  });
  it("khác trung bình cộng giá các nhà: nhà nhập ít không kéo lệch", () => {
    // 10 cái giá 100.000 + 1.000 cái giá 50.000 → ~50.495, không phải 75.000.
    expect(weightedAveragePrice(10 * 100000 + 1000 * 50000, 1010)).toBe(50495);
  });
  it("chưa dòng nào có giá → null, không chia cho 0", () => {
    expect(weightedAveragePrice(0, 0)).toBeNull();
  });
});

describe("utcTimestampLiteral — mốc ngày cho SQL thô trên cột không múi giờ", () => {
  it("giữ nguyên giờ UTC, bỏ chữ T và Z", () => {
    expect(utcTimestampLiteral(new Date("2026-11-04T17:00:00.000Z"))).toBe("2026-11-04 17:00:00.000");
  });
});
