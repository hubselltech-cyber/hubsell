import type { StocktakeSessionStatus } from "@/lib/api";

/**
 * Nhãn + màu trạng thái của PHIÊN KIỂM KÊ (kho chuẩn quốc tế lát 5, 20/11/2026) — dùng chung cho danh
 * sách phiên và màn một phiên. Màu lấy từ các bậc đã lật cho giao diện tối (không viết lớp dark:).
 */
export const SESSION_STATUS_META: Record<StocktakeSessionStatus, { label: string; className: string }> = {
  COUNTING: { label: "Đang đếm", className: "border-sky-200 bg-sky-50 text-sky-800" },
  PENDING: { label: "Chờ duyệt", className: "border-amber-200 bg-amber-50 text-amber-800" },
  APPROVED: { label: "Đã duyệt", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "Đã hủy", className: "border-slate-200 bg-slate-50 text-slate-700" },
};
