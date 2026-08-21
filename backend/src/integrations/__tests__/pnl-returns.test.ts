// ============================================================
// LÃI/LỖ THỰC HIỆN — 4 KỊCH BẢN HOÀN/TRẢ THEO SỐ CỦA SÀN (chốt anh Trung 19/08)
//
// Nguyên tắc: KHÔNG BỊA GIÁ. Tiền hoàn = số sao kê thật → số sàn báo trên yêu
// cầu hoàn → 0. Hàng đã về (kho quét / sàn xác nhận / đơn hủy đã hoàn tồn) →
// thu hồi giá vốn, chỉ còn lỗ phí/ship. Logic thuần trên computePnlRow, KHÔNG DB.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  ChannelName,
  Prisma,
  ReturnSolution,
  ReturnStatus,
  ShippingStatus,
} from "@prisma/client";
import { computePnlRow, computeReturnLoss, returnGoodsRecovered } from "../../routes/finance";

type PnlOrder = Parameters<typeof computePnlRow>[0];
const D = (n: number) => new Prisma.Decimal(n);

/** Đơn Shopee 1 SKU giá 269k, vốn 131k, phí sàn 90k — khung mọi kịch bản. */
type ItemOverride = Partial<Record<keyof PnlOrder["items"][number], unknown>>;
type OrderOverride = Partial<Record<Exclude<keyof PnlOrder, "items">, unknown>> & { items?: ItemOverride[] };
function mkOrder(over: OrderOverride = {}): PnlOrder {
  const base = {
    id: "o1",
    orderCode: "2608TEST",
    channelId: "c1",
    shippingStatus: ShippingStatus.DELIVERED,
    returnStatus: ReturnStatus.NONE,
    returnSolution: null,
    returnDeliveredAt: null,
    stockRestoredAt: null,
    platformRefundAmount: D(0),
    platformReturnStatus: null,
    isSettled: true,
    createdAt: new Date("2026-08-10"),
    packedAt: null,
    customerName: "Khách",
    carrier: null,
    totalAmount: D(269000),
    sellerVoucher: D(0),
    fixedFee: D(68389),
    paymentFee: D(0),
    serviceFee: D(17795),
    sellerProtectionFee: D(2700),
    affiliateFee: D(0),
    platformSubsidy: D(0),
    shippingFeeQuoted: D(0),
    shippingFeeActual: D(0),
    shipSubsidyPlatform: D(0),
    shipSubsidyShop: D(0),
    shippingFeeDiff: D(0),
    adWalletTopup: D(0),
    taxWithheld: D(4035),
    refundedAmount: D(0),
    actualPayout: D(176081),
    channel: { channelName: ChannelName.SHOPEE, shopName: "ANO" },
    inventoryLogs: [],
    lazadaSettlement: null,
  };
  const items = (over.items ?? [{}]).map((it, i) => ({
    id: `i${i}`,
    orderId: "o1",
    productId: null,
    channelSku: "TC025",
    productName: "Túi TC025",
    quantity: 1,
    price: D(269000),
    costPriceAtSale: D(131000),
    returnedQuantity: 0,
    returnRestocked: false,
    product: null,
    ...it,
  }));
  return { ...base, ...over, items } as unknown as PnlOrder;
}
const FEES = 68389 + 17795 + 2700 + 4035; // 92 919

describe("returnGoodsRecovered — hàng đã về tay chưa (căn cứ kho / sàn / hủy)", () => {
  const base = {
    shippingStatus: ShippingStatus.DELIVERED,
    returnStatus: ReturnStatus.NONE,
    returnSolution: null,
    returnDeliveredAt: null,
    stockRestoredAt: null,
  };
  it("sàn xác nhận kiện về (RETURN_REFUND + returnDeliveredAt) → thu hồi dù kho chưa quét", () => {
    expect(
      returnGoodsRecovered({
        ...base,
        returnStatus: ReturnStatus.AWAITING,
        returnSolution: ReturnSolution.RETURN_REFUND,
        returnDeliveredAt: new Date(),
      })
    ).toBe(true);
  });
  it("chỉ hoàn tiền (REFUND_ONLY) dù có mốc về → KHÔNG thu hồi (khách giữ hàng)", () => {
    expect(
      returnGoodsRecovered({
        ...base,
        returnSolution: ReturnSolution.REFUND_ONLY,
        returnDeliveredAt: new Date(),
      })
    ).toBe(false);
  });
  it("đang chờ về (AWAITING, chưa mốc) → chưa thu hồi", () => {
    expect(
      returnGoodsRecovered({
        ...base,
        returnStatus: ReturnStatus.AWAITING,
        returnSolution: ReturnSolution.RETURN_REFUND,
      })
    ).toBe(false);
  });
  it("kho đánh DAMAGED / WRITTEN_OFF → mất vốn thật dù sàn báo đã về", () => {
    for (const st of [ReturnStatus.DAMAGED, ReturnStatus.WRITTEN_OFF]) {
      expect(
        returnGoodsRecovered({
          ...base,
          returnStatus: st,
          returnSolution: ReturnSolution.RETURN_REFUND,
          returnDeliveredAt: new Date(),
        })
      ).toBe(false);
    }
  });
  it("kho quét RECEIVED / nhập kho RECEIVED_INTACT / thắng khiếu nại → thu hồi", () => {
    for (const st of [ReturnStatus.RECEIVED, ReturnStatus.RECEIVED_INTACT, ReturnStatus.CLAIM_SETTLED]) {
      expect(returnGoodsRecovered({ ...base, returnStatus: st })).toBe(true);
    }
  });
  it("đơn HỦY → hàng chưa xuất / đã quay về người gửi → vốn không mất (kể cả không quản tồn kho); kho đánh hỏng mới mất", () => {
    expect(
      returnGoodsRecovered({ ...base, shippingStatus: ShippingStatus.CANCELLED })
    ).toBe(true);
    expect(
      returnGoodsRecovered({
        ...base,
        shippingStatus: ShippingStatus.CANCELLED,
        stockRestoredAt: new Date(),
      })
    ).toBe(true);
    expect(
      returnGoodsRecovered({
        ...base,
        shippingStatus: ShippingStatus.CANCELLED,
        returnStatus: ReturnStatus.DAMAGED,
      })
    ).toBe(false);
  });
});

