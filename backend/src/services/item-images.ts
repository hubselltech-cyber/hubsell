import { prisma } from "../lib/prisma";
import { lineDisplay, type LineCatalogHint } from "../lib/order-line-display";

/**
 * GẮN ẢNH + CHỮ HIỂN THỊ CHO DÒNG HÀNG CỦA ĐƠN.
 *
 * Nguồn ảnh theo thứ tự ưu tiên (chốt với anh Trung 13/08):
 *   1. ChannelProduct cùng gian — ảnh SÀN đổ về. Ưu tiên vì seller đổi ảnh listing
 *      liên tục; ảnh sàn luôn khớp cái khách thấy.
 *   2. Product kho gốc — fallback khi SKU sàn chưa từng được quét về.
 *
 * Trả về bản sao đơn với trường phẳng `imageUrl` trên TỪNG dòng hàng — client
 * chỉ cần đọc một chỗ, khỏi tự chọn nguồn. Trường `product` giữ nguyên để
 * web cũ không vỡ.
 *
 * 19/11/2026 — cùng câu truy vấn đó gắn luôn ba trường chữ theo MỘT luật của
 * lib/order-line-display.ts (khách không đặt SKU kêu màn quét in dãy id sàn, mất
 * tên phân loại): `baseName` (tên không đuôi phân loại), `variantName` (tên phân
 * loại, null = sản phẩm đơn / không tách được), `sellerSku` (mã người bán tự đặt,
 * null khi `channelSku` là mã máy). `productName` + `channelSku` giữ nguyên cho
 * client cũ và làm khóa gom. KHÔNG thêm câu truy vấn nào, không gọi sàn.
 *
 * Dòng danh mục tra theo ID LÁ SÀN trước (gian + externalId), mã sau — đúng thứ tự
 * của order-line-keys / order-line-names: product-sync có đổi khóa `channelSku` tại
 * chỗ (SPE-… → mã người bán) thì dòng đơn cũ mang khóa cũ vẫn tìm ra ảnh + tên.
 */

interface ItemWithProduct {
  productName?: string;
  channelSku: string | null;
  externalId?: string | null;
  variantName?: string | null;
  /** Ảnh lưu từ payload đơn của sàn (08/09) — có khi gian chưa đồng bộ danh mục. */
  imageUrl?: string | null;
  product: { imageUrl: string | null } | null;
}

export interface ItemDisplayFields {
  imageUrl: string | null;
  baseName: string;
  variantName: string | null;
  sellerSku: string | null;
}

interface CatalogRow extends LineCatalogHint {
  imageUrl: string | null;
}

export async function attachItemImages<
  I extends ItemWithProduct,
  O extends { channelId: string; items: I[] },
>(orders: O[]): Promise<(Omit<O, "items"> & { items: (Omit<I, keyof ItemDisplayFields> & ItemDisplayFields)[] })[]> {
  // Tra danh mục sàn cho MỌI dòng (kể cả dòng đã có ảnh kho — ảnh sàn thắng),
  // gộp MỘT lượt truy vấn cho cả trang.
  const channelIds = new Set<string>();
  const skus = new Set<string>();
  const exts = new Set<string>();
  for (const o of orders) {
    for (const it of o.items) {
      if (it.channelSku) skus.add(it.channelSku);
      if (it.externalId) exts.add(it.externalId);
      if (it.channelSku || it.externalId) channelIds.add(o.channelId);
    }
  }

  const bySku = new Map<string, CatalogRow>();
  const byExt = new Map<string, CatalogRow & { active: boolean }>();
  if (channelIds.size > 0) {
    // Lọc in×in là TẬP CHA của các cặp cần tìm — chấp nhận thừa vài dòng để
    // khỏi dựng OR hàng chục cặp; khoá ghép đảm bảo tra đúng gian.
    const rows = await prisma.channelProduct.findMany({
      where: {
        channelId: { in: [...channelIds] },
        OR: [
          ...(skus.size ? [{ channelSku: { in: [...skus] } }] : []),
          ...(exts.size ? [{ externalId: { in: [...exts] } }] : []),
        ],
      },
      select: {
        channelId: true,
        channelSku: true,
        externalId: true,
        status: true,
        productName: true,
        variantName: true,
        imageUrl: true,
      },
    });
    for (const r of rows) {
      const row: CatalogRow = { productName: r.productName, variantName: r.variantName, imageUrl: r.imageUrl };
      bySku.set(`${r.channelId}:${r.channelSku}`, row);
      if (!r.externalId) continue;
      // DB lỡ có 2 dòng cùng id sàn (đổi mã) → ưu tiên dòng đang bán (như order-line-keys).
      const key = `${r.channelId}:${r.externalId}`;
      const active = r.status === "ACTIVE";
      const cur = byExt.get(key);
      if (!cur || (!cur.active && active)) byExt.set(key, { ...row, active });
    }
  }

  return orders.map((o) => ({
    ...o,
    items: o.items.map((it) => {
      const cat =
        (it.externalId ? byExt.get(`${o.channelId}:${it.externalId}`) : undefined) ??
        (it.channelSku ? bySku.get(`${o.channelId}:${it.channelSku}`) : undefined) ??
        null;
      return {
        ...it,
        // Thứ tự: ảnh listing sàn (mới nhất) → ảnh chụp từ payload đơn → ảnh kho gốc
        imageUrl: cat?.imageUrl ?? it.imageUrl ?? it.product?.imageUrl ?? null,
        ...lineDisplay(
          {
            productName: it.productName ?? "",
            channelSku: it.channelSku,
            externalId: it.externalId,
            variantName: it.variantName,
          },
          cat
        ),
      };
    }),
  }));
}
