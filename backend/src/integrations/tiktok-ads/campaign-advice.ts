// ============================================================
// TIKTOK ADS — CHẨN ĐOÁN MỘT CHIẾN DỊCH GMV MAX (19/09/2026). THUẦN — không DB, không gọi sàn.
//
// Vì sao chỉ GỢI Ý: chiến dịch tạo từ Seller Center không sửa được qua Marketing API (probe 19/09/2026 — 40002 "Shop must belong
// to a Business Center account", ticket #4455484) → Hubsell đưa kết luận + con số, khách tự sửa trong Seller Center.
//
// Mọi kết luận ghép từ SỐ ĐÃ CÓ: ROI mục tiêu + ngân sách ngày (báo cáo sàn), ROI thực + chi tiêu (báo cáo sàn), ROI hòa vốn + biên
// lãi (đơn ĐÃ ĐỐI SOÁT — breakeven.ts). Hai mốc không phải số của khách lấy từ tài liệu TikTok (tính năng tự tăng ngân sách của
// GMV Max, đọc 19/09/2026: "reached at least 90% of your ROI target and at least 80% of your budget has been used"):
//   · BUDGET_USED_PCT 80  — tiêu từ 80% ngân sách ngày = ngân sách đang là thứ chặn.
//   · TARGET_REACHED_PCT 90 — ROI thực từ 90% mục tiêu = coi như đạt mục tiêu (chỉ dùng cho kết luận "ngân sách chặn").
//
// HẠ ROI MỤC TIÊU ĐI TỪNG NẤC (anh Trung 08/10/2026, cùng luật với Shopee chốt 04/10): "hạ mục tiêu" không phải một phát về sát
// sàn — mỗi lần hạ TARGET_STEP_PCT (10%), rồi để TikTok chạy đủ TARGET_STEP_WAIT_HOURS mới xét nấc kế. Mốc đổi =
// AdsCampaign.roasTargetChangedAt (đồng bộ thấy roas_bid trên sàn khác số đang lưu — khách sửa trong Seller Center; Hubsell không
// sửa được chiến dịch GMV Max qua API). NÂNG mục tiêu lên hòa vốn khi đang đặt dưới hòa vốn thì vẫn một phát: đó là chặn lỗ.
//
// SÀN HẠ TỚI + VẠCH "MỤC TIÊU ĐANG GHÌM" (anh Trung 08/10/2026 chiều, ca ANO: ROI thực 13,84 / mục tiêu 15 / hòa vốn 5,58 / tiêu 12%
// ngân sách mà máy nói "chưa thấy gì cần sửa" chỉ vì ROI đã ≥ 90% mục tiêu — bản 19/09 chỉ khuyên hạ khi CHƯA đạt):
//   · Sàn = profitFloorRoas(biên, lãi mong muốn/100đ) — giữ được mức lãi khách muốn sau quảng cáo (mặc định 5đ/100đ, khách sửa);
//     không thấp hơn hòa vốn. Căn cứ + nguồn xem đầu mục trong shopee/ads-assistant-rules.ts.
//   · Mục tiêu đang ghìm khi ROI thực < mục tiêu × TARGET_BINDING_BAND (1,1) và ngân sách còn dư — kể cả đã đạt mục tiêu
//     (TikTok: "Lower ROI targets boost delivery and GMV, while higher targets may limit spend").
//   · ROI vượt mục tiêu quá 10% mà vẫn tiêu ít → mục tiêu không phải thứ chặn, hạ không giúp; thứ chặn nằm ở video / sản phẩm.
//   · Sau mỗi nấc hạ: so lãi tuyệt đối 2 ngày trọn trước / sau (stepProfitCheck). Không tăng → GIỮ, không hạ tiếp.
// ============================================================

import { breakevenUnusableReason } from "./auto-rules";
import { TIKTOK_TARGET_STEP_WAIT_HOURS, type TiktokBreakeven } from "../../lib/tiktok-breakeven";
import { profitPer100AtRoi } from "./breakeven";
import {
  DEFAULT_MIN_KEEP_PER_100,
  TARGET_BINDING_BAND,
  TARGET_STEP_PCT,
  profitFloorRoas,
  type StepProfitCheck,
} from "../shopee/ads-assistant-rules";

export const BUDGET_USED_PCT = 80;
export const TARGET_REACHED_PCT = 90;
/** 72 giờ — căn cứ TikTok "keep each ROI setting for at least three full days" (xem lib/tiktok-breakeven.ts). */
export const TARGET_STEP_WAIT_HOURS = TIKTOK_TARGET_STEP_WAIT_HOURS;
export { TARGET_STEP_PCT, TARGET_BINDING_BAND, DEFAULT_MIN_KEEP_PER_100 };