describe("computePnlRow — 4 kịch bản hoàn/trả", () => {
  it("KB4 trả hàng, kiện ĐÃ VỀ (sàn xác nhận), escrow chưa có số: refund = sàn báo, vốn thu hồi → chỉ lỗ phí", () => {
    const r = computePnlRow(
      mkOrder({
        returnStatus: ReturnStatus.AWAITING,
        returnSolution: ReturnSolution.RETURN_REFUND,
        returnDeliveredAt: new Date(),
        platformRefundAmount: D(269000),
        platformReturnStatus: "ACCEPTED",
      })
    );
    expect(r.returnType).toBe("FULL_RETURN");
    expect(r.refundedAmount).toBe(269000);
    expect(r.refundSource).toBe("platform");
    expect(r.refundEstimated).toBe(true);
    expect(r.costSnapshot).toBe(0);
    expect(r.recoveredCost).toBe(131000);
    expect(r.profit).toBe(-FEES);
    expect(computeReturnLoss(r).costLoss).toBe(0);
  });

  it("KB4 trả hàng đang TREO (chưa về): refund theo sàn báo, vốn CHƯA thu hồi", () => {
    const r = computePnlRow(
      mkOrder({
        returnStatus: ReturnStatus.AWAITING,
        returnSolution: ReturnSolution.RETURN_REFUND,
        platformRefundAmount: D(269000),
        platformReturnStatus: "PROCESSING",
      })
    );
    expect(r.returnType).toBe("FULL_RETURN");
    expect(r.refundedAmount).toBe(269000);
    expect(r.costSnapshot).toBe(131000);
    expect(r.profit).toBe(-FEES - 131000);
  });

  it("KB1 hoàn tiền 100% khách giữ hàng: vốn mất 100%, nhãn REFUND_ONLY", () => {
    const r = computePnlRow(
      mkOrder({
        returnSolution: ReturnSolution.REFUND_ONLY,
        platformRefundAmount: D(269000),
        platformReturnStatus: "ACCEPTED",
      })
    );
    expect(r.returnType).toBe("REFUND_ONLY");
    expect(r.refundedAmount).toBe(269000);
    expect(r.costSnapshot).toBe(131000);
    expect(computeReturnLoss(r).costLoss).toBe(131000);
  });

  it("KB2 hoàn 1 phần khách giữ hàng: doanh thu = giá − hoàn, nhãn PARTIAL_REFUND, không mất vốn", () => {
    const r = computePnlRow(
      mkOrder({
        returnSolution: ReturnSolution.REFUND_ONLY,
        platformRefundAmount: D(50000),
        platformReturnStatus: "ACCEPTED",
      })
    );
    expect(r.returnType).toBe("PARTIAL_REFUND");
    expect(r.refundedAmount).toBe(50000);
    expect(r.netRevenue).toBe(269000 - 50000 - FEES);
    expect(computeReturnLoss(r).costLoss).toBe(0);
  });

  it("KB3 trả 1 vài SKU (2 cái trả 1, kiện đã về): thu hồi vốn đúng phần trả, nhãn PARTIAL_RETURN x/y", () => {
    const r = computePnlRow(
      mkOrder({
        returnStatus: ReturnStatus.AWAITING,
        returnSolution: ReturnSolution.RETURN_REFUND,
        returnDeliveredAt: new Date(),
        platformRefundAmount: D(269000),
        items: [{ quantity: 2, returnedQuantity: 1 }],
      })
    );
    expect(r.returnType).toBe("PARTIAL_RETURN");
    expect(r.returnedQuantity).toBe(1);
    expect(r.totalQuantity).toBe(2);
    expect(r.costSnapshot).toBe(131000);
    expect(r.recoveredCost).toBe(131000);
    expect(computeReturnLoss(r).costLoss).toBe(0);
  });

  it("số sao kê THẬT (escrow seller_return_refund) thắng số sàn báo", () => {
    const r = computePnlRow(
      mkOrder({
        returnSolution: ReturnSolution.REFUND_ONLY,
        refundedAmount: D(200000),
        platformRefundAmount: D(269000),
      })
    );
    expect(r.refundedAmount).toBe(200000);
    expect(r.refundSource).toBe("settled");
    expect(r.refundEstimated).toBe(false);
  });

  it("KHÔNG BỊA: Shopee cờ AWAITING kiểu cũ, không số sàn, escrow đã trả tiền dương → refund 0, không còn lỗ ảo", () => {
    const r = computePnlRow(mkOrder({ returnStatus: ReturnStatus.AWAITING }));
    expect(r.returnType).toBe("FULL_RETURN");
    expect(r.refundedAmount).toBe(0);
    expect(r.refundSource).toBeNull();
    expect(r.profit).toBe(269000 - FEES - 131000);
  });

  it("Lazada chưa nối Reverse API: đơn 'returned' vẫn tạm tính hoàn full (ghi rõ estimate)", () => {
    const r = computePnlRow(
      mkOrder({
        returnStatus: ReturnStatus.AWAITING,
        channel: { channelName: ChannelName.LAZADA, shopName: "Hi.Bé" },
      })
    );
    expect(r.refundedAmount).toBe(269000);
    expect(r.refundSource).toBe("estimate");
  });

  it("ĐƠN HỦY (kể cả không quản tồn kho) + escrow trả lại khách full: KHÔNG phải đơn hoàn, vốn 0, doanh thu 0", () => {
    const r = computePnlRow(
      mkOrder({
        shippingStatus: ShippingStatus.CANCELLED,
        refundedAmount: D(269000),
        isSettled: false,
        actualPayout: D(0),
        fixedFee: D(0),
        serviceFee: D(0),
        sellerProtectionFee: D(0),
        taxWithheld: D(0),
      })
    );
    expect(r.returnType).toBeNull();
    expect(r.costSnapshot).toBe(0);
    expect(r.netRevenue).toBe(0);
    expect(r.profit).toBe(0);
    expect(computeReturnLoss(r).total).toBe(0);
  });

  it("sàn báo đã về nhưng kho đánh DAMAGED → vốn mất thật", () => {
    const r = computePnlRow(
      mkOrder({
        returnStatus: ReturnStatus.DAMAGED,
        returnSolution: ReturnSolution.RETURN_REFUND,
        returnDeliveredAt: new Date(),
        platformRefundAmount: D(269000),
      })
    );
    expect(r.costSnapshot).toBe(131000);
    expect(computeReturnLoss(r).costLoss).toBe(131000);
  });
});

