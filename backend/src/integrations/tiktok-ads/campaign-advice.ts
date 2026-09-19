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
  /**
   * DỮ KIỆN, mỗi ý một dòng (anh Trung 19/09: viết dồn một đoạn trong ô lý do rất khó đọc — xuống dòng từng nhận định rồi mới kết luận).
   * FE in mỗi phần tử một dòng.
   */
  points: string[];
  /** KẾT LUẬN + việc nên làm — in riêng, sau các dữ kiện. */
  conclusion: string;
  /** points + conclusion nối lại (cho chỗ chỉ cần một chuỗi). */
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

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;

export function campaignAdvice(i: CampaignAdviceInput): CampaignAdvice {
  const budgetUsedPct = i.avgDailySpend != null && i.budget > 0 ? Math.round((i.avgDailySpend / i.budget) * 100) : null;
  const make = (
    kind: CampaignAdviceKind,
    label: string,
    tone: CampaignAdvice["tone"],
    points: string[],
    conclusion: string,
    extra: { keepPer100?: number | null; editInSellerCenter?: boolean } = {}
  ): CampaignAdvice => ({
    kind,
    label,
    tone,
    points,
    conclusion,
    text: [...points, conclusion].filter(Boolean).join(" "),
    budgetUsedPct,
    keepPer100: extra.keepPer100 ?? null,
    editInSellerCenter: extra.editInSellerCenter ?? false,
  });

  if (i.status !== "ongoing") return make("paused", "Đang tạm dừng", "muted", [], "Chiến dịch đang tắt nên không có gì để chẩn đoán.");
  if (!(i.spend > 0)) return make("no_spend", "Chưa tiêu tiền", "muted", [], "Chiến dịch chưa tiêu tiền trong khoảng ngày đang xem.");

  const roi = i.gmv / i.spend;
  const budgetPoint = budgetUsedPct != null ? `Mỗi ngày tiêu khoảng ${budgetUsedPct}% ngân sách (${vnd(i.budget)}).` : "";
  const targetPoint = (reached: boolean) =>
    i.roasTarget != null ? `ROI mục tiêu đang đặt ${num(i.roasTarget)} — ${reached ? "đã đạt" : "chưa đạt"}.` : "Chiến dịch chạy phân phối tối đa (không đặt ROI mục tiêu).";

  const why = i.breakevenProblem ?? breakevenUnusableReason(i.breakeven);
  const be = i.breakeven;
  if (why || !be || be.breakevenRoi == null || be.margin == null) {
    return make(
      "no_breakeven",
      "Chưa kết luận được",
      "muted",
      [`ROI thực ${num(roi)}.`, `Chưa có mốc hòa vốn đủ tin: ${why || "chưa tính được hòa vốn"}.`],
      "Chưa nói được chiến dịch đang lãi hay lỗ. Nhập đủ giá vốn cho sản phẩm của chiến dịch là có kết luận."
    );
  }

  const beRoi = be.breakevenRoi;
  const keep = profitPer100AtRoi(be.margin, roi);
  const roiPoint = `ROI thực ${num(roi)} · hòa vốn ${num(beRoi)}.`;
  const keepPoint = keep != null ? `Mỗi 100đ doanh thu ${keep >= 0 ? "còn lãi" : "lỗ"} khoảng ${num(Math.abs(keep), 1)}đ sau quảng cáo.` : "";
  const reached = i.roasTarget == null || roi >= (i.roasTarget * TARGET_REACHED_PCT) / 100;
  const facts = (...more: string[]) => [roiPoint, keepPoint, ...more].filter(Boolean);

  if (roi < beRoi) {
    const raise = i.roasTarget != null && i.roasTarget < beRoi ? `Nâng ROI mục tiêu lên ít nhất ${num(beRoi)}. ` : "";
    return make(
      "losing",
      "Quảng cáo đang lỗ",
      "warn",
      // Mục tiêu đặt DƯỚI hòa vốn thì "đã đạt mục tiêu" là câu vô nghĩa (đạt mà vẫn lỗ) → nói thẳng nó thấp hơn hòa vốn.
      facts(i.roasTarget != null && i.roasTarget < beRoi ? `ROI mục tiêu đang đặt ${num(i.roasTarget)} — thấp hơn hòa vốn.` : targetPoint(reached)),
      `Quảng cáo đang ăn vào vốn. ${raise}Loại bớt video tiêu tiền mà ROI thấp trong bảng video của chiến dịch (hoặc bật tự động loại).`,
      { keepPer100: keep, editInSellerCenter: true }
    );
  }
  if (i.roasTarget != null && i.roasTarget < beRoi) {
    return make(
      "target_below",
      "Mục tiêu dưới hòa vốn",
      "warn",
      facts(`ROI mục tiêu đang đặt ${num(i.roasTarget)} — thấp hơn hòa vốn.`),
      `Hiện vẫn lãi, nhưng TikTok được phép kéo ROI xuống tới mức mục tiêu, tức là xuống vùng lỗ. Nâng ROI mục tiêu lên ít nhất ${num(beRoi)}.`,
      { keepPer100: keep, editInSellerCenter: true }
    );
  }
  if (budgetUsedPct != null && budgetUsedPct >= BUDGET_USED_PCT && reached) {
    return make(
      "budget_capped",
      "Ngân sách đang chặn",
      "info",
      facts(targetPoint(true), budgetPoint),
      "Chiến dịch đang lãi và gần tiêu hết ngân sách — ngân sách đang là thứ chặn đơn. Tăng ngân sách ngày thì có thêm đơn ở cùng mức lãi.",
      { keepPer100: keep, editInSellerCenter: true }
    );
  }
  if (i.roasTarget != null && !reached && budgetUsedPct != null && budgetUsedPct < BUDGET_USED_PCT) {
    return make(
      "target_binding",
      "Mục tiêu đang bó phân phối",
      "info",
      facts(targetPoint(false), budgetPoint),
      `Đang lãi nhưng tiêu ít: nhiều khả năng mục tiêu cao đang làm TikTok phân phối dè dặt. Hạ ROI mục tiêu thì thêm đơn nhưng lãi mỗi đơn mỏng đi — đừng đặt dưới ${num(beRoi)}.`,
      { keepPer100: keep, editInSellerCenter: true }
    );
  }
  return make("healthy", "Đang lãi", "ok", facts(targetPoint(reached), budgetPoint), "Quảng cáo đang có lãi, chưa thấy gì cần sửa.", { keepPer100: keep });
}

/** Chi tiêu trung bình của những ngày TRỌN có tiêu tiền (bỏ hôm nay — ngày chưa hết). Thuần. */
export function avgDailySpendOf(days: { date: string; expense: number }[], today: string): number | null {
  const full = days.filter((d) => d.date < today && d.expense > 0);
  if (full.length === 0) return null;
  return full.reduce((s, d) => s + d.expense, 0) / full.length;
}
