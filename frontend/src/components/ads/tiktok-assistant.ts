// ============================================================
// TRỢ LÝ TỐI ƯU GMV MAX (TikTok) — LOGIC THUẦN + MOCK DATA 3 TẦNG
//
// Bài toán: GMV Max tự test video liên tục → cắn tiền vào video không ra đơn.
// Trợ lý quét từng video theo RULE ENGINE 2 LỚP (kế thừa thiết kế đã test ở
// poc/rules.py của dự án gốc):
//   Lớp 1 (sàn dữ liệu): video CHƯA đủ dữ liệu (chi tiêu/giờ chạy quá ít)
//     → KHÔNG phán xét, tránh giết nhầm video mới mà TikTok đang test.
//   Lớp 2 (KPI): đủ dữ liệu mới soi 2 nhóm luật:
//     - Nhóm 1 (loại trừ thẳng tay): chi tiêu lớn mà 0 đơn / ROAS quá thấp /
//       CPA vượt trần → verdict "auto_exclude".
//     - Nhóm 2 (chờ phê duyệt): đơn ra ĐỀU (chuyển đổi tốt) nhưng CPA vượt
//       ngưỡng % so với mục tiêu → verdict "needs_review", KHÔNG tự loại.
// Mọi verdict đều kèm `reasons` chữ nghĩa — minh bạch vì sao bị gắn cờ, và
// người dùng luôn có đường lui (Khôi phục / Giữ lại).
//
// File này KHÔNG đụng React/API — thuần types + hàm + mock, tách để test được
// và để khi nối TikTok Marketing API thật chỉ thay nguồn `TIKTOK_CAMPAIGN_DETAILS`.
// ============================================================

import { formatNumber, formatVND } from "@/lib/format";

// ---------- Types ----------

/**
 * KHUNG THỜI GIAN tính số liệu cho Quy tắc 1 & 2. Bài toán thực chiến: video
 * quá khứ chạy rất ngon (số tổng đẹp) nhưng 3 ngày gần đây bão hòa, cắn tiền
 * lỗ — soi theo "3 ngày gần nhất" mới bắt được, soi số tổng thì lọt lưới.
 */
export type RuleTimeWindow = "all" | "today" | "3d" | "7d" | "custom";

export const RULE_WINDOW_LABELS: Record<RuleTimeWindow, string> = {
  all: "Tổng thời gian",
  today: "Hôm nay",
  "3d": "3 ngày gần nhất",
  "7d": "7 ngày gần nhất",
  custom: "Tùy chỉnh khoảng thời gian…",
};

/** Khoảng ngày tùy chỉnh cho window "custom" — ISO yyyy-mm-dd từ <input type=date>. */
export interface CustomDateRange {
  from: string;
  to: string;
}

/** "2026-07-21" → "21/7" cho lý do gắn cờ gọn mắt. */
function formatIsoShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

/** Hậu tố khung thời gian gắn vào lý do — khung "Tổng thời gian" thì rỗng. */
export function formatWindowTag(
  window: RuleTimeWindow,
  customRange?: CustomDateRange
): string {
  if (window === "all") return "";
  if (window === "custom") {
    return customRange?.from && customRange?.to
      ? ` (${formatIsoShort(customRange.from)}–${formatIsoShort(customRange.to)})`
      : "";
  }
  return ` (${RULE_WINDOW_LABELS[window].toLowerCase()})`;
}

/** Bộ số liệu của một video trong MỘT khung thời gian. */
export interface VideoWindowMetrics {
  spend: number;
  orders: number;
  revenue: number;
}

/** Một video (mẫu quảng cáo) trong chiến dịch GMV Max — Tầng 3. */
export interface TiktokAdVideo {
  id: string;
  /** ID bài đăng trên TikTok (hiển thị cạnh tên video như Ads Manager) */
  postId: string;
  title: string;
  spend: number;
  orders: number;
  revenue: number;
  /** Số giờ đã chạy — đầu vào Lớp 1 (sàn dữ liệu) */
  hoursRunning: number;
  /**
   * Lát số liệu theo khung gần nhất — thiếu lát nào rule engine fallback về
   * số tổng (mock; khi nối API thật sẽ lấy report theo ngày của TikTok).
   */
  recent?: Partial<
    Record<Exclude<RuleTimeWindow, "all" | "custom">, VideoWindowMetrics>
  >;
  /**
   * Đợt dồn traffic gần nhất (report theo giờ) — đầu vào Quy tắc 3 (đột biến
   * chi phí). TikTok có lúc dồn traffic cực lớn vào 1 video chỉ trong vài giờ
   * đầu ngày; không có trường này thì Quy tắc 3 bỏ qua video.
   */
  recentBurst?: { hours: number; spend: number; orders: number };
  /**
   * Bộ đếm ân hạn của Quy tắc 4 (bảo vệ công thần): đã theo dõi bao nhiêu giờ
   * và tiêu thêm bao nhiêu KỂ TỪ lần vi phạm đầu tiên. Mock cứng; khi nối API
   * thật backend sẽ ghi mốc vi phạm và tự cộng dồn. Thiếu trường = vừa vào
   * ân hạn (0h, 0đ).
   */
  graceWatch?: { hoursElapsed: number; spentDuring: number };
}