/** Nấc hạ kế tiếp của ROI mục tiêu: giảm TARGET_STEP_PCT, 1 số lẻ, không thủng sàn. null = đã sát sàn. */
export function nextRoiTargetStep(target: number, floor: number): number | null {
  const stepped = Math.round(target * (1 - TARGET_STEP_PCT) * 10) / 10;
  const next = Math.max(stepped, floor);
  return next < target ? next : null;
}

/** Số giờ còn phải theo dõi sau lần đổi mục tiêu gần nhất (0 = hết khóa / chưa từng đổi). */
export function targetWatchHoursLeft(changedAt: Date | null | undefined, now: Date): number {
  if (!changedAt) return 0;
  const left = TARGET_STEP_WAIT_HOURS - (now.getTime() - changedAt.getTime()) / 3_600_000;
  return left > 0 ? Math.ceil(left) : 0;
}

export type CampaignAdviceKind =
  | "paused" // chiến dịch đang tắt — không chẩn đoán
  | "no_spend" // chưa tiêu tiền trong khoảng xem
  | "no_breakeven" // chưa có mốc hòa vốn tin được → chưa kết luận lãi / lỗ
  | "losing" // ROI thực dưới hòa vốn
  | "target_below" // đang lãi nhưng ROI mục tiêu đặt dưới hòa vốn
  | "budget_capped" // đạt mục tiêu + tiêu gần hết ngân sách
  | "target_binding" // lãi, ROI bám mục tiêu, tiêu ít ngân sách → mục tiêu đang ghìm phân phối, còn nấc để hạ
  | "target_watching" // như target_binding nhưng mục tiêu vừa đổi < TARGET_STEP_WAIT_HOURS → giữ nguyên, theo dõi
  | "target_hold" // nấc hạ gần nhất không ra thêm lãi → giữ mục tiêu, không hạ tiếp
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
  /** Lần gần nhất Hubsell thấy ROI mục tiêu đổi (AdsCampaign.roasTargetChangedAt); còn trong khóa thì không gợi ý hạ tiếp. */
  roasTargetChangedAt?: Date | null;
  /** Lãi tối thiểu muốn giữ sau quảng cáo (đ / 100đ doanh thu) — cấu hình gian; bỏ trống = mặc định. */
  minKeepPer100?: number;
  /** So lãi tuyệt đối trước / sau nấc hạ gần nhất (stepProfitCheck của shopee/ads-assistant-rules). */
  stepCheck?: StepProfitCheck | null;
  /** Mốc "bây giờ" (test truyền vào). */
  now?: Date;
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
  /** target_binding: nấc ROI mục tiêu nên hạ xuống (giảm 10%, không dưới sàn an toàn); null = kết luận khác. */
  nextTarget: number | null;
  /** target_binding: lãi / 100đ doanh thu nếu ROI thực về đúng nextTarget. */
  keepAtNextTarget: number | null;
  /** Sàn không hạ mục tiêu xuống dưới (giữ lãi mong muốn, không dưới hòa vốn); null khi chưa có hòa vốn hoặc biên không đủ. */
  safeTarget: number | null;
  /** Lãi mong muốn / 100đ đã dùng để tính safeTarget. */
  minKeepPer100: number;
  /** target_watching: còn bao nhiêu giờ phải theo dõi sau lần đổi mục tiêu gần nhất; null = không trong khóa. */
  watchHoursLeft: number | null;
}

const num = (n: number, d = 2) => n.toLocaleString("vi-VN", { maximumFractionDigits: d });

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;

