// ============================================================
// computePnlRow — ĐƠN TIKTOK CÓ BẢN KÊ: "Giá trị đơn hàng" = GIÁ MÓN HÀNG TRONG
// GIỎ (29/10/2026, anh Trung chốt; docs/DONG-TIEN-TONG-GIA-TRI-SAN-PHAM-KHAO-SAT-
// 29-10.md mục 8–9). Số mẫu = dòng ORDER docs 202501 trong tiktok-settlements.test
// (giá gốc 350.000, chiết khấu NBH −16.800, revenue_amount 333.200) và đơn hủy
// thật ảnh anh 29/10 (550.000 / −200.000 / hoàn −350.000).
// ============================================================
import { ChannelName, ShippingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { computePnlRow } from "../pnl-formula";
import { computeGrossDeductions } from "../cash-flow-totals";
import { D, mkOrder } from "./ledger-order-fixture";

/** Sao kê TikTok tối thiểu cho computePnlRow (các cột khác không dùng ở đây → 0). */
function ttSettlement(over: Record<string, unknown>) {
  return {
    estimated: false, estimatedSettlementAt: null, unsettledReason: null, adjustmentTypes: null,
    grossSales: D(0), sellerDiscount: D(0), refundGross: D(0), sellerDiscountRefund: D(0),
    revenueAmount: D(0), platformDiscount: D(0), customerRefund: D(0), feeGmvMax: D(0),
    ...over,
  } as unknown as NonNullable<ReturnType<typeof mkOrder>["tiktokSettlement"]>;
}

const tiktok = { channelName: ChannelName.TIKTOK, shopName: "and.not.or", userId: "u1" };

describe("computePnlRow — TikTok giá trong giỏ", () => {
  it("đơn thường: revenueGross = giá gốc + chiết khấu NBH (= revenue_amount dòng ORDER), sellerVoucher = 0", () => {
    const r = computePnlRow(
      mkOrder({
        channel: tiktok, totalAmount: D(333200), sellerVoucher: D(16800), fixedFee: D(46648),
        paymentFee: D(22992), serviceFee: D(12996), affiliateFee: D(11760), shippingFeeDiff: D(5000),
        taxWithheld: D(1604), actualPayout: D(232200),
        items: [{ id: "i1", channelSku: "TC031", price: D(316400), costPriceAtSale: D(150000) }],
        tiktokSettlement: ttSettlement({ grossSales: D(350000), sellerDiscount: D(-16800), revenueAmount: D(333200) }),
      })
    );
    expect(r.revenueGross).toBe(333200);
    expect(r.sellerVoucher).toBe(0);
    expect(r.actualRevenue).toBe(333200);
    // Doanh thu ước tính vẫn khớp payout từng đồng như trước khi đổi định nghĩa
    expect(r.netRevenue).toBe(232200);
    expect(r.platformRevenue).toBe(232200);
    // Thác nước Báo cáo dòng tiền: Tổng giá trị SP − khấu trừ = Doanh thu, dòng voucher TikTok = 0
    const gd = computeGrossDeductions([r]);
    expect(gd.grossValue).toBe(333200);
    expect(gd.grossValue - gd.totalDeduction).toBe(gd.actualRevenueTotal);
    expect(gd.feeSellerVoucher).toBe(0);
    expect(gd.feeOther).toBe(0);
  });

  it("đơn hủy có bản kê (ảnh 29/10): giá trị = 350.000 (giá trong giỏ), tiền hoàn = số sàn, doanh thu 0", () => {
    const r = computePnlRow(
      mkOrder({
        channel: tiktok, shippingStatus: ShippingStatus.CANCELLED, deliveredAt: null,
        totalAmount: D(350000), sellerVoucher: D(200000), refundedAmount: D(350000), actualPayout: D(0),
        isSettled: true,
        items: [{ id: "i1", channelSku: "TC040", price: D(350000), costPriceAtSale: D(150000) }],
        tiktokSettlement: ttSettlement({
          grossSales: D(550000), sellerDiscount: D(-200000), refundGross: D(-550000),
          sellerDiscountRefund: D(200000), revenueAmount: D(0),
        }),
      })
    );
    expect(r.revenueGross).toBe(350000); // KHÔNG phải 550.000 (giá niêm yết) như bản cũ
    expect(r.sellerVoucher).toBe(0);
    expect(r.refundedAmount).toBe(350000);
    expect(r.platformRevenue).toBe(0);
    expect(r.profitAfterTax).toBe(0); // hàng chưa đi → vốn thu hồi
  });

  it("đơn CHƯA có bản kê: giữ giá dòng hàng (sale_price), không đổi so với trước", () => {
    const r = computePnlRow(
      mkOrder({
        channel: tiktok, isSettled: false, actualPayout: D(0), totalAmount: D(279000),
        items: [{ id: "i1", channelSku: "TC054", price: D(279000), costPriceAtSale: D(120000) }],
        tiktokSettlement: null,
      })
    );
    expect(r.revenueGross).toBe(279000);
    expect(r.sellerVoucher).toBe(0);
  });
});
