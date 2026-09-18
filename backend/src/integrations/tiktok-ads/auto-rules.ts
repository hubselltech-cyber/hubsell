// ============================================================
// TIKTOK ADS — LUẬT LOẠI VIDEO TỰ ĐỘNG (thuần, không đụng DB / sàn)
//
// Bài toán: GMV Max tự rải tiền thử hàng trăm video; video kém cứ ngốn tiền
// tới khi chủ shop mở Seller Center loại tay. Hubsell chấm từng video mỗi ngày
// một lần (sau 12h trưa — chi phí video của TikTok về trễ tới 11 giờ) trên
// một CỬA SỔ NGÀY kết thúc HÔM QUA, rồi loại (hoặc chỉ ghi sổ khi diễn tập).
//
// Nguyên tắc anh Trung chốt 18/09/2026:
//   · Cấu hình THEO TỪNG CHIẾN DỊCH (AutoRuleConfig), không có bộ chung theo gian.
//   · Video TikTok còn ĐANG HỌC (LEARNING / IN_QUEUE) thì KHÔNG động tới.
//   · Đồng hồ luật tính từ ngày TikTok HỌC XONG video (mốc "ra trường" do lượt
//     theo dõi hằng ngày ghi lại) — số liệu đưa vào đây đã được người gọi cắt
//     theo mốc đó; hàm này chỉ nhận số của cửa sổ hiệu lực.
//   · Không có luật "đột biến trong N giờ": tầng video không có số theo giờ.
//
// Thứ tự chấm một video (assessVideo):
//   1. learning      — sàn còn học → bỏ qua.
//   2. protected     — chủ shop vừa khôi phục tay (≤30 ngày) → chỉ gắn cờ, máy không loại lại.
//   3. insufficient  — tiêu dưới sàn dữ liệu → chưa phán.
//   4. vi phạm CỨNG  — tiêu ≥ ngưỡng mà 0 đơn / ROI < mục tiêu × tỷ lệ cứng / CPA > trần
//        · video công thần (đủ đơn 30 ngày) → grace cho tới khi vi phạm đủ số ngày liên tục → exclude
//        · còn lại → exclude
//   5. flag          — có đơn, ROI dưới mục tiêu nhưng chưa tới mức cứng → chỉ gắn cờ.
//   6. healthy.
// Sau đó planAutoExclusion áp hai chốt an toàn cấp chiến dịch: trần số video
// loại mỗi ngày (ưu tiên tốn tiền nhất) và giữ lại tối thiểu N video còn ra đơn.
// ============================================================

export type AutoRuleMode = "off" | "dry_run" | "live";
export const AUTO_RULE_MODES: AutoRuleMode[] = ["off", "dry_run", "live"];

export interface AutoRuleConfig {
  roiTarget: number;
  windowDays: number;
  minSpend: number;
  spendNoOrder: number;
  roiHardPct: number;
  maxCpa: number | null;
  graceMinOrders: number;
  graceDays: number;
  maxExcludePerDay: number;
  minOrderingVideosKeep: number;
}

/** Số mặc định khi chiến dịch chưa có cấu hình (roiTarget lấy từ roasTarget của campaign nếu có). */
export const AUTO_RULE_DEFAULTS: AutoRuleConfig = {
  roiTarget: 10,
  windowDays: 7,
  minSpend: 50_000,
  spendNoOrder: 200_000,
  roiHardPct: 50,
  maxCpa: null,
  graceMinOrders: 20,
  graceDays: 2,
  maxExcludePerDay: 10,
  minOrderingVideosKeep: 3,
};

export const AUTO_RULE_LIMITS = {
  windowDays: { min: 3, max: 30 },
  roiHardPct: { min: 10, max: 95 },
  graceDays: { min: 1, max: 14 },
  maxExcludePerDay: { min: 1, max: 100 },
  minOrderingVideosKeep: { min: 0, max: 50 },
} as const;

/** Khách khôi phục tay thì máy không loại lại video đó trong chừng này ngày. */
export const RESTORE_PROTECT_DAYS = 30;

