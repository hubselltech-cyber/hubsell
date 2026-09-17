// ============================================================
// GHI GIÁ VỐN — hai đường ghi duy nhất của hệ thống (tách khỏi routes/finance.ts
// 17/09/2026 để tab "Mapping giá vốn" và hook tự điền khi đồng bộ dùng chung).
//
//   - SKU ĐÃ nối kho  → Product.costPrice        (applyCostPrice)
//   - SKU CHƯA nối kho → ChannelProduct.costPrice (applyChannelCostPrice)
//
// Cả hai đều VÁ LẠI các dòng hàng đã bán mà lúc bán chưa biết giá vốn.
// ============================================================

import { prisma } from "./prisma";

/**
 * Đặt giá vốn cho các sản phẩm gốc, ĐỒNG THỜI vá lại các dòng hàng đã bán mà
 * lúc bán chưa biết giá vốn.
 *
 * OrderItem.costPriceAtSale là ảnh chụp giá vốn tại thời điểm bán — cố ý đóng
 * băng để giá nhập đổi về sau không làm sai lệch báo cáo cũ. Nhưng giá trị 0
 * KHÔNG phải một ảnh chụp hợp lệ, nó nghĩa là "lúc đó chưa ai nhập giá vốn".
 * Để nguyên thì mã đó mãi mãi bị đánh dấu "chưa nhập giá vốn" trong P&L dù chủ
 * shop vừa nhập xong, và lãi/lỗ của nó vẫn sai.
 *
 * Nên chỉ vá đúng những dòng đang là 0. Dòng đã có số thật thì tuyệt đối không
 * đụng vào — đó mới là lịch sử cần giữ.
 */
export async function applyCostPrice(
  productIds: string[],
  cost: number,
  ownerId: string
): Promise<{ products: number; backfilledOrderLines: number }> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.updateMany({
      where: { id: { in: productIds }, userId: ownerId },
      data: { costPrice: cost },
    });

    const backfilled = await tx.orderItem.updateMany({
      where: {
        productId: { in: productIds },
        costPriceAtSale: 0,
        order: { channel: { userId: ownerId } },
      },
      data: { costPriceAtSale: cost },
    });

    return { products: updated.count, backfilledOrderLines: backfilled.count };
  });
}

/**
 * Đặt giá vốn cho các SKU SÀN CHƯA LIÊN KẾT KHO, đồng thời vá lại dòng hàng đã
 * bán của đúng (gian, mã SKU) đó mà lúc bán chưa có giá vốn (snapshot = 0).
 *
 * Song song với applyCostPrice của sản phẩm gốc: cùng nguyên tắc "0 không phải
 * ảnh chụp hợp lệ" — chỉ vá dòng đang 0, dòng có số thật là lịch sử, không đụng.
 */
export async function applyChannelCostPrice(
  channelProductIds: string[],
  cost: number,
  ownerId: string
): Promise<{
  updated: number;
  backfilledOrderLines: number;
  sample: { productName: string } | null;
}> {
  const cps = await prisma.channelProduct.findMany({
    where: {
      id: { in: channelProductIds },
      productId: null,
      channel: { userId: ownerId },
    },
    select: { id: true, channelId: true, channelSku: true, productName: true },
  });
  if (cps.length === 0) return { updated: 0, backfilledOrderLines: 0, sample: null };

  // (channelId, channelSku) là unique nên vá đơn gom được theo GIAN: một lệnh
  // cho mỗi gian thay vì một lệnh cho mỗi SKU — mapping vài trăm mã cùng giá
  // không còn là vài trăm truy vấn tuần tự trong một transaction.
  const skusByChannel = new Map<string, string[]>();
  for (const cp of cps) {
    const list = skusByChannel.get(cp.channelId) ?? [];
    list.push(cp.channelSku);
    skusByChannel.set(cp.channelId, list);
  }

  return prisma.$transaction(async (tx) => {
    await tx.channelProduct.updateMany({
      where: { id: { in: cps.map((c) => c.id) } },
      data: { costPrice: cost },
    });

    let backfilled = 0;
    for (const [channelId, skus] of skusByChannel) {
      const r = await tx.orderItem.updateMany({
        where: {
          channelSku: { in: skus },
          costPriceAtSale: 0,
          productId: null, // dòng đã nối kho thì giá vốn theo sản phẩm gốc
          order: { channelId },
        },
        data: { costPriceAtSale: cost },
      });
      backfilled += r.count;
    }

    return {
      updated: cps.length,
      backfilledOrderLines: backfilled,
      sample: { productName: cps[0].productName },
    };
  });
}
