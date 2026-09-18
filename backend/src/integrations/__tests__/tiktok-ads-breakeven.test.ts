import { describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";
import { tiktokBreakevenBase, toTiktokBreakeven, type BreakevenPnlRow } from "../tiktok-ads/breakeven";

// ROI HÒA VỐN TIKTOK = 1 ÷ biên lãi TRƯỚC quảng cáo. Phí GMV Max đã nằm trong lợi nhuận đơn → cộng ngược.
function row(over: Partial<BreakevenPnlRow> & { sku?: string }): BreakevenPnlRow {
  return {
    shippingStatus: ShippingStatus.DELIVERED,
    items: [{ sku: over.sku ?? "TC054", price: 250_000, quantity: 1 }],
    actualRevenue: 250_000,
    profit: 30_000,
    missingCostPrice: false,
    tiktok: { feeGmvMax: -20_000 },
    ...over,
  };
}

describe("tiktokBreakevenBase", () => {
  it("cộng ngược phí GMV Max: lãi 30k đã trừ 20k quảng cáo → lãi trước ads 50k, hòa vốn = 250/50 = 5", () => {
    const base = tiktokBreakevenBase([row({})], null);
    expect(base).toMatchObject({ orders: 1, revenue: 250_000, profitBeforeAds: 50_000, adFee: 20_000 });
    expect(toTiktokBreakeven(base, "campaign")).toMatchObject({ breakevenRoi: 5, margin: 0.2, negativeMargin: false, source: "campaign", costCoveragePct: 100 });
  });

  it("đơn HỦY góp doanh thu vào mẫu số (TikTok vẫn đếm) nhưng 0 đồng lãi — không lấy lỗ ảo của dòng P&L", () => {
    const base = tiktokBreakevenBase(
      [row({}), row({ shippingStatus: ShippingStatus.CANCELLED, profit: -120_000, tiktok: null })],
      null
    );
    expect(base).toMatchObject({ orders: 2, cancelledOrders: 1, revenue: 500_000, profitBeforeAds: 50_000 });
    expect(toTiktokBreakeven(base, "shop").breakevenRoi).toBe(10); // hủy 50% → hòa vốn gấp đôi
  });

  it("đơn thiếu giá vốn bị loại khỏi cả tử lẫn mẫu, chỉ tính vào độ phủ", () => {
    const base = tiktokBreakevenBase([row({}), row({ missingCostPrice: true, profit: 200_000 })], null);
    expect(base).toMatchObject({ orders: 1, revenue: 250_000, missingCostRevenue: 250_000 });
    expect(toTiktokBreakeven(base, "shop")).toMatchObject({ breakevenRoi: 5, costCoveragePct: 50 });
  });

  it("đơn chưa có bản kê của sàn (phí = 0 giả) không được tính", () => {
    const base = tiktokBreakevenBase([row({}), row({ tiktok: null, profit: 150_000 })], null);
    expect(base).toMatchObject({ orders: 1, revenue: 250_000, noStatementRevenue: 250_000 });
  });

  it("lọc theo SKU của chiến dịch + phân bổ đơn nhiều SKU theo tỷ trọng giá trị hàng", () => {
    const mixed = row({
      items: [
        { sku: "TC054", price: 100_000, quantity: 1 },
        { sku: "KHAC", price: 300_000, quantity: 1 },
      ],
      actualRevenue: 400_000,
      profit: 60_000,
      tiktok: { feeGmvMax: -20_000 },
    });
    const base = tiktokBreakevenBase([mixed, row({ sku: "KHAC" })], new Set(["TC054"]));
    expect(base.orders).toBe(1);
    expect(base.revenue).toBeCloseTo(100_000);
    expect(base.profitBeforeAds).toBeCloseTo(20_000); // (60k + 20k) × 25%
    expect(base.adFee).toBeCloseTo(5_000);
  });

  it("sàn HOÀN lại phí quảng cáo (feeGmvMax dương) thì trừ ra, không cộng", () => {
    const base = tiktokBreakevenBase([row({ profit: 40_000, tiktok: { feeGmvMax: 5_000 } })], null);
    expect(base.profitBeforeAds).toBe(35_000);
  });
});

describe("toTiktokBreakeven", () => {
  it("bán đã lỗ trước cả quảng cáo → không có ROI hòa vốn, gắn cờ negativeMargin", () => {
    const base = tiktokBreakevenBase([row({ profit: -40_000 })], null);
    expect(toTiktokBreakeven(base, "campaign")).toMatchObject({ breakevenRoi: null, negativeMargin: true });
  });

  it("không có đơn nào tính được → null, vẫn báo độ phủ giá vốn", () => {
    const base = tiktokBreakevenBase([row({ missingCostPrice: true })], null);
    expect(toTiktokBreakeven(base, "shop")).toMatchObject({ breakevenRoi: null, source: null, orders: 0, costCoveragePct: 0, negativeMargin: false });
  });
});
