import { describe, expect, it } from "vitest";
import { orderPaymentDetail } from "./order-payment-detail";

type Input = Parameters<typeof orderPaymentDetail>[0];

/** Đơn tối thiểu — chỉ điền các trường hàm đọc. */
function order(over: Record<string, unknown>): Input {
  return {
    totalAmount: 0,
    isSettled: false,
    actualPayout: 0,
    fixedFee: 0,
    serviceFee: 0,
    paymentFee: 0,
    sellerProtectionFee: 0,
    affiliateFee: 0,
    sellerVoucher: 0,
    platformSubsidy: 0,
    refundedAmount: 0,
    shippingFeeActual: 0,
    shipSubsidyPlatform: 0,
    shippingFeeDiff: 0,
    taxWithheld: 0,
    channel: { channelName: "SHOPEE" },
    items: [],
    lazadaSettlement: null,
    tiktokSettlement: null,
    ...over,
  } as unknown as Input;
}

describe("orderPaymentDetail", () => {
  it("Shopee chưa quyết toán: khớp màn Doanh thu đơn hàng ước tính (đơn 261003NBDUYU8T)", () => {
    const d = orderPaymentDetail(
      order({
        items: [{ quantity: 1, price: 269000 }],
        actualPayout: 179651,
        fixedFee: 51379,
        serviceFee: 17795,
        paymentFee: 16140,
        taxWithheld: 4035,
        shippingFeeActual: 30000,
        shipSubsidyPlatform: 30000,
      })
    );
    expect(d.status).toBe("estimated");
    expect(d.productTotal).toBe(269000);
    expect(d.payout).toBe(179651);
    const byLabel = Object.fromEntries(d.groups.map((g) => [g.label, g.total]));
    expect(byLabel["Phụ phí"]).toBe(-85314);
    expect(byLabel["Thuế"]).toBe(-4035);
    expect(byLabel["Phí vận chuyển"]).toBe(0);
    // Tổng sản phẩm + mọi nhóm = tiền sàn trả về.
    const sum = d.groups.reduce((s, g) => s + (g.total ?? 0), d.productTotal);
    expect(sum).toBe(179651);
  });

  it("Shopee chưa có số của sàn: không dựng khối phí", () => {
    const d = orderPaymentDetail(order({ items: [{ quantity: 2, price: 100000 }] }));
    expect(d).toEqual({ status: "none", productTotal: 200000, groups: [], payout: null });
  });

  it("Lazada chưa có sao kê: không dựng khối phí", () => {
    const d = orderPaymentDetail(
      order({ channel: { channelName: "LAZADA" }, totalAmount: 248000, items: [{ quantity: 1, price: 241676 }] })
    );
    expect(d.status).toBe("none");
    expect(d.productTotal).toBe(248000);
  });

  it("TikTok ước tính: giữ nguyên dấu của bản kê, bỏ dòng 0", () => {
    const d = orderPaymentDetail(
      order({
        channel: { channelName: "TIKTOK" },
        tiktokSettlement: {
          estimated: true,
          grossSales: 200000,
          sellerDiscount: -20000,
          feeCommission: -18000,
          feeTransaction: -5000,
          taxVat: -1800,
          taxPit: -900,
          settlementAmount: 154300,
        },
      })
    );
    expect(d.status).toBe("estimated");
    expect(d.payout).toBe(154300);
    const fees = d.groups.find((g) => g.label === "Phụ phí")!;
    expect(fees.total).toBe(-23000);
    expect(fees.lines.map((l) => l.label)).toEqual(["Phí hoa hồng nền tảng", "Phí giao dịch"]);
    expect(d.groups.find((g) => g.label === "Thuế")!.total).toBe(-2700);
  });
});
