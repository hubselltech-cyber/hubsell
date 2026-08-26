import { prisma } from "../lib/prisma";

/**
 * GẮN ẢNH CHO DÒNG HÀNG CỦA ĐƠN.
 *
 * Nguồn ảnh theo thứ tự ưu tiên (chốt với anh Trung 13/08):
 *   1. ChannelProduct cùng (channelId, channelSku) — ảnh SÀN đổ về. Ưu tiên
 *      vì seller đổi ảnh listing liên tục; ảnh sàn luôn khớp cái khách thấy.
 *   2. Product kho gốc — fallback khi SKU sàn chưa từng được quét về.
 *
 * Trả về bản sao đơn với trường phẳng `imageUrl` trên TỪNG dòng hàng — client
 * chỉ cần đọc một chỗ, khỏi tự chọn nguồn. Trường `product` giữ nguyên để
 * web cũ không vỡ.
 */

interface ItemWithProduct {
  channelSku: string | null;
  product: { imageUrl: string | null } | null;
}

export async function attachItemImages<
  I extends ItemWithProduct,
  O extends { channelId: string; items: I[] },
>(orders: O[]): Promise<(Omit<O, "items"> & { items: (I & { imageUrl: string | null })[] })[]> {
  // Tra ảnh sàn cho MỌI dòng có channelSku (kể cả dòng đã có ảnh kho —
  // ảnh sàn thắng), gộp MỘT lượt truy vấn cho cả trang
  const channelIds = new Set<string>();
  const skus = new Set<string>();
  for (const o of orders) {
    for (const it of o.items) {
      if (it.channelSku) {
        channelIds.add(o.channelId);
        skus.add(it.channelSku);
      }
    }
  }

  const map = new Map<string, string>();
  if (skus.size > 0) {
    // Lọc in×in là TẬP CHA của các cặp cần tìm — chấp nhận thừa vài dòng để
    // khỏi dựng OR hàng chục cặp; khoá ghép đảm bảo tra đúng gian.
    const rows = await prisma.channelProduct.findMany({
      where: {
        channelId: { in: [...channelIds] },
        channelSku: { in: [...skus] },
        imageUrl: { not: null },
      },
      select: { channelId: true, channelSku: true, imageUrl: true },
    });
    for (const r of rows) {
      if (r.imageUrl) map.set(`${r.channelId}:${r.channelSku}`, r.imageUrl);
    }
  }

  return orders.map((o) => ({
    ...o,
    items: o.items.map((it) => ({
      ...it,
      imageUrl:
        (it.channelSku ? map.get(`${o.channelId}:${it.channelSku}`) : undefined) ??
        it.product?.imageUrl ??
        null,
    })),
  }));
}
