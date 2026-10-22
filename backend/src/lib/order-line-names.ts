// ============================================================
// TÊN PHÂN LOẠI CHO DÒNG ĐƠN (khách vài nghìn SKU, 22/10/2026)
//
// OrderItem chỉ lưu mã (channelSku) + tên sản phẩm lúc bán, KHÔNG có tên phân
// loại — bảng Lãi/Lỗ thực hiện và Kiểm toán phí in ra "SPE-466…-395…" khiến
// khách phải mở lại đơn trên sàn mới biết là hàng gì. Tên phân loại nằm ở danh
// mục gian (ChannelProduct.variantName) và sản phẩm kho đã nối (Product.variantName).
//
// Khớp theo DANH TÍNH SÀN trước (gian + externalId "item-model" — bất biến B3
// docs/MO-HINH-CAY-SAN-PHAM-SAN.md), đơn cũ không có id thì theo (gian + mã),
// cuối cùng là sản phẩm kho đã nối. Hai câu findMany cho CẢ TRANG đơn — không
// hỏi từng dòng.
// ============================================================

import { prisma } from "./prisma";

export interface OrderLineRef {
  channelId: string;
  externalId: string | null;
  channelSku: string;
  /** Product.variantName của sản phẩm kho đã nối (nếu nơi gọi đã include). */
  productVariantName?: string | null;
}

const extKey = (channelId: string, externalId: string) => `${channelId}\u0000${externalId}`;
const skuKey = (channelId: string, sku: string) =>
  `${channelId}\u0000${sku.normalize("NFC").trim().toUpperCase()}`;

/**
 * Tra tên phân loại cho một loạt dòng đơn. Trả về hàm tra cho từng dòng:
 * chuỗi rỗng khi không biết (giao diện in mã như cũ).
 */
export async function loadVariantNames(
  lines: OrderLineRef[]
): Promise<(line: OrderLineRef) => string> {
  const byExt = new Map<string, string>();
  const bySku = new Map<string, string>();
  if (lines.length > 0) {
    const channelIds = [...new Set(lines.map((l) => l.channelId))];
    const externalIds = [...new Set(lines.map((l) => l.externalId).filter((x): x is string => !!x))];
    const skus = [...new Set(lines.map((l) => l.channelSku).filter(Boolean))];
    const [viaExt, viaSku] = await Promise.all([
      externalIds.length
        ? prisma.channelProduct.findMany({
            where: { channelId: { in: channelIds }, externalId: { in: externalIds } },
            select: { channelId: true, externalId: true, variantName: true },
          })
        : [],
      skus.length
        ? prisma.channelProduct.findMany({
            // Mã so không phân biệt hoa/thường ở tầng ứng dụng — lấy cả tập rồi khớp
            where: { channelId: { in: channelIds }, channelSku: { in: skus, mode: "insensitive" } },
            select: { channelId: true, channelSku: true, variantName: true },
          })
        : [],
    ]);
    for (const cp of viaExt) {
      if (cp.externalId && cp.variantName) byExt.set(extKey(cp.channelId, cp.externalId), cp.variantName);
    }
    for (const cp of viaSku) {
      if (cp.variantName) bySku.set(skuKey(cp.channelId, cp.channelSku), cp.variantName);
    }
  }
  return (line) =>
    (line.externalId ? byExt.get(extKey(line.channelId, line.externalId)) : undefined) ??
    bySku.get(skuKey(line.channelId, line.channelSku)) ??
    line.productVariantName?.trim() ??
    "";
}