/** Số liệu của video trong khung thời gian yêu cầu (thiếu lát → dùng số tổng). */
export function videoWindowMetrics(
  video: TiktokAdVideo,
  window: RuleTimeWindow,
  customRange?: CustomDateRange
): VideoWindowMetrics {
  const totals = {
    spend: video.spend,
    orders: video.orders,
    revenue: video.revenue,
  };
  if (window === "custom") {
    // Mock: nội suy tuyến tính theo tỷ lệ giờ của khoảng ngày so với tổng giờ
    // chạy. Khi nối API thật sẽ query report theo ngày và cộng đúng lát —
    // logic gọi (rule engine) không phải đổi, chỉ thay hàm này.
    if (!customRange?.from || !customRange?.to) return totals;
    const from = new Date(`${customRange.from}T00:00:00`);
    const to = new Date(`${customRange.to}T00:00:00`);
    const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (!Number.isFinite(days) || days < 1) return totals; // khoảng ngược/lỗi → số tổng
    const frac = Math.min(1, (days * 24) / Math.max(video.hoursRunning, 1));
    return {
      spend: Math.round(video.spend * frac),
      orders: Math.round(video.orders * frac),
      revenue: Math.round(video.revenue * frac),
    };
  }
  if (window !== "all") {
    const slice = video.recent?.[window];
    if (slice) return slice;
  }
  return totals;
}

/** Một sản phẩm trong chiến dịch — Tầng 2. */
export interface TiktokCampaignProduct {
  id: string;
  name: string;
  /** Chế độ tối ưu TikTok đặt cho SP (Tối đa hóa GMV / Tự động…) */
  optimizationMode: string;
  spend: number;
  orders: number;
}

export interface TiktokDailyPoint {
  label: string;
  spend: number;
  revenue: number;
}

/** Chi tiết 3 tầng của một chiến dịch — key khớp `AdsCampaign.id` bên preset. */
export interface TiktokCampaignDetail {
  campaignId: string;
  products: TiktokCampaignProduct[];
  videos: TiktokAdVideo[];
  series: TiktokDailyPoint[];
}

/**
 * MỘT BỘ LUẬT hoàn chỉnh (sàn dữ liệu + 2 nhóm quy tắc). Tách riêng khỏi
 * AssistantConfig vì bộ luật tồn tại ở HAI cấp:
 *   - Cấp hệ thống: "Cấu hình Mặc định" trong tab Cấu hình Trợ lý Tự động.
 *   - Cấp chiến dịch (override): mỗi sản phẩm có giá bán/biên lãi khác nhau —
 *     SP 100k trần CPA chỉ 30k, SP 1 triệu trần CPA 200k vẫn lãi. Áp một rule
 *     cứng toàn hệ thống sẽ giết nhầm video của hàng giá trị cao.
 */
export interface AssistantRuleSet {
  /** Lớp 1 — sàn dữ liệu: dưới mức này KHÔNG phán xét */
  dataFloor: {
    minSpend: number;
    minHours: number;
  };
  /** Nhóm 1 — vi phạm là loại trừ thẳng tay (OR giữa các luật) */
  hard: {
    /** Switch riêng của Quy tắc 1 */
    enabled: boolean;
    /** Chi tiêu vượt mức này mà vẫn 0 đơn */
    spendNoOrder: number;
    /** ROAS thấp hơn mức này */
    minRoas: number;
    /** Chi phí mỗi đơn (CPA) vượt trần này */
    maxCpa: number;
    /** Khung thời gian tính số liệu cho nhóm luật này */
    window: RuleTimeWindow;
    /** Khoảng ngày khi window = "custom" */
    customRange?: CustomDateRange;
  };
  /** Nhóm 2 — chuyển đổi tốt nhưng CPA cao: chỉ cảnh báo, chờ Seller duyệt */
  review: {
    /** Switch riêng của Quy tắc 2 */
    enabled: boolean;
    /** Từ bao nhiêu đơn trở lên thì coi là "đơn ra đều" */
    minOrders: number;
    /** CPA mục tiêu của shop */
    targetCpa: number;
    /** Vượt bao nhiêu % so với mục tiêu thì gắn cờ */
    overPct: number;
    /** Khung thời gian tính số liệu cho nhóm luật này */
    window: RuleTimeWindow;
    /** Khoảng ngày khi window = "custom" */
    customRange?: CustomDateRange;
  };
  /**
   * Nhóm 3 — đột biến chi phí (Spend Spike): BỎ QUA sàn dữ liệu, quét cả video
   * mới đăng. Chống kịch bản TikTok dồn traffic vài giờ đầu ngày — đợi đủ 24h
   * theo Lớp 1 thì tài khoản đã cháy sạch tiền.
   */
  spike: {
    enabled: boolean;
    /** Tiêu vượt mức này trong cửa sổ giờ mà vẫn 0 đơn → loại trừ ngay */
    spend: number;
    /** Cửa sổ "N giờ gần nhất" */
    hours: number;
  };
  /**
   * Nhóm 4 — BẢO VỆ CÔNG THẦN (ân hạn): video đã tích lũy đủ nhiều đơn (tính
   * TỔNG thời gian) mà vi phạm Quy tắc 1/2 thì KHÔNG chém/cảnh báo ngay —
   * chuyển sang trạng thái Ân hạn theo dõi thêm N giờ hoặc tối đa thêm X đồng
   * chi tiêu. Hết ân hạn vẫn vi phạm mới trả về cờ gốc. Chống giết nhầm video
   * chủ lực chỉ thốn chỉ số tạm thời.
   */
  grace: {
    enabled: boolean;
    /** Từ bao nhiêu đơn tích lũy trở lên thì được coi là "công thần" */
    minOrders: number;
    /** Ân hạn tối đa bao nhiêu giờ */
    hours: number;
    /** Hoặc tiêu thêm tối đa bao nhiêu tiền trong thời gian ân hạn */
    maxExtraSpend: number;
  };
}

