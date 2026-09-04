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

/**
 * Tiêu đề trang trên thanh header — 24px đậm.
 * 04/09/2026: nâng từ 20px/semibold/tracking-tight theo đo đạc YouTube Studio
 * (h1 32/700, không nén tracking): thang cỡ của Hubsell trước đây nén trong
 * 12→20px nên tiêu đề không tách khỏi thân, cả trang nhìn phẳng.
 */
export const TEXT_PAGE_TITLE = "text-2xl font-bold text-slate-900";

/** Nội dung chính / số liệu trong bảng — 14px, xám đen sắc nét */
export const TEXT_BODY = "text-sm text-slate-900";

/**
 * Số liệu PHỤ TRỢ trong bảng: giá vốn, phí sàn, chi phí Ads.
 * slate-700 weight 400 (04/09/2026 bỏ font-medium theo đo đạc YouTube Studio:
 * nền chữ 400 thì bậc semibold của cột kết luận TEXT_NUMBER_STRONG mới nổi thật).
 */
export const TEXT_NUMBER_MUTED = "text-sm text-slate-700 tabular-nums";

/**
 * Số liệu KẾT LUẬN: cột Lợi nhuận cuối bảng.
 * Chỗ duy nhất trong bảng được in đậm, để mắt lướt dọc là thấy ngay.
 */
export const TEXT_NUMBER_STRONG = "text-sm font-semibold tabular-nums";

/** Dòng phụ (sub-info) xếp chồng dưới số liệu — 12px */
export const TEXT_SUB = "text-xs text-slate-500";

/**
 * Tiêu đề cột của bảng — 12px, weight 500, xám vừa, KHÔNG in hoa.
 * 04/09/2026: bỏ uppercase + tracking-wide (đo YouTube Studio: header cột
 * 12/500 #606060 chữ thường). Chữ hoa giãn cách ở 12px tạo dải xám nhiễu
 * phía trên mọi bảng/thẻ, góp phần vào cảm giác "phẳng".
 */
export const TEXT_TABLE_HEAD = "text-xs font-medium text-slate-500";

/**
 * Thanh tiêu đề bảng bản NỔI — nền xám đặc, chữ đậm/sẫm hơn TEXT_TABLE_HEAD,
 * viền đáy rõ + bo nhẹ hai góc trên. Áp qua <TableHeader className={...}> ở
 * những bảng dày số liệu cần tách hẳn tiêu đề khỏi dữ liệu.
 */
export const TABLE_HEAD_EMPHASIS =
  "bg-slate-50 [&_tr]:border-b [&_tr]:border-slate-200 [&_th]:font-semibold [&_th]:text-slate-700 [&_th:first-child]:rounded-tl-lg [&_th:last-child]:rounded-tr-lg";

/** Nhãn của thẻ chỉ số — 13px chữ thường, weight 400, xám (không in hoa — xem TEXT_TABLE_HEAD) */
export const TEXT_CARD_TITLE = "text-[13px] text-slate-500";

/** Số lớn trong thẻ phụ — 18px */
export const TEXT_BIG_NUMBER =
  "text-lg font-semibold tracking-tight text-slate-900 tabular-nums";

/**
 * Số HERO trên thẻ chỉ số — 24px, CỐ ĐỊNH. 04/09/2026 đã thử 28px theo đo đạc
 * YouTube Studio, anh Trung chốt hạ lại: giao diện đẹp lên là chính nhưng con
 * số phải dễ dùng — số tiền dài (1.080.655.755 ₫) ở 28px vỡ dòng trên thẻ
 * hẹp. Chỉ bỏ tracking-tight cho chữ số thở, không nén như trước.
 *
 * tabular-nums: bảng đã có sẵn qua globals.css (td/th) nhưng thẻ chỉ số thì
 * không — thiếu nó con số to nhất màn hình lại dùng chữ số bề rộng lệch, số
 * nhảy giật khi dữ liệu refresh và các thẻ cùng hàng nhìn không đều nhau.
 */
export const TEXT_HERO_NUMBER = "text-2xl font-bold text-slate-900 tabular-nums";

/** Khoảng đệm ô trong bảng — dòng một tầng nội dung cao ≈56px */
export const CELL_PADDING = "px-4 py-4";

/** Màu chữ cho số dương/âm — dùng chung ở bảng và thẻ. */
export const MONEY_POSITIVE = "text-emerald-500";
export const MONEY_NEGATIVE = "text-red-500";

/** Dương → emerald-500 (#10B981), âm → red-500 (#EF4444). Class màu cho số tiền. */
export function moneyTone(value: number): string {
  return value >= 0 ? MONEY_POSITIVE : MONEY_NEGATIVE;
}
