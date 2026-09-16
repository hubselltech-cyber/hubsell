// ============================================================
// BẢN KÊ TIKTOK 202501 / UNSETTLED 202507 — TEST MAPPER THUẦN (16/09/2026)
// Payload theo docs Partner Center (tải JSON 16/09): breakdown đặt tên, số CÓ
// DẤU (âm = sàn trừ). Kiểm: đúng cột theo tên phí TikTok VN, cột gộp Order dương,
// hoàn tiền không đếm đôi, điều chỉnh gắn đơn, dòng unsettled est_*.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  groupTiktokLinesByOrder,
  mapTiktokBreakdownToSettlement,
  parseEstimatedSettlement,
} from "../tiktok/settlements";
import type { TikTokTxBreakdown } from "../tiktok/client";

const ORDER_LINE: TikTokTxBreakdown = {
  type: "ORDER",
  order_id: "586000000000000001",
  revenue_amount: "333200",
  shipping_cost_amount: "-5000",
  fee_tax_amount: "-96000",
  settlement_amount: "232200",
  revenue_breakdown: {
    subtotal_before_discount_amount: "350000",
    seller_discount_amount: "-16800",
  },
  shipping_cost_breakdown: {
    actual_shipping_fee_amount: "-40000",
    customer_paid_shipping_fee_amount: "5000",
    shipping_fee_discount_amount: "30000",
    return_shipping_fee_amount: "0",
    signature_confirmation_fee_amount: "0",
    supplementary_component: {
      platform_shipping_fee_discount_amount: "20000",
      shipping_fee_subsidy_amount: "10000",
      seller_shipping_fee_discount_amount: "0",
    },
  },
  fee_tax_breakdown: {
    fee: {
      platform_commission_amount: "-46648",
      transaction_fee_amount: "-19992",
      vn_fix_infrastructure_fee: "-3000",
      sfp_service_fee_amount: "-9996",
      voucher_xtra_service_fee_amount: "0",
      flash_sales_service_fee_amount: "-2000",
      affiliate_commission_amount: "-10584",
      affiliate_commission_amount_before_pit: "-11760",
      affiliate_ads_commission_amount: "0",
      gmv_max_ad_fee_amount: "0",
      seller_growth_fee_amount: "-1000", // chưa có cột riêng → Phí khác
    },
    tax: {
      local_vat_amount: "-1204",
      pit_amount: "-400",
    },
  },
  supplementary_component: {
    platform_discount_amount: "39200",
    customer_refund_amount: "0",
  },
};

