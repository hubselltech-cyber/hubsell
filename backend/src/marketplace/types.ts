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
  /** Tồn kho người bán ĐANG CÓ TRÊN SÀN — null nếu sàn không trả số. */
  channelStock: number | null;
  /** location_id kho Shopee của SKU (đúng một địa điểm) — null với sàn khác/kho mặc định. */
  channelStockLocationId: string | null;
  /** ACTIVE = đang bán; DELISTED = đã gỡ/ẩn/khoá. */
  status: "ACTIVE" | "DELISTED";
  /**
   * Thời điểm sàn báo SẢN PHẨM CHA đổi lần cuối (giây epoch: Shopee item update_time, TikTok
   * product update_time, Lazada updated_time). Không lưu DB — chỉ để đo đối chiếu "lượt tăng dần
   * có thấy dòng này không" (05/11/2026). null / thiếu = sàn không trả.
   */
  sourceUpdatedAt?: number | null;
  /**
   * Chỉ có ở lượt TOÀN BỘ được xin đo đối chiếu (`opts.shadowSince`), với sàn mà lượt tăng dần chọn
   * sản phẩm bằng luật riêng chứ không chỉ theo thời điểm cập nhật (Shopee): true = lượt tăng dần
   * từ mốc đó CŨNG sẽ đọc sản phẩm cha của dòng này. Thiếu = nơi gọi tự so `sourceUpdatedAt` với mốc.
   */
  inIncrementalWindow?: boolean;
}

/**
 * Kết quả kéo danh mục KÈM CAM KẾT ĐẦY ĐỦ (29/09/2026, docs/KIEN-TRUC-QUY-MO-
 * TRIEU-DON.md nguyên tắc 2). `complete = false` nghĩa là adapter dừng vì chạm
 * chốt chặn phân trang — danh sách CHƯA phải toàn bộ danh mục. Nơi gọi TUYỆT ĐỐI
 * không được coi SKU vắng mặt trong một kết quả chưa đầy đủ là "đã gỡ khỏi sàn".
 */
export interface FetchedProducts {
  products: NormalizedChannelProduct[];
  complete: boolean;
  /**
   * true = danh sách CHỈ GỒM sản phẩm thay đổi từ `opts.since` (lượt tăng dần, 05/11/2026). Khi đó
   * SKU vắng mặt KHÔNG có nghĩa là đã gỡ: nơi gọi TUYỆT ĐỐI không đánh DELISTED theo vắng mặt, kể cả
   * khi `complete = true` (`complete` lúc này chỉ nói "đã đọc đủ phần thay đổi"). Thiếu / false =
   * danh sách là toàn bộ danh mục (adapter không lọc, hoặc đã tự lùi về kéo toàn bộ).
   */
  incremental?: boolean;
  /** Số lệnh gọi sàn của lượt này (để log / đo trước–sau). Adapter không đếm thì bỏ trống. */
  apiCalls?: number;
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
   * true = adapter hiểu `opts.since` (đọc tăng dần). Thiếu / false = luôn kéo toàn bộ
   * (mock, sàn chưa hỗ trợ) — kế hoạch lượt kéo sẽ không bao giờ xin tăng dần.
   */
  readonly supportsIncremental?: boolean;
  /**
   * Kéo sản phẩm của gian (đã tự phân trang + tự refresh token) và trả về danh sách đã chuẩn
   * hoá kèm cờ `complete`. Không có `opts.since` = TOÀN BỘ danh mục; có `since` = chỉ sản phẩm
   * sàn báo đổi từ mốc đó (kết quả mang `incremental: true`). Ném lỗi nếu gọi API thất bại.
   */
  fetchProducts(channel: Channel, opts?: FetchProductsOptions): Promise<FetchedProducts>;
  /**
   * Tuỳ chọn — sàn mà `fetchProducts` chỉ bổ sung được ảnh/phân loại cho MỘT
   * PHẦN danh mục mỗi lượt (TikTok: 1 call/sản phẩm, có trần) thì cài hàm này
   * để chạy NỀN nốt phần còn thiếu sau khi lượt đồng bộ đã trả kết quả. Tự ghi
   * DB, tự nuốt lỗi — không bao giờ ném.
   */
  enrichMissing?(channel: Channel): Promise<void>;
}

export interface FetchProductsOptions {
  /**
   * false = chỉ cần danh mục + tồn (worker tồn kho), adapter bỏ các call bổ
   * sung ảnh/phân loại tốn quota (TikTok GET products/{id}). Mặc định true.
   */
  details?: boolean;
  /**
   * Đọc TĂNG DẦN: chỉ sản phẩm sàn báo đổi từ thời điểm này (nơi gọi đã lùi khoảng chồng lấn).
   * Adapter không lọc được thì trả toàn bộ và KHÔNG gắn `incremental` vào kết quả.
   */
  since?: Date;
  /**
   * Lượt TOÀN BỘ có đo đối chiếu: vẫn kéo toàn bộ, chỉ nhờ adapter đánh dấu `inIncrementalWindow`
   * cho từng dòng theo đúng luật chọn của lượt tăng dần từ mốc này. Adapter không cần thì bỏ qua.
   */
  shadowSince?: Date;
}