/** Ép một object bất kỳ (body request) về cấu hình hợp lệ; sai kiểu → lấy số hiện có / mặc định. */
export function sanitizeAutoRuleConfig(raw: Record<string, unknown>, base: AutoRuleConfig = AUTO_RULE_DEFAULTS): AutoRuleConfig {
  const num = (k: keyof AutoRuleConfig, fallback: number): number => {
    const n = Number(raw[k]);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const clamp = (v: number, lim: { min: number; max: number }) => Math.min(lim.max, Math.max(lim.min, Math.trunc(v)));
  const maxCpaRaw = raw.maxCpa;
  const maxCpa =
    maxCpaRaw == null || maxCpaRaw === "" ? null : Number.isFinite(Number(maxCpaRaw)) && Number(maxCpaRaw) > 0 ? Number(maxCpaRaw) : base.maxCpa;
  return {
    roiTarget: Math.max(0.1, num("roiTarget", base.roiTarget)),
    windowDays: clamp(num("windowDays", base.windowDays), AUTO_RULE_LIMITS.windowDays),
    minSpend: Math.round(num("minSpend", base.minSpend)),
    spendNoOrder: Math.round(num("spendNoOrder", base.spendNoOrder)),
    roiHardPct: clamp(num("roiHardPct", base.roiHardPct), AUTO_RULE_LIMITS.roiHardPct),
    maxCpa,
    graceMinOrders: Math.max(0, Math.trunc(num("graceMinOrders", base.graceMinOrders))),
    graceDays: clamp(num("graceDays", base.graceDays), AUTO_RULE_LIMITS.graceDays),
    maxExcludePerDay: clamp(num("maxExcludePerDay", base.maxExcludePerDay), AUTO_RULE_LIMITS.maxExcludePerDay),
    minOrderingVideosKeep: clamp(num("minOrderingVideosKeep", base.minOrderingVideosKeep), AUTO_RULE_LIMITS.minOrderingVideosKeep),
  };
}

/** Một video đưa vào chấm — số liệu ĐÃ cắt theo cửa sổ hiệu lực (từ ngày ra trường nếu có). */
export interface AutoVideoInput {
  videoId: string;
  spuId: string;
  /** Trạng thái sàn: DELIVERING | LEARNING | IN_QUEUE (video EXCLUDED không đưa vào). */
  deliveryStatus: string;
  cost: number;
  orders: number;
  gmv: number;
  /** Số đơn 30 ngày gần nhất — để nhận diện công thần. */
  orders30d: number;
  /** Số ngày dữ liệu thật của cửa sổ (video mới ra trường 2 ngày thì 2). */
  windowDaysUsed: number;
  /** Trạng thái theo dõi đã lưu; thiếu = video mới thấy lần đầu. */
  watch?: {
    violationSince: string;
    restoredByUserAt: Date | null;
  };
}

export type AutoVerdict = "learning" | "protected" | "insufficient" | "exclude" | "grace" | "flag" | "healthy";

export const AUTO_VERDICT_LABEL: Record<AutoVerdict, string> = {
  learning: "Đang học",
  protected: "Khách đã khôi phục",
  insufficient: "Chưa đủ dữ liệu",
  exclude: "Sẽ loại",
  grace: "Ân hạn",
  flag: "Cần xem",
  healthy: "Ổn",
};

export interface AutoAssessment {
  videoId: string;
  spuId: string;
  verdict: AutoVerdict;
  /** Một câu căn cứ, đủ để ghi sổ và hiện lên UI. */
  reason: string;
  cost: number;
  orders: number;
  gmv: number;
  /** Video có vi phạm luật cứng hôm nay không (kể cả khi đang ân hạn / được bảo vệ). */
  violated: boolean;
  /** Chỉ khi grace: còn bao nhiêu ngày ân hạn. */
  graceDaysLeft?: number;
}

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
const roiTxt = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

/** Số ngày giữa hai "YYYY-MM-DD" (b − a). Sai định dạng → 0. */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round((tb - ta) / 86_400_000);
}