export function campaignAdvice(i: CampaignAdviceInput): CampaignAdvice {
  const budgetUsedPct = i.avgDailySpend != null && i.budget > 0 ? Math.round((i.avgDailySpend / i.budget) * 100) : null;
  const minKeepPer100 = i.minKeepPer100 ?? DEFAULT_MIN_KEEP_PER_100;
  const make = (
    kind: CampaignAdviceKind,
    label: string,
    tone: CampaignAdvice["tone"],
    points: string[],
    conclusion: string,
    extra: {
      keepPer100?: number | null;
      editInSellerCenter?: boolean;
      nextTarget?: number | null;
      keepAtNextTarget?: number | null;
      safeTarget?: number | null;
      watchHoursLeft?: number | null;
    } = {}
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
    nextTarget: extra.nextTarget ?? null,
    keepAtNextTarget: extra.keepAtNextTarget ?? null,
    safeTarget: extra.safeTarget ?? null,
    minKeepPer100,
    watchHoursLeft: extra.watchHoursLeft ?? null,
  });

  if (i.status !== "ongoing") return make("paused", "Đang tạm dừng", "muted", [], "Chiến dịch đang tắt nên không có gì để chẩn đoán.");
  if (!(i.spend > 0)) return make("no_spend", "Chưa tiêu tiền", "muted", [], "Chiến dịch chưa tiêu tiền trong khoảng ngày đang xem.");

  const roi = i.gmv / i.spend;
  const budgetPoint = budgetUsedPct != null ? `Mỗi ngày tiêu khoảng ${budgetUsedPct}% ngân sách (${vnd(i.budget)}).` : "";
  // "Đã đạt" chỉ khi ROI thực ≥ mục tiêu; từ 90% tới dưới mục tiêu nói "gần đạt" (13,84 so với 15 mà ghi "đã đạt" gây hiểu lầm — 08/10).
  const targetPoint = () => {
    if (i.roasTarget == null) return "Chiến dịch chạy phân phối tối đa (không đặt ROI mục tiêu).";
    const word = roi >= i.roasTarget ? "đã đạt" : roi >= (i.roasTarget * TARGET_REACHED_PCT) / 100 ? `gần đạt (từ ${TARGET_REACHED_PCT}%)` : "chưa đạt";
    return `ROI mục tiêu đang đặt ${num(i.roasTarget)} — ${word}.`;
  };

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
  const margin = be.margin;
  const keep = profitPer100AtRoi(margin, roi);
  const roiPoint = `ROI thực ${num(roi)} · hòa vốn ${num(beRoi)}.`;
  const keepPoint = keep != null ? `Mỗi 100đ doanh thu ${keep >= 0 ? "còn lãi" : "lỗ"} khoảng ${num(Math.abs(keep), 1)}đ sau quảng cáo.` : "";
  const reached = i.roasTarget == null || roi >= (i.roasTarget * TARGET_REACHED_PCT) / 100;
  const facts = (...more: string[]) => [roiPoint, keepPoint, ...more].filter(Boolean);
  // Sàn an toàn: giữ lãi mong muốn, không dưới hòa vốn. null = biên không đủ cho mức lãi mong muốn.
  const profitFloor = profitFloorRoas(margin, minKeepPer100);
  const safeTarget = profitFloor != null ? Math.max(profitFloor, Math.ceil(beRoi * 10 - 1e-9) / 10) : null;

  if (roi < beRoi) {
    const raise = i.roasTarget != null && i.roasTarget < beRoi ? `Nâng ROI mục tiêu lên ít nhất ${num(beRoi)}. ` : "";
    return make(
      "losing",
      "Quảng cáo đang lỗ",
      "warn",
      // Mục tiêu đặt DƯỚI hòa vốn thì "đã đạt mục tiêu" là câu vô nghĩa (đạt mà vẫn lỗ) → nói thẳng nó thấp hơn hòa vốn.
      facts(i.roasTarget != null && i.roasTarget < beRoi ? `ROI mục tiêu đang đặt ${num(i.roasTarget)} — thấp hơn hòa vốn.` : targetPoint()),
      `Quảng cáo đang ăn vào vốn. ${raise}Loại bớt video tiêu tiền mà ROI thấp trong bảng video của chiến dịch (hoặc bật tự động loại).`,
      { keepPer100: keep, editInSellerCenter: true, safeTarget }
    );
  }
  if (i.roasTarget != null && i.roasTarget < beRoi) {
    return make(
      "target_below",
      "Mục tiêu dưới hòa vốn",
      "warn",
      facts(`ROI mục tiêu đang đặt ${num(i.roasTarget)} — thấp hơn hòa vốn.`),
      `Hiện vẫn lãi, nhưng TikTok được phép kéo ROI xuống tới mức mục tiêu, tức là xuống vùng lỗ. Nâng ROI mục tiêu lên ít nhất ${num(beRoi)}.`,
      { keepPer100: keep, editInSellerCenter: true, safeTarget }
    );
  }
  if (budgetUsedPct != null && budgetUsedPct >= BUDGET_USED_PCT && reached) {
    return make(
      "budget_capped",
      "Ngân sách đang chặn",
      "info",
      facts(targetPoint(), budgetPoint),
      "Chiến dịch đang lãi và gần tiêu hết ngân sách — ngân sách đang là thứ chặn đơn. Tăng ngân sách ngày thì có thêm đơn ở cùng mức lãi.",
      { keepPer100: keep, editInSellerCenter: true, safeTarget }
    );
  }
  if (i.roasTarget != null && budgetUsedPct != null && budgetUsedPct < BUDGET_USED_PCT) {
    const ok = { keepPer100: keep, safeTarget };
    // ROI vượt mục tiêu quá 10% mà vẫn tiêu ít: mục tiêu không phải thứ ghìm — hạ nữa cũng không thêm phân phối.
    if (roi >= i.roasTarget * TARGET_BINDING_BAND) {
      return make(
        "healthy",
        "Đang lãi",
        "ok",
        facts(targetPoint(), budgetPoint, "ROI thực vượt mục tiêu khá xa mà vẫn tiêu ít: mục tiêu không phải thứ đang chặn."),
        "Hạ ROI mục tiêu lúc này không thêm được phân phối. Muốn thêm đơn thì thêm video / sản phẩm vào chiến dịch.",
        { ...ok, editInSellerCenter: true }
      );
    }
    const bindingFacts = facts(targetPoint(), budgetPoint, "Đang lãi nhưng tiêu ít: ROI bám sát mục tiêu nên mục tiêu đang ghìm TikTok phân phối dè dặt.");
    // Khóa cứng giữa hai nấc: mục tiêu vừa đổi thì để TikTok chạy đủ TARGET_STEP_WAIT_HOURS rồi mới xét hạ tiếp.
    const hoursLeft = targetWatchHoursLeft(i.roasTargetChangedAt, i.now ?? new Date());
    if (hoursLeft > 0) {
      return make(
        "target_watching",
        "Theo dõi sau đổi mục tiêu",
        "ok",
        bindingFacts,
        `Mục tiêu vừa đổi chưa đủ ${TARGET_STEP_WAIT_HOURS} giờ — TikTok còn đang học lại. Giữ nguyên, còn khoảng ${hoursLeft} giờ nữa mới xét hạ nấc tiếp.`,
        { ...ok, watchHoursLeft: hoursLeft }
      );
    }
    // Nấc hạ gần nhất không ra thêm lãi tuyệt đối → giữ, không hạ tiếp.
    const sc = i.stepCheck;
    if (sc?.flat) {
      return make(
        "target_hold",
        "Giữ mục tiêu",
        "ok",
        facts(targetPoint(), budgetPoint, `Sau nấc hạ gần nhất (${sc.changedOn}): lãi ${sc.days} ngày sau ${vnd(sc.after)}, ${sc.days} ngày trước ${vnd(sc.before)}.`),
        "Hạ mục tiêu không ra thêm lãi — đã tới mức phân phối thêm chỉ thêm chi phí. Giữ ROI mục tiêu hiện tại.",
        ok
      );
    }
    if (safeTarget == null) {
      return make(
        "healthy",
        "Đang lãi",
        "ok",
        bindingFacts,
        `Biên lãi ${num(margin * 100, 1)}% không đủ cho mức lãi mong muốn ${minKeepPer100}đ/100đ nên không có mức hạ an toàn. Giữ mục tiêu; muốn hạ thì giảm mức lãi mong muốn trong cấu hình.`,
        ok
      );
    }
    const nextTarget = nextRoiTargetStep(i.roasTarget, safeTarget);
    if (nextTarget == null) {
      return make(
        "healthy",
        "Đang lãi",
        "ok",
        bindingFacts,
        `ROI mục tiêu đã sát mức an toàn ${num(safeTarget)} (giữ lãi từ ${minKeepPer100}đ/100đ), không còn nấc để hạ. Giữ nguyên.`,
        ok
      );
    }
    const keepAtNextTarget = profitPer100AtRoi(margin, nextTarget);
    return make(
      "target_binding",
      "Mục tiêu đang ghìm phân phối",
      "info",
      bindingFacts,
      `Giảm ROI mục tiêu một nấc, từ ${num(i.roasTarget)} xuống ${num(nextTarget)}, rồi theo dõi ${TARGET_STEP_WAIT_HOURS} giờ mới giảm tiếp.` +
        (keepAtNextTarget != null ? ` Ở ${num(nextTarget)} mỗi 100đ doanh thu còn lãi khoảng ${num(keepAtNextTarget, 1)}đ.` : "") +
        ` Không xuống dưới ${num(safeTarget)} (giữ lãi từ ${minKeepPer100}đ/100đ).`,
      { ...ok, editInSellerCenter: true, nextTarget, keepAtNextTarget }
    );
  }
  return make("healthy", "Đang lãi", "ok", facts(targetPoint(), budgetPoint), "Quảng cáo đang có lãi, chưa thấy gì cần sửa.", { keepPer100: keep, safeTarget });
}

/** Chi tiêu trung bình của những ngày TRỌN có tiêu tiền (bỏ hôm nay — ngày chưa hết). Thuần. */
export function avgDailySpendOf(days: { date: string; expense: number }[], today: string): number | null {
  const full = days.filter((d) => d.date < today && d.expense > 0);
  if (full.length === 0) return null;
  return full.reduce((s, d) => s + d.expense, 0) / full.length;
}
