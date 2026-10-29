// ============================================================
// LUẬT ĐĂNG SẢN PHẨM THEO SÀN — phần thuần (không gọi API), có test.
//
// Số lấy từ tài liệu API đọc 29/10/2026 (docs/KHAO-SAT-SAO-CHEP-SAN-PHAM-DANG-
// HANG-LOAT-29-10.md mục 4). Adapter thật có thể ghi đè theo get_item_limit
// (Shopee) / category rules (TikTok) của từng danh mục; đây là mức mặc định.
// ============================================================

import { ChannelName } from "@prisma/client";
import type { CategoryRequirements, NormalizedListing } from "./types";

export type PlatformRules = Omit<CategoryRequirements, "attributes">;

export const PLATFORM_LISTING_RULES: Record<ChannelName, PlatformRules> = {
  SHOPEE: {
    brandRequired: false,
    weightRequired: true,
    dimensionsRequired: false,
    logisticsRequired: true,
    titleMin: 10,
    titleMax: 120,
    descriptionMin: 20,
    descriptionMax: 3000,
    maxImages: 9,
    maxOptions: 2,
    maxVariants: 50,
  },
  TIKTOK: {
    brandRequired: false,
    weightRequired: true,
    dimensionsRequired: false,
    logisticsRequired: false,
    titleMin: 25,
    titleMax: 255,
    descriptionMin: 20,
    descriptionMax: 10000,
    maxImages: 9,
    maxOptions: 3,
    maxVariants: 100,
  },
  LAZADA: {
    brandRequired: true,
    weightRequired: true,
    dimensionsRequired: true,
    logisticsRequired: false,
    titleMin: 2,
    titleMax: 255,
    descriptionMin: 20,
    descriptionMax: 25000,
    maxImages: 8,
    maxOptions: 2,
    maxVariants: 100,
  },
  OFFLINE: {
    brandRequired: false,
    weightRequired: false,
    dimensionsRequired: false,
    logisticsRequired: false,
    titleMin: 1,
    titleMax: 500,
    descriptionMin: 0,
    descriptionMax: 100000,
    maxImages: 99,
    maxOptions: 9,
    maxVariants: 999,
  },
};

/** Mã trường còn thiếu — FE dịch bằng MISSING_LABELS. `attr:<id>` = thuộc tính danh mục. */
export type MissingCode =
  | "category"
  | "brand"
  | "weight"
  | "dimensions"
  | "logistics"
  | "title_short"
  | "title_long"
  | "description"
  | "images"
  | "too_many_images"
  | "too_many_options"
  | "too_many_variants"
  | "sku"
  | "sku_exists"
  | "price"
  | `attr:${string}`;

export const MISSING_LABELS: Record<Exclude<MissingCode, `attr:${string}`>, string> = {
  category: "Chưa chọn danh mục",
  brand: "Thiếu thương hiệu",
  weight: "Thiếu cân nặng",
  dimensions: "Kích thước kiện chưa đủ 3 số (Dài × Rộng × Cao)",
  logistics: "Chưa bật kênh vận chuyển",
  title_short: "Tên quá ngắn",
  title_long: "Tên quá dài",
  description: "Mô tả quá ngắn",
  images: "Chưa có ảnh",
  too_many_images: "Quá số ảnh cho phép",
  too_many_options: "Quá số nhóm phân loại",
  too_many_variants: "Quá số phân loại",
  sku: "Phân loại thiếu SKU",
  sku_exists: "SKU đã có trên gian đích",
  price: "Giá phải lớn hơn 0",
};

export interface TargetDraftState {
  categoryId: string | null;
  attributes: Record<string, string>;
  brandId: string | null;
  logisticIds: string[];
  weightGrams: number | null;
  dimensionsCm: { length: number; width: number; height: number } | null;
  /** SKU đã tồn tại trên gian đích (kiểm trước khi đăng). */
  existingSkus?: string[];
}

