// ============================================================
// ENGINE TỒN KHẢ DỤNG + ENQUEUE ĐẨY TỒN ĐA SÀN
//
// Mọi biến động kho (đơn sàn, nhập/xuất tay, nhập hàng hoàn, sửa tồn, import)
// đều đi qua MỘT cửa: enqueueStockPush(productIds) — ghi job vào hàng đợi bền
// stock_push_jobs rồi trả về NGAY (1 upsert/SKU-gian, không gọi API sàn, không
// làm chậm request). Worker stock-push-worker.ts nhặt job và đẩy thật.
//
// Công thức tồn khả dụng (số ĐẨY LÊN SÀN):
//   available = max(0, quantityInStock − holdQuantity − safetyStock)
//   safetyStock = Product.safetyStock (per-SKU) ?? ShopSyncSetting.safetyStockDefault
//
// Switch autoSyncEnabled (per chủ shop, mặc định TẮT) gác ở NGAY cửa enqueue:
// tắt thì biến động tự động không sinh job nào — chỉ thao tác chủ động của
// người dùng (force = true: nút [Sync ngay toàn bộ], force-sync theo cảnh báo)
// mới đi qua. Shop chưa nhập đúng tồn kho vật lý sẽ không bị ghi đè tồn sàn.
// ============================================================

import { ChannelName, StockPushStatus } from "@prisma/client";
import { prisma } from "../prisma";

/** Các sàn đã có chiều ĐẨY tồn. TikTok chưa có product-sync (ChannelProduct
 *  không có externalId) nên chưa đẩy được — bổ sung khi làm product pull TikTok. */
export const PUSHABLE_CHANNELS: ChannelName[] = [
  ChannelName.SHOPEE,
  ChannelName.LAZADA,
];

export interface StockFields {
  quantityInStock: number;
  holdQuantity: number;
  safetyStock: number | null;
}

/** Tồn khả dụng đẩy lên sàn — âm nghĩa là đã bán vượt, đẩy 0 để chặn bán thêm. */
export function availableToPush(p: StockFields, safetyStockDefault: number): number {
  const safety = p.safetyStock ?? safetyStockDefault;
  return Math.max(0, p.quantityInStock - p.holdQuantity - safety);
}

export interface EnqueueOptions {
  /** Nguồn biến động để ghi vào nhật ký sync (vd "webhook Shopee đơn X"). */
  source?: string;
  /** true = người dùng chủ động sync — bỏ qua switch autoSyncEnabled. */
  force?: boolean;
  /**
   * Snapshot tồn khả dụng TRƯỚC biến động (chụp trong transaction, theo công
   * thức cũ quantityInStock − holdQuantity) — chỉ phục vụ cột "số cũ" của
   * nhật ký sync; số đẩy lên sàn luôn được worker đọc lại mới nhất lúc đẩy.
   */
  oldAvailable?: Record<string, number>;
}

/**
 * Ghi job đẩy tồn cho MỌI SKU sàn đã liên kết các sản phẩm này (mọi gian
 * Shopee/Lazada ACTIVE). Upsert theo khóa (channelId, channelSku) → nhiều biến
 * động liên tiếp của cùng SKU GỘP còn một job (chống bão rate-limit).
 *
 * Best-effort: KHÔNG BAO GIỜ ném — biến động kho đã ghi DB xong, việc đẩy sàn
 * có hàng đợi/retry/cảnh báo riêng; ném lên sẽ làm hỏng transaction gốc.
 */
export async function enqueueStockPush(
  productIds: string[],
  opts: EnqueueOptions = {}
): Promise<{ queued: number }> {
  const result = { queued: 0 };
  try {
    const ids = [...new Set(productIds)].filter(Boolean);
    if (ids.length === 0) return result;

    const mappings = await prisma.channelProduct.findMany({
      where: {
        productId: { in: ids },
        externalId: { not: null },
        channel: {
          channelName: { in: PUSHABLE_CHANNELS },
          status: "ACTIVE",
          refreshToken: { not: null },
        },
      },
      select: {
        channelId: true,
        channelSku: true,
        productId: true,
        channel: { select: { userId: true } },
        product: {
          select: { quantityInStock: true, holdQuantity: true, safetyStock: true },
        },
      },
    });
    if (mappings.length === 0) return result;

    // Switch + tồn an toàn mặc định theo CHỦ SHOP của từng gian.
    const ownerIds = [...new Set(mappings.map((m) => m.channel.userId))];
    const settings = await prisma.shopSyncSetting.findMany({
      where: { userId: { in: ownerIds } },
    });
    const settingByOwner = new Map(settings.map((s) => [s.userId, s]));

    for (const mp of mappings) {
      const setting = settingByOwner.get(mp.channel.userId);
      if (!opts.force && !setting?.autoSyncEnabled) continue;

      const snapshot = opts.oldAvailable?.[mp.productId!];
      const oldAvailable =
        snapshot ??
        (mp.product
          ? availableToPush(mp.product, setting?.safetyStockDefault ?? 0)
          : null);

      const data = {
        productId: mp.productId!,
        status: StockPushStatus.PENDING,
        attempts: 0,
        nextRetryAt: new Date(),
        lastError: null,
        source: opts.source ?? null,
        forced: opts.force ?? false,
      };
      await prisma.stockPushJob.upsert({
        where: {
          channelId_channelSku: {
            channelId: mp.channelId,
            channelSku: mp.channelSku,
          },
        },
        // Job đang chờ thì GIỮ oldAvailable cũ — "số cũ" phải là tồn trước
        // biến động ĐẦU TIÊN của chuỗi được gộp, không phải biến động cuối.
        update: data,
        create: {
          channelId: mp.channelId,
          channelSku: mp.channelSku,
          oldAvailable,
          ...data,
        },
      });
      result.queued++;
    }
  } catch (err) {
    console.error("[Stock-push] Không enqueue được job đẩy tồn:", err);
  }
  return result;
}

/**
 * [Sync ngay toàn bộ] — ghi job FORCE cho MỌI SKU sàn đã liên kết của một chủ
 * shop (mọi gian Shopee/Lazada ACTIVE), bất kể switch autoSync. Trả số job đã
 * xếp hàng để UI hiển thị tiến độ.
 */
export async function enqueueStockPushForOwner(
  ownerId: string,
  source: string
): Promise<{ queued: number }> {
  const rows = await prisma.channelProduct.findMany({
    where: {
      productId: { not: null },
      externalId: { not: null },
      channel: {
        userId: ownerId,
        channelName: { in: PUSHABLE_CHANNELS },
        status: "ACTIVE",
        refreshToken: { not: null },
      },
    },
    select: { productId: true },
    distinct: ["productId"],
  });
  return enqueueStockPush(
    rows.map((r) => r.productId!),
    { source, force: true }
  );
}

/** Số job còn nằm trong hàng đợi của một chủ shop — UI poll để vẽ tiến độ. */
export async function countPendingJobs(ownerId: string): Promise<number> {
  return prisma.stockPushJob.count({
    where: { channel: { userId: ownerId } },
  });
}
