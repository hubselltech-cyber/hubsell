// ============================================================
// TRỢ LÝ QUẢNG CÁO SHOPEE — RULE ENGINE (GĐ2, LOGIC THUẦN)
//
// Port triết lý 2 lớp + 4 quy tắc đã test 13 ca ở Trợ lý GMV Max TikTok
// (frontend/src/components/ads/tiktok-assistant.ts), đổi đơn vị đánh giá từ
// "video" sang "chiến dịch" và neo mọi ngưỡng lãi/lỗ vào ROAS HÒA VỐN thật
// (1/biên lãi ròng từ computePnlRow — routes/ads.ts tính sẵn, truyền vào đây).
//
// GĐ2 CHỈ ĐỀ XUẤT — verdict + reasons hiển thị cho chủ shop tự quyết trên
// Seller Center. Không có một lệnh ghi nào lên sàn (autoExecute là GĐ3).
//
// LOGIC THUẦN, KHÔNG IMPORT PRISMA/CLIENT — để vitest đánh thẳng không cần DB
// (cùng khuôn với tiktok-assistant.ts và poc/rules.py của dự án tiền thân).
//
// Thứ tự đánh giá (mirror TikTok):
//   Q3 spike (chạy TRƯỚC sàn dữ liệu — cháy ví phải báo ngay dù chưa đủ mẫu)
//   → Lớp sàn dữ liệu (chưa đủ chi tiêu/click thì không phán xét)
//   → Q1 loại thẳng ─┐ nếu fired → Q4 công thần đánh chặn (grace)
//   → Q2 chờ duyệt ──┘
//   → healthy
// ============================================================

/** Cửa sổ đánh giá — lát cắt ngắn bắt campaign BÃO HÒA (tổng đẹp, gần đây lỗ). */
export type AssistantWindowKey = "today" | "3d" | "7d" | "30d";

export const ASSISTANT_WINDOWS: AssistantWindowKey[] = ["today", "3d", "7d", "30d"];

/** Nhãn cửa sổ cho reasons/UI. */
export const WINDOW_LABEL: Record<AssistantWindowKey, string> = {
  today: "hôm nay",
  "3d": "3 ngày",
  "7d": "7 ngày",
  "30d": "30 ngày",
};

/** Ngưỡng sàn cấu hình theo chuẩn 7 ngày — cửa sổ khác scale theo độ dài. */
const WINDOW_FLOOR_SCALE: Record<AssistantWindowKey, number> = {
  today: 0.2,
  "3d": 0.5,
  "7d": 1,
  "30d": 1.5,
};

export interface AssistantWindowMetrics {
  spend: number;
  clicks: number;
  broadOrder: number;
  broadGmv: number;
}

export interface AssistantCampaignInput {
  /** Chỉ campaign "ongoing" bị đánh giá — paused/ended/deleted trả verdict null. */
  status: string;
  /** ROAS hòa vốn của chính SKU trong campaign (null = chưa đủ dữ liệu P&L). */
  breakevenRoas: number | null;
  windows: Record<AssistantWindowKey, AssistantWindowMetrics>;
  /** Chi tiêu trung bình/ngày của 7 ngày TRƯỚC hôm nay (mẫu so spike). */
  avgDailySpend7d: number;
}

export type AssistantVerdict =
  | "spike" // Q3: hôm nay vọt chi bất thường
  | "pause_now" // Q1: đề xuất tạm dừng ngay
  | "grace" // Q4: vi phạm Q1/Q2 nhưng là công thần — theo dõi sát, chưa cắt
  | "review" // Q2: vùng vàng, cần người duyệt
  | "healthy"
  | "insufficient_data"; // lớp sàn: chưa đủ mẫu để phán xét

/**
 * Nhánh Q1 đã kích hoạt — dạng CÓ CẤU TRÚC để nơi tiêu thụ (Trung tâm điều
 * hành) phân loại kịch bản mà không phải parse chuỗi `reasons`:
 *   zero_order      = đốt ngân sách vượt ngưỡng nhưng 0 đơn (Zero Order Drain)
 *   below_breakeven = ROAS dưới ngưỡng nguy hiểm quanh hòa vốn (ROAS Risk)
 */