/** Cấu hình cấp hệ thống = switch tổng + bộ luật mặc định. */
export interface AssistantConfig extends AssistantRuleSet {
  /** Switch tổng "Bật trợ lý tối ưu tự động" */
  enabled: boolean;
}

/**
 * Bộ luật riêng theo chiến dịch — CÓ mặt trong map nghĩa là chiến dịch đó bật
 * "Tùy chỉnh quy tắc riêng" (ưu tiên tuyệt đối); KHÔNG có = kế thừa mặc định.
 */
export type CampaignRuleOverrides = Record<string, AssistantRuleSet>;

/** Bộ luật hiệu lực của một chiến dịch: riêng nếu có, không thì mặc định. */
export function effectiveRuleSet(
  campaignId: string,
  config: AssistantConfig,
  overrides: CampaignRuleOverrides
): { rules: AssistantRuleSet; custom: boolean } {
  const override = overrides[campaignId];
  return override
    ? { rules: override, custom: true }
    : { rules: config, custom: false };
}

/** Nhân bản sâu một bộ luật — dùng khi seed override từ cấu hình mặc định. */
export function cloneRuleSet(rules: AssistantRuleSet): AssistantRuleSet {
  return {
    dataFloor: { ...rules.dataFloor },
    hard: {
      ...rules.hard,
      customRange: rules.hard.customRange && { ...rules.hard.customRange },
    },
    review: {
      ...rules.review,
      customRange: rules.review.customRange && { ...rules.review.customRange },
    },
    spike: { ...rules.spike },
    grace: { ...rules.grace },
  };
}

/** Kết luận của Trợ lý cho một video đang chạy. */
export type VideoVerdict =
  | "insufficient" // Lớp 1: chưa đủ dữ liệu — không phán xét
  | "spike_exclude" // Nhóm 3: đột biến chi phí — loại trừ ngay, bỏ qua Lớp 1
  | "auto_exclude" // Nhóm 1: kém hiệu quả — chờ loại trừ
  | "needs_review" // Nhóm 2: chi phí cao — cần Seller xem xét
  | "grace" // Nhóm 4: công thần vi phạm — đang ân hạn, chưa xử
  | "healthy";

/**
 * Quyết định của Seller đè lên verdict:
 *   - EXCLUDED: loại hẳn khỏi GMV Max.
 *   - KEPT: duyệt giữ lại (chấp nhận CPA cao, không gắn cờ nữa).
 *   - WATCHING: "Theo dõi thêm" — giữ video chạy, TẠM ẨN cờ cảnh báo để trợ lý
 *     tiếp tục thu số liệu thay vì ép Seller quyết ngay (mock chưa hẹn giờ;
 *     khi nối API thật sẽ kèm thời hạn tự hết hiệu lực).
 */
export type VideoDecision = "EXCLUDED" | "KEPT" | "WATCHING";
export type VideoDecisionMap = Record<string, VideoDecision>;

/** Trạng thái hiển thị cuối cùng của video = verdict + quyết định người dùng. */
export type VideoDisplayStatus = VideoVerdict | "excluded" | "kept" | "watching";

export interface VideoAssessment {
  status: VideoDisplayStatus;
  /** Lý do minh bạch để hiện lên UI ("CPO 46.700 ₫ > mục tiêu +40%…") */
  reasons: string[];
  /** Chỉ có khi status "grace": phần ân hạn CÒN LẠI để UI đếm ngược */
  grace?: { hoursLeft: number; spendLeft: number };
}

// ---------- Rule engine ----------

/** CPA (chi phí mỗi đơn); 0 đơn → Infinity. */
export function videoCpa(video: TiktokAdVideo): number {
  return video.orders > 0 ? video.spend / video.orders : Infinity;
}

/** ROAS = doanh thu / chi phí; chi phí 0 → 0 (chưa tiêu thì chưa tính). */
export function videoRoas(video: TiktokAdVideo): number {
  return video.spend > 0 ? video.revenue / video.spend : 0;
}

/**
 * Chạy RULE ENGINE thuần (Lớp 1 + 2 nhóm KPI) cho MỘT video — chưa tính đến
 * quyết định của Seller. Tách riêng để assessVideo truy lại được VERDICT GỐC
 * của video đã bị loại trừ (hiện lý do "Trợ lý tự động loại trừ (…)" trên UI).
 */
