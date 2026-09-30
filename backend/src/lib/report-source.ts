// ============================================================
// NGUỒN SỐ CỦA BÁO CÁO trong thời gian chuyển sang sổ cái đơn
// (docs/SO-CAI-DON.md mục 9): mỗi báo cáo có hai đường cho cùng kết quả —
//   "ledger": SUM trong database trên sổ cái (mặc định),
//   "orders": đường cũ kéo đơn lên RAM (giữ 1 tuần sau công tắc env).
// ?source= của request thắng env — để so hai đường ngay trên prod.
// ============================================================

export type ReportSource = "ledger" | "orders";

export function resolveReportSource(query: unknown, env: string | undefined): ReportSource {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (q === "orders" || q === "ledger") return q;
  return env === "orders" ? "orders" : "ledger";
}
