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
//   4. vi phạm CỨNG  — tiêu ≥ ngưỡng mà 0 đơn / ROI < MỨC LOẠI / CPA > trần
//        MỨC LOẠI (resolveHardLevel) = % mục tiêu (mặc định) HOẶC ROI HÒA VỐN của chiến dịch khi
//        khách chọn hardBasis "breakeven" và hòa vốn ĐỦ TIN — dưới hòa vốn là lỗ thật, có căn cứ
//        hơn con số % tự đặt (anh Trung duyệt 18/09). Hòa vốn chưa đủ tin → tự rơi về % và nói rõ.
//        · video công thần (đủ đơn 30 ngày) → grace cho tới khi vi phạm đủ số ngày liên tục → exclude
//        · còn lại → exclude
//   5. flag          — có đơn, ROI dưới mục tiêu nhưng chưa tới mức cứng → chỉ gắn cờ.
//   6. healthy.
// Sau đó planAutoExclusion áp hai chốt an toàn cấp chiến dịch: trần số video
// loại mỗi ngày (ưu tiên tốn tiền nhất) và giữ lại tối thiểu N video còn ra đơn.
// ============================================================

export type AutoRuleMode = "off" | "dry_run" | "live";
export const AUTO_RULE_MODES: AutoRuleMode[] = ["off", "dry_run", "live"];

/** Mức loại ROI tính theo gì: % của mục tiêu, hay ROI hòa vốn của chiến dịch. */
export type HardBasis = "pct" | "breakeven";
export const HARD_BASES: HardBasis[] = ["pct", "breakeven"];

