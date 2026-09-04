// ============================================================
// ENGINE TỒN KHẢ DỤNG + ENQUEUE ĐẨY TỒN ĐA SÀN
//
// Mọi biến động kho (đơn sàn, nhập/xuất tay, nhập hàng hoàn, sửa tồn, import)
// đều đi qua MỘT cửa: enqueueStockPush(productIds) — ghi job vào hàng đợi bền
// stock_push_jobs rồi trả về NGAY (1 upsert/SKU-gian, không gọi API sàn, không
// làm chậm request). Worker stock-push-worker.ts nhặt job và đẩy thật.
//
// Công thức tồn khả dụng ("CÓ THỂ BÁN" — số ĐẨY LÊN SÀN):
//   available = max(0, quantityInStock − holdQuantity − safetyStock)
//   safetyStock = Product.safetyStock (per-SKU) ?? ShopSyncSetting.safetyStockDefault
//
// MÔ HÌNH (chốt 05/09 theo Sapo): Hubsell là TRUNG TÂM điều tiết — một SKU kho
// có thể niêm yết trên nhiều gian, nhiều sàn; mọi gian luôn hiện CÙNG một số
// "có thể bán". Gian A bán 1 → kho trừ 1 → A, B, C, D… đều nhận số mới.
//
// Cờ BẬT/TẮT theo TỪNG GIAN (Channel.stockSyncEnabled, mặc định TẮT) gác ngay
// ở cửa enqueue: gian tắt thì biến động tự động không sinh job cho gian đó —
// chỉ thao tác chủ động của người dùng (force = true: nút [Sync ngay toàn bộ],
// bật gian lần đầu, force-sync theo cảnh báo) mới đi qua. Gian chưa qua màn
// so sánh/bật sẽ không bao giờ bị ghi đè tồn.
// ============================================================

import { ChannelName, StockPushStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

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

/**
 * Tồn an toàn mặc định của một chủ shop (0 khi chưa cấu hình). Gom một chỗ để
 * mọi nơi tính "có thể bán" (route danh sách, worker, đối soát) dùng cùng số.
 */
export async function getSafetyStockDefault(ownerId: string): Promise<number> {
  const s = await prisma.shopSyncSetting.findUnique({
    where: { userId: ownerId },
    select: { safetyStockDefault: true },
  });
  return s?.safetyStockDefault ?? 0;
}

export interface EnqueueOptions {
  /** Nguồn biến động để ghi vào nhật ký sync (vd "webhook Shopee đơn X"). */
  source?: string;
  /** true = người dùng chủ động sync — bỏ qua cờ stockSyncEnabled của gian. */
  force?: boolean;
  /** Chỉ xếp job cho các gian này (vd bật đồng bộ MỘT gian) — bỏ trống = mọi gian. */
  channelIds?: string[];
  /**
   * Snapshot tồn khả dụng TRƯỚC biến động (chụp trong transaction, theo công
   * thức cũ quantityInStock − holdQuantity) — chỉ phục vụ cột "số cũ" của
   * nhật ký sync; số đẩy lên sàn luôn được worker đọc lại mới nhất lúc đẩy.
   */
  oldAvailable?: Record<string, number>;
}

// Worker đăng ký hàm "đánh thức" để nhặt job NGAY sau khi enqueue thay vì chờ
// nhịp poll — rút ngắn cửa sổ bán vượt giữa các gian xuống vài trăm ms.
// Đăng ký qua callback (không import worker) để tránh import vòng.
let kickWorker: (() => void) | null = null;
export function registerStockPushKick(fn: () => void): void {
  kickWorker = fn;
}

/**
 * Ghi job đẩy tồn cho MỌI SKU sàn đã liên kết các sản phẩm này (mọi gian
 * Shopee/Lazada ACTIVE đang BẬT đồng bộ, hoặc mọi gian nếu force). Upsert theo
 * khóa (channelId, channelSku) → nhiều biến động liên tiếp của cùng SKU GỘP
 * còn một job (chống bão rate-limit).
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
        // SKU đã gỡ niêm yết trên sàn không nhận tồn — đẩy chỉ sinh lỗi + cảnh báo rác.
        status: "ACTIVE",
        ...(opts.channelIds?.length ? { channelId: { in: opts.channelIds } } : {}),
        channel: {
          channelName: { in: PUSHABLE_CHANNELS },
          status: "ACTIVE",
          refreshToken: { not: null },
          // Cờ theo gian gác ngay tại cửa — gian tắt không sinh job tự động.
          ...(opts.force ? {} : { stockSyncEnabled: true }),
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

    // Tồn an toàn mặc định theo CHỦ SHOP của từng gian (cột "số cũ" của log).
    const ownerIds = [...new Set(mappings.map((m) => m.channel.userId))];
    const settings = await prisma.shopSyncSetting.findMany({
      where: { userId: { in: ownerIds } },
      select: { userId: true, safetyStockDefault: true },
    });
    const safetyByOwner = new Map(settings.map((s) => [s.userId, s.safetyStockDefault]));

    for (const mp of mappings) {
      const snapshot = opts.oldAvailable?.[mp.productId!];
      const oldAvailable =
        snapshot ??
        (mp.product
          ? availableToPush(mp.product, safetyByOwner.get(mp.channel.userId) ?? 0)
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

    if (result.queued > 0 && kickWorker) kickWorker();
  } catch (err) {
    console.error("[Stock-push] Không enqueue được job đẩy tồn:", err);
  }
  return result;
}

/**
 * [Sync ngay toàn bộ] — ghi job cho MỌI SKU sàn đã liên kết của một chủ shop
 * (mọi gian Shopee/Lazada ACTIVE). Mặc định FORCE (bỏ qua cờ gian); truyền
 * force: false để chỉ đẩy tới các gian đang BẬT (vd đổi tồn an toàn mặc định).
 * Trả số job đã xếp hàng để UI hiển thị tiến độ.
 */
export async function enqueueStockPushForOwner(
  ownerId: string,
  source: string,
  opts: { force?: boolean } = {}
): Promise<{ queued: number }> {
  const rows = await prisma.channelProduct.findMany({
    where: {
      productId: { not: null },
      externalId: { not: null },
      status: "ACTIVE",
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
    { source, force: opts.force ?? true }
  );
}

/**
 * Đẩy (FORCE) toàn bộ SKU đã liên kết của MỘT gian — dùng ngay khi chủ shop
 * bật đồng bộ cho gian đó sau màn so sánh, để tồn sàn về khớp Hubsell một lượt.
 */
export async function enqueueStockPushForChannel(
  channelId: string,
  source: string
): Promise<{ queued: number }> {
  const rows = await prisma.channelProduct.findMany({
    where: {
      channelId,
      productId: { not: null },
      externalId: { not: null },
      status: "ACTIVE",
    },
    select: { productId: true },
    distinct: ["productId"],
  });
  return enqueueStockPush(
    rows.map((r) => r.productId!),
    { source, force: true, channelIds: [channelId] }
  );
}

/** Số job còn nằm trong hàng đợi của một chủ shop — UI poll để vẽ tiến độ. */
export async function countPendingJobs(ownerId: string): Promise<number> {
  return prisma.stockPushJob.count({
    where: { channel: { userId: ownerId } },
  });
}
