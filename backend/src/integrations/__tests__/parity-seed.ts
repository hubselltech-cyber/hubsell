// ============================================================
// BỘ ĐƠN MẪU cho các test ĐỐI SOÁT sổ cái = đơn gốc (21/10/2026).
//
// Các file *-ledger-db.test.ts / ads-margin-sql-db / ads-rows-ledger-db so hai
// đường tính trên MỌI chủ shop của DB đang nối, và đòi "DB dev phải có gian
// Shopee/Lazada có đơn 30 ngày". Trên DB dev thật thì có sẵn; trên DB mới dựng
// từ migration (CI, máy mới) thì trống → phép so vô nghĩa và test đỏ.
//
// ensureParityDataset(): nếu DB chưa có gian Shopee/Lazada nào có đơn trong 30
// ngày thì dựng MỘT chủ shop cố định (email test-parity-seed@hubsell.test) với
// gian Shopee + Lazada, sản phẩm, đơn nhiều dòng trải đủ trạng thái / kỳ / phí /
// hoàn / lỗ / thiếu giá vốn, chi phí ads theo ngày. Idempotent theo email, KHÔNG
// dọn (là "dữ liệu dev" của DB trống — chạy lại không dựng thêm). DB dev thật
// đã có đơn thì không đụng gì.
// ============================================================
import { ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ensureLedgerFresh } from "../../services/order-ledger";

export const PARITY_SEED_EMAIL = "test-parity-seed@hubsell.test";