describe("mapTiktokBreakdownToSettlement — dòng ORDER 202501", () => {
  const { detail, order } = mapTiktokBreakdownToSettlement([ORDER_LINE]);

  it("mỗi cột chi tiết = đúng một trường API, giữ nguyên dấu", () => {
    expect(detail.grossSales).toBe(350000);
    expect(detail.sellerDiscount).toBe(-16800);
    expect(detail.revenueAmount).toBe(333200);
    expect(detail.platformDiscount).toBe(39200);
    expect(detail.shipActual).toBe(-40000);
    expect(detail.shipCustomerPaid).toBe(5000);
    expect(detail.shipPlatformDiscount).toBe(20000);
    expect(detail.shipSubsidy).toBe(10000);
    expect(detail.shippingCost).toBe(-5000);
    expect(detail.feeCommission).toBe(-46648);
    expect(detail.feeTransaction).toBe(-19992);
    expect(detail.feeOrderProcessing).toBe(-3000);
    expect(detail.feeSfp).toBe(-9996);
    expect(detail.feeFlashSale).toBe(-2000);
    // Hoa hồng affiliate ưu tiên before_pit (chi phí thật của shop)
    expect(detail.feeAffiliate).toBe(-11760);
    expect(detail.taxVat).toBe(-1204);
    expect(detail.taxPit).toBe(-400);
    expect(detail.settlementAmount).toBe(232200);
    expect(detail.adjustmentTypes).toBeNull();
  });

  it("Phí khác = phần dư của fee_tax_amount sau khi bóc cột đã đặt tên + thuế", () => {
    // −96.000 − (−46.648 −19.992 −3.000 −9.996 −2.000 −11.760) − (−1.204 −400) = −1.000
    expect(detail.feeOther).toBe(-1000);
    const named =
      detail.feeCommission + detail.feeTransaction + detail.feeOrderProcessing +
      detail.feeSfp + detail.feeVoucherXtra + detail.feeFlashSale + detail.feeAffiliate +
      detail.feeAffiliateAds + detail.feeAffiliatePartner + detail.feeGmvMax + detail.feeOther +
      detail.taxVat + detail.taxPit + detail.taxOther;
    expect(named).toBe(-96000);
  });

  it("cột gộp Order lưu DƯƠNG, đúng nhóm; trợ giá KHÔNG gồm chiết khấu nền tảng", () => {
    expect(order.fixedFee).toBe(46648);
    expect(order.paymentFee).toBe(19992 + 3000);
    expect(order.serviceFee).toBe(9996 + 2000 + 1000);
    expect(order.affiliateFee).toBe(11760);
    expect(order.taxWithheld).toBe(1604);
    expect(order.sellerVoucher).toBe(16800);
    expect(order.platformSubsidy).toBe(0);
    expect(order.shippingFeeQuoted).toBe(5000);
    expect(order.shippingFeeActual).toBe(40000);
    expect(order.shipSubsidyPlatform).toBe(30000);
    expect(order.shippingFeeDiff).toBe(5000);
    expect(order.refundedAmount).toBe(0);
    expect(order.actualPayout).toBe(232200);
    // Doanh thu ước tính theo công thức chung khớp payout từng đồng
    const est =
      350000 - 16800 - order.fixedFee - order.paymentFee - order.serviceFee -
      order.affiliateFee - order.shippingFeeDiff - order.taxWithheld + order.platformSubsidy;
    expect(est).toBe(order.actualPayout);
  });
});

describe("mapTiktokBreakdownToSettlement — ORDER + REFUND cùng đơn", () => {
  it("hoàn toàn bộ: tiền hoàn = giá gốc hoàn − CK shop trả lại, không đếm đôi; payout về 0", () => {
    const refund: TikTokTxBreakdown = {
      type: "REFUND",
      order_id: "586000000000000001",
      revenue_amount: "-333200",
      shipping_cost_amount: "0",
      fee_tax_amount: "96000",
      settlement_amount: "-232200",
      revenue_breakdown: {
        refund_subtotal_before_discount_amount: "-350000",
        seller_discount_refund_amount: "16800",
      },
      fee_tax_breakdown: {
        fee: {
          platform_commission_amount: "46648",
          transaction_fee_amount: "19992",
          vn_fix_infrastructure_fee: "3000",
          sfp_service_fee_amount: "9996",
          flash_sales_service_fee_amount: "2000",
          affiliate_commission_amount_before_pit: "11760",
          seller_growth_fee_amount: "1000",
        },
        tax: { local_vat_amount: "1204", pit_amount: "400" },
      },
      supplementary_component: { customer_refund_amount: "-338200" },
    };
    const { detail, order } = mapTiktokBreakdownToSettlement([ORDER_LINE, refund]);
    expect(detail.refundGross).toBe(-350000);
    expect(detail.sellerDiscountRefund).toBe(16800);
    expect(detail.customerRefund).toBe(-338200);
    expect(order.refundedAmount).toBe(333200); // KHÔNG phải 2× như bản 202309
    expect(order.actualPayout).toBe(0);
    // Phí đã hoàn lại đủ → nhóm phí ròng 0, không âm hoá thành phí ảo
    expect(order.fixedFee).toBe(0);
    expect(order.affiliateFee).toBe(0);
    expect(order.taxWithheld).toBe(0);
    expect(order.platformSubsidy).toBe(0);
  });
});

