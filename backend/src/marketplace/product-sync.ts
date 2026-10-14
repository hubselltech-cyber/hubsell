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
//
// Từ 15/10/2026 (sự cố Hi.Bé — xem marketplace/sku-key.ts):
//   - DANH TÍNH dòng = `externalId` (id phân loại lá phía sàn). Khóa `channelSku`
//     là khóa hiển thị, duy nhất trong gian; mã trùng được thêm đuôi tên phân loại.
//   - Dòng cũ có cùng externalId mà khóa khác (đổi tên phân loại, hoặc dòng gộp
//     cũ "LT075-HONG" nay thành "LT075-HONG (Hồng, 3-5kg)") → ĐỔI KHÓA tại chỗ,
//     giữ nguyên liên kết kho + giá vốn thay vì tạo dòng mới + gỡ dòng cũ.
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelProductStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { autoFillCostForNewSkus } from "../lib/cost-mapping";
import { getProductAdapter } from "./registry";
import { resolveChannelSkuKeys } from "./sku-key";
import type { NormalizedChannelProduct } from "./types";

export interface ProductSyncResult {
  scanned: number; // số SP sàn adapter trả về
  created: number; // số ChannelProduct tạo mới
  updated: number; // số ChannelProduct cập nhật
  delisted: number; // số SKU cũ không còn → đánh DELISTED
  costAutoFilled: number; // số SKU mới được tự điền giá vốn theo mã
  /** Số dòng đổi khóa hiển thị theo externalId (đuôi phân loại / đổi tên). */
  renamed: number;
  /** false = adapter chạm chốt chặn phân trang, danh mục CHƯA đủ — đã BỎ QUA bước đánh DELISTED. */
  complete: boolean;
}

interface ExistingRow {
  id: string;
  channelSku: string;
  externalId: string | null;
  variantName: string | null;
  status: ChannelProductStatus;
}

/**
 * Chọn dòng cũ đại diện cho một externalId khi DB lỡ có nhiều dòng cùng id sàn
 * (người bán từng đổi model_sku: dòng cũ DELISTED + dòng mới cùng model). Ưu
 * tiên dòng đang mang đúng khóa mới, rồi dòng ACTIVE, rồi dòng đầu.
 */
export function pickRowForExternalId(rows: ExistingRow[], key: string): ExistingRow {
  return rows.find((r) => r.channelSku === key) ?? rows.find((r) => r.status === "ACTIVE") ?? rows[0];
}

/**
 * Đồng bộ sản phẩm của MỘT gian: lấy adapter phù hợp → kéo (đã chuẩn hoá) →
 * gán khóa duy nhất → upsert bảng đệm theo externalId (rồi mới tới khóa).
 */