/** Chấm MỘT video theo cấu hình — thuần, `today` là ngày VN "YYYY-MM-DD". */
export function assessVideo(v: AutoVideoInput, cfg: AutoRuleConfig, today: string): AutoAssessment {
  const base = { videoId: v.videoId, spuId: v.spuId, cost: v.cost, orders: v.orders, gmv: v.gmv };
  const win = v.windowDaysUsed > 0 ? `${v.windowDaysUsed} ngày` : "cửa sổ";

  if (v.deliveryStatus !== "DELIVERING") {
    return { ...base, verdict: "learning", violated: false, reason: "TikTok còn đang học video này — không xét." };
  }

  // ----- Vi phạm luật cứng? -----
  const roi = v.cost > 0 ? v.gmv / v.cost : 0;
  const cpa = v.orders > 0 ? v.cost / v.orders : Infinity;
  const hardRoi = cfg.roiTarget * (cfg.roiHardPct / 100);
  let violation = "";
  if (v.cost >= cfg.minSpend) {
    if (v.orders === 0 && v.cost >= cfg.spendNoOrder) {
      violation = `tiêu ${vnd(v.cost)} trong ${win} mà 0 đơn (ngưỡng ${vnd(cfg.spendNoOrder)})`;
    } else if (v.orders > 0 && roi < hardRoi) {
      violation = `ROI ${roiTxt(roi)} < ${roiTxt(hardRoi)} (${cfg.roiHardPct}% của mục tiêu ${roiTxt(cfg.roiTarget)}) trong ${win}`;
    } else if (v.orders > 0 && cfg.maxCpa != null && cpa > cfg.maxCpa) {
      violation = `chi phí/đơn ${vnd(cpa)} > trần ${vnd(cfg.maxCpa)} trong ${win}`;
    }
  }

  const restoredAt = v.watch?.restoredByUserAt ?? null;
  if (restoredAt && Date.now() - restoredAt.getTime() < RESTORE_PROTECT_DAYS * 86_400_000) {
    const d = restoredAt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
    return {
      ...base,
      verdict: "protected",
      violated: violation !== "",
      reason: violation
        ? `${violation} — nhưng chủ shop đã khôi phục tay ngày ${d}, máy không loại lại trong ${RESTORE_PROTECT_DAYS} ngày.`
        : `Chủ shop đã khôi phục tay ngày ${d} — máy không loại lại trong ${RESTORE_PROTECT_DAYS} ngày.`,
    };
  }

  if (v.cost < cfg.minSpend) {
    return {
      ...base,
      verdict: "insufficient",
      violated: false,
      reason: `mới tiêu ${vnd(v.cost)} trong ${win} (sàn ${vnd(cfg.minSpend)}) — chưa đủ để phán.`,
    };
  }

  if (violation) {
    // Công thần: đủ đơn 30 ngày → phải vi phạm liên tục đủ graceDays ngày mới loại.
    if (cfg.graceMinOrders > 0 && v.orders30d >= cfg.graceMinOrders) {
      const since = v.watch?.violationSince || today;
      const elapsed = daysBetween(since, today);
      if (elapsed < cfg.graceDays) {
        return {
          ...base,
          verdict: "grace",
          violated: true,
          graceDaysLeft: cfg.graceDays - elapsed,
          reason: `${violation} — video từng ra ${v.orders30d} đơn/30 ngày nên được ân hạn, còn ${cfg.graceDays - elapsed} ngày.`,
        };
      }
      return {
        ...base,
        verdict: "exclude",
        violated: true,
        reason: `${violation} — đã vi phạm liên tục ${elapsed} ngày, hết ân hạn công thần (${v.orders30d} đơn/30 ngày).`,
      };
    }
    return { ...base, verdict: "exclude", violated: true, reason: violation + "." };
  }

  if (v.orders > 0 && roi < cfg.roiTarget) {
    return {
      ...base,
      verdict: "flag",
      violated: false,
      reason: `ROI ${roiTxt(roi)} dưới mục tiêu ${roiTxt(cfg.roiTarget)} nhưng chưa tới mức loại (${roiTxt(hardRoi)}) trong ${win}.`,
    };
  }
  return { ...base, verdict: "healthy", violated: false, reason: "" };
}

