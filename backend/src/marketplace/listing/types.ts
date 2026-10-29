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
  description: string;
  images: string[];
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

export interface ListingAdapter {
  readonly name: string;
  /** Đọc chi tiết một sản phẩm sàn (mọi phân loại) về dạng chuẩn; null = không có. */
  fetchListing(channel: Channel, itemId: string): Promise<NormalizedListing | null>;
  recommendCategory(channel: Channel, listing: NormalizedListing): Promise<CategorySuggestion[]>;
  searchCategories(channel: Channel, query: string): Promise<CategoryNode[]>;
  /** TOÀN BỘ cây danh mục của sàn (phẳng) — adapter đệm theo gian, route cắt theo cha. */
  getCategoryTree(channel: Channel): Promise<CategoryTreeNode[]>;
  getCategoryRequirements(channel: Channel, categoryId: string): Promise<CategoryRequirements | null>;
  getLogistics(channel: Channel): Promise<LogisticOption[]>;
  searchBrands(channel: Channel, categoryId: string | null, query: string): Promise<Brand[]>;
  createListing(channel: Channel, draft: ListingDraft): Promise<CreateListingResult>;
}
