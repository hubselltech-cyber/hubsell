// ============================================================
// BẢN KÊ TIKTOK — TEST MAPPER THUẦN (16/09/2026): giao dịch phẳng (phí âm) →
// cột quyết toán dương của Order; Σ cột phí khớp |fee_amount|; gộp ORDER + REFUND.
// ============================================================
import { describe, expect, it } from "vitest";
import { mapTiktokTransactionsToOrder } from "../tiktok/settlements";

describe("mapTiktokTransactionsToOrder", () => {
  it("bóc từng loại phí, phần chưa bóc dồn serviceFee để khớp tổng fee_amount", () => {
    const cols = mapTiktokTransactionsToOrder([
      {
        type: "ORDER",
        order_id: "O1",
        settlement_amount: "180000",
        fee_amount: "-24000",
        platform_commission_amount: "-8000",
        transaction_fee_amount: "-6000",
        affiliate_commission_amount: "-5000",
        sfp_service_fee_amount: "-3000",
        // 2.000 còn lại của fee_amount không có cột riêng → serviceFee
        platform_discount_amount: "10000",
        customer_paid_shipping_fee_amount: "15000",
        actual_shipping_fee_amount: "-30000",
        shipping_fee_subsidy_amount: "10000",
        pit_amount: "-1000",
        iva_vat_amount: "-2000",
      } as never,
    ]);
    expect(cols.fixedFee).toBe(8000);
    expect(cols.paymentFee).toBe(6000);
    expect(cols.affiliateFee).toBe(5000);
    expect(cols.serviceFee).toBe(5000); // 3.000 SFP + 2.000 chưa bóc
    expect(cols.fixedFee + cols.paymentFee + cols.affiliateFee + cols.serviceFee).toBe(24000);
    expect(cols.platformSubsidy).toBe(10000);
    expect(cols.shippingFeeQuoted).toBe(15000);
    expect(cols.shippingFeeActual).toBe(30000);
    expect(cols.shipSubsidyPlatform).toBe(10000);
    expect(cols.shippingFeeDiff).toBe(5000); // 30.000 − (15.000 + 10.000)
    expect(cols.taxWithheld).toBe(3000);
    expect(cols.refundedAmount).toBe(0);
    expect(cols.actualPayout).toBe(180000);
  });

  it("gộp ORDER + REFUND của cùng đơn: payout cộng có dấu, tiền hoàn lấy trị tuyệt đối", () => {
    const cols = mapTiktokTransactionsToOrder([
      { type: "ORDER", order_id: "O2", settlement_amount: "100000", fee_amount: "-5000", platform_commission_amount: "-5000" } as never,
      { type: "REFUND", order_id: "O2", settlement_amount: "-100000", fee_amount: "5000", platform_commission_amount: "5000", customer_refund_amount: "-120000" } as never,
    ]);
    expect(cols.actualPayout).toBe(0);
    expect(cols.refundedAmount).toBe(120000);
    // Phí hoàn lại (dấu dương) cộng trị tuyệt đối — cùng quy ước Shopee lưu magnitude.
    expect(cols.fixedFee).toBe(10000);
  });

  it("thiếu mọi trường → toàn 0, không NaN", () => {
    const cols = mapTiktokTransactionsToOrder([{ type: "ORDER", order_id: "O3" } as never]);
    for (const v of Object.values(cols)) expect(v).toBe(0);
  });
});