const DAY = 86_400_000;
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(Date.now() - n * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

interface SeedItem {
  sku: string;
  quantity: number;
  price: number;
  cost: number;
}
interface SeedOrder {
  code: string;
  items: SeedItem[];
  createdAt: Date;
  shippingStatus: ShippingStatus;
  deliveredAt?: Date;
  isSettled?: boolean;
  settledAt?: Date;
  platformFee?: number;
  fixedFee?: number;
  serviceFee?: number;
  paymentFee?: number;
  sellerVoucher?: number;
  shippingFeeQuoted?: number;
  shippingFeeActual?: number;
  actualPayout?: number;
  taxWithheld?: number;
  refundedAmount?: number;
  returnStatus?: ReturnStatus;
  paymentStatus?: string;
}

/** Bộ đơn một gian: trải 30 ngày, 60 ngày, quý trước, năm trước; nhiều dòng; đủ trạng thái. */
function ordersFor(prefix: string, lazada: boolean): SeedOrder[] {
  const A = { sku: `${prefix}-A1`, quantity: 1, price: 120_000, cost: 50_000 };
  const A2 = { sku: `${prefix}-A2`, quantity: 2, price: 60_000, cost: 25_000 };
  const B = { sku: `${prefix}-B`, quantity: 1, price: 250_000, cost: 180_000 };
  const G = { sku: `${prefix}-G`, quantity: 1, price: 0, cost: 5_000 }; // quà giá 0
  const N = { sku: `${prefix}-N`, quantity: 3, price: 30_000, cost: 0 }; // chưa có giá vốn
  const L = { sku: `${prefix}-L`, quantity: 1, price: 40_000, cost: 70_000 }; // bán lỗ
  const settled = (o: Partial<SeedOrder>): Partial<SeedOrder> => ({
    isSettled: true,
    paymentStatus: "PAID",
    platformFee: 8_000,
    fixedFee: 4_000,
    serviceFee: 3_000,
    paymentFee: 2_000,
    taxWithheld: 1_500,
    ...o,
  });
  return [
    // Trong 7 ngày: đã giao + đã đối soát, hai dòng cùng sản phẩm.
    { code: "S01", items: [A, A2], createdAt: daysAgo(2), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: daysAgo(1),
      settledAt: daysAgo(0, 8), actualPayout: 221_500, ...settled({}) },
    // Hôm nay: đang giao, chưa đối soát.
    { code: "S02", items: [B], createdAt: daysAgo(0, 6), shippingStatus: ShippingStatus.SHIPPING, paymentStatus: "PAID" },
    // 3 ngày: hàng + quà giá 0, voucher shop, đã giao chưa đối soát.
    { code: "S03", items: [A, G], createdAt: daysAgo(3), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: daysAgo(2),
      sellerVoucher: 10_000, paymentStatus: "PAID" },
    // 5 ngày: hủy.
    { code: "S04", items: [A], createdAt: daysAgo(5), shippingStatus: ShippingStatus.CANCELLED, paymentStatus: "UNPAID" },
    // 6 ngày: thiếu giá vốn (độ phủ).
    { code: "S05", items: [N, G], createdAt: daysAgo(6), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: daysAgo(4),
      settledAt: daysAgo(3), actualPayout: 80_000, ...settled({}) },
    // 12 ngày: ba dòng bằng nhau + voucher → phân bổ làm tròn; bán lỗ một dòng.
    { code: "S06", items: [A, L, A2], createdAt: daysAgo(12), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: daysAgo(10),
      settledAt: daysAgo(9), sellerVoucher: 1_000, actualPayout: 260_000, ...settled({}) },
    // 15 ngày: hoàn một phần — khách trả, đã nhập kho nguyên vẹn, sàn hoàn tiền.
    { code: "S07", items: [B, A], createdAt: daysAgo(15), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: daysAgo(13),
      settledAt: daysAgo(11), actualPayout: 100_000, refundedAmount: 250_000, returnStatus: ReturnStatus.RECEIVED_INTACT, ...settled({}) },
    // 20 ngày: đang xử lý.
    { code: "S08", items: [A2], createdAt: daysAgo(20), shippingStatus: ShippingStatus.PROCESSED, paymentStatus: "PAID" },
    // 25 ngày: đã giao, phí ship chênh.
    { code: "S09", items: [A, B], createdAt: daysAgo(25), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: daysAgo(22),
      settledAt: daysAgo(20), shippingFeeQuoted: 20_000, shippingFeeActual: 26_000, actualPayout: 340_000, ...settled({}) },
    // 45 ngày: ngoài 30 nhưng trong 60.
    { code: "S10", items: [A, A2, G], createdAt: daysAgo(45), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: daysAgo(43),
      settledAt: daysAgo(41), actualPayout: 220_000, ...settled({}) },
    // 100 ngày: quý trước.
    { code: "S11", items: [B], createdAt: daysAgo(100), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: daysAgo(98),
      settledAt: daysAgo(95), actualPayout: 230_000, ...settled({}) },
    // 400 ngày: năm trước.
    { code: "S12", items: [A, L], createdAt: daysAgo(400), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: daysAgo(398),
      settledAt: daysAgo(395), actualPayout: 150_000, ...settled({}) },
    // Lazada: thêm một đơn giao chưa đối soát (Lazada chỉ tính đơn đã đối soát vào biên lãi).
    ...(lazada
      ? [{ code: "S13", items: [A2, B], createdAt: daysAgo(8), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: daysAgo(6),
          paymentStatus: "PAID" } satisfies SeedOrder]
      : []),
  ];
}

async function seedChannel(userId: string, channelName: ChannelName, prefix: string, productIdBySku: Map<string, string>) {
  const channel = await prisma.channel.create({
    data: {
      userId,
      channelName,
      shopName: `TEST-PARITY-${channelName}`,
      externalShopId: channelName === ChannelName.SHOPEE ? "900000001" : "900000002",
      refreshToken: "test-refresh-token",
      status: "ACTIVE",
    },
  });
  const orders = ordersFor(prefix, channelName === ChannelName.LAZADA);
  const skus = [...new Set(orders.flatMap((o) => o.items.map((i) => i.sku)))];
  await prisma.channelProduct.createMany({
    data: skus.map((sku, i) => ({
      channelId: channel.id,
      channelSku: sku,
      productName: `SP sàn ${sku}`,
      externalId: `${prefix}-${i + 1}`,
      productId: productIdBySku.get(sku) ?? null,
      imageUrl: `https://img.test/${sku}.jpg`,
    })),
  });
  for (const o of orders) {
    const total = o.items.reduce((s, i) => s + i.price * i.quantity, 0) - (o.sellerVoucher ?? 0);
    await prisma.order.create({
      data: {
        channelId: channel.id,
        orderCode: `TEST-PARITY-${prefix}-${o.code}`,
        customerName: "Khách mẫu",
        customerPhone: "0900000000",
        totalAmount: Math.max(0, total),
        itemCount: o.items.length,
        createdAt: o.createdAt,
        shippingStatus: o.shippingStatus,
        paymentStatus: o.paymentStatus ?? "PAID",
        deliveredAt: o.deliveredAt ?? null,
        isSettled: o.isSettled ?? false,
        settledAt: o.settledAt ?? null,
        platformFee: o.platformFee ?? 0,
        fixedFee: o.fixedFee ?? 0,
        serviceFee: o.serviceFee ?? 0,
        paymentFee: o.paymentFee ?? 0,
        sellerVoucher: o.sellerVoucher ?? 0,
        shippingFeeQuoted: o.shippingFeeQuoted ?? 0,
        shippingFeeActual: o.shippingFeeActual ?? 0,
        shippingFeeDiff: (o.shippingFeeActual ?? 0) - (o.shippingFeeQuoted ?? 0),
        actualPayout: o.actualPayout ?? 0,
        taxWithheld: o.taxWithheld ?? 0,
        refundedAmount: o.refundedAmount ?? 0,
        returnStatus: o.returnStatus ?? ReturnStatus.NONE,
        items: {
          create: o.items.map((it) => ({
            productId: productIdBySku.get(it.sku) ?? null,
            channelSku: it.sku,
            productName: `SP ${it.sku}`,
            quantity: it.quantity,
            price: it.price,
            costPriceAtSale: it.cost,
            imageUrl: `https://img.test/${it.sku}.jpg`,
            returnedQuantity: o.returnStatus === ReturnStatus.RECEIVED_INTACT && it.sku.endsWith("-B") ? 1 : 0,
            returnRestocked: o.returnStatus === ReturnStatus.RECEIVED_INTACT && it.sku.endsWith("-B"),
          })),
        },
      },
    });
  }
  // Chi phí ads cấp gian theo ngày (dòng tiền / tổng quan trừ ads).
  await prisma.adSpend.createMany({
    data: [1, 2, 3, 12, 25].map((n) => ({
      channelId: channel.id,
      date: new Date(daysAgo(n).toISOString().slice(0, 10)),
      amount: 15_000 + n * 1_000,
    })),
  });
  return channel.id;
}

/**
 * Dựng bộ đơn mẫu nếu DB chưa có gian Shopee/Lazada nào có đơn 30 ngày (hoặc chủ
 * shop mẫu đã có → không dựng lại). Trả về true nếu vừa dựng.
 */
export async function ensureParityDataset(): Promise<boolean> {
  const existing = await prisma.user.findUnique({ where: { email: PARITY_SEED_EMAIL }, select: { id: true } });
  if (existing) return false;
  const hasRecent = await prisma.order.findFirst({
    where: {
      createdAt: { gte: new Date(Date.now() - 30 * DAY) },
      channel: { channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] } },
    },
    select: { id: true },
  });
  if (hasRecent) return false;

  const user = await prisma.user.create({
    data: { email: PARITY_SEED_EMAIL, passwordHash: "x", fullName: "TEST parity seed", role: "ADMIN" },
  });
  // Sản phẩm kho của chủ shop (nối với SKU sàn qua ChannelProduct.productId).
  const productIdBySku = new Map<string, string>();
  for (const prefix of ["SP", "LZ"]) {
    for (const [name, cost] of [["A1", 50_000], ["A2", 25_000], ["B", 180_000], ["G", 5_000], ["L", 70_000]] as const) {
      const p = await prisma.product.create({
        data: {
          userId: user.id,
          skuCode: `TEST-PARITY-${prefix}-${name}`,
          productName: `SP mẫu ${prefix}-${name}`,
          costPrice: cost,
          quantityInStock: 100,
        },
      });
      productIdBySku.set(`${prefix}-${name}`, p.id);
    }
  }
  await seedChannel(user.id, ChannelName.SHOPEE, "SP", productIdBySku);
  await seedChannel(user.id, ChannelName.LAZADA, "LZ", productIdBySku);
  const fresh = await ensureLedgerFresh({ userId: user.id }, undefined, { maxInline: 5_000 });
  if (fresh.dirty !== 0) throw new Error(`parity-seed: sổ cái còn ${fresh.dirty} dòng bẩn sau khi dựng`);
  console.log(`[parity-seed] Đã dựng chủ shop mẫu ${PARITY_SEED_EMAIL} (Shopee + Lazada, 25 đơn) vì DB chưa có đơn 30 ngày`);
  return true;
}