export function runRuleEngine(
  video: TiktokAdVideo,
  rules: AssistantRuleSet
): { verdict: VideoVerdict; reasons: string[]; grace?: { hoursLeft: number; spendLeft: number } } {
  // ----- Nhóm 4 (bảo vệ công thần) — bộ ĐÁNH CHẶN cho Quy tắc 1/2: video đã
  // tích lũy đủ đơn mà vi phạm thì vào ân hạn thay vì ăn cờ ngay. Trả null
  // khi không đủ điều kiện HOẶC đã hết ân hạn (lúc đó cờ gốc được thả ra,
  // kèm ghi chú hết ân hạn qua graceExpiredNote).
  const graceState = video.graceWatch ?? { hoursElapsed: 0, spentDuring: 0 };
  const graceQualifies =
    rules.grace.enabled && video.orders >= rules.grace.minOrders;
  const graceExpired =
    graceState.hoursElapsed >= rules.grace.hours ||
    graceState.spentDuring >= rules.grace.maxExtraSpend;
  const graceIntercept = (
    violation: string[]
  ): { verdict: VideoVerdict; reasons: string[]; grace: { hoursLeft: number; spendLeft: number } } | null => {
    if (!graceQualifies || graceExpired) return null;
    return {
      verdict: "grace",
      reasons: [
        `video bán chạy (${formatNumber(video.orders)} đơn tích lũy) vi phạm: ` +
          `${violation.join("; ")} — đang trong ân hạn công thần ` +
          `(đã theo dõi ${formatNumber(graceState.hoursElapsed)}h/${formatNumber(rules.grace.hours)}h, ` +
          `tiêu thêm ${formatVND(graceState.spentDuring)}/${formatVND(rules.grace.maxExtraSpend)})`,
      ],
      grace: {
        hoursLeft: Math.max(0, rules.grace.hours - graceState.hoursElapsed),
        spendLeft: Math.max(0, rules.grace.maxExtraSpend - graceState.spentDuring),
      },
    };
  };
  const graceExpiredNote =
    graceQualifies && graceExpired
      ? `hết ân hạn công thần (đã theo dõi ${formatNumber(graceState.hoursElapsed)}h, ` +
        `tiêu thêm ${formatVND(graceState.spentDuring)}) — thả cờ`
      : null;

  // ----- Nhóm 3 (đột biến chi phí) — chạy TRƯỚC sàn dữ liệu: video mới đăng
  // vài giờ bị TikTok dồn traffic đốt tiền phải chặn ngay, không đợi đủ 24h.
  if (rules.spike.enabled && video.recentBurst) {
    const burst = video.recentBurst;
    // Cửa sổ luật ngắn hơn cửa sổ dữ liệu → co tuyến tính; dài hơn thì dùng
    // nguyên số đã quan sát (cận dưới an toàn, không phóng đại).
    const spendInWindow =
      rules.spike.hours >= burst.hours
        ? burst.spend
        : (burst.spend * rules.spike.hours) / burst.hours;
    if (burst.orders === 0 && spendInWindow > rules.spike.spend) {
      return {
        verdict: "spike_exclude",
        reasons: [
          `đột biến chi phí: tiêu ${formatVND(Math.round(spendInWindow))} trong ` +
            `${formatNumber(Math.min(rules.spike.hours, burst.hours))}h gần nhất mà 0 đơn ` +
            `(ngưỡng ${formatVND(rules.spike.spend)}/${formatNumber(rules.spike.hours)}h)`,
        ],
      };
    }
  }

  // ----- Lớp 1: đủ dữ liệu chưa? Chưa đủ thì đứng ngoài, không phán xét -----
  const lacking: string[] = [];
  if (video.spend < rules.dataFloor.minSpend) {
    lacking.push(
      `mới tiêu ${formatVND(video.spend)} < sàn ${formatVND(rules.dataFloor.minSpend)}`
    );
  }
  if (video.hoursRunning < rules.dataFloor.minHours) {
    lacking.push(
      `mới chạy ${formatNumber(video.hoursRunning)}h < ${formatNumber(rules.dataFloor.minHours)}h`
    );
  }
  if (lacking.length > 0) return { verdict: "insufficient", reasons: lacking };

  // ----- Nhóm 1: vi phạm là đề nghị loại thẳng (OR) — tính trên khung thời
  // gian đã chọn. Video tổng đẹp nhưng 3 ngày gần đây bão hòa sẽ lộ ở đây. -----
  const hardM = videoWindowMetrics(video, rules.hard.window, rules.hard.customRange);
  // Hậu tố khung thời gian cho lý do — khung "Tổng thời gian" thì khỏi nhắc
  const hardTag = formatWindowTag(rules.hard.window, rules.hard.customRange);
  const hard: string[] = [];
  // Khung gần nhất chưa tiêu đồng nào → không có gì để phán xét trong khung đó
  if (rules.hard.enabled && hardM.spend > 0) {
    const cpaW = hardM.orders > 0 ? hardM.spend / hardM.orders : Infinity;
    const roasW = hardM.revenue / hardM.spend;
    if (hardM.orders === 0 && hardM.spend > rules.hard.spendNoOrder) {
      hard.push(
        `tiêu ${formatVND(hardM.spend)} nhưng 0 đơn (ngưỡng ${formatVND(rules.hard.spendNoOrder)})${hardTag}`
      );
    }
    if (roasW < rules.hard.minRoas) {
      hard.push(
        `ROAS ${roasW.toFixed(2)} < ${rules.hard.minRoas.toLocaleString("vi-VN")}${hardTag}`
      );
    }
    if (hardM.orders > 0 && cpaW > rules.hard.maxCpa) {
      hard.push(`CPA ${formatVND(cpaW)} > trần ${formatVND(rules.hard.maxCpa)}${hardTag}`);
    }
  }
  if (hard.length > 0) {
    return (
      graceIntercept(hard) ?? {
        verdict: "auto_exclude",
        reasons: graceExpiredNote ? [...hard, graceExpiredNote] : hard,
      }
    );
  }

  // ----- Nhóm 2: đơn ra đều nhưng CPA vượt % ngưỡng → chờ Seller duyệt -----
  const reviewM = videoWindowMetrics(
    video,
    rules.review.window,
    rules.review.customRange
  );
  const reviewTag = formatWindowTag(rules.review.window, rules.review.customRange);
  const reviewCeiling = rules.review.targetCpa * (1 + rules.review.overPct / 100);
  const reviewCpa = reviewM.orders > 0 ? reviewM.spend / reviewM.orders : Infinity;
  if (
    rules.review.enabled &&
    reviewM.orders >= rules.review.minOrders &&
    reviewCpa > reviewCeiling
  ) {
    const reviewReasons = [
      `chuyển đổi tốt (${formatNumber(reviewM.orders)} đơn) nhưng CPA ${formatVND(reviewCpa)} ` +
        `vượt ${formatNumber(rules.review.overPct)}% mục tiêu ${formatVND(rules.review.targetCpa)}${reviewTag}`,
    ];
    return (
      graceIntercept(reviewReasons) ?? {
        verdict: "needs_review",
        reasons: graceExpiredNote
          ? [...reviewReasons, graceExpiredNote]
          : reviewReasons,
      }
    );
  }

  return { verdict: "healthy", reasons: [] };
}