export interface AutoRuleConfig {
  roiTarget: number;
  windowDays: number;
  hardBasis: HardBasis;
  /** Công tắc từng luật — tắt là luật đó không xét, số bên cạnh giữ nguyên để bật lại. */
  ruleNoOrderOn: boolean;
  ruleLowRoiOn: boolean;
  ruleCpaOn: boolean;
  graceOn: boolean;
  minSpend: number;
  spendNoOrder: number;
  roiHardPct: number;
  /** Trần chi phí/đơn; null = chưa đặt số (luật CPA coi như tắt). */
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
  // Mặc định giữ kiểu % để không đổi hành vi chiến dịch đang chạy; khách tự chuyển sang hòa vốn.
  hardBasis: "pct",
  ruleNoOrderOn: true,
  ruleLowRoiOn: true,
  ruleCpaOn: false,
  graceOn: true,
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
  const bool = (k: keyof AutoRuleConfig, fallback: boolean): boolean => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : fallback);
  return {
    roiTarget: Math.max(0.1, num("roiTarget", base.roiTarget)),
    windowDays: clamp(num("windowDays", base.windowDays), AUTO_RULE_LIMITS.windowDays),
    hardBasis: HARD_BASES.includes(raw.hardBasis as HardBasis) ? (raw.hardBasis as HardBasis) : base.hardBasis,
    ruleNoOrderOn: bool("ruleNoOrderOn", base.ruleNoOrderOn),
    ruleLowRoiOn: bool("ruleLowRoiOn", base.ruleLowRoiOn),
    ruleCpaOn: bool("ruleCpaOn", base.ruleCpaOn),
    graceOn: bool("graceOn", base.graceOn),
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

/**
 * Độ phủ giá vốn tối thiểu để hòa vốn được dùng làm mức loại. Sàn không có số nào cho việc này —
 * 90 là MẶC ĐỊNH CHỌN (anh Trung duyệt 18/09): đơn thiếu giá vốn đã bị loại khỏi phép tính, nhưng
 * nếu phần thiếu quá lớn thì biên lãi của phần còn lại không đại diện được cả chiến dịch.
 */
export const BREAKEVEN_MIN_COVERAGE_PCT = 90;

/** Phần của kết quả hòa vốn mà luật cần (khớp TiktokBreakeven của breakeven.ts). */
export interface BreakevenInput {
  breakevenRoi: number | null;
  negativeMargin: boolean;
  source: "campaign" | "shop" | null;
  orders: number;
  costCoveragePct: number | null;
}

export interface HardLevel {
  /** ROI dưới mức này (khi có đơn) là vi phạm cứng. */
  hardRoi: number;
  /** Mức loại THỰC DÙNG lượt này. */
  basis: HardBasis;
  /** Khách chọn hòa vốn nhưng lượt này phải rơi về %: lý do (rỗng = không rơi). */
  fallbackReason: string;
  /** Nhãn của mức loại để ghi vào căn cứ, vd "hòa vốn 6,1 (312 đơn đã đối soát)". */
  label: string;
}

/** Hòa vốn có đủ tin để máy dựa vào mà LOẠI video không? Trả lý do khi không. Thuần. */
export function breakevenUnusableReason(be: BreakevenInput | null): string {
  if (!be) return "chưa tính được hòa vốn";
  if (be.negativeMargin) return "sản phẩm đang lỗ trước cả quảng cáo — loại video không cứu được, cần xem lại giá bán / giá vốn";
  if (be.breakevenRoi == null) return "chưa có đơn đã đối soát đủ giá vốn";
  if (be.source !== "campaign") return "chiến dịch chưa đủ đơn đã đối soát nên hòa vốn đang mượn biên lãi toàn gian";
  if (be.costCoveragePct == null || be.costCoveragePct < BREAKEVEN_MIN_COVERAGE_PCT) {
    return `mới ${be.costCoveragePct ?? 0}% doanh thu có giá vốn (cần từ ${BREAKEVEN_MIN_COVERAGE_PCT}%)`;
  }
  return "";
}

/** Mức loại ROI của lượt chấm: theo hòa vốn nếu khách chọn VÀ hòa vốn đủ tin; không thì theo % mục tiêu. Thuần. */
export function resolveHardLevel(cfg: AutoRuleConfig, be: BreakevenInput | null = null): HardLevel {
  const pctRoi = cfg.roiTarget * (cfg.roiHardPct / 100);
  const pctLabel = `${roiTxt(pctRoi)} (${cfg.roiHardPct}% của mục tiêu ${roiTxt(cfg.roiTarget)})`;
  if (cfg.hardBasis !== "breakeven") return { hardRoi: pctRoi, basis: "pct", fallbackReason: "", label: pctLabel };
  const why = breakevenUnusableReason(be);
  if (why || !be || be.breakevenRoi == null) return { hardRoi: pctRoi, basis: "pct", fallbackReason: why, label: pctLabel };
  return {
    hardRoi: be.breakevenRoi,
    basis: "breakeven",
    fallbackReason: "",
    label: `hòa vốn ${roiTxt(be.breakevenRoi)} (${be.orders.toLocaleString("vi-VN")} đơn đã đối soát)`,
  };
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

/**
 * A2 — CHỐT CHẶN SỐ LIỆU SÀN HỎNG. Luật "0 đơn" tin tuyệt đối cột đơn của báo cáo tầng video; hôm nào TikTok trả
 * thiếu (đơn = 0 hàng loạt) thì máy sẽ loại oan tới maxExcludePerDay video. Đối chiếu với TẦNG CHIẾN DỊCH của cùng
 * cửa sổ — Hubsell đồng bộ riêng vào AdsCampaignDailyPerf, một đường báo cáo khác của sàn. KHÔNG dùng ngưỡng tự đặt:
 * chỉ chặn khi có bằng chứng dương tính rõ ràng — tầng video (mọi video + thẻ sản phẩm) báo 0 trong khi tầng chiến
 * dịch có số. Hai tầng không bao giờ bằng nhau tuyệt đối (video đã loại / sàn tự ngưng không nằm trong tầng video ta
 * đọc) nên KHÔNG so lệch bao nhiêu phần trăm. Không có số tầng chiến dịch (null / toàn 0) → không kết luận được → cho qua.
 * Trả "" = ổn; có chữ = lý do bỏ lượt. Thuần.
 */
export function videoDataProblem(
  videoTier: { cost: number; orders: number },
  campaignTier: { spend: number; orders: number } | null
): string {
  if (!campaignTier) return "";
  if (campaignTier.orders > 0 && videoTier.orders === 0) {
    return `báo cáo video của TikTok trả 0 đơn cho MỌI video trong khi chiến dịch ghi ${campaignTier.orders.toLocaleString("vi-VN")} đơn cùng kỳ — số liệu video đang thiếu`;
  }
  if (campaignTier.spend > 0 && videoTier.cost === 0) {
    return `báo cáo video của TikTok trả 0 đồng chi phí trong khi chiến dịch tiêu ${vnd(campaignTier.spend)} cùng kỳ — số liệu video đang thiếu`;
  }
  return "";
}

/** Chấm MỘT video theo cấu hình — thuần, `today` là ngày VN "YYYY-MM-DD". `hard` = mức loại của lượt (mặc định theo %). */
export function assessVideo(v: AutoVideoInput, cfg: AutoRuleConfig, today: string, hard: HardLevel = resolveHardLevel(cfg)): AutoAssessment {
  const base = { videoId: v.videoId, spuId: v.spuId, cost: v.cost, orders: v.orders, gmv: v.gmv };
  const win = v.windowDaysUsed > 0 ? `${v.windowDaysUsed} ngày` : "cửa sổ";

  if (v.deliveryStatus !== "DELIVERING") {
    return { ...base, verdict: "learning", violated: false, reason: "TikTok còn đang học video này — không xét." };
  }

  // ----- Vi phạm luật cứng? -----
  const roi = v.cost > 0 ? v.gmv / v.cost : 0;
  const cpa = v.orders > 0 ? v.cost / v.orders : Infinity;
  const hardRoi = hard.hardRoi;
  let violation = "";
  if (v.cost >= cfg.minSpend) {
    if (cfg.ruleNoOrderOn && v.orders === 0 && v.cost >= cfg.spendNoOrder) {
      violation = `tiêu ${vnd(v.cost)} trong ${win} mà 0 đơn (ngưỡng ${vnd(cfg.spendNoOrder)})`;
    } else if (cfg.ruleLowRoiOn && v.orders > 0 && roi < hardRoi) {
      violation =
        hard.basis === "breakeven"
          ? `ROI ${roiTxt(roi)} < ${hard.label} trong ${win} — đang lỗ`
          : `ROI ${roiTxt(roi)} < ${hard.label} trong ${win}`;
    } else if (cfg.ruleCpaOn && v.orders > 0 && cfg.maxCpa != null && cpa > cfg.maxCpa) {
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
    if (cfg.graceOn && cfg.graceMinOrders > 0 && v.orders30d >= cfg.graceMinOrders) {
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
  /** Mức loại ROI thực dùng lượt này (% mục tiêu hay hòa vốn, kèm lý do nếu phải rơi về %). */
  hard: HardLevel;
}

/** Chấm cả chiến dịch rồi áp chốt an toàn cấp chiến dịch. */
export function planAutoExclusion(
  videos: AutoVideoInput[],
  cfg: AutoRuleConfig,
  today: string,
  breakeven: BreakevenInput | null = null
): AutoExclusionPlan {
  const hard = resolveHardLevel(cfg, breakeven);
  const assessments = videos.map((v) => assessVideo(v, cfg, today, hard));
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
    hard,
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
  if (cfg.ruleLowRoiOn && plan.hard.basis === "breakeven") parts.push(`mức loại theo ${plan.hard.label}`);
  if (cfg.ruleLowRoiOn && plan.hard.fallbackReason) parts.push(`chưa dùng được hòa vốn làm mức loại (${plan.hard.fallbackReason}) nên tạm theo ${cfg.roiHardPct}% mục tiêu`);
  return parts.join(" · ");
}

// ------------------------------------------------------------
// B6 — CẤU HÌNH ĐÃ DIỄN TẬP CHƯA? (rà 18/09: rào lastRunOn chỉ biết "đã từng có lượt chấm", không biết lượt đó chạy
// bằng cấu hình nào → khách diễn tập bằng số nhẹ, sửa số nặng rồi bật thật luôn được.) Mỗi lượt chấm THẬT chốt lại
// cấu hình nó dùng (TiktokAdsAutoRule.lastRunConfig); Tự loại thật chỉ chạy với đúng cấu hình đó.
// ------------------------------------------------------------

/** Số đi kèm một luật ĐANG TẮT không tham gia chấm điểm → không tính là đổi cấu hình. */
function effectiveConfig(c: AutoRuleConfig): Partial<AutoRuleConfig> {
  const e: Partial<AutoRuleConfig> = { ...c };
  if (!c.ruleNoOrderOn) delete e.spendNoOrder;
  if (!c.ruleLowRoiOn) {
    delete e.hardBasis;
    delete e.roiHardPct;
  }
  if (!c.ruleCpaOn) delete e.maxCpa;
  if (!c.graceOn) {
    delete e.graceMinOrders;
    delete e.graceDays;
  }
  return e;
}

/** Đọc lại cấu hình lượt chấm đã chốt trong DB (Json). Thiếu / sai kiểu → null = coi như chưa diễn tập. */
export function parseRehearsedConfig(raw: unknown): AutoRuleConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.roiTarget !== "number" || typeof r.windowDays !== "number") return null;
  return sanitizeAutoRuleConfig(r);
}

/** Những ô của `next` KHÁC cấu hình đã diễn tập. [] = đúng cấu hình đã diễn tập; chưa có lượt nào thì mọi ô đều "khác". */
export function unrehearsedFields(rehearsed: AutoRuleConfig | null, next: AutoRuleConfig): (keyof AutoRuleConfig)[] {
  const b = effectiveConfig(next);
  if (!rehearsed) return Object.keys(b) as (keyof AutoRuleConfig)[];
  const a = effectiveConfig(rehearsed);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof AutoRuleConfig>;
  return [...keys].filter((k) => a[k] !== b[k]);
}

// ------------------------------------------------------------
// B8 — CHUÔNG CHỈ KHI KẾT QUẢ ĐỔI. Diễn tập không loại thật nên hôm sau máy lại định loại ĐÚNG các video hôm trước;
// chuông y nguyên mỗi ngày thì khách tắt chuông. So lượt hôm nay với lượt trước (lastRunSummary), giống hệt thì im.
// ------------------------------------------------------------

export interface RunDigest {
  mode: string;
  excludeIds: string[];
  grace: number;
  flag: number;
}

/** Rút gọn lastRunSummary của lượt TRƯỚC. Lượt bị bỏ (A2) / lệnh bị sàn từ chối / chưa có lượt nào → null = không có gì để so. */
export function runDigestOf(summary: unknown): RunDigest | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const s = summary as Record<string, unknown>;
  if (typeof s.mode !== "string" || typeof s.skipped === "string" || typeof s.error === "string") return null;
  // Dòng ghi trước B8 chưa có excludeIds → lấy từ `videos` (tối đa 50, đủ cho trần mặc định 10 video/ngày).
  const videos = Array.isArray(s.videos) ? s.videos : [];
  const excludeIds = Array.isArray(s.excludeIds)
    ? s.excludeIds.map(String)
    : videos.map((v) => String((v as Record<string, unknown>)?.videoId ?? "")).filter(Boolean);
  return { mode: s.mode, excludeIds, grace: Number(s.grace) || 0, flag: Number(s.flag) || 0 };
}

export interface RunChange {
  changed: boolean;
  added: number;
  removed: number;
}

/** Lượt hôm nay có gì KHÁC lượt trước không. Không loại video nào thì so số video ân hạn / cần xem. */
export function compareRunDigest(prev: RunDigest | null, now: RunDigest): RunChange {
  if (!prev || prev.mode !== now.mode) return { changed: true, added: now.excludeIds.length, removed: 0 };
  const before = new Set(prev.excludeIds);
  const after = new Set(now.excludeIds);
  const added = now.excludeIds.filter((id) => !before.has(id)).length;
  const removed = prev.excludeIds.filter((id) => !after.has(id)).length;
  const quietChanged = now.excludeIds.length === 0 && (prev.grace !== now.grace || prev.flag !== now.flag);
  return { changed: added > 0 || removed > 0 || quietChanged, added, removed };
}

/** Đuôi tiêu đề chuông: "thêm 2, bớt 1 so với lượt trước". Lượt đầu / danh sách mới hoàn toàn thì không cần đuôi. */
export function runChangeLabel(prev: RunDigest | null, change: RunChange): string {
  if (!prev || prev.excludeIds.length === 0) return "";
  const parts = [change.added > 0 ? `thêm ${change.added}` : "", change.removed > 0 ? `bớt ${change.removed}` : ""].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(", ")} so với lượt trước)` : "";
}