/**
 * Tính danh sách còn thiếu của một gian đích. `requirements` null = chưa có danh
 * mục (hoặc adapter không trả luật) → chỉ áp luật mặc định của sàn.
 */
/**
 * Trần ảnh chèn trong mô tả khi đăng. Shopee docs add_item: extended_description ≤12 ảnh;
 * TikTok/Lazada docs không nêu trần riêng → tự chọn cùng mức 12 (mặc định, chưa có căn cứ sàn).
 */
export const MAX_DESCRIPTION_IMAGES = 12;

export interface Dims {
  length: number;
  width: number;
  height: number;
}

/**
 * Chuẩn hóa kích thước kiện từ MỌI nguồn (API sàn trả chuỗi "0", JSON bảng, body FE):
 * cả 3 số ≤ 0 / không phải số → null (= không có). Có ít nhất một số > 0 → giữ để
 * computeMissing báo "chưa đủ 3 số" thay vì lặng lẽ gửi 0 lên sàn (sự cố 29/10:
 * TikTok trả package_dimensions "0" → Shopee add_item từ chối Dimension.PackageLength).
 */
export function normalizeDims(v: unknown): Dims | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => {
    const num = typeof x === "number" ? x : Number(x);
    return Number.isFinite(num) && num > 0 ? num : 0;
  };
  const d = { length: n(o.length), width: n(o.width), height: n(o.height) };
  return d.length > 0 || d.width > 0 || d.height > 0 ? d : null;
}

/** Đủ 3 số > 0 — chỉ khi đó mới gửi `dimension` lên sàn. */
export function dimsComplete(d: Dims | null | undefined): d is Dims {
  return Boolean(d && d.length > 0 && d.width > 0 && d.height > 0);
}

export function computeMissing(
  platform: ChannelName,
  listing: NormalizedListing,
  target: TargetDraftState,
  requirements: CategoryRequirements | null
): MissingCode[] {
  const rules: PlatformRules = requirements ?? PLATFORM_LISTING_RULES[platform];
  const out: MissingCode[] = [];
  const title = listing.title.trim();
  if (!target.categoryId) out.push("category");
  if (title.length < rules.titleMin) out.push("title_short");
  if (title.length > rules.titleMax) out.push("title_long");
  if (listing.description.trim().length < rules.descriptionMin) out.push("description");
  if (listing.images.length === 0) out.push("images");
  if (listing.images.length > rules.maxImages) out.push("too_many_images");
  if (listing.options.length > rules.maxOptions) out.push("too_many_options");
  if (listing.variants.length > rules.maxVariants) out.push("too_many_variants");
  if (listing.variants.some((v) => !v.sku.trim())) out.push("sku");
  if (listing.variants.some((v) => !(v.price > 0))) out.push("price");
  if (target.existingSkus && target.existingSkus.length > 0) out.push("sku_exists");
  if (rules.brandRequired && !target.brandId) out.push("brand");
  if (rules.weightRequired && !(target.weightGrams && target.weightGrams > 0)) out.push("weight");
  // Bắt buộc mà thiếu, HOẶC không bắt buộc nhưng điền dở (1–2 số) → sàn sẽ từ chối, chặn từ đây.
  const d = normalizeDims(target.dimensionsCm);
  if ((rules.dimensionsRequired && !dimsComplete(d)) || (d && !dimsComplete(d))) out.push("dimensions");
  if (rules.logisticsRequired && target.logisticIds.length === 0) out.push("logistics");
  if (requirements) {
    for (const a of requirements.attributes) {
      if (a.required && !String(target.attributes[a.id] ?? "").trim()) out.push(`attr:${a.id}`);
    }
  }
  return out;
}

/** Áp % điều chỉnh giá, làm tròn tới 100 đồng — giá sàn VN không có lẻ. */
export function adjustPrice(price: number, percent: number): number {
  const p = price * (1 + percent / 100);
  return Math.max(0, Math.round(p / 100) * 100);
}
