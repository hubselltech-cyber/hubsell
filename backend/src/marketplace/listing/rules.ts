// ============================================================
// LUẬT ĐĂNG SẢN PHẨM THEO SÀN — phần thuần (không gọi API), có test.
//
// Số lấy từ tài liệu API đọc 29/10/2026 (docs/KHAO-SAT-SAO-CHEP-SAN-PHAM-DANG-
// HANG-LOAT-29-10.md mục 4). Adapter thật có thể ghi đè theo get_item_limit
// (Shopee) / category rules (TikTok) của từng danh mục; đây là mức mặc định.
// ============================================================

import { ChannelName } from "@prisma/client";
import type { CategoryRequirements, ListingOption, ListingVariant, NormalizedListing } from "./types";
import { splitVariantValues } from "./variant-map";

type PlatformRules = Omit<CategoryRequirements, "attributes">;

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
    // Trợ giúp Shopee (mẫu tải hàng loạt + app Shopee Channel, đọc 30/10/2026): 1 nhóm → tối đa
    // 20 phân loại; 2 nhóm → 20 giá trị/nhóm, tổng ≤ 50 tổ hợp. Sản phẩm khách 17 màu × 3 = 51 → bỏ bớt.
    maxVariants: 50,
    maxOptionValues: 20,
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
    // Khảo sát API 29/10 (docs/KHAO-SAT… mục 4): ~2 tầng, 20 option/tầng.
    maxOptionValues: 20,
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

/**
 * Mã trường còn thiếu — nhãn tiếng Việt ở FE (components/operations/copy-listing/shared.ts,
 * thêm mã mới thì thêm nhãn ở đó). `attr:<id>` = thuộc tính danh mục.
 */
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
  | "too_many_option_values"
  | "too_many_variants"
  | "no_variants"
  | "sku"
  | "sku_duplicate"
  | "sku_exists"
  | "price"
  | `attr:${string}`;

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
 * Trần ảnh chèn trong mô tả khi đăng. Shopee docs add_item: extended_description ≤12 ảnh;
 * TikTok/Lazada docs không nêu trần riêng → tự chọn cùng mức 12 (mặc định, chưa có căn cứ sàn).
 */
export const MAX_DESCRIPTION_IMAGES = 12;

interface Dims {
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

/** Phân loại SẼ ĐĂNG = chưa bị khách bỏ. */
export function activeVariants(listing: Pick<NormalizedListing, "variants">): ListingVariant[] {
  return listing.variants.filter((v) => !v.excluded);
}

/**
 * Nhóm phân loại theo các phân loại SẼ ĐĂNG: bỏ giá trị không còn phân loại nào dùng
 * (khách bỏ hết "Màu: Đỏ" thì tier Shopee / sales attribute TikTok không được còn "Đỏ"),
 * nhóm trống thì bỏ hẳn. Không có phân loại bị bỏ → trả nguyên.
 */
export function effectiveOptions(listing: NormalizedListing): ListingOption[] {
  if (!listing.variants.some((v) => v.excluded)) return listing.options;
  const used = listing.options.map(() => new Set<string>());
  for (const v of activeVariants(listing)) {
    splitVariantValues(v.name).forEach((val, i) => used[i]?.add(val.toLowerCase()));
  }
  return listing.options
    .map((o, i) => ({ name: o.name, values: o.values.filter((val) => used[i].has(val.toLowerCase())) }))
    .filter((o) => o.values.length > 0);
}

/**
 * Tính danh sách còn thiếu của một gian đích. `requirements` null = chưa có danh
 * mục (hoặc adapter không trả luật) → chỉ áp luật mặc định của sàn.
 */
export function computeMissing(
  platform: ChannelName,
  listing: NormalizedListing,
  target: TargetDraftState,
  requirements: CategoryRequirements | null
): MissingCode[] {
  const rules: PlatformRules = requirements ?? PLATFORM_LISTING_RULES[platform];
  const out: MissingCode[] = [];
  const title = listing.title.trim();
  const variants = activeVariants(listing);
  const options = effectiveOptions(listing);
  if (!target.categoryId) out.push("category");
  if (title.length < rules.titleMin) out.push("title_short");
  if (title.length > rules.titleMax) out.push("title_long");
  if (listing.description.trim().length < rules.descriptionMin) out.push("description");
  if (listing.images.length === 0) out.push("images");
  if (listing.images.length > rules.maxImages) out.push("too_many_images");
  if (options.length > rules.maxOptions) out.push("too_many_options");
  if (rules.maxOptionValues && options.some((o) => o.values.length > rules.maxOptionValues!)) out.push("too_many_option_values");
  if (variants.length === 0) out.push("no_variants");
  if (variants.length > rules.maxVariants) out.push("too_many_variants");
  if (variants.some((v) => !v.sku.trim())) out.push("sku");
  // Mã SKU trùng giữa các phân loại: Shopee/TikTok CHẤP NHẬN (khách Hi.Bé bấm "Áp dụng cho tất cả
  // phân loại", 30/10/2026 — docs mục 23) → chỉ cảnh báo (computeWarnings). Lazada SellerSku phải
  // duy nhất trong gian (tài liệu API; CHƯA kiểm gian thật) → vẫn chặn.
  if (platform === "LAZADA" && hasDuplicateSkus(variants)) out.push("sku_duplicate");
  if (variants.some((v) => !(v.price > 0))) out.push("price");
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

function hasDuplicateSkus(variants: ListingVariant[]): boolean {
  const skus = variants.map((v) => v.sku.trim().toLowerCase()).filter(Boolean);
  return new Set(skus).size !== skus.length;
}

/** Mã CẢNH BÁO — không chặn đăng, FE vẽ chip riêng + tooltip hệ quả (nhãn ở FE shared.ts). */
type WarningCode = "sku_duplicate";

/**
 * Cảnh báo (không chặn) cho một gian đích — thuần theo sàn + nguồn, không cần API nên
 * không lưu DB, tính lại mỗi lần trả job.
 */
export function computeWarnings(platform: ChannelName, listing: NormalizedListing): WarningCode[] {
  const out: WarningCode[] = [];
  if ((platform === "SHOPEE" || platform === "TIKTOK") && hasDuplicateSkus(activeVariants(listing))) out.push("sku_duplicate");
  return out;
}

/** Áp % điều chỉnh giá, làm tròn tới 100 đồng — giá sàn VN không có lẻ. */
export function adjustPrice(price: number, percent: number): number {
  const p = price * (1 + percent / 100);
  return Math.max(0, Math.round(p / 100) * 100);
}