export type AssistantTrigger = "zero_order" | "below_breakeven";

export interface AssistantAssessment {
  /** null = không đánh giá (campaign không chạy / Trợ lý tắt). */
  verdict: AssistantVerdict | null;
  /** Diễn giải từng căn cứ, tiếng Việt kèm số — UI hiện nguyên văn. */
  reasons: string[];
  /** Cửa sổ kích hoạt quy tắc (badge tooltip); undefined với healthy/floor. */
  window?: AssistantWindowKey;
  /** Nhánh Q1 kích hoạt — chỉ có với pause_now/grace (grace kế thừa từ Q1). */
  triggers?: AssistantTrigger[];
}

// ---------- Cấu hình luật ----------

export interface ShopeeAssistantConfig {
  enabled: boolean;
  /** Lớp sàn dữ liệu — ngưỡng chuẩn cửa sổ 7 ngày, cửa sổ khác tự scale. */
  floor: { minSpend7d: number; minClicks7d: number };
  /** Q1 — loại thẳng. breakevenFactor <1 chừa vùng đệm quanh hòa vốn cho Q2. */
  hard: { enabled: boolean; zeroOrderSpend7d: number; breakevenFactor: number };
  /** Q2 — vùng vàng: hòa vốn×breakevenFactor ≤ ROAS < hòa vốn×dangerFactor. */
  review: { enabled: boolean; dangerFactor: number };
  /** Q3 — spike: hôm nay tiêu ≥ dayMultiple × trung bình ngày (và ≥ minTodaySpend). */
  spike: { enabled: boolean; dayMultiple: number; minTodaySpend: number };
  /** Q4 — công thần: ≥ minOrders7d đơn/7 ngày thì Q1/Q2 hạ xuống theo dõi sát. */
  grace: { enabled: boolean; minOrders7d: number };
  /** GĐ3 — TỰ THỰC THI (v1 chỉ hành động PAUSE với verdict pause_now/spike):
   *  off = tắt; dry_run = DIỄN TẬP (ghi sổ AdsActionLog, KHÔNG gọi sàn);
   *  live = gọi edit_manual_product_ads thật. Mặc định off — chỉ bật live sau
   *  khi probe xác minh enum edit_action + quyền write trên shop thật. */
  autoExecute: {
    mode: "off" | "dry_run" | "live";
    /** Trần hành động/ngày/gian — đệm dưới giới hạn sàn ~10 thao tác/item/ngày. */
    maxActionsPerDay: number;
  };
}

export const DEFAULT_SHOPEE_ASSISTANT_CONFIG: ShopeeAssistantConfig = {
  enabled: true,
  floor: { minSpend7d: 100_000, minClicks7d: 50 },
  hard: { enabled: true, zeroOrderSpend7d: 150_000, breakevenFactor: 0.95 },
  review: { enabled: true, dangerFactor: 1.1 },
  spike: { enabled: true, dayMultiple: 2, minTodaySpend: 100_000 },
  grace: { enabled: true, minOrders7d: 30 },
  autoExecute: { mode: "off", maxActionsPerDay: 5 },
};

/** Các mode tự thực thi hợp lệ (validate bản lưu/PUT). */
export const AUTO_EXECUTE_MODES = ["off", "dry_run", "live"] as const;

