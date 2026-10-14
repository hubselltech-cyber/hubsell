// ============================================================
// ẢNH DÒNG HÀNG TỪ PAYLOAD ĐƠN — dùng chung Shopee / Lazada / TikTok (08/09).
//
// Vì sao: bảng Đơn hàng từng trống ảnh hàng loạt vì ảnh chỉ tra ChannelProduct
// (đồng bộ danh mục bằng TAY) hoặc kho tổng; gian chưa bấm đồng bộ danh mục là
// cả bảng hiện icon rỗng. Payload đơn của cả 3 sàn đều kèm ảnh từng dòng
// (Shopee item_list[].image_info.image_url, Lazada product_main_image, TikTok
// sku_image) → lưu thẳng vào OrderItem.imageUrl lúc tạo đơn, và điền bù cho
// đơn cũ mỗi lần đơn được quét lại (worker 10 phút / bấm Đồng bộ đơn).
// ============================================================

import type { Prisma } from "@prisma/client";

/**
 * Điền bù ảnh dòng hàng cho đơn ĐÃ CÓ (đồng bộ trước 08/09 chưa lưu ảnh, hoặc
 * sàn bổ sung ảnh sau) — chỉ ghi vào chỗ còn trống, không đụng snapshot khác.
 * Dùng chung 3 sàn qua tham số lines.
 */
export async function backfillOrderItemImagesTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  lines: { channelSku: string; imageUrl: string | null }[]
): Promise<void> {
  const missing = await tx.orderItem.count({ where: { orderId, imageUrl: null } });
  if (missing === 0) return;
  for (const line of lines) {
    if (!line.imageUrl) continue;
    // Dòng đơn mới ghi khóa dòng sàn có đuôi phân loại ("LT075-HONG (Hồng, 3-5kg)")
    // khi mã trùng (15/10/2026) → so cả khóa đúng lẫn khóa bắt đầu bằng mã thô.
    await tx.orderItem.updateMany({
      where: {
        orderId,
        imageUrl: null,
        OR: [{ channelSku: line.channelSku }, { channelSku: { startsWith: `${line.channelSku} (` } }],
      },
      data: { imageUrl: line.imageUrl },
    });
  }
}