export interface AutoExclusionPlan {
  assessments: AutoAssessment[];
  /** Video SẼ loại hôm nay (sau trần/ngày + chốt giữ video ra đơn), tốn tiền nhất trước. */
  exclude: AutoAssessment[];
  /** Vi phạm nhưng bị giữ lại vì trần số video/ngày. */
  heldByCap: AutoAssessment[];
  /** Vi phạm nhưng bị giữ lại vì chiến dịch sẽ còn quá ít video ra đơn. */
  heldByFloor: AutoAssessment[];
  counts: Record<AutoVerdict, number>;
  /** Tổng tiền cửa sổ của nhóm sẽ loại — để chuông/tóm tắt nói bằng tiền. */
  excludeSpend: number;
  excludeOrders: number;
}

/** Chấm cả chiến dịch rồi áp chốt an toàn cấp chiến dịch. */
export function planAutoExclusion(videos: AutoVideoInput[], cfg: AutoRuleConfig, today: string): AutoExclusionPlan {
  const assessments = videos.map((v) => assessVideo(v, cfg, today));
  const counts: Record<AutoVerdict, number> = { learning: 0, protected: 0, insufficient: 0, exclude: 0, grace: 0, flag: 0, healthy: 0 };
  for (const a of assessments) counts[a.verdict]++;

  const candidates = assessments.filter((a) => a.verdict === "exclude").sort((a, b) => b.cost - a.cost);
  const exclude: AutoAssessment[] = [];
  const heldByCap: AutoAssessment[] = [];
  const heldByFloor: AutoAssessment[] = [];

  // Chốt giữ video ra đơn: đếm video đang phân phối có đơn trong cửa sổ; loại
  // video có đơn chỉ khi phần còn lại vẫn ≥ minOrderingVideosKeep.
  let orderingLeft = assessments.filter((a) => a.verdict !== "learning" && a.orders > 0).length;
  for (const a of candidates) {
    if (exclude.length >= cfg.maxExcludePerDay) {
      heldByCap.push(a);
      continue;
    }
    if (a.orders > 0) {
      if (orderingLeft - 1 < cfg.minOrderingVideosKeep) {
        heldByFloor.push(a);
        continue;
      }
      orderingLeft--;
    }
    exclude.push(a);
  }

  return {
    assessments,
    exclude,
    heldByCap,
    heldByFloor,
    counts,
    excludeSpend: exclude.reduce((s, a) => s + a.cost, 0),
    excludeOrders: exclude.reduce((s, a) => s + a.orders, 0),
  };
}

/** Câu tóm tắt một lượt xét — dùng cho chuông, lastRunSummary và dòng xem trước trong popup. */
export function summarizeAutoPlan(plan: AutoExclusionPlan, cfg: AutoRuleConfig): string {
  const parts: string[] = [];
  if (plan.exclude.length > 0) {
    parts.push(
      `loại ${plan.exclude.length} video đang ngốn ${vnd(plan.excludeSpend)}/${cfg.windowDays} ngày mà ra ${plan.excludeOrders} đơn`
    );
  } else {
    parts.push("không có video nào tới mức loại");
  }
  if (plan.counts.grace > 0) parts.push(`${plan.counts.grace} video đang ân hạn`);
  if (plan.counts.flag > 0) parts.push(`gắn cờ ${plan.counts.flag} video cần xem`);
  if (plan.heldByCap.length > 0) parts.push(`${plan.heldByCap.length} video vi phạm chờ ngày mai (trần ${cfg.maxExcludePerDay}/ngày)`);
  if (plan.heldByFloor.length > 0) parts.push(`giữ lại ${plan.heldByFloor.length} video để chiến dịch còn video ra đơn`);
  if (plan.counts.learning > 0) parts.push(`bỏ qua ${plan.counts.learning} video đang học`);
  return parts.join(" · ");
}