/**
 * Phân loại MỘT video theo BỘ LUẬT HIỆU LỰC của chiến dịch chứa nó (riêng
 * nếu chiến dịch có override, không thì mặc định — xem effectiveRuleSet).
 * Thuần logic, không side effect. Quyết định người dùng (nếu có) thắng
 * verdict; trợ lý tắt thì mọi video đang chạy đều "healthy" (không quét).
 */
export function assessVideo(
  video: TiktokAdVideo,
  rules: AssistantRuleSet,
  enabled: boolean,
  decisions: VideoDecisionMap
): VideoAssessment {
  const decision = decisions[video.id];
  if (decision === "EXCLUDED") {
    // Truy lại verdict gốc để UI nói rõ VÌ SAO video này bị loại: trợ lý tự
    // gắn cờ hay Seller tự tay tắt một video đang bình thường.
    const engine = enabled
      ? runRuleEngine(video, rules)
      : { verdict: "healthy" as const, reasons: [] };
    const reason =
      engine.verdict === "auto_exclude" || engine.verdict === "spike_exclude"
        ? `Trợ lý tự động loại trừ (${engine.reasons.join("; ")})`
        : engine.reasons.length > 0
          ? `Seller loại trừ thủ công (${engine.reasons.join("; ")})`
          : "Seller loại trừ thủ công";
    return { status: "excluded", reasons: [reason] };
  }
  if (decision === "KEPT") {
    return {
      status: "kept",
      reasons: [
        "Seller đã duyệt giữ lại — whitelist 24h, trợ lý không quét lại trong thời gian này",
      ],
    };
  }
  if (decision === "WATCHING") {
    return {
      status: "watching",
      reasons: [
        "Seller chọn theo dõi thêm — tạm ẩn cờ cảnh báo, trợ lý tiếp tục thu số liệu",
      ],
    };
  }
  if (!enabled) return { status: "healthy", reasons: [] };
  const { verdict, reasons, grace } = runRuleEngine(video, rules);
  return { status: verdict, reasons, grace };
}

/** Đếm cờ toàn cục — nuôi banner "Đề xuất từ Trợ lý Hubsell" và preview ở tab cấu hình. */
export interface AssistantSummary {
  autoExclude: number;
  needsReview: number;
  insufficient: number;
  /** Seller chọn "Theo dõi thêm" — video giữ chạy, cờ cảnh báo tạm ẩn */
  watching: number;
  excluded: number;
  /** Chiến dịch đầu tiên còn video bị gắn cờ — đích của nút "Xem & quyết định" */
  firstFlaggedCampaignId: string | null;
}

