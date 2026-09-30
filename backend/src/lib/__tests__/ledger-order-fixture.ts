// Bộ đơn mẫu dùng chung cho các test "hai nguồn số bằng nhau" (sổ cái ↔ kéo
// đơn). Không phải file test — vitest chỉ chạy *.test.ts.

import {
  ChannelName,
  Prisma,
  ReturnSolution,
  ReturnStatus,
  ShippingStatus,
} from "@prisma/client";
import type { LedgerOrder } from "../order-ledger";

export const D = (n: number) => new Prisma.Decimal(n);

type ItemOverride = Partial<Record<keyof LedgerOrder["items"][number], unknown>>;
export type OrderOverride = Partial<Record<Exclude<keyof LedgerOrder, "items">, unknown>> & { items?: ItemOverride[] };

/** Đơn Shopee đã quyết toán: 2 dòng (269k + 100k), vốn 131k + 40k, payout 300.000. */
export function mkOrder(over: OrderOverride = {}): LedgerOrder {
  const base = {
    id: "o1",
    orderCode: "2609TEST",
    channelId: "c1",
    shippingStatus: ShippingStatus.DELIVERED,
    returnStatus: ReturnStatus.NONE,
    returnSolution: null,
    returnDeliveredAt: null,
    stockRestoredAt: null,
    platformRefundAmount: D(0),
    platformReturnStatus: null,
    isSettled: true,
    settledAt: new Date("2026-09-20T03:00:00Z"),
    deliveredAt: new Date("2026-09-15T10:30:00Z"),
    createdAt: new Date("2026-09-10T17:30:00Z"), // 00:30 ngày 11/09 giờ VN
    packedAt: null,
    customerName: "Khách",
    carrier: null,
    totalAmount: D(369000),
    sellerVoucher: D(0),
    fixedFee: D(30000),
    paymentFee: D(0),
    serviceFee: D(10000),
    sellerProtectionFee: D(0),
    affiliateFee: D(0),
    platformSubsidy: D(0),
    shippingFeeQuoted: D(0),
    shippingFeeActual: D(0),
    shipSubsidyPlatform: D(0),
    shipSubsidyShop: D(0),
    shippingFeeDiff: D(0),
    adWalletTopup: D(0),
    taxWithheld: D(5535),
    refundedAmount: D(0),
    actualPayout: D(300000),
    channel: { channelName: ChannelName.SHOPEE, shopName: "ANO", userId: "u1" },
    inventoryLogs: [],
    lazadaSettlement: null,
    tiktokSettlement: null,
  };
  const items = (
    over.items ?? [
      { id: "i1", channelSku: "TC025", price: D(269000), costPriceAtSale: D(131000) },
      { id: "i2", channelSku: "TC026", price: D(100000), costPriceAtSale: D(40000) },
    ]
  ).map((it, i) => ({
    id: `i${i}`,
    orderId: "o1",
    productId: null,
    channelSku: "SKU",
    productName: "Sản phẩm",
    quantity: 1,
    price: D(0),
    costPriceAtSale: D(0),
    returnedQuantity: 0,
    returnRestocked: false,
    product: null,
    ...it,
  }));
  return { ...base, ...over, items } as unknown as LedgerOrder;
}

/** 9 đơn phủ mọi nhóm: quyết toán / chờ / đang giao / hủy / đang hoàn / hoàn xong / thiếu vốn ×2 / gian & ngày khác. */
export const FIXTURE_ORDERS: LedgerOrder[] = [
  mkOrder({ id: "a" }), // tính doanh thu + quyết toán + đã giao
  mkOrder({ id: "b", isSettled: false, actualPayout: D(0), createdAt: new Date("2026-09-12T02:00:00Z") }),
  mkOrder({ id: "b2", isSettled: false, actualPayout: D(0), shippingStatus: ShippingStatus.SHIPPING, deliveredAt: null }),
  mkOrder({ id: "c", shippingStatus: ShippingStatus.CANCELLED, isSettled: false, actualPayout: D(0) }),
  mkOrder({
    id: "d", returnStatus: ReturnStatus.AWAITING, returnSolution: ReturnSolution.RETURN_REFUND,
    isSettled: false, actualPayout: D(0), platformRefundAmount: D(369000),
  }),
  mkOrder({
    id: "e", returnStatus: ReturnStatus.RECEIVED_INTACT, returnSolution: ReturnSolution.RETURN_REFUND,
    returnDeliveredAt: new Date(), refundedAmount: D(100000), actualPayout: D(200000),
    items: [
      { id: "i1", channelSku: "TC025", price: D(269000), costPriceAtSale: D(131000) },
      { id: "i2", channelSku: "TC026", price: D(100000), costPriceAtSale: D(40000), returnedQuantity: 1, returnRestocked: true },
    ],
  }),
  mkOrder({ id: "f", items: [{ id: "i1", price: D(369000), costPriceAtSale: D(0) }] }),
  mkOrder({ id: "f2", isSettled: false, actualPayout: D(0), items: [{ id: "i1", price: D(369000), costPriceAtSale: D(0) }] }),
  mkOrder({
    id: "g", channelId: "c2", channel: { channelName: ChannelName.TIKTOK, shopName: "TT", userId: "u1" },
    createdAt: new Date("2026-09-20T09:00:00Z"), sellerVoucher: D(20000), platformSubsidy: D(8750),
    affiliateFee: D(15000), adWalletTopup: D(5000), shippingFeeDiff: D(3000), actualPayout: D(250000),
    items: [
      { id: "i1", channelSku: "TC025", price: D(269000), costPriceAtSale: D(131000), quantity: 1 },
      { id: "i2", channelSku: "TC026", price: D(50000), costPriceAtSale: D(20000), quantity: 2 },
    ],
  }),
];
