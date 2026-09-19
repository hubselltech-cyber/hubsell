/**
 * LUẬT CỦA TỰ ĐỘNG PHÁT HÀNH HÓA ĐƠN — các hàm THUẦN (không DB, không gọi
 * NCC), tách khỏi worker 19/09/2026 để route (`routes/tax.ts`) và worker
 * (`workers/invoice-auto-issue.ts`) cùng dùng mà route không phải import ngược
 * từ tầng worker. Worker chỉ còn việc "quét + gọi", mọi quyết định nằm ở đây
 * và có test (`__tests__/invoice-hardening.test.ts`).
 */

import type { InvoiceErrorScope } from "./invoice-errors";

/**
 * MỐC XUẤT (InvoiceConfig.autoIssueTrigger):
 *   DELIVERED — ngay khi giao thành công. Đúng Điều 9 NĐ 254/2026 (lập hóa đơn
 *               tại thời điểm chuyển giao quyền sở hữu); số tiền hóa đơn là TIỀN
 *               HÀNG, không phụ thuộc đối soát. Mặc định cho shop bật mới.
 *   SETTLED   — chờ thêm sàn đối soát (luật cũ trước 19/09): ít hóa đơn điều
 *               chỉnh hơn, đổi lại trễ vài ngày so với mốc luật.
 */
export type AutoIssueTrigger = "DELIVERED" | "SETTLED";

/** Giá trị lạ / thiếu → DELIVERED (mốc đúng luật). */
export function normalizeAutoIssueTrigger(v: unknown): AutoIssueTrigger {
  return v === "SETTLED" ? "SETTLED" : "DELIVERED";
}

/**
 * 0h giờ VN (UTC+7) của ngày chứa mốc `at` — trả về dạng Date UTC. Tự động phát
 * hành chỉ áp cho đơn giao từ mốc này của NGÀY BẬT công tắc: đơn cũ hơn có thể
 * đã được lập hóa đơn tay bên NCC trước khi dùng Hubsell, tự xuất là trùng.
 */
export function vnStartOfDay(at: Date): Date {
  const VN = 7 * 3600 * 1000;
  const vn = new Date(at.getTime() + VN);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - VN);
}

/**
 * Cùng MỘT mã lỗi lặp liên tiếp chừng này đơn trong một lượt → coi là lỗi hệ
 * thống đội lốt lỗi đơn lẻ (mã NCC chưa có trong bảng invoice-errors) và ngắt
 * mạch. Con số 3 là MẶC ĐỊNH TÙY Ý, không có nguồn: đủ nhỏ để không đốt cả lô
 * 20 đơn, đủ lớn để 2 đơn bẩn dữ liệu nằm cạnh nhau không làm ngừng cả shop.
 */
const SAME_ERROR_STREAK_TO_PAUSE = 3;

export type FailureDecision = "CONTINUE" | "STOP_RUN" | "PAUSE";

/**
 * NGẮT MẠCH — quyết định sau MỖI đơn lỗi:
 *   · ACCOUNT   → PAUSE ngay: sai mật khẩu meInvoice / ký hiệu ngừng dùng / hết
 *                 số hóa đơn / chứng thư hết hạn thì đơn nào cũng lỗi y hệt; thử
 *                 tiếp chỉ đẻ FAILED rác và khóa các đơn đó 24h. Ngừng tới khi
 *                 chủ shop sửa rồi bấm Chạy lại.
 *   · TRANSIENT → STOP_RUN: NCC bận / mạng chập chờn — bỏ phần còn lại của lượt,
 *                 15 phút sau quét lại (không đánh dấu tạm ngừng).
 *   · ORDER     → CONTINUE, trừ khi cùng mã lặp đủ SAME_ERROR_STREAK_TO_PAUSE.
 */
export function decideAfterFailure(
  scope: InvoiceErrorScope | undefined,
  sameCodeStreak: number
): FailureDecision {
  if (scope === "ACCOUNT") return "PAUSE";
  if (scope === "TRANSIENT") return "STOP_RUN";
  return sameCodeStreak >= SAME_ERROR_STREAK_TO_PAUSE ? "PAUSE" : "CONTINUE";
}
