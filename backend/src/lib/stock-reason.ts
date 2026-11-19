/**
 * LÝ DO NHẬP / XUẤT TAY THEO DANH SÁCH — kho chuẩn quốc tế lát 4 (20/11/2026,
 * docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 5.4 + 16; anh Trung 12/11: "Chuẩn quốc tế như thế nào thì
 * em cứ làm như vậy" → danh sách cố định dựng theo Shopify, kèm ô ghi chú tự do).
 *
 * Mã lý do ghi vào `InventoryLog.kind` (cùng cột với RESERVE / SHIP / STOCKTAKE / SET…) để Nhật ký
 * kho gọi đúng tên dòng và báo cáo "Hàng hỏng, mất & chênh kiểm kê" cộng theo lý do. KHÔNG bắt buộc:
 * không gửi mã → dòng ghi như trước (kind NULL) và báo cáo xếp vào "Xuất không ghi lý do" — theo
 * luật "cảnh báo, không khóa cứng", app cũ / mobile chưa cập nhật vẫn nhập xuất bình thường.
 *
 * ⚠️ Bản sao ở frontend: `frontend/src/lib/stock-reason.ts` và `hubsell-mobile/src/lib/stock-reason.ts`
 * — đổi danh sách phải đổi cả ba.
 */
export type StockReasonCode =
  | "RECEIVED"
  | "RETURN_RESTOCK"
  | "OFFLINE_SALE"
  | "DAMAGED"
  | "LOST"
  | "GIFT"
  | "CORRECTION";

export const STOCK_REASONS: Record<"IMPORT" | "EXPORT", { code: StockReasonCode; label: string }[]> = {
  IMPORT: [
    { code: "RECEIVED", label: "Nhập hàng" },
    { code: "RETURN_RESTOCK", label: "Hàng hoàn nhập lại" },
    { code: "CORRECTION", label: "Sửa sai số" },
  ],
  EXPORT: [
    { code: "OFFLINE_SALE", label: "Bán ngoài sàn" },
    { code: "DAMAGED", label: "Hỏng" },
    { code: "LOST", label: "Mất / thất lạc" },
    { code: "GIFT", label: "Tặng / dùng nội bộ" },
    { code: "CORRECTION", label: "Sửa sai số" },
  ],
};

export function stockReasonLabel(type: "IMPORT" | "EXPORT", code: StockReasonCode): string {
  return STOCK_REASONS[type].find((r) => r.code === code)?.label ?? code;
}

/**
 * Đọc `reasonCode` từ body. Không gửi / rỗng → null (không ghi lý do). Mã không thuộc danh sách của
 * chiều nhập / xuất đó → không hợp lệ (vd "Hỏng" trên phiếu NHẬP).
 */
export function parseStockReason(
  type: "IMPORT" | "EXPORT",
  v: unknown
): { ok: true; code: StockReasonCode | null } | { ok: false } {
  if (v === undefined || v === null || v === "") return { ok: true, code: null };
  if (typeof v !== "string") return { ok: false };
  const hit = STOCK_REASONS[type].find((r) => r.code === v);
  return hit ? { ok: true, code: hit.code } : { ok: false };
}

/**
 * Câu "Lý do" ghi vào nhật ký + phiếu kho: có mã thì tên lý do đứng trước, ghi chú tự do theo sau —
 * để cột Lý do đọc đúng ở MỌI màn (kể cả màn chưa biết cột `kind`). Không mã, không ghi chú → câu
 * mặc định cũ của từng cửa ghi.
 */
export function stockReasonText(
  type: "IMPORT" | "EXPORT",
  code: StockReasonCode | null,
  note: string | null | undefined,
  fallback: string
): string {
  const text = (note ?? "").trim();
  if (!code) return text || fallback;
  const label = stockReasonLabel(type, code);
  return text ? `${label} — ${text}` : label;
}

/**
 * CHIP LÝ DO CỦA APP MOBILE BẢN CŨ (tới 1.5.0): app gửi nguyên câu chữ trong `reason`, không có mã.
 * Câu nào trùng đúng một chip cũ thì máy chủ tự suy ra mã — khách chưa cập nhật app vẫn vào đúng
 * nhóm của báo cáo. Câu lý do giữ NGUYÊN VĂN (không chèn tên lý do đằng trước).
 * "Kiểm lại thấy dư / thiếu" là sửa số sau khi đếm lại, không rõ nguyên nhân → "Sửa sai số".
 */
const LEGACY_MOBILE_REASONS: Record<"IMPORT" | "EXPORT", Record<string, StockReasonCode>> = {
  IMPORT: {
    "Nhập hàng mới": "RECEIVED",
    "Kiểm lại thấy dư": "CORRECTION",
    "Khách trả tại shop": "RETURN_RESTOCK",
  },
  EXPORT: {
    "Hàng hỏng": "DAMAGED",
    "Kiểm lại thấy thiếu": "CORRECTION",
    "Bán ngoài sàn": "OFFLINE_SALE",
    "Tặng / dùng nội bộ": "GIFT",
  },
};

/**
 * MỘT CỬA cho hai route nhập / xuất tay: đọc mã lý do + ghi chú từ body → `kind` ghi vào nhật ký và
 * câu "Lý do". Mã gửi lên sai → không hợp lệ. Không gửi mã mà ghi chú trùng chip của app mobile cũ →
 * suy ra mã, giữ nguyên câu.
 */
export function resolveStockReason(
  type: "IMPORT" | "EXPORT",
  rawCode: unknown,
  note: string | null | undefined,
  fallback: string
): { ok: true; kind: StockReasonCode | null; text: string } | { ok: false } {
  const parsed = parseStockReason(type, rawCode);
  if (!parsed.ok) return { ok: false };
  if (parsed.code) return { ok: true, kind: parsed.code, text: stockReasonText(type, parsed.code, note, fallback) };
  const text = (note ?? "").trim();
  const inferred = Object.prototype.hasOwnProperty.call(LEGACY_MOBILE_REASONS[type], text)
    ? LEGACY_MOBILE_REASONS[type][text]!
    : null;
  return { ok: true, kind: inferred, text: text || fallback };
}

/**
 * NHÓM CỦA BÁO CÁO "Hàng hỏng, mất & chênh kiểm kê": mỗi dòng nhật ký tay (không gắn đơn) rơi vào
 * đúng một nhóm theo `kind`; dòng cũ / không ghi lý do (kind NULL) xếp theo `type`.
 *   · Bán ngoài sàn và Nhập hàng KHÔNG nằm trong báo cáo (không phải thất thoát / điều chỉnh).
 */
export const LOSS_GROUPS = [
  { key: "DAMAGED", label: "Hỏng" },
  { key: "LOST", label: "Mất / thất lạc" },
  { key: "GIFT", label: "Tặng / dùng nội bộ" },
  { key: "STOCKTAKE", label: "Chênh kiểm kê" },
  { key: "SET", label: "Sửa số trên bảng / Excel" },
  { key: "CORRECTION", label: "Sửa sai số (nhập / xuất tay)" },
  { key: "ADJUST_OLD", label: "Điều chỉnh chưa phân loại" },
  { key: "EXPORT_NO_REASON", label: "Xuất không ghi lý do" },
] as const;

export type LossGroupKey = (typeof LOSS_GROUPS)[number]["key"];
