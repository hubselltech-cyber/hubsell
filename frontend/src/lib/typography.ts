/**
 * QUY CHUẨN CHỮ & MÀU CHỮ CỦA HUBSELL (Design System)
 *
 * Nguồn chân lý duy nhất cho cỡ chữ và sắc độ chữ toàn hệ thống. Các component
 * nền (Table, Card, DashboardCard, Money…) đều ăn theo file này, nên đổi phong
 * cách toàn hệ thống chỉ cần sửa ở đây.
 *
 * ─── NGUYÊN TẮC: TIẾT CHẾ ───
 * Đây là màn hình tài chính. Nếu chữ nào cũng đậm và ô nào cũng có màu thì mắt
 * không biết bám vào đâu — cái gì cũng nổi nghĩa là không gì nổi cả.
 *
 *   Sắc độ chữ chỉ có 3 bậc:
 *     slate-900  số liệu & tiêu đề    (thông tin chính)
 *     slate-600  số liệu phụ trợ      (giá vốn, phí — đọc khi cần)
 *     slate-500  nhãn & chú thích     (biết là gì, không cần đọc kỹ)
 *
 *   MÀU tín hiệu (emerald-500 / red-500) chỉ dành cho LÃI–LỖ và CẢNH BÁO.
 *   Không tô trang trí.
 *   ĐẬM (semibold) chỉ dành cho cột Lợi nhuận và số Hero. Không đậm tràn lan.
 */

/** Tiêu đề trang trên thanh header — 20px */
export const TEXT_PAGE_TITLE =
  "text-xl font-semibold tracking-tight text-slate-900";

/** Nội dung chính / số liệu trong bảng — 14px, xám đen sắc nét */
export const TEXT_BODY = "text-sm text-slate-900";

/**
 * Số liệu PHỤ TRỢ trong bảng: giá vốn, phí sàn, chi phí Ads.
 * font-medium + slate-700: đủ nổi để mắt quét trúng số khi lướt bảng, nhưng
 * vẫn nhường bậc semibold cho cột kết luận (TEXT_NUMBER_STRONG).
 */
export const TEXT_NUMBER_MUTED = "text-sm font-medium text-slate-700";

/**
 * Số liệu KẾT LUẬN: cột Lợi nhuận cuối bảng.
 * Chỗ duy nhất trong bảng được in đậm, để mắt lướt dọc là thấy ngay.
 */
export const TEXT_NUMBER_STRONG = "text-sm font-semibold";

/** Dòng phụ (sub-info) xếp chồng dưới số liệu — 12px */
export const TEXT_SUB = "text-xs text-slate-500";

/** Tiêu đề cột của bảng — 12px in hoa, xám vừa */
export const TEXT_TABLE_HEAD =
  "text-xs font-medium uppercase tracking-wide text-slate-500";

/**
 * Thanh tiêu đề bảng bản NỔI — nền xám đặc, chữ đậm/sẫm hơn TEXT_TABLE_HEAD,
 * viền đáy rõ + bo nhẹ hai góc trên. Áp qua <TableHeader className={...}> ở
 * những bảng dày số liệu cần tách hẳn tiêu đề khỏi dữ liệu.
 */
export const TABLE_HEAD_EMPHASIS =
  "bg-slate-50 [&_tr]:border-b [&_tr]:border-slate-200 [&_th]:font-semibold [&_th]:text-slate-700 [&_th:first-child]:rounded-tl-lg [&_th:last-child]:rounded-tr-lg";

/** Nhãn của thẻ chỉ số — 12px in hoa, cùng cấp với tiêu đề cột bảng */
export const TEXT_CARD_TITLE =
  "text-xs font-medium uppercase tracking-wide text-slate-500";

/** Số lớn trong thẻ phụ — 18px */
export const TEXT_BIG_NUMBER =
  "text-lg font-semibold tracking-tight text-slate-900";

/**
 * Số HERO trên thẻ chỉ số — 24px.
 * Cố định một cỡ ở mọi màn hình: to hơn nữa thì thẻ trông "chềnh ềnh" và số
 * tiền dài bị vỡ dòng ở khung hẹp.
 */
export const TEXT_HERO_NUMBER =
  "text-2xl font-bold tracking-tight text-slate-900";

/** Khoảng đệm ô trong bảng — dòng một tầng nội dung cao ≈56px */
export const CELL_PADDING = "px-4 py-4";

/** Màu chữ cho số dương/âm — dùng chung ở bảng và thẻ. */
export const MONEY_POSITIVE = "text-emerald-500";
export const MONEY_NEGATIVE = "text-red-500";

/** Dương → emerald-500 (#10B981), âm → red-500 (#EF4444). Class màu cho số tiền. */
export function moneyTone(value: number): string {
  return value >= 0 ? MONEY_POSITIVE : MONEY_NEGATIVE;
}
