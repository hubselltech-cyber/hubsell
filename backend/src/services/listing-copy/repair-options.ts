// ============================================================
// SAO CHÉP SẢN PHẨM — CHỮA bản chụp nguồn THIẾU NHÓM PHÂN LOẠI (docs mục 35, 22/11/2026)
//
// Trước 22/11/2026 nguồn Shopee đọc nhóm phân loại nhầm chỗ → mọi bản chụp có phân loại đều
// lưu `options: []`. Hệ quả: TikTok từ chối (12052241 sales_attributes), Shopee lên bài KHÔNG
// có phân loại. Bản chụp đã nằm trong DB nên sửa adapter không cứu được đợt cũ → worker gọi
// ensureListingOptions trước khi đăng: đọc lại nhóm từ gian nguồn, không được thì suy từ tên.
// ============================================================

import { prisma } from "../../lib/prisma";
import { inferOptions } from "../../marketplace/listing/infer-options";
import { getListingAdapter } from "../../marketplace/listing/registry";
import type { ListingVariant, NormalizedListing } from "../../marketplace/listing/types";
import { json } from "./json-fields";

/** Bản chụp có nhiều phân loại mang tên mà không có nhóm nào → adapter đích không dựng được phân loại. */
export function needsOptionRepair(listing: Pick<NormalizedListing, "options" | "variants">): boolean {
  return listing.options.length === 0 && listing.variants.length > 1 && listing.variants.some((v) => (v.name ?? "").trim());
}

const key = (name: string | null) => (name ?? "").trim().toLowerCase();

/**
 * Ghép nhóm phân loại vừa đọc lại từ gian nguồn vào bản chụp cũ (thuần, có test). GIỮ mọi thứ
 * khách đã sửa trên bản chụp (giá, tồn, mã SKU, bỏ phân loại, ảnh) — chỉ thêm `options`,
 * `optionValues` và ảnh phân loại còn trống. Khớp phân loại theo vị trí trước, lệch thì theo tên.
 * Trả null khi nguồn không có nhóm hoặc còn phân loại không khớp được (nguồn đã đổi) → gọi
 * nơi khác suy từ tên.
 */
export function mergeFreshOptions<T extends NormalizedListing>(stored: T, fresh: NormalizedListing): T | null {
  if (fresh.options.length === 0) return null;
  const byName = new Map<string, ListingVariant>();
  for (const v of fresh.variants) if (key(v.name) && !byName.has(key(v.name))) byName.set(key(v.name), v);
  const variants: ListingVariant[] = [];
  for (let i = 0; i < stored.variants.length; i++) {
    const v = stored.variants[i];
    const sameSlot = fresh.variants[i];
    const match = sameSlot && key(sameSlot.name) === key(v.name) ? sameSlot : byName.get(key(v.name));
    if (!match?.optionValues) return null;
    variants.push({ ...v, optionValues: match.optionValues, imageUrl: v.imageUrl ?? match.imageUrl });
  }
  return { ...stored, options: fresh.options, variants };
}

interface JobRef {
  id: string;
  sourceType: "CHANNEL" | "PRODUCT" | "MANUAL";
  sourceChannelId: string | null;
  sourceItemId: string | null;
}

/**
 * Trả bản chụp đã có nhóm phân loại; có chữa thì ghi lại vào job (các gian đích sau khỏi đọc
 * lại). Đọc lại nguồn tốn 2 call sàn, chỉ xảy ra với bản chụp hỏng — bản chụp mới không vào đây.
 */
export async function ensureListingOptions<T extends NormalizedListing>(job: JobRef, stored: T): Promise<T> {
  if (!needsOptionRepair(stored)) return stored;
  let fixed: T | null = null;
  if (job.sourceType === "CHANNEL" && job.sourceChannelId && job.sourceItemId) {
    try {
      const channel = await prisma.channel.findUnique({ where: { id: job.sourceChannelId } });
      const fresh = channel ? await getListingAdapter(channel).fetchListing(channel, job.sourceItemId) : null;
      if (fresh) fixed = mergeFreshOptions(stored, fresh);
    } catch (err) {
      console.warn(`[listing-copy] job ${job.id}: đọc lại nhóm phân loại từ gian nguồn lỗi (${(err as Error).message.slice(0, 160)}) — suy nhóm từ tên phân loại`);
    }
  }
  const how = fixed ? "đọc lại từ gian nguồn" : "suy từ tên phân loại";
  if (!fixed) fixed = { ...stored, options: inferOptions(stored.variants) };
  if (fixed.options.length === 0) return stored;
  console.log(`[listing-copy] job ${job.id}: bản chụp thiếu nhóm phân loại — đã chữa (${how}): ${fixed.options.map((o) => `${o.name}×${o.values.length}`).join(", ")}`);
  await prisma.listingCopyJob.update({ where: { id: job.id }, data: { source: json(fixed) } });
  return fixed;
}
