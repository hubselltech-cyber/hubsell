// ============================================================
// ĐỌC / GHI CÁC CỘT JSON của listing_copy_jobs / listing_copy_targets.
// Prisma trả JsonValue — ở đây ép về kiểu nghiệp vụ, có phòng dữ liệu ghi
// trước các lát sau (job cũ thiếu descriptionImages, dimension {0,0,0}…).
// ============================================================

import type { ListingCopyTarget, Prisma } from "@prisma/client";
import { normalizeDims, type TargetDraftState } from "../../marketplace/listing/rules";
import type { NormalizedListing } from "../../marketplace/listing/types";

/** Object thường → kiểu JSON ghi Prisma. */
export function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

export function asListing(v: Prisma.JsonValue): NormalizedListing {
  const l = v as unknown as NormalizedListing;
  // Job tạo trước lát "ảnh trong mô tả" chưa có trường này.
  if (!Array.isArray(l.descriptionImages)) l.descriptionImages = [];
  return l;
}

export function asRecord(v: Prisma.JsonValue): Record<string, string> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
}

export function asStringArray(v: Prisma.JsonValue): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/**
 * Trạng thái đã chọn của một gian đích (danh mục, thuộc tính, thương hiệu, vận chuyển, cân
 * nặng, kích thước) từ dòng bảng — đầu vào của computeMissing. dimensionsCm {0,0,0} ghi trước
 * 29/10 → normalizeDims trả null, không gửi sàn.
 */
export function targetState(t: ListingCopyTarget): Omit<TargetDraftState, "existingSkus"> {
  return {
    categoryId: t.categoryId,
    attributes: asRecord(t.attributes),
    brandId: t.brandId,
    logisticIds: asStringArray(t.logisticIds),
    weightGrams: t.weightGrams,
    dimensionsCm: normalizeDims(t.dimensionsCm),
  };
}
