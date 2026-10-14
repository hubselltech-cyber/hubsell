// ============================================================
// KHÓA SKU SÀN KHI NGƯỜI BÁN ĐẶT CHUNG MỘT MÃ CHO NHIỀU PHÂN LOẠI (15/10/2026)
//
// Sự cố khách Hi.Bé: sản phẩm Shopee có 2 tầng phân loại (Màu × Size), người
// bán bấm "Áp dụng cho tất cả phân loại" nên 5 size của màu Hồng cùng model_sku
// "LT075-HONG". Trước đây adapter GỘP các dòng trùng mã thành MỘT dòng (giữ
// externalId của model đầu, tồn cộng dồn) → worker chỉ đẩy tồn cho 1 model, 4
// size còn lại trên sàn không bao giờ nhận số; bảng Hàng hóa cũng thiếu 4 dòng.
// Đo prod 15/10: 13 khách Shopee (1.391 dòng) + 12 gian TikTok (~700 dòng) dính.
//
// Nguyên tắc mới:
//   1. KHÔNG gộp. Mỗi phân loại lá trên sàn = MỘT dòng ChannelProduct.
//   2. Danh tính thật của dòng là `externalId` (item-model / item-sku /
//      product-sku). `channelSku` chỉ là khóa hiển thị + khóa khớp kho, và phải
//      duy nhất trong gian (unique DB).
//   3. Mã trùng trong cùng gian → thêm đuôi TÊN PHÂN LOẠI cho người đọc:
//        "LT075-HONG (Hồng, 3-5kg)", "LT075-HONG (Hồng, 5-7kg)"
//      (anh Trung 15/10: khách đối chiếu bằng tên, không phải id). Chưa biết tên
//      (TikTok products/search không trả sales_attributes, chi tiết bổ sung sau)
//      → tạm "LT075-HONG #1734732076211733760"; có tên thì product-sync đổi khóa
//      theo externalId, giữ nguyên liên kết kho + giá vốn.
//   4. Hai lá trùng cả mã lẫn tên (sàn vẫn cho) → thêm cả "#id" để không mất dòng.
//   5. Mã duy nhất trong gian giữ nguyên như cũ — khách khác không đổi gì.
// ============================================================

import type { NormalizedChannelProduct } from "./types";

/**
 * Chuẩn hóa tên phân loại để cùng một tổ hợp cho ra cùng một đuôi trên mọi sàn:
 * Shopee model_name "Hồng,3-5kg" / TikTok "Hồng, 3-5kg" → "Hồng, 3-5kg".
 */
export function normalizeVariantName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Id của phân loại lá từ externalId "item-model" (đoạn sau dấu gạch cuối). */
export function leafIdOf(externalId: string | null | undefined): string | null {
  if (!externalId) return null;
  const i = externalId.lastIndexOf("-");
  return i >= 0 ? externalId.slice(i + 1) : externalId;
}

/** Khóa hiển thị cho dòng trùng mã. */
export function suffixedSku(
  sku: string,
  variant: string | null,
  leafId: string | null,
  withId: boolean
): string {
  let key = sku;
  if (variant) key += ` (${variant})`;
  if (withId || !variant) key += leafId ? ` #${leafId}` : "";
  return key;
}

/**
 * Lấy lại mã người bán từ khóa đã thêm đuôi ("LT075-HONG (Hồng, 3-5kg) #123" →
 * "LT075-HONG"). Dùng khi cần so với mã thô của sàn (đơn cũ, trả hàng).
 */
export function baseSkuOf(key: string): string {
  return key.replace(/\s\(.*\)(\s#[^\s]+)?$/, "").replace(/\s#[^\s]+$/, "");
}

export interface ResolvedSkuKeys<T extends NormalizedChannelProduct> {
  products: T[];
  /** Số dòng phải thêm đuôi (để log/đếm). */
  suffixed: number;
}

/**
 * Gán khóa `channelSku` DUY NHẤT trong gian cho danh sách dòng adapter trả về.
 * Hàm thuần — không đụng DB. `variantHint(p)` cho tầng gọi bù tên phân loại từ
 * DB khi adapter không đọc được (TikTok lượt không bổ sung chi tiết), để khóa
 * không nhảy qua lại giữa "(tên)" và "#id" giữa hai lượt.
 *
 * Thứ tự ổn định: không phụ thuộc thứ tự sàn trả về (đuôi chỉ dựa vào tên +
 * id lá), nên cùng dữ liệu luôn ra cùng khóa.
 */
export function resolveChannelSkuKeys<T extends NormalizedChannelProduct>(
  products: T[],
  variantHint: (p: T) => string | null = (p) => p.variantName
): ResolvedSkuKeys<T> {
  const groups = new Map<string, T[]>();
  for (const p of products) {
    const list = groups.get(p.channelSku) ?? [];
    list.push(p);
    groups.set(p.channelSku, list);
  }

  const taken = new Set<string>();
  for (const [sku, list] of groups) if (list.length === 1) taken.add(sku);

  let suffixed = 0;
  const out: T[] = [];
  for (const [sku, list] of groups) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    // Cùng mã → đuôi theo tên; tên trùng nhau (hoặc đụng khóa đã có) → thêm #id.
    const byVariant = new Map<string, T[]>();
    for (const p of list) {
      const v = normalizeVariantName(variantHint(p)) ?? "";
      const l = byVariant.get(v) ?? [];
      l.push(p);
      byVariant.set(v, l);
    }
    for (const [variant, same] of byVariant) {
      for (const p of same) {
        const leaf = leafIdOf(p.externalId);
        const v = variant || null;
        let key = suffixedSku(sku, v, leaf, same.length > 1);
        if (taken.has(key)) key = suffixedSku(sku, v, leaf, true);
        // Chốt chặn cuối: vẫn đụng (hai lá không có externalId) → đánh số.
        let n = 2;
        const base = key;
        while (taken.has(key)) key = `${base} #${n++}`;
        taken.add(key);
        out.push({ ...p, channelSku: key, variantName: p.variantName ?? v });
        suffixed++;
      }
    }
  }
  return { products: out, suffixed };
}
