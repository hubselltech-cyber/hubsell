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
    /** Chi tiêu vượt mức này mà vẫn 0 đơn */
    spendNoOrder: number;
    /** ROAS thấp hơn mức này */
    minRoas: number;
    /** Chi phí mỗi đơn (CPA) vượt trần này */
    maxCpa: number;
  };
  /** Nhóm 2 — chuyển đổi tốt nhưng CPA cao: chỉ cảnh báo, chờ Seller duyệt */
  review: {
    /** Từ bao nhiêu đơn trở lên thì coi là "đơn ra đều" */
    minOrders: number;
    /** CPA mục tiêu của shop */
    targetCpa: number;
    /** Vượt bao nhiêu % so với mục tiêu thì gắn cờ */
    overPct: number;
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
    hard: { ...rules.hard },
    review: { ...rules.review },
  };
}

/** Kết luận của Trợ lý cho một video đang chạy. */
export type VideoVerdict =
  | "insufficient" // Lớp 1: chưa đủ dữ liệu — không phán xét
  | "auto_exclude" // Nhóm 1: kém hiệu quả — chờ loại trừ
  | "needs_review" // Nhóm 2: chi phí cao — cần Seller xem xét
  | "healthy";

/** Quyết định của Seller đè lên verdict (loại hẳn / duyệt giữ lại). */
export type VideoDecision = "EXCLUDED" | "KEPT";
export type VideoDecisionMap = Record<string, VideoDecision>;

/** Trạng thái hiển thị cuối cùng của video = verdict + quyết định người dùng. */
export type VideoDisplayStatus = VideoVerdict | "excluded" | "kept";

export interface VideoAssessment {
  status: VideoDisplayStatus;
  /** Lý do minh bạch để hiện lên UI ("CPO 46.700 ₫ > mục tiêu +40%…") */
  reasons: string[];
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
    return { status: "excluded", reasons: [] };
  }
  if (decision === "KEPT") {
    return { status: "kept", reasons: ["Seller đã duyệt giữ lại"] };
  }
  if (!enabled) return { status: "healthy", reasons: [] };

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
  if (lacking.length > 0) return { status: "insufficient", reasons: lacking };

  const cpa = videoCpa(video);
  const roas = videoRoas(video);

  // ----- Nhóm 1: vi phạm là đề nghị loại thẳng (OR) -----
  const hard: string[] = [];
  if (video.orders === 0 && video.spend > rules.hard.spendNoOrder) {
    hard.push(
      `tiêu ${formatVND(video.spend)} nhưng 0 đơn (ngưỡng ${formatVND(rules.hard.spendNoOrder)})`
    );
  }
  if (roas < rules.hard.minRoas) {
    hard.push(`ROAS ${roas.toFixed(2)} < ${rules.hard.minRoas.toLocaleString("vi-VN")}`);
  }
  if (video.orders > 0 && cpa > rules.hard.maxCpa) {
    hard.push(`CPA ${formatVND(cpa)} > trần ${formatVND(rules.hard.maxCpa)}`);
  }
  if (hard.length > 0) return { status: "auto_exclude", reasons: hard };

  // ----- Nhóm 2: đơn ra đều nhưng CPA vượt % ngưỡng → chờ Seller duyệt -----
  const reviewCeiling = rules.review.targetCpa * (1 + rules.review.overPct / 100);
  if (video.orders >= rules.review.minOrders && cpa > reviewCeiling) {
    return {
      status: "needs_review",
      reasons: [
        `chuyển đổi tốt (${formatNumber(video.orders)} đơn) nhưng CPA ${formatVND(cpa)} ` +
          `vượt ${formatNumber(rules.review.overPct)}% mục tiêu ${formatVND(rules.review.targetCpa)}`,
      ],
    };
  }

  return { status: "healthy", reasons: [] };
}

/** Đếm cờ toàn cục — nuôi banner "Đề xuất từ Trợ lý Hubsell" và preview ở tab cấu hình. */
export interface AssistantSummary {
  autoExclude: number;
  needsReview: number;
  insufficient: number;
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
    excluded: 0,
    firstFlaggedCampaignId: null,
  };
  for (const detail of details) {
    const { rules } = effectiveRuleSet(detail.campaignId, config, overrides);
    for (const video of detail.videos) {
      const { status } = assessVideo(video, rules, config.enabled, decisions);
      if (status === "auto_exclude") summary.autoExclude += 1;
      else if (status === "needs_review") summary.needsReview += 1;
      else if (status === "insufficient") summary.insufficient += 1;
      else if (status === "excluded") summary.excluded += 1;
      if (
        (status === "auto_exclude" || status === "needs_review") &&
        summary.firstFlaggedCampaignId === null
      ) {
        summary.firstFlaggedCampaignId = detail.campaignId;
      }
    }
  }
  return summary;
}

// ---------- Cấu hình mặc định ----------

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  enabled: true,
  dataFloor: { minSpend: 100_000, minHours: 24 },
  hard: { spendNoOrder: 500_000, minRoas: 1.5, maxCpa: 80_000 },
  review: { minOrders: 5, targetCpa: 30_000, overPct: 40 },
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
    hard: { spendNoOrder: 500_000, minRoas: 1.5, maxCpa: 150_000 },
    review: { minOrders: 5, targetCpa: 60_000, overPct: 40 },
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
 * 3 video "auto_exclude", 3 video "needs_review", 2 video "insufficient".
 */
export const TIKTOK_CAMPAIGN_DETAILS: TiktokCampaignDetail[] = [
  {
    campaignId: "tt-1",
    products: [
      { id: "p-tc054", name: "Túi đeo chéo nam TC054", optimizationMode: "Tối đa hóa GMV", spend: 3_100_000, orders: 68 },
      { id: "p-tc055", name: "Túi đeo chéo nam ANO TC055", optimizationMode: "Tự động", spend: 1_720_000, orders: 30 },
    ],
    videos: [
      { id: "v-11", postId: "7345128890123457001", title: "Review túi TC054 đeo thử thực tế", spend: 1_850_000, orders: 52, revenue: 8_600_000, hoursRunning: 240 },
      { id: "v-12", postId: "7345128890123457002", title: "Unbox TC054 + mã giảm giá", spend: 980_000, orders: 21, revenue: 3_400_000, hoursRunning: 168 },
      { id: "v-13", postId: "7345128890123457003", title: "Clip viral chợ đêm (TikTok tự test)", spend: 720_000, orders: 0, revenue: 0, hoursRunning: 96 },
      { id: "v-14", postId: "7345128890123457004", title: "Video mới đăng sáng nay", spend: 62_000, orders: 1, revenue: 180_000, hoursRunning: 9 },
      { id: "v-15", postId: "7345128890123457005", title: "TC054 phối đồ nam", spend: 1_208_000, orders: 24, revenue: 4_900_000, hoursRunning: 200 },
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