describe("dòng điều chỉnh gắn đơn", () => {
  it("SHIPPING_FEE_ADJUSTMENT âm → ship shop chịu; điều chỉnh dương → trợ giá", () => {
    const shipAdj: TikTokTxBreakdown = {
      type: "SHIPPING_FEE_ADJUSTMENT",
      adjustment_id: "72",
      adjustment_order_id: "586000000000000001",
      adjustment_amount: "-7000",
      settlement_amount: "-7000",
    };
    const { detail, order } = mapTiktokBreakdownToSettlement([ORDER_LINE, shipAdj]);
    expect(detail.adjustmentAmount).toBe(-7000);
    expect(detail.adjustmentTypes).toBe("SHIPPING_FEE_ADJUSTMENT");
    expect(order.shippingFeeDiff).toBe(5000 + 7000);
    expect(order.actualPayout).toBe(232200 - 7000);

    const comp: TikTokTxBreakdown = {
      type: "PLATFORM_COMPENSATION",
      adjustment_id: "73",
      adjustment_order_id: "586000000000000001",
      adjustment_amount: "15000",
      settlement_amount: "15000",
    };
    const r2 = mapTiktokBreakdownToSettlement([ORDER_LINE, comp]);
    expect(r2.order.platformSubsidy).toBe(15000);
    expect(r2.order.serviceFee).toBe(9996 + 2000 + 1000);
  });
});

describe("dòng unsettled 202507 (est_*)", () => {
  it("đọc các tổng est_ và breakdown y hệt bản kê thật", () => {
    const line: TikTokTxBreakdown = {
      type: "ORDER",
      status: "UNSETTLED",
      order_id: "586000000000000002",
      estimated_settlement: "1758000000",
      unsettled_reason: "waiting for delivery",
      est_revenue_amount: "200000",
      est_shipping_cost_amount: "0",
      est_fee_tax_amount: "-30000",
      est_settlement_amount: "170000",
      revenue_breakdown: { subtotal_before_discount_amount: "210000", seller_discount_amount: "-10000" },
      fee_tax_breakdown: {
        fee: { platform_commission_amount: "-20000", transaction_fee_amount: "-7000" },
        tax: { local_vat_amount: "-2000", pit_amount: "-1000" },
      },
    };
    const { detail, order } = mapTiktokBreakdownToSettlement([line]);
    expect(detail.revenueAmount).toBe(200000);
    expect(detail.feeTaxAmount).toBe(-30000);
    expect(detail.settlementAmount).toBe(170000);
    expect(detail.feeOther).toBe(0);
    expect(order.actualPayout).toBe(170000);
    expect(order.taxWithheld).toBe(3000);
    expect(parseEstimatedSettlement(line.estimated_settlement)?.toISOString()).toBe(
      new Date(1758000000 * 1000).toISOString()
    );
    expect(parseEstimatedSettlement("7 days after delivery")).toBeNull();
  });
});

describe("groupTiktokLinesByOrder", () => {
  it("gom ORDER/REFUND theo order_id, điều chỉnh theo adjustment_order_id, dòng cấp shop đếm riêng", () => {
    const { byOrder, unlinked } = groupTiktokLinesByOrder([
      { type: "ORDER", order_id: "A" },
      { type: "REFUND", order_id: "A" },
      { type: "SHIPPING_FEE_ADJUSTMENT", adjustment_id: "9", adjustment_order_id: "A" },
      { type: "ORDER", order_id: "B" },
      { type: "PLATFORM_PENALTY", adjustment_id: "10", order_id: "0" },
      { type: "SAMPLE_SHIPPING_FEE", adjustment_id: "11" },
    ]);
    expect(byOrder.get("A")?.length).toBe(3);
    expect(byOrder.get("B")?.length).toBe(1);
    expect(unlinked).toBe(2);
  });

  it("thiếu mọi trường → toàn 0, không NaN", () => {
    const { detail, order } = mapTiktokBreakdownToSettlement([{ type: "ORDER", order_id: "X" }]);
    for (const v of Object.values(order)) expect(v).toBe(0);
    for (const [k, v] of Object.entries(detail)) {
      if (k === "adjustmentTypes") expect(v).toBeNull();
      else expect(v).toBe(0);
    }
  });
});
