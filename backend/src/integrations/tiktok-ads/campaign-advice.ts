// ============================================================
// TIKTOK ADS — CHẨN ĐOÁN MỘT CHIẾN DỊCH GMV MAX (19/09/2026). THUẦN — không DB, không gọi sàn.
//
// Vì sao chỉ GỢI Ý: chiến dịch tạo từ Seller Center không sửa được qua Marketing API (probe 19/09/2026 — 40002 "Shop must belong
// to a Business Center account", ticket #4455484) → Hubsell đưa kết luận + con số, khách tự sửa trong Seller Center.
//
// Mọi kết luận ghép từ SỐ ĐÃ CÓ: ROI mục tiêu + ngân sách ngày (báo cáo sàn), ROI thực + chi tiêu (báo cáo sàn), ROI hòa vốn + biên
// lãi (đơn ĐÃ ĐỐI SOÁT — breakeven.ts). Hai mốc duy nhất không phải số của khách đều lấy từ tài liệu TikTok (tính năng tự tăng
// ngân sách của GMV Max, đọc 19/09/2026: "reached at least 90% of your ROI target and at least 80% of your budget has been used"):
//   · BUDGET_USED_PCT 80  — tiêu từ 80% ngân sách ngày = ngân sách đang là thứ chặn.
//   · TARGET_REACHED_PCT 90 — ROI thực từ 90% mục tiêu = coi như đạt mục tiêu.
// KHÔNG có mốc "mục tiêu cao gấp N lần hòa vốn thì nên hạ" — không có căn cứ nào cho N; chỉ nói dư địa bằng số lãi / 100đ.
// ============================================================

import { breakevenUnusableReason } from "./auto-rules";
import { profitPer100AtRoi, type TiktokBreakeven } from "./breakeven";

export const BUDGET_USED_PCT = 80;
export const TARGET_REACHED_PCT = 90;

export type CampaignAdviceKind =
  | "paused" // chiến dịch đang tắt — không chẩn đoán
  | "no_spend" // chưa tiêu tiền trong khoảng xem
  | "no_breakeven" // chưa có mốc hòa vốn tin được → chưa kết luận lãi / lỗ
  | "losing" // ROI thực dưới hòa vốn
  | "target_below" // đang lãi nhưng ROI mục tiêu đặt dưới hòa vốn
  | "budget_capped" // đạt mục tiêu + tiêu gần hết ngân sách
  | "target_binding" // lãi, chưa đạt mục tiêu, tiêu ít ngân sách → mục tiêu đang bó phân phối
  | "healthy";

export interface CampaignAdviceInput {
  status: string;
  roasTarget: number | null;
  /** Ngân sách ngày; 0 = không rõ / không giới hạn. */
  budget: number;
  breakeven: TiktokBreakeven | null;
  /**
   * Vì sao hòa vốn CHƯA tin được ("" = tin được). Bỏ trống → xét theo luật của hòa vốn CHIẾN DỊCH (breakevenUnusableReason). Tab Hòa
   * vốn sản phẩm truyền vào kết luận của chính dòng sản phẩm (hòa vốn nguồn "product" có bộ điều kiện riêng: đủ đơn, đủ giá vốn).
   */
  breakevenProblem?: string;
  /** Chi tiêu + doanh thu sàn báo trong khoảng xem. */
  spend: number;
  gmv: number;
  /** Chi tiêu trung bình của những NGÀY TRỌN có tiêu tiền trong khoảng xem (không tính hôm nay); null = chưa có ngày nào. */
  avgDailySpend: number | null;
}

export interface CampaignAdvice {
  kind: CampaignAdviceKind;
  /** Nhãn ngắn của kết luận. */
  label: string;
  /** Lý do + việc nên làm, có số. */
  text: string;
  /** warn = đang mất tiền / sắp mất tiền; info = có việc đáng cân nhắc; ok = ổn; muted = chưa kết luận được. */
  tone: "warn" | "info" | "ok" | "muted";
  /** % ngân sách ngày đang dùng (trung bình ngày có tiêu tiền); null = không tính được. */
  budgetUsedPct: number | null;
  /** Lãi sau quảng cáo trên mỗi 100đ doanh thu ở ROI THỰC; null = chưa có hòa vốn tin được. */
  keepPer100: number | null;
  /** Có nên đưa đường tới Seller Center (kết luận kéo theo việc sửa chiến dịch). */
  editInSellerCenter: boolean;
}

const num = (n: number, d = 2) => n.toLocaleString("vi-VN", { maximumFractionDigits: d });

