// ============================================================
// THAO TÁC HÀNG LOẠT Ở ĐỐI SOÁT ĐƠN HOÀN (13/11/2026) — phần thuần, không chạm DB.
//
// Anh Trung chốt: "Cứ tích từng trang một. Tích được bao nhiêu thì tác động lên
// bấy nhiêu đơn" → mỗi lượt gọi mang đúng danh sách id đang tích trên MỘT trang
// (trang tối đa 100 dòng). Không có chế độ "mọi đơn khớp bộ lọc".
// docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md
// ============================================================

import { ReturnStatus } from "@prisma/client";

/** Trần số đơn một lượt = cỡ trang lớn nhất của bảng Đối soát đơn hoàn. */
export const RETURN_BULK_MAX = 100;

/**
 * Đọc `ids` từ body: mảng chuỗi không rỗng, bỏ trùng, tối đa RETURN_BULK_MAX.
 * Trả null khi sai dạng hoặc vượt trần — nơi gọi báo 400.
 */
export function parseBulkIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string" || !v.trim()) return null;
    ids.add(v.trim());
  }
  if (ids.size === 0 || ids.size > RETURN_BULK_MAX) return null;
  return [...ids];
}

/** Nhận hàng: chỉ đơn đang Chờ hàng về. */
export const BULK_RECEIVE_FROM: ReturnStatus[] = [ReturnStatus.AWAITING];
/** Nhập kho / Báo hỏng: đơn Chờ hàng về (xử lý tắt) hoặc Đã nhận — cùng luật route xử lý lẻ. */
export const BULK_PROCESS_FROM: ReturnStatus[] = [ReturnStatus.AWAITING, ReturnStatus.RECEIVED];

/** Ghi chú mới nối sau ghi chú cũ (giữ căn cứ đối soát), bỏ phần rỗng. */
export function appendReturnNote(existing: string | null, ...parts: (string | null | undefined)[]): string | null {
  const merged = [existing, ...parts]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  return merged.length > 0 ? merged.join(" · ") : null;
}