export function summarizeAssistant(
  details: TiktokCampaignDetail[],
  config: AssistantConfig,
  overrides: CampaignRuleOverrides,
  decisions: VideoDecisionMap
): AssistantSummary {
  const summary: AssistantSummary = {
    autoExclude: 0,
    needsReview: 0,
    insufficient: 0,
    watching: 0,
    excluded: 0,
    firstFlaggedCampaignId: null,
  };
  for (const detail of details) {
    const { rules } = effectiveRuleSet(detail.campaignId, config, overrides);
    for (const video of detail.videos) {
      const { status } = assessVideo(video, rules, config.enabled, decisions);
      // Đột biến chi phí gộp chung rổ "chờ loại trừ" — banner ngoài trang chỉ
      // cần con số tổng, chi tiết vì sao nằm trong modal.
      if (status === "auto_exclude" || status === "spike_exclude")
        summary.autoExclude += 1;
      else if (status === "needs_review") summary.needsReview += 1;
      else if (status === "insufficient") summary.insufficient += 1;
      // Ân hạn công thần bản chất cũng là "đang theo dõi" — gộp chung rổ
      else if (status === "watching" || status === "grace")
        summary.watching += 1;
      else if (status === "excluded") summary.excluded += 1;
      if (
        (status === "auto_exclude" ||
          status === "spike_exclude" ||
          status === "needs_review") &&
        summary.firstFlaggedCampaignId === null
      ) {
        summary.firstFlaggedCampaignId = detail.campaignId;
      }
    }
  }
  return summary;
}

// ---------- Lưu trữ cấu hình (localStorage) ----------
//
// MOCK persistence: toàn bộ trạng thái Trợ lý (switch tổng, bộ luật mặc định,
// override theo chiến dịch, quyết định video, chế độ tự động thực thi) lưu
// vào localStorage để F5/đóng-mở modal KHÔNG reset về default. Khi có backend
// thật chỉ cần thay 2 hàm load/save bằng API — schema giữ nguyên.

export const ASSISTANT_STORAGE_KEY = "hubsell_ads_assistant_v1";

/** Trạng thái đầy đủ cần sống sót qua F5. */
export interface PersistedAssistantState {
  config: AssistantConfig;
  overrides: CampaignRuleOverrides;
  decisions: VideoDecisionMap;
  autoExecute: boolean;
}

/** Bản lưu có thể thiếu trường (schema cũ) — mọi nhánh đều optional. */
type PartialRuleSet = {
  dataFloor?: Partial<AssistantRuleSet["dataFloor"]>;
  hard?: Partial<AssistantRuleSet["hard"]>;
  review?: Partial<AssistantRuleSet["review"]>;
  spike?: Partial<AssistantRuleSet["spike"]>;
  grace?: Partial<AssistantRuleSet["grace"]>;
};

/**
 * Vá bản lưu THIẾU TRƯỜNG bằng giá trị mặc định — schema bộ luật đã đổi nhiều
 * lần (thêm window/spike/grace…), bản lưu cũ mà đọc thẳng sẽ crash UI.
 */
export function normalizeRuleSet(
  saved: PartialRuleSet | undefined,
  base: AssistantRuleSet
): AssistantRuleSet {
  if (!saved) return cloneRuleSet(base);
  return {
    dataFloor: { ...base.dataFloor, ...saved.dataFloor },
    hard: { ...base.hard, ...saved.hard },
    review: { ...base.review, ...saved.review },
    spike: { ...base.spike, ...saved.spike },
    grace: { ...base.grace, ...saved.grace },
  };
}

/**
 * Nạp trạng thái đã lưu; null nếu chưa từng lưu / bản lưu hỏng / đang SSR.
 * LƯU Ý: overrides lấy NGUYÊN từ bản lưu (không trộn DEFAULT_CAMPAIGN_OVERRIDES)
 * — người dùng đã XÓA quy tắc riêng của một chiến dịch thì F5 không được tự
 * mọc lại.
 */
export function loadAssistantState(): PersistedAssistantState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ASSISTANT_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as {
      config?: PartialRuleSet & { enabled?: boolean };
      overrides?: Record<string, PartialRuleSet>;
      decisions?: VideoDecisionMap;
      autoExecute?: boolean;
    };
    const overrides: CampaignRuleOverrides = {};
    for (const [campaignId, rules] of Object.entries(saved.overrides ?? {})) {
      overrides[campaignId] = normalizeRuleSet(rules, DEFAULT_ASSISTANT_CONFIG);
    }
    return {
      config: {
        enabled: saved.config?.enabled ?? DEFAULT_ASSISTANT_CONFIG.enabled,
        ...normalizeRuleSet(saved.config, DEFAULT_ASSISTANT_CONFIG),
      },
      overrides,
      decisions: saved.decisions ?? {},
      autoExecute: saved.autoExecute ?? true,
    };
  } catch {
    return null; // bản lưu hỏng → dùng default, KHÔNG làm sập trang
  }
}

/** Ghi trạng thái xuống localStorage — nuốt lỗi quota/private mode. */
export function saveAssistantState(state: PersistedAssistantState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage đầy / bị chặn — bỏ qua, phiên hiện tại vẫn chạy bằng state RAM
  }
}

// ---------- Cấu hình mặc định ----------

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  enabled: true,
  dataFloor: { minSpend: 100_000, minHours: 24 },
  hard: { enabled: true, spendNoOrder: 500_000, minRoas: 1.5, maxCpa: 80_000, window: "all" },
  review: { enabled: true, minOrders: 5, targetCpa: 30_000, overPct: 40, window: "all" },
  // Quy tắc 3 bật mặc định — spike vài giờ đầu ngày là kịch bản cháy ví nhanh
  // nhất, để Seller tự bật thì thường đã muộn.
  spike: { enabled: true, spend: 300_000, hours: 2 },
  // Quy tắc 4 bật mặc định — video 50+ đơn là tài sản, cho ân hạn 12h/200k
  // trước khi chém để tránh giết nhầm lúc thốn chỉ số tạm thời.
  grace: { enabled: true, minOrders: 50, hours: 12, maxExtraSpend: 200_000 },
};