export function campaignAdvice(i: CampaignAdviceInput): CampaignAdvice {
  const budgetUsedPct = i.avgDailySpend != null && i.budget > 0 ? Math.round((i.avgDailySpend / i.budget) * 100) : null;
  const base = { budgetUsedPct, keepPer100: null as number | null, editInSellerCenter: false };

  if (i.status !== "ongoing") return { ...base, kind: "paused", label: "Đang tạm dừng", tone: "muted", text: "Chiến dịch đang tắt nên không có gì để chẩn đoán." };
  if (!(i.spend > 0)) return { ...base, kind: "no_spend", label: "Chưa tiêu tiền", tone: "muted", text: "Chiến dịch chưa tiêu tiền trong khoảng ngày đang xem." };

  const why = i.breakevenProblem ?? breakevenUnusableReason(i.breakeven);
  const be = i.breakeven;
  if (why || !be || be.breakevenRoi == null || be.margin == null) {
    return {
      ...base,
      kind: "no_breakeven",
      label: "Chưa kết luận được",
      tone: "muted",
      text: `Chưa có mốc hòa vốn đủ tin (${why || "chưa tính được hòa vốn"}) nên chưa nói được chiến dịch đang lãi hay lỗ. Nhập đủ giá vốn cho sản phẩm của chiến dịch là có kết luận.`,
    };
  }

  const roi = i.gmv / i.spend;
  const beRoi = be.breakevenRoi;
  const keep = profitPer100AtRoi(be.margin, roi);
  const out = { ...base, keepPer100: keep };
  const keepTxt = keep != null ? `mỗi 100đ doanh thu ${keep >= 0 ? "còn lãi" : "lỗ"} khoảng ${num(Math.abs(keep), 1)}đ sau quảng cáo` : "";

  if (roi < beRoi) {
    const raise = i.roasTarget != null && i.roasTarget < beRoi ? ` ROI mục tiêu đang đặt ${num(i.roasTarget)} — nâng lên ít nhất ${num(beRoi)}.` : "";
    return {
      ...out,
      kind: "losing",
      label: "Quảng cáo đang lỗ",
      tone: "warn",
      editInSellerCenter: true,
      text: `ROI thực ${num(roi)} thấp hơn hòa vốn ${num(beRoi)}: ${keepTxt}.${raise} Loại bớt video tiêu tiền mà ROI thấp trong bảng video của chiến dịch (hoặc bật tự động loại).`,
    };
  }
  if (i.roasTarget != null && i.roasTarget < beRoi) {
    return {
      ...out,
      kind: "target_below",
      label: "Mục tiêu dưới hòa vốn",
      tone: "warn",
      editInSellerCenter: true,
      text: `Hiện ROI thực ${num(roi)} vẫn trên hòa vốn ${num(beRoi)}, nhưng ROI mục tiêu đang đặt ${num(i.roasTarget)} — TikTok được phép kéo ROI xuống tới mức đó, tức là xuống vùng lỗ. Nâng ROI mục tiêu lên ít nhất ${num(beRoi)}.`,
    };
  }

  const reached = i.roasTarget == null || roi >= (i.roasTarget * TARGET_REACHED_PCT) / 100;
  if (budgetUsedPct != null && budgetUsedPct >= BUDGET_USED_PCT && reached) {
    return {
      ...out,
      kind: "budget_capped",
      label: "Ngân sách đang chặn",
      tone: "info",
      editInSellerCenter: true,
      text: `Chiến dịch đang lãi (ROI thực ${num(roi)}, hòa vốn ${num(beRoi)}: ${keepTxt}) và mỗi ngày tiêu khoảng ${budgetUsedPct}% ngân sách — ngân sách đang là thứ chặn đơn. Tăng ngân sách ngày thì có thêm đơn ở cùng mức lãi.`,
    };
  }
  if (i.roasTarget != null && !reached && budgetUsedPct != null && budgetUsedPct < BUDGET_USED_PCT) {
    return {
      ...out,
      kind: "target_binding",
      label: "Mục tiêu đang bó phân phối",
      tone: "info",
      editInSellerCenter: true,
      text: `Chiến dịch đang lãi (ROI thực ${num(roi)}, hòa vốn ${num(beRoi)}: ${keepTxt}) nhưng chưa đạt ROI mục tiêu ${num(i.roasTarget)} và mỗi ngày mới tiêu khoảng ${budgetUsedPct}% ngân sách — nhiều khả năng mục tiêu cao đang làm TikTok phân phối dè dặt. Hạ ROI mục tiêu thì thêm đơn nhưng lãi mỗi đơn mỏng đi; đừng đặt dưới ${num(beRoi)}.`,
    };
  }
  return {
    ...out,
    kind: "healthy",
    label: "Đang lãi",
    tone: "ok",
    text: `ROI thực ${num(roi)} trên hòa vốn ${num(beRoi)}: ${keepTxt}.${budgetUsedPct != null ? ` Mỗi ngày tiêu khoảng ${budgetUsedPct}% ngân sách.` : ""}`,
  };
}

/** Chi tiêu trung bình của những ngày TRỌN có tiêu tiền (bỏ hôm nay — ngày chưa hết). Thuần. */
export function avgDailySpendOf(days: { date: string; expense: number }[], today: string): number | null {
  const full = days.filter((d) => d.date < today && d.expense > 0);
  if (full.length === 0) return null;
  return full.reduce((s, d) => s + d.expense, 0) / full.length;
}