export async function syncChannelProducts(channel: Channel): Promise<ProductSyncResult> {
  const adapter = getProductAdapter(channel);
  const { products: raw, complete } = await adapter.fetchProducts(channel);
  const now = new Date();

  // Toàn bộ dòng của gian (đã cần sẵn cho bước DELISTED) → tra theo externalId
  // và theo khóa trong RAM, không thêm truy vấn theo từng sản phẩm.
  const existing: ExistingRow[] = await prisma.channelProduct.findMany({
    where: { channelId: channel.id },
    select: { id: true, channelSku: true, externalId: true, variantName: true, status: true },
  });
  const byKey = new Map<string, ExistingRow>();
  const byExt = new Map<string, ExistingRow[]>();
  for (const r of existing) {
    byKey.set(r.channelSku, r);
    if (r.externalId) {
      const l = byExt.get(r.externalId) ?? [];
      l.push(r);
      byExt.set(r.externalId, l);
    }
  }

  // Khóa duy nhất: mã trùng → đuôi tên phân loại. Adapter không đọc được tên
  // (TikTok lượt không bổ sung chi tiết) thì mượn tên đã lưu của đúng dòng đó.
  const { products, suffixed } = resolveChannelSkuKeys(raw, (p: NormalizedChannelProduct) => {
    if (p.variantName) return p.variantName;
    const rows = p.externalId ? byExt.get(p.externalId) : undefined;
    return rows?.find((r) => r.variantName)?.variantName ?? null;
  });

  let created = 0;
  let updated = 0;
  let renamed = 0;
  let renameSkipped = 0;
  const createdIds: string[] = [];
  const seenIds = new Set<string>();

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

    // 1) Theo externalId (danh tính thật). 2) Theo khóa (dòng cũ chưa có externalId).
    const extRows = p.externalId ? byExt.get(p.externalId) : undefined;
    let row = extRows?.length ? pickRowForExternalId(extRows, p.channelSku) : undefined;
    let newKey: string | undefined;
    if (row && row.channelSku !== p.channelSku) {
      const clash = byKey.get(p.channelSku);
      if (clash && clash.id !== row.id) {
        // Khóa mới đang thuộc một dòng KHÁC (id sàn khác) — không đổi, giữ khóa
        // cũ để không phá unique; cập nhật dữ liệu như thường và đếm để soi log.
        renameSkipped++;
      } else {
        newKey = p.channelSku;
      }
    }
    if (!row) row = byKey.get(p.channelSku);

    if (row) {
      // KHÔNG đụng productId — liên kết là của người dùng.
      await prisma.channelProduct.update({
        where: { id: row.id },
        data: { ...data, ...(newKey ? { channelSku: newKey } : {}) },
      });
      if (newKey) {
        byKey.delete(row.channelSku);
        row.channelSku = newKey;
        byKey.set(newKey, row);
        renamed++;
      }
      if (p.variantName) row.variantName = p.variantName;
      if (!row.externalId && p.externalId) {
        row.externalId = p.externalId;
        byExt.set(p.externalId, [...(byExt.get(p.externalId) ?? []), row]);
      }
      seenIds.add(row.id);
      updated++;
    } else {
      const made = await prisma.channelProduct.create({
        data: { channelId: channel.id, channelSku: p.channelSku, ...data },
        select: { id: true },
      });
      const fresh: ExistingRow = {
        id: made.id,
        channelSku: p.channelSku,
        externalId: p.externalId,
        variantName: p.variantName,
        status: data.status,
      };
      byKey.set(p.channelSku, fresh);
      if (p.externalId) byExt.set(p.externalId, [...(byExt.get(p.externalId) ?? []), fresh]);
      seenIds.add(made.id);
      createdIds.push(made.id);
      created++;
    }
  }

  if (suffixed > 0 || renamed > 0 || renameSkipped > 0) {
    console.log(
      `[product-sync] gian ${channel.shopName} (${channel.id}): ${suffixed} dòng trùng mã được thêm đuôi phân loại, ` +
        `${renamed} dòng đổi khóa theo id sàn${renameSkipped ? `, ${renameSkipped} dòng KHÔNG đổi được vì khóa mới thuộc dòng khác` : ""}`
    );
  }

  // SKU cũ không còn trong danh mục sàn → đánh DELISTED (không xoá để giữ liên kết).
  // CHỈ làm khi lượt kéo ĐẦY ĐỦ: danh mục bị cắt ở chốt chặn phân trang thì SKU
  // vắng mặt chưa chắc đã gỡ — đánh DELISTED nhầm là gian đó ngừng được đẩy tồn
  // (enqueueStockPush chỉ nhặt ACTIVE) → bán vượt tồn (rà soát 29/09/2026).
  let delisted = 0;
  if (complete) {
    delisted = await delistUnseen(existing, seenIds);
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
    renamed,
    complete,
  };
}

/** Lô id mỗi lệnh UPDATE — dưới xa trần 32.767 tham số của Postgres. */
const DELIST_BATCH = 1000;

/**
 * Đánh DELISTED các dòng đang ACTIVE của gian mà lượt kéo KHÔNG chạm tới
 * (`seenIds`). So khớp trong bộ nhớ rồi cập nhật theo lô id: `channelSku notIn
 * [hàng chục nghìn mã]` vượt trần tham số của Postgres ở gian danh mục lớn.
 */
async function delistUnseen(existing: ExistingRow[], seenIds: Set<string>): Promise<number> {
  const goneIds = existing
    .filter((r) => r.status === ChannelProductStatus.ACTIVE && !seenIds.has(r.id))
    .map((r) => r.id);
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