/**
 * Override mẫu: chiến dịch tt-1 (GMV Max — Túi TC054) bán hàng GIÁ TRỊ CAO —
 * trần CPA nới lên 150.000 ₫ (mặc định 80.000 ₫) và CPA mục tiêu 60.000 ₫.
 * Nhờ vậy 2 video CPA ~47–50k của TC054 thoát cờ "Cần xem xét" dù rule mặc
 * định vẫn bắt — bằng chứng sống cơ chế Override chạy đúng.
 */
export const DEFAULT_CAMPAIGN_OVERRIDES: CampaignRuleOverrides = {
  "tt-1": {
    dataFloor: { minSpend: 150_000, minHours: 24 },
    hard: { enabled: true, spendNoOrder: 500_000, minRoas: 1.5, maxCpa: 150_000, window: "all" },
    review: { enabled: true, minOrders: 5, targetCpa: 60_000, overPct: 40, window: "all" },
    spike: { enabled: true, spend: 300_000, hours: 2 },
    grace: { enabled: true, minOrders: 50, hours: 12, maxExtraSpend: 200_000 },
  },
};

// ---------- Mock data 3 tầng (Chiến dịch → Sản phẩm → Video) ----------

/** 7 ngày mock tất định cho biểu đồ trong modal (không Math.random — SSR/CSR khớp). */
function detailSeries(baseSpend: number, roas: number): TiktokDailyPoint[] {
  const points: TiktokDailyPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const wave = 1 + 0.25 * Math.sin((6 - i) * 1.3);
    const spend = Math.round((baseSpend * wave) / 1000) * 1000;
    points.push({
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      spend,
      revenue: Math.round((spend * roas * (1 + 0.1 * Math.cos(i))) / 1000) * 1000,
    });
  }
  return points;
}

/**
 * Chi tiết mock của 4 chiến dịch TikTok (id khớp PLATFORM_PRESETS.TIKTOK).
 * Số liệu được cài CHỦ ĐÍCH để cấu hình mặc định bắt trúng từng loại cờ:
 * "auto_exclude", "needs_review", "insufficient", 1 video "spike_exclude"
 * (v-16: mới đăng 2h, tiêu 350k, 0 đơn — Quy tắc 3 bắt dù chưa đủ 24h),
 * 1 video bão hòa (v-15: số tổng đẹp nhưng lát "3 ngày gần nhất" lỗ nặng —
 * đổi khung thời gian Quy tắc 1 sang 3 ngày là lộ), và 1 video CÔNG THẦN
 * (v-17: 52 đơn tích lũy, CPA 88k vượt ngưỡng Quy tắc 2 nhưng được Quy tắc 4
 * đánh chặn → trạng thái Ân hạn thay vì ăn cờ cảnh báo).
 */
