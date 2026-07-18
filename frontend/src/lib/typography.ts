/**
 * QUY CHUẨN FONT CHỮ HỆ THỐNG (Responsive Typography)
 *
 * Nguồn chân lý duy nhất cho cỡ chữ toàn Hubsell. Các component nền
 * (Table, Input, StatCard, BreakdownCard…) đều ăn theo file này, nên muốn
 * chỉnh cỡ chữ toàn hệ thống chỉ cần sửa ở đây.
 *
 * ─── Vì sao dùng breakpoint `2xl` (≥1536px) thay vì `md` (≥768px)? ───
 * Mục tiêu: "laptop hiển thị gọn gàng, PC lớn tự nở to cho nét căng".
 * Laptop phổ biến rộng 1366–1440px → đã vượt `md` từ lâu, nếu dùng `md`
 * thì laptop cũng nhảy lên cỡ chữ lớn, mất đi sự gọn gàng.
 * Dùng `2xl`: laptop (≤1535px) giữ cỡ nhỏ, màn PC lớn (≥1536px) mới nở ra.
 * Muốn đổi ngưỡng, chỉ cần thay `2xl:` thành `xl:` hoặc `md:` trong file này.
 */

/** Nội dung chính / số liệu trong bảng — 14px → 16px */
export const TEXT_BODY = "text-sm 2xl:text-base text-foreground";

/** Dòng phụ (sub-info) xếp chồng dưới số liệu — 11px → 13px */
export const TEXT_SUB = "text-[11px] 2xl:text-[13px] text-muted-foreground";

/** Tiêu đề cột của bảng — 12px → 14px */
export const TEXT_TABLE_HEAD =
  "text-xs 2xl:text-sm font-semibold tracking-wider text-foreground/75";

/** Tiêu đề khối / thẻ số liệu — 12px → 14px, in hoa */
export const TEXT_CARD_TITLE =
  "text-xs 2xl:text-sm font-medium uppercase tracking-wide text-muted-foreground";

/** Số lớn trên dashboard — 20px → 24px */
export const TEXT_BIG_NUMBER =
  "text-xl 2xl:text-2xl font-bold tracking-tight text-foreground";

/**
 * Số TỔNG trên thẻ chỉ số — 24px → 30px, đậm hơn một bậc.
 * Đây là điểm neo thị giác (visual anchor) của mỗi khối: mắt phải bắt được
 * con số này trước tiên, nên nó to & đậm hơn hẳn TEXT_BIG_NUMBER.
 */
export const TEXT_HERO_NUMBER =
  "text-2xl 2xl:text-3xl font-extrabold tracking-tight text-foreground";

/** Khoảng đệm ô trong bảng — luôn có khoảng thở khi chữ nở to */
export const CELL_PADDING = "px-3 py-3 2xl:py-4";
