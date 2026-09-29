// ============================================================
// ĐỒNG BỘ SẢN PHẨM — TẦNG KHO NỘI BỘ (trung lập sàn).
//
// Nhận sản phẩm ĐÃ CHUẨN HOÁ từ adapter rồi upsert vào bảng đệm ChannelProduct.
// Tầng này KHÔNG biết gì về Shopee/TikTok — chỉ làm việc với dữ liệu chuẩn.
//
// Nguyên tắc bất di bất dịch (giữ từ luồng cũ):
//   - TUYỆT ĐỐI không đụng `productId` (liên kết do người dùng cấu hình).
//   - TUYỆT ĐỐI không GHI ĐÈ giá vốn chủ shop đã nhập. Ngoại lệ duy nhất: SKU
//     VỪA TẠO MỚI, còn trống giá, được tự điền theo bảng giá tự nhập / SKU trùng
//     mã ở gian khác của chính chủ shop (lib/cost-mapping.ts, 17/09).
//   - SKU không còn thấy trên sàn → đánh DELISTED (giữ lịch sử, không xoá).
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelProductStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { autoFillCostForNewSkus } from "../lib/cost-mapping";
import { getProductAdapter } from "./registry";

export interface ProductSyncResult {
  scanned: number; // số SP sàn adapter trả về
  created: number; // số ChannelProduct tạo mới
  updated: number; // số ChannelProduct cập nhật
  delisted: number; // số SKU cũ không còn → đánh DELISTED
  costAutoFilled: number; // số SKU mới được tự điền giá vốn theo mã
  /** false = adapter chạm chốt chặn phân trang, danh mục CHƯA đủ — đã BỎ QUA bước đánh DELISTED. */
  complete: boolean;
}

/**
 * Đồng bộ sản phẩm của MỘT gian: lấy adapter phù hợp → kéo (đã chuẩn hoá) →
 * upsert bảng đệm. Idempotent theo (channelId, channelSku).
 */
export async function syncChannelProducts(channel: Channel): Promise<ProductSyncResult> {
  const adapter = getProductAdapter(channel);
  const { products, complete } = await adapter.fetchProducts(channel);
  const now = new Date();

  let created = 0;
  let updated = 0;
  const createdIds: string[] = [];

  for (const p of products) {
    const data = {
      productName: p.productName,
      price: p.price,
      externalId: p.externalId,
      // Ảnh/phân loại: adapter không đọc được (TikTok products/search không trả
      // ảnh, chỉ chi tiết từng SP mới có) → giữ giá trị cũ thay vì xóa trắng.
      ...(p.imageUrl !== null ? { imageUrl: p.imageUrl } : {}),
      ...(p.variantName !== null ? { variantName: p.variantName } : {}),
      itemSku: p.itemSku,
      // Tồn sàn chỉ ghi đè khi adapter ĐỌC ĐƯỢC số — null giữ nguyên giá trị cũ
      // (sàn không trả số không có nghĩa là hết hàng).
      ...(p.channelStock !== null ? { channelStock: p.channelStock } : {}),
      channelStockLocationId: p.channelStockLocationId,
      status:
        p.status === "ACTIVE"
          ? ChannelProductStatus.ACTIVE
          : ChannelProductStatus.DELISTED,
      lastSyncedAt: now,
    };

    const existing = await prisma.channelProduct.findUnique({
      where: { channelId_channelSku: { channelId: channel.id, channelSku: p.channelSku } },
      select: { id: true },
    });

    if (existing) {
      // KHÔNG đụng productId — liên kết là của người dùng.
      await prisma.channelProduct.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      const row = await prisma.channelProduct.create({
        data: { channelId: channel.id, channelSku: p.channelSku, ...data },
        select: { id: true },
      });
      createdIds.push(row.id);
      created++;
    }
  }

  // SKU cũ không còn trong danh mục sàn → đánh DELISTED (không xoá để giữ liên kết).
  // CHỈ làm khi lượt kéo ĐẦY ĐỦ: danh mục bị cắt ở chốt chặn phân trang thì SKU
  // vắng mặt chưa chắc đã gỡ — đánh DELISTED nhầm là gian đó ngừng được đẩy tồn
  // (enqueueStockPush chỉ nhặt ACTIVE) → bán vượt tồn (rà soát 29/09/2026).
  let delisted = 0;
  if (complete) {
    delisted = await delistUnseen(channel.id, new Set(products.map((p) => p.channelSku)));
  } else {
    console.warn(
      `[product-sync] gian ${channel.shopName} (${channel.id}): danh mục CHƯA đủ (chạm chốt chặn phân trang, đọc được ${products.length} SKU) — bỏ qua bước đánh DELISTED`
    );
  }

  // Tự điền giá vốn là tiện ích — hỏng thì danh mục vẫn phải đồng bộ xong.
  let costAutoFilled = 0;
  try {
    costAutoFilled = await autoFillCostForNewSkus(channel.userId, createdIds);
  } catch (err) {
    console.error(`[product-sync] tự điền giá vốn lỗi (gian ${channel.id}):`, err);
  }

  // Sàn chỉ bổ sung được ảnh cho một phần danh mục mỗi lượt (TikTok) → chạy nền
  // nốt phần còn thiếu, KHÔNG bắt chủ shop chờ. Hàm tự nuốt lỗi.
  void adapter.enrichMissing?.(channel);

  return {
    scanned: products.length,
    created,
    updated,
    delisted,
    costAutoFilled,
    complete,
  };
}

/** Lô id mỗi lệnh UPDATE — dưới xa trần 32.767 tham số của Postgres. */
const DELIST_BATCH = 1000;

/**
 * Đánh DELISTED các SKU đang ACTIVE của gian mà KHÔNG có trong `seen`. So khớp
 * trong bộ nhớ rồi cập nhật theo lô id: `channelSku notIn [hàng chục nghìn mã]`
 * vượt trần tham số của Postgres ở gian danh mục lớn.
 */
async function delistUnseen(channelId: string, seen: Set<string>): Promise<number> {
  const active = await prisma.channelProduct.findMany({
    where: { channelId, status: ChannelProductStatus.ACTIVE },
    select: { id: true, channelSku: true },
  });
  const goneIds = active.filter((r) => !seen.has(r.channelSku)).map((r) => r.id);
  let count = 0;
  for (let i = 0; i < goneIds.length; i += DELIST_BATCH) {
    const r = await prisma.channelProduct.updateMany({
      where: {
        id: { in: goneIds.slice(i, i + DELIST_BATCH) },
        status: ChannelProductStatus.ACTIVE,
      },
      data: { status: ChannelProductStatus.DELISTED },
    });
    count += r.count;
  }
  return count;
}