export const TIKTOK_CAMPAIGN_DETAILS: TiktokCampaignDetail[] = [
  {
    campaignId: "tt-1",
    products: [
      { id: "p-tc054", name: "Túi đeo chéo nam TC054", optimizationMode: "Tối đa hóa GMV", spend: 3_100_000, orders: 68 },
      { id: "p-tc055", name: "Túi đeo chéo nam ANO TC055", optimizationMode: "Tự động", spend: 1_720_000, orders: 30 },
    ],
    videos: [
      { id: "v-11", postId: "7345128890123457001", title: "Review túi TC054 đeo thử thực tế", spend: 1_850_000, orders: 52, revenue: 8_600_000, hoursRunning: 240, recent: { "3d": { spend: 560_000, orders: 15, revenue: 2_600_000 } } },
      { id: "v-12", postId: "7345128890123457002", title: "Unbox TC054 + mã giảm giá", spend: 980_000, orders: 21, revenue: 3_400_000, hoursRunning: 168 },
      { id: "v-13", postId: "7345128890123457003", title: "Clip viral chợ đêm (TikTok tự test)", spend: 720_000, orders: 0, revenue: 0, hoursRunning: 96 },
      { id: "v-14", postId: "7345128890123457004", title: "Video mới đăng sáng nay", spend: 62_000, orders: 1, revenue: 180_000, hoursRunning: 9 },
      // Video BÃO HÒA: tổng CPA ~50k rất đẹp, nhưng 3 ngày gần nhất CPA 210k +
      // ROAS 0.62 — đổi khung Quy tắc 1 sang "3 ngày gần nhất" là bị gắn cờ.
      { id: "v-15", postId: "7345128890123457005", title: "TC054 phối đồ nam", spend: 1_208_000, orders: 24, revenue: 4_900_000, hoursRunning: 200, recent: { "3d": { spend: 420_000, orders: 2, revenue: 260_000 } } },
      // Video ĐỘT BIẾN: TikTok dồn traffic, 2 tiếng đốt 350k chưa ra đơn nào —
      // Quy tắc 3 phải chặn ngay dù Lớp 1 (24h) chưa cho phán xét.
      { id: "v-16", postId: "7345128890123457006", title: "Flash clip trend sáng nay (TikTok dồn traffic)", spend: 350_000, orders: 0, revenue: 0, hoursRunning: 2, recentBurst: { hours: 2, spend: 350_000, orders: 0 } },
      // Video CÔNG THẦN: 52 đơn tích lũy, CPA 88.5k vượt ngưỡng duyệt 84k của
      // Quy tắc 2 (override tt-1: 60k +40%) — Quy tắc 4 đánh chặn, vào ân hạn
      // đã theo dõi 5h/12h và tiêu thêm 80k/200k.
      { id: "v-17", postId: "7345128890123457007", title: "Video chủ lực tháng 6 (52 đơn tích lũy)", spend: 4_600_000, orders: 52, revenue: 8_400_000, hoursRunning: 700, graceWatch: { hoursElapsed: 5, spentDuring: 80_000 } },
      // 6 video NỀN khỏe mạnh (CPA 36–41k, ROAS > 3 — sạch cờ ở cả cấu hình
      // mặc định lẫn override) để bảng video đủ dài minh họa PHÂN TRANG.
      { id: "v-18", postId: "7345128890123457008", title: "Combo túi + ví da PU", spend: 320_000, orders: 9, revenue: 1_150_000, hoursRunning: 120 },
      { id: "v-19", postId: "7345128890123457009", title: "TC054 góc quay cận khóa kéo", spend: 280_000, orders: 7, revenue: 900_000, hoursRunning: 96 },
      { id: "v-1a", postId: "7345128890123457010", title: "Clip khách feedback 5 sao", spend: 410_000, orders: 11, revenue: 1_500_000, hoursRunning: 144 },
      { id: "v-1b", postId: "7345128890123457011", title: "TC054 mix đồ đi học", spend: 260_000, orders: 7, revenue: 820_000, hoursRunning: 72 },
      { id: "v-1c", postId: "7345128890123457012", title: "So sánh TC054 vs túi thường", spend: 300_000, orders: 8, revenue: 1_020_000, hoursRunning: 108 },
      { id: "v-1d", postId: "7345128890123457013", title: "Hậu trường đóng gói đơn", spend: 350_000, orders: 9, revenue: 1_300_000, hoursRunning: 130 },
    ],
    series: detailSeries(690_000, 4.6),
  },
  {
    campaignId: "tt-2",
    products: [
      { id: "p-aogio", name: "Áo gió nam AOGIO_001", optimizationMode: "Tối đa hóa GMV", spend: 3_150_000, orders: 58 },
    ],
    videos: [
      { id: "v-21", postId: "7351442760987650001", title: "KOL T7 thử áo gió dưới mưa", spend: 1_650_000, orders: 38, revenue: 5_900_000, hoursRunning: 168 },
      { id: "v-22", postId: "7351442760987650002", title: "Cắt clip livestream KOL", spend: 890_000, orders: 4, revenue: 810_000, hoursRunning: 120 },
      { id: "v-23", postId: "7351442760987650003", title: "Áo gió cận cảnh chất vải", spend: 610_000, orders: 16, revenue: 2_450_000, hoursRunning: 144 },
    ],
    series: detailSeries(450_000, 3.1),
  },
  {
    campaignId: "tt-3",
    products: [
      { id: "p-live-1", name: "Túi đeo chéo nam TC054", optimizationMode: "Live Shopping", spend: 1_720_000, orders: 52 },
      { id: "p-live-2", name: "Tất thể thao VDT_001", optimizationMode: "Live Shopping", spend: 1_260_000, orders: 36 },
    ],
    videos: [
      { id: "v-31", postId: "7358100234567890001", title: "Highlight live 18/7", spend: 1_900_000, orders: 61, revenue: 7_800_000, hoursRunning: 216 },
      { id: "v-32", postId: "7358100234567890002", title: "Teaser live tuần này", spend: 84_000, orders: 2, revenue: 260_000, hoursRunning: 12 },
      { id: "v-33", postId: "7358100234567890003", title: "Highlight live 11/7", spend: 996_000, orders: 25, revenue: 3_700_000, hoursRunning: 384 },
    ],
    series: detailSeries(425_000, 4.2),
  },
  {
    campaignId: "tt-4",
    products: [
      { id: "p-tat", name: "Tất thể thao nam VDT_001", optimizationMode: "Tự động", spend: 1_500_000, orders: 29 },
    ],
    videos: [
      { id: "v-41", postId: "7361558812345670001", title: "Tất thể thao combo 5 đôi", spend: 620_000, orders: 6, revenue: 700_000, hoursRunning: 168 },
      { id: "v-42", postId: "7361558812345670002", title: "Tất trắng basic", spend: 540_000, orders: 14, revenue: 1_600_000, hoursRunning: 168 },
      { id: "v-43", postId: "7361558812345670003", title: "Clip so găng chất liệu", spend: 340_000, orders: 9, revenue: 1_150_000, hoursRunning: 132 },
    ],
    series: detailSeries(215_000, 1.8),
  },
];

/** Tra chi tiết theo id chiến dịch — null nếu chiến dịch không có mock 3 tầng. */
export function findCampaignDetail(campaignId: string): TiktokCampaignDetail | null {
  return TIKTOK_CAMPAIGN_DETAILS.find((d) => d.campaignId === campaignId) ?? null;
}