/** Vá bản lưu DB theo schema hiện tại — thêm luật mới không vỡ config cũ. */
export function normalizeAssistantConfig(raw: unknown): ShopeeAssistantConfig {
  const d = DEFAULT_SHOPEE_ASSISTANT_CONFIG;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, Record<string, unknown> | boolean>;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const bool = (v: unknown, fallback: boolean) =>
    typeof v === "boolean" ? v : fallback;
  const sect = (k: string) =>
    (typeof r[k] === "object" && r[k] !== null ? r[k] : {}) as Record<string, unknown>;
  return {
    enabled: bool(r.enabled, d.enabled),
    floor: {
      minSpend7d: num(sect("floor").minSpend7d, d.floor.minSpend7d),
      minClicks7d: num(sect("floor").minClicks7d, d.floor.minClicks7d),
    },
    hard: {
      enabled: bool(sect("hard").enabled, d.hard.enabled),
      zeroOrderSpend7d: num(sect("hard").zeroOrderSpend7d, d.hard.zeroOrderSpend7d),
      breakevenFactor: num(sect("hard").breakevenFactor, d.hard.breakevenFactor),
    },
    review: {
      enabled: bool(sect("review").enabled, d.review.enabled),
      dangerFactor: num(sect("review").dangerFactor, d.review.dangerFactor),
    },
    spike: {
      enabled: bool(sect("spike").enabled, d.spike.enabled),
      dayMultiple: num(sect("spike").dayMultiple, d.spike.dayMultiple),
      minTodaySpend: num(sect("spike").minTodaySpend, d.spike.minTodaySpend),
    },
    grace: {
      enabled: bool(sect("grace").enabled, d.grace.enabled),
      minOrders7d: num(sect("grace").minOrders7d, d.grace.minOrders7d),
    },
    autoExecute: {
      mode: (AUTO_EXECUTE_MODES as readonly string[]).includes(
        String(sect("autoExecute").mode)
      )
        ? (String(sect("autoExecute").mode) as "off" | "dry_run" | "live")
        : d.autoExecute.mode,
      maxActionsPerDay: num(
        sect("autoExecute").maxActionsPerDay,
        d.autoExecute.maxActionsPerDay
      ),
    },
  };
}

// ---------- Format helpers cho reasons ----------

function vnd(n: number): string {
  return `${Math.round(n).toLocaleString("vi-VN")}₫`;
}

