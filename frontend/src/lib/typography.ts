/**
 * QUY CHUẨN FONT CHỮ HỆ THỐNG (Responsive Typography)
 *
 * Nguồn chân lý duy nhất cho cỡ chữ toàn Hubsell. Các component nền
 * (Table, Input, StatCard, BreakdownCard…) đều ăn theo file này, nên muốn
 * chỉnh cỡ chữ toàn hệ thống chỉ cần sửa ở đây.
 *
 * ─── Triết lý cỡ chữ ───
 * Dễ đọc ở MỌI kích cỡ màn hình, không có cỡ nào dưới 12px. Phiên bản trước
 * để laptop dùng cỡ nhỏ (11–12px) rồi chỉ nở to trên màn ≥1536px — kết quả là
 * đa số người dùng (laptop 13–15 inch) phải đọc chữ nhi nhí cả ngày. Nay:
 *   - Cỡ chuẩn đã thoải mái ngay trên laptop (nội dung bảng 15px).
 *   - Màn PC lớn (`2xl` ≥1536px) nở thêm một nấc cho nét căng.
 */

/** Tiêu đề trang trên thanh header — 24px, đậm */
export const TEXT_PAGE_TITLE =
  "text-2xl font-bold tracking-tight text-foreground";

/** Nội dung chính / số liệu trong bảng — 15px → 16px */
export const TEXT_BODY = "text-[15px] 2xl:text-base text-foreground";

/** Dòng phụ (sub-info) xếp chồng dưới số liệu — 12px → 13px */
export const TEXT_SUB = "text-xs 2xl:text-[13px] text-muted-foreground";

/** Tiêu đề cột của bảng — 13px → 14px */
export const TEXT_TABLE_HEAD =
  "text-[13px] 2xl:text-sm font-semibold tracking-wide text-muted-foreground";

/** Tiêu đề khối / thẻ số liệu — 13px → 14px, in hoa */
export const TEXT_CARD_TITLE =
  "text-[13px] 2xl:text-sm font-medium uppercase tracking-wide text-muted-foreground";

/** Số lớn trên dashboard — 24px → 26px */
export const TEXT_BIG_NUMBER =
  "text-2xl 2xl:text-[26px] font-bold tracking-tight text-foreground";

/**
 * Số TỔNG trên thẻ chỉ số — 28px → 32px.
 * Đây là điểm neo thị giác (visual anchor) của mỗi khối: mắt phải bắt được
 * con số này trước tiên, nên nó to & đậm hơn hẳn TEXT_BIG_NUMBER.
 */
export const TEXT_HERO_NUMBER =
  "text-[28px] leading-tight 2xl:text-[32px] font-bold tracking-tight text-foreground";

/**
 * Khoảng đệm ô trong bảng — dòng một tầng nội dung cao ≈56px cho mắt có chỗ
 * nghỉ giữa các dòng, theo chuẩn bảng dữ liệu SaaS (Shopify/Stripe)
 */
export const CELL_PADDING = "px-4 py-4";