describe("computePnlRow — đơn hủy giao thất bại quay về (ca thật 26081266V7GRHG, anh Trung 20/08)", () => {
  it("sàn hủy vì hư hỏng khi vận chuyển, kiện hoàn về người gửi, escrow trả khách full, chỉ PiShip 2.700: lỗ đúng 2.700, không mất 131.000 vốn", () => {
    const r = computePnlRow(
      mkOrder({
        shippingStatus: ShippingStatus.CANCELLED,
        isSettled: false,
        refundedAmount: D(239000),
        actualPayout: D(-2700),
        fixedFee: D(0),
        serviceFee: D(0),
        taxWithheld: D(0),
        sellerProtectionFee: D(2700),
        items: [{ price: D(239000) }],
      })
    );
    expect(r.returnType).toBeNull();
    expect(r.costSnapshot).toBe(0);
    expect(r.profit).toBe(-2700);
    expect(r.profitAfterTax).toBe(-2700);
  });
});

describe("computePnlRow — Lazada sau khi nối Reverse Order API (20/08)", () => {
  it("có dữ liệu Reverse: refund = số sàn báo, KHÔNG còn tạm tính full", () => {
    const r = computePnlRow(
      mkOrder({
        channel: { channelName: ChannelName.LAZADA, shopName: "Hi.Bé" },
        returnStatus: ReturnStatus.AWAITING,
        returnSolution: ReturnSolution.RETURN_REFUND,
        platformRefundAmount: D(159000),
        platformReturnStatus: "REQUEST_INITIATE",
      })
    );
    expect(r.refundedAmount).toBe(159000);
    expect(r.refundSource).toBe("platform");
  });

  it("Reverse nói KHÔNG hoàn đồng nào (returnSolution có, refund 0) → tin số 0, không bịa", () => {
    const r = computePnlRow(
      mkOrder({
        channel: { channelName: ChannelName.LAZADA, shopName: "Hi.Bé" },
        returnStatus: ReturnStatus.AWAITING,
        returnSolution: ReturnSolution.RETURN_REFUND,
        platformRefundAmount: D(0),
      })
    );
    expect(r.refundedAmount).toBe(0);
    expect(r.refundSource).toBeNull();
  });
});
