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

// ------------------------------------------------------------
// Biên lãi quảng cáo Shopee/Lazada (docs/QUANG-CAO-GOM-TRONG-DATABASE.md):
//   "sql" : GROUP BY trên sổ dòng hàng trong database (mặc định),
//   "rows": đường lui — giữ đơn của cửa sổ trong RAM rồi duyệt.
// ------------------------------------------------------------

/** Nơi cộng biên lãi của Trợ lý quảng cáo Shopee/Lazada. */
export type AdsMarginSource = "rows" | "sql";

/**
 * Mặc định `sql` (gom trong database) từ 30/09/2026 tối, sau khi 20/20 gian
 * Shopee/Lazada trên prod khớp ở cả hai tầng so. Env ADS_MARGIN_SOURCE=rows lui
 * về đường duyệt mảng đơn — giữ một tuần (gỡ ~07/10). Khi báo cáo đã lui về đơn
 * gốc (LEDGER_REPORTS_SOURCE=orders) thì sổ cái không còn là nguồn số → luôn `rows`.
 */
export function resolveAdsMarginSource(
  env: string | undefined = process.env.ADS_MARGIN_SOURCE,
  reportsEnv: string | undefined = process.env.LEDGER_REPORTS_SOURCE
): AdsMarginSource {
  if (resolveReportSource(undefined, reportsEnv) === "orders") return "rows";
  return env?.trim().toLowerCase() === "rows" ? "rows" : "sql";
}

// ------------------------------------------------------------
// Hòa vốn quảng cáo TikTok (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 12) —
// công tắc RIÊNG với Shopee/Lazada để lỗi hoặc lui đường của khối này không kéo
// theo khối kia:
//   "sql" : GROUP BY trên sổ dòng hàng trong database (mặc định),
//   "rows": đường lui — giữ đơn 60 ngày của gian trong RAM rồi duyệt.
// ------------------------------------------------------------

/** Nơi cộng nguyên liệu hòa vốn của Trợ lý quảng cáo TikTok. */
export type TiktokBreakevenSource = "rows" | "sql";

/**
 * Mặc định `sql` (gom trong database) từ 30/09/2026 đêm, sau khi 11/11 gian
 * TikTok trên prod khớp ở cả hai tầng so (`ads-compare --platform TIKTOK`). Env
 * TIKTOK_BREAKEVEN_SOURCE=rows lui về đường duyệt mảng đơn — giữ một tuần (gỡ
 * ~07/10). Khi báo cáo đã lui về đơn gốc (LEDGER_REPORTS_SOURCE=orders) thì sổ
 * cái không còn là nguồn số → luôn `rows`.
 */
export function resolveTiktokBreakevenSource(
  env: string | undefined = process.env.TIKTOK_BREAKEVEN_SOURCE,
  reportsEnv: string | undefined = process.env.LEDGER_REPORTS_SOURCE
): TiktokBreakevenSource {
  if (resolveReportSource(undefined, reportsEnv) === "orders") return "rows";
  return env?.trim().toLowerCase() === "rows" ? "rows" : "sql";
}
