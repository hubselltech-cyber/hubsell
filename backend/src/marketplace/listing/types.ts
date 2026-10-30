// ============================================================
// SAO CHÉP SẢN PHẨM — HỢP ĐỒNG ĐĂNG SẢN PHẨM LÊN SÀN (docs/SAO-CHEP-SAN-PHAM.md mục 2)
//
// Khác với marketplace/types.ts (chiều ĐỌC danh mục về kho), tệp này là chiều
// GHI: một sản phẩm đã chuẩn hoá (NormalizedListing) được đăng lên gian đích qua
// ListingAdapter của từng sàn. Mọi khác biệt sàn (danh mục, thuộc tính bắt buộc,
// kênh vận chuyển, thương hiệu, giới hạn tên/ảnh) nằm sau hợp đồng này.
// ============================================================

import type { Channel } from "@prisma/client";

export interface ListingVariant {
  /** SKU người bán — giữ NGUYÊN từ nguồn để sản phẩm mới tự nối SKU kho. */
  sku: string;
  /** Tên phân loại ("Đen, M"); null nếu sản phẩm đơn. */
  name: string | null;
  price: number;
  stock: number;
  imageUrl: string | null;
  /**
   * Khách BỎ phân loại này khỏi bài đăng (30/10/2026: sản phẩm 17 màu × 3 = 51 phân loại
   * vượt trần 50 của Shopee → bỏ bớt mới đăng được). Vẫn giữ trong source để bật lại.
   */
  excluded?: boolean;
}

export interface ListingOption {
  name: string;
  values: string[];
}

export interface ListingDimensions {
  length: number;
  width: number;
  height: number;
}

/** Sản phẩm ở dạng trung lập — cả nguồn gian sàn lẫn nguồn kho Hubsell đều quy về đây. */
export interface NormalizedListing {
  title: string;
  /** Chữ thuần (đã bóc HTML + ảnh); ảnh chèn trong mô tả tách sang descriptionImages. */
  description: string;
  images: string[];
  /**
   * Ảnh CHÈN TRONG MÔ TẢ của nguồn (Shopee extended_description, TikTok/Lazada <img>), theo thứ tự.
   * Khi đăng: upload lại lên gian đích rồi ghép vào CUỐI mô tả (không giữ vị trí xen kẽ chữ–ảnh).
   */
  descriptionImages: string[];
  /** Danh mục ở sàn NGUỒN (id + đường dẫn), chỉ để gợi ý; null khi nguồn là kho. */
  categoryId: string | null;
  categoryPath: string[] | null;
  brandName: string | null;
  weightGrams: number | null;
  dimensionsCm: ListingDimensions | null;
  options: ListingOption[];
  variants: ListingVariant[];
  attributes: { name: string; value: string }[];
}

export interface CategorySuggestion {
  id: string;
  name: string;
  path: string[];
  /** 0–1. */
  confidence: number;
}

export interface CategoryNode {
  id: string;
  name: string;
  path: string[];
  leaf: boolean;
}

/** Một nút trong cây danh mục của sàn (phẳng, có cha) — để màn hình xổ cha → con. */
export interface CategoryTreeNode {
  id: string;
  name: string;
  /** null = cấp gốc. */
  parentId: string | null;
  leaf: boolean;
}

export interface AttributeDef {
  id: string;
  name: string;
  required: boolean;
  type: "select" | "text" | "number";
  options?: string[];
}

/** Luật của MỘT danh mục lá trên MỘT sàn — nguồn để tính "còn thiếu gì". */
export interface CategoryRequirements {
  attributes: AttributeDef[];
  brandRequired: boolean;
  weightRequired: boolean;
  dimensionsRequired: boolean;
  logisticsRequired: boolean;
  titleMin: number;
  titleMax: number;
  descriptionMin: number;
  descriptionMax: number;
  maxImages: number;
  maxOptions: number;
  maxVariants: number;
  /** Trần số GIÁ TRỊ trong một nhóm phân loại (Shopee/Lazada 20); bỏ trống = không kiểm. */
  maxOptionValues?: number;
}

export interface LogisticOption {
  id: string;
  name: string;
  enabled: boolean;
}

export interface Brand {
  id: string;
  name: string;
}

/** Bản nháp đã đủ điều kiện để gọi API tạo sản phẩm. */
export interface ListingDraft {
  listing: NormalizedListing;
  categoryId: string;
  attributes: Record<string, string>;
  brandId: string | null;
  brandName: string | null;
  logisticIds: string[];
  weightGrams: number | null;
  dimensionsCm: ListingDimensions | null;
  /** Phân loại sau khi áp % giá + tồn đăng. */
  variants: ListingVariant[];
}

export interface CreateListingResult {
  remoteItemId: string;
  remoteUrl: string | null;
  /** LISTED = bán ngay; PENDING_REVIEW = sàn còn duyệt (TikTok). */
  status: "LISTED" | "PENDING_REVIEW";
  variants: { sku: string; remoteId: string }[];
}

/** Kết quả hỏi lại sàn về bài đang CHỜ DUYỆT (TikTok). */
export interface ReviewCheckResult {
  status: "LISTED" | "PENDING_REVIEW" | "FAILED";
  /** Lý do sàn từ chối (FAILED) — đã là câu cho người bán. */
  reason?: string;
  remoteUrl?: string | null;
}

export interface ListingAdapter {
  readonly name: string;
  /**
   * Hỏi lại sàn bài đã đăng ở trạng thái PENDING_REVIEW đã được duyệt chưa.
   * Không có (Shopee/Lazada bán ngay) → bỏ. null = sàn không trả lời được, giữ nguyên.
   */
  checkReviewStatus?(channel: Channel, remoteItemId: string): Promise<ReviewCheckResult | null>;
  /** Đọc chi tiết một sản phẩm sàn (mọi phân loại) về dạng chuẩn; null = không có. */
  fetchListing(channel: Channel, itemId: string): Promise<NormalizedListing | null>;
  recommendCategory(channel: Channel, listing: NormalizedListing): Promise<CategorySuggestion[]>;
  searchCategories(channel: Channel, query: string): Promise<CategoryNode[]>;
  /** TOÀN BỘ cây danh mục của sàn (phẳng) — adapter đệm theo gian, route cắt theo cha. */
  getCategoryTree(channel: Channel): Promise<CategoryTreeNode[]>;
  getCategoryRequirements(channel: Channel, categoryId: string): Promise<CategoryRequirements | null>;
  getLogistics(channel: Channel): Promise<LogisticOption[]>;
  searchBrands(channel: Channel, categoryId: string | null, query: string): Promise<Brand[]>;
  /** Tên thương hiệu theo id (không bị cắt 200 dòng như searchBrands). Không khai → tra trong searchBrands(""). */
  getBrandName?(channel: Channel, categoryId: string | null, id: string): Promise<string | null>;
  createListing(channel: Channel, draft: ListingDraft): Promise<CreateListingResult>;
}