function roasTxt(n: number): string {
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`;
}

function windowRoas(w: AssistantWindowMetrics): number | null {
  return w.spend > 0 ? w.broadGmv / w.spend : null;
}

// ---------- Đánh giá một campaign ----------

export function evaluateShopeeCampaign(
  input: AssistantCampaignInput,
  config: ShopeeAssistantConfig = DEFAULT_SHOPEE_ASSISTANT_CONFIG
): AssistantAssessment {
  if (!config.enabled || input.status !== "ongoing") {
    return { verdict: null, reasons: [] };
  }

  const { windows, breakevenRoas, avgDailySpend7d } = input;

  // ---- Q3 SPIKE — chạy TRƯỚC sàn dữ liệu: cháy ví phải báo ngay ----
  if (config.spike.enabled) {
    const today = windows.today;
    const todayRoas = windowRoas(today);
    const burning =
      today.spend >= config.spike.minTodaySpend &&
      avgDailySpend7d > 0 &&
      today.spend >= config.spike.dayMultiple * avgDailySpend7d;
    // Vọt chi mà ROAS hôm nay vẫn trên hòa vốn = scale thắng, không báo.
    const notPayingOff =
      breakevenRoas == null || todayRoas == null || todayRoas < breakevenRoas;
    if (burning && notPayingOff) {
      const reasons = [
        `Hôm nay đã tiêu ${vnd(today.spend)} — gấp ${(today.spend / avgDailySpend7d).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} lần trung bình ngày 7 ngày qua (${vnd(avgDailySpend7d)}).`,
      ];
      if (breakevenRoas != null && todayRoas != null) {
        reasons.push(
          `ROAS hôm nay ${roasTxt(todayRoas)} đang DƯỚI hòa vốn ${roasTxt(breakevenRoas)} — càng tiêu càng lỗ.`
        );
      } else if (todayRoas == null) {
        reasons.push(`Chi tiêu vọt lên nhưng chưa ghi nhận GMV nào hôm nay.`);
      }
      return { verdict: "spike", reasons, window: "today" };
    }
  }

  // ---- LỚP SÀN DỮ LIỆU: cửa sổ nào đủ mẫu mới được phán xét ----
  const eligible = ASSISTANT_WINDOWS.filter((k) => {
    const scale = WINDOW_FLOOR_SCALE[k];
    return (
      windows[k].spend >= config.floor.minSpend7d * scale &&
      windows[k].clicks >= config.floor.minClicks7d * scale
    );
  });
  if (eligible.length === 0) {
    return {
      verdict: "insufficient_data",
      reasons: [
        `Chưa đủ dữ liệu để phán xét: cần tối thiểu ${vnd(config.floor.minSpend7d)} chi tiêu và ${config.floor.minClicks7d} click trong 7 ngày (cửa sổ ngắn hơn ngưỡng thấp hơn tương ứng).`,
      ],
    };
  }

  // ---- Q1 LOẠI THẲNG (duyệt cửa sổ NGẮN trước — bắt bão hòa sớm nhất) ----
  let hardHit: {
    window: AssistantWindowKey;
    reasons: string[];
    triggers: AssistantTrigger[];
  } | null = null;
  if (config.hard.enabled) {
    for (const k of eligible) {
      const w = windows[k];
      const roas = windowRoas(w);
      const reasons: string[] = [];
      const triggers: AssistantTrigger[] = [];
      const zeroFloor = config.hard.zeroOrderSpend7d * WINDOW_FLOOR_SCALE[k];
      if (w.spend >= zeroFloor && w.broadOrder === 0) {
        reasons.push(
          `Cửa sổ ${WINDOW_LABEL[k]}: tiêu ${vnd(w.spend)} mà KHÔNG có đơn nào.`
        );
        triggers.push("zero_order");
      }
      if (
        breakevenRoas != null &&
        roas != null &&
        roas < breakevenRoas * config.hard.breakevenFactor
      ) {
        reasons.push(
          `Cửa sổ ${WINDOW_LABEL[k]}: ROAS ${roasTxt(roas)} dưới ngưỡng nguy hiểm ${roasTxt(breakevenRoas * config.hard.breakevenFactor)} (hòa vốn ${roasTxt(breakevenRoas)} × ${config.hard.breakevenFactor}) — mỗi đồng ads đang lỗ thật.`
        );
        triggers.push("below_breakeven");
      }
      if (reasons.length > 0) {
        hardHit = { window: k, reasons, triggers };
        break;
      }
    }
  }

  // ---- Q2 CHỜ DUYỆT — vùng vàng quanh hòa vốn ----
  let reviewHit: { window: AssistantWindowKey; reasons: string[] } | null = null;
  if (!hardHit && config.review.enabled && breakevenRoas != null) {
    for (const k of eligible) {
      const roas = windowRoas(windows[k]);
      if (
        roas != null &&
        roas >= breakevenRoas * config.hard.breakevenFactor &&
        roas < breakevenRoas * config.review.dangerFactor
      ) {
        reviewHit = {
          window: k,
          reasons: [
            `Cửa sổ ${WINDOW_LABEL[k]}: ROAS ${roasTxt(roas)} sát hòa vốn ${roasTxt(breakevenRoas)} (chưa vượt vùng an toàn ×${config.review.dangerFactor}) — lãi quá mỏng, lệch nhẹ là lỗ.`,
          ],
        };
        break;
      }
    }
  }

  // ---- Q4 CÔNG THẦN đánh chặn Q1/Q2 ----
  if ((hardHit || reviewHit) && config.grace.enabled) {
    const orders7d = windows["7d"].broadOrder;
    if (orders7d >= config.grace.minOrders7d) {
      const base = hardHit ?? reviewHit!;
      return {
        verdict: "grace",
        window: base.window,
        reasons: [
          `Chiến dịch công thần: ${orders7d} đơn/7 ngày (ngưỡng ${config.grace.minOrders7d}) — KHÔNG đề xuất dừng ngay, theo dõi sát thêm.`,
          ...base.reasons,
        ],
        triggers: hardHit?.triggers,
      };
    }
  }

  if (hardHit) {
    return {
      verdict: "pause_now",
      window: hardHit.window,
      reasons: hardHit.reasons,
      triggers: hardHit.triggers,
    };
  }
  if (reviewHit) {
    return { verdict: "review", window: reviewHit.window, reasons: reviewHit.reasons };
  }

  return { verdict: "healthy", reasons: [] };
}
