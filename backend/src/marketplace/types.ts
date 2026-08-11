// ============================================================
// MARKETPLACE — LỚP TRỪU TƯỢNG ĐA SÀN (Adapter Pattern)
//
// Mục tiêu: tách LOGIC API TỪNG SÀN (Shopee/TikTok/Lazada…) khỏi LOGIC KHO nội
// bộ của Hubsell. Mỗi sàn viết một Adapter chuyển đổi dữ liệu API riêng của nó
// về một cấu trúc CHUẨN (NormalizedChannelProduct) trước khi tầng lưu trữ dùng.
//
// Nhờ vậy: thêm sàn mới = viết thêm 1 adapter, KHÔNG đụng tầng kho/DB.
// ============================================================

import type { Channel } from "@prisma/client";

/**
 * Sản phẩm sàn ở dạng ĐÃ CHUẨN HOÁ — cấu trúc trung lập, không dính API sàn nào.
 * Tầng lưu trữ chỉ làm việc với kiểu này, không cần biết dữ liệu đến từ Shopee
 * hay TikTok. Đây là "hợp đồng" giữa adapter (bên trái) và kho nội bộ (bên phải).
 */
export interface NormalizedChannelProduct {
  /** Mã SKU trên sàn — khoá định danh trong một gian hàng. */
  channelSku: string;
  /** Tên hiển thị trên sàn. */
  productName: string;
  /** Phân loại (size/màu…) nếu là biến thể; null nếu sản phẩm đơn. */
  variantName: string | null;
  /** Giá niêm yết trên sàn. */
  price: number;
  imageUrl: string | null;
  /** Id phía sàn (item_id / model_id…) để đối chiếu về sau. */
  externalId: string | null;
  /** SKU TỔNG cấp sản phẩm (item_sku Shopee) — null nếu người bán không đặt. */
  itemSku: string | null;
  /** ACTIVE = đang bán; DELISTED = đã gỡ/ẩn/khoá. */
  status: "ACTIVE" | "DELISTED";
}

/**
 * Adapter của một sàn: biết cách gọi API sàn đó và TRẢ VỀ dữ liệu đã chuẩn hoá.
 * Đây là chỗ DUY NHẤT chứa kiến thức riêng của sàn (endpoint, phân trang, tên
 * trường, đổi token…). Tầng trên chỉ gọi `fetchProducts` mà không quan tâm bên
 * trong là sàn gì.
 */
export interface MarketplaceProductAdapter {
  /** Tên adapter (để log/nhận diện). */
  readonly name: string;
  /**
   * Kéo TOÀN BỘ sản phẩm của gian (đã tự phân trang + tự refresh token) và trả
   * về danh sách đã chuẩn hoá. Ném lỗi nếu gọi API thất bại.
   */
  fetchProducts(channel: Channel): Promise<NormalizedChannelProduct[]>;
}
