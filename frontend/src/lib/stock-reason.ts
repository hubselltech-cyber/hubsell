/**
 * LÝ DO NHẬP / XUẤT TAY THEO DANH SÁCH — kho chuẩn quốc tế lát 4 (20/11/2026,
 * docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 5.4 + 16). Danh sách cố định dựng theo Shopify, kèm ô ghi chú.
 *
 * ⚠️ Bản sao của `backend/src/lib/stock-reason.ts` (máy chủ là bên kiểm) và
 * `hubsell-mobile/src/lib/stock-reason.ts` — đổi danh sách phải đổi cả ba.
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

/**
 * Lý do chọn sẵn khi mở hộp: NHẬP = "Nhập hàng" (gần như mọi lần nhập); XUẤT để trống — chọn sẵn một
 * lý do xuất là đoán thay người làm, đoán sai thì báo cáo hàng hỏng / mất sai theo.
 */
export function defaultStockReason(type: "IMPORT" | "EXPORT"): StockReasonCode | "" {
  return type === "IMPORT" ? "RECEIVED" : "";
}
