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

/**
 * NGƯỠNG TIỀN của Q1 (hard.zeroOrderSpend7d) theo cửa sổ — SỰ CỐ 14/09/2026:
 * Trợ lý live dừng campaign ANO đang lời lúc 07:05 vì ROAS "hôm nay" 4,96x
 * dưới hòa vốn khi mới tiêu hơn 20.000₫ — sàn dữ liệu ×0,2 cho phép phán xét
 * quá sớm trong khi đơn broad Shopee về trễ hàng giờ (chiều cùng ngày 8,98x).
 * Anh Trung chốt: (1) ngưỡng tiền gác CẢ HAI nhánh Q1 (0 đơn lẫn dưới hòa
 * vốn), (2) cửa sổ HÔM NAY đòi ĐỦ số tiền seller đặt, không nhân 0,2 — "bạn cho
 * phép mỗi campaign đốt tối đa X để thử; quá X mà chưa có lãi thì máy mới can
 * thiệp". 3d giữ 0,5 để vẫn bắt bão hòa sớm; 30d 1,5 như sàn dữ liệu.
 */
const WINDOW_MONEY_SCALE: Record<AssistantWindowKey, number> = {
  today: 1,
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
  /** Q1 — loại thẳng. zeroOrderSpend7d = NGƯỠNG TIỀN gác cả hai nhánh (0 đơn
   *  lẫn dưới hòa vốn; tên giữ vì tương thích bản lưu) — hôm nay đòi đủ, cửa sổ
   *  khác scale WINDOW_MONEY_SCALE. breakevenFactor <1 chừa vùng đệm cho Q2. */
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
    /** ĐỢT B (24/09): campaign lỗ (pause_now) thì HẠ NGÂN SÁCH NGÀY trước (change_budget),
     *  ngày sau vẫn lỗ mới tạm dừng; bật lại thì trả ngân sách cũ. Vọt chi (spike) vẫn
     *  tắt ngay. Chỉ Shopee có lệnh đổi ngân sách; Lazada luôn tắt như cũ. */
    cutBudgetFirst: boolean;
  };
}

export const DEFAULT_SHOPEE_ASSISTANT_CONFIG: ShopeeAssistantConfig = {
  enabled: true,
  floor: { minSpend7d: 100_000, minClicks7d: 50 },
  hard: { enabled: true, zeroOrderSpend7d: 150_000, breakevenFactor: 0.95 },
  review: { enabled: true, dangerFactor: 1.1 },
  spike: { enabled: true, dayMultiple: 2, minTodaySpend: 100_000 },
  grace: { enabled: true, minOrders7d: 30 },
  autoExecute: { mode: "off", maxActionsPerDay: 5, cutBudgetFirst: true },
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
      cutBudgetFirst: bool(sect("autoExecute").cutBudgetFirst, d.autoExecute.cutBudgetFirst),
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
  // Cửa sổ dưới hòa vốn nhưng CHƯA tiêu đủ ngưỡng tiền → không phán, chỉ ghi
  // chú để badge "Ổn" vẫn nói thật vì sao chưa kết luận (đơn về trễ).
  const underMoneyNotes: string[] = [];
  if (config.hard.enabled) {
    for (const k of eligible) {
      const w = windows[k];
      const roas = windowRoas(w);
      const reasons: string[] = [];
      const triggers: AssistantTrigger[] = [];
      const moneyGate = config.hard.zeroOrderSpend7d * WINDOW_MONEY_SCALE[k];
      const belowBreakeven =
        breakevenRoas != null &&
        roas != null &&
        roas < breakevenRoas * config.hard.breakevenFactor;
      if (w.spend < moneyGate) {
        if (belowBreakeven) {
          underMoneyNotes.push(
            `Cửa sổ ${WINDOW_LABEL[k]}: ROAS ${roasTxt(roas!)} đang dưới hòa vốn ${roasTxt(breakevenRoas!)} nhưng mới tiêu ${vnd(w.spend)} (ngưỡng can thiệp ${vnd(moneyGate)}) — chưa kết luận, đơn từ quảng cáo thường về trễ vài giờ.`
          );
        }
        continue; // chưa tiêu đủ tiền seller cho phép → Q1 không được phán ở cửa sổ này
      }
      if (w.broadOrder === 0) {
        reasons.push(
          `Cửa sổ ${WINDOW_LABEL[k]}: tiêu ${vnd(w.spend)} mà KHÔNG có đơn nào.`
        );
        triggers.push("zero_order");
      }
      if (belowBreakeven) {
        reasons.push(
          `Cửa sổ ${WINDOW_LABEL[k]}: ROAS ${roasTxt(roas!)} dưới ngưỡng nguy hiểm ${roasTxt(breakevenRoas! * config.hard.breakevenFactor)} (hòa vốn ${roasTxt(breakevenRoas!)} × ${config.hard.breakevenFactor}) — mỗi đồng ads đang lỗ thật, đã tiêu ${vnd(w.spend)} vượt ngưỡng can thiệp ${vnd(moneyGate)}.`
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

  return { verdict: "healthy", reasons: underMoneyNotes };
}

// ============================================================
// ĐỢT A (17/09/2026) — MỤC TIÊU ROAS TRÊN SÀN so với HÒA VỐN THẬT
//
// Campaign đấu thầu tự động mang `roas_target` seller đặt trên Seller Center.
// Đặt THẤP HƠN hòa vốn = ra lệnh cho Shopee tối ưu về đúng mức lỗ: sàn sẽ
// "đạt mục tiêu" mà shop vẫn mất tiền. Đây KHÔNG phải ngưỡng tay (bài học
// 10/08) — là so số seller đã đặt với số hòa vốn tính từ P&L.
//   below = mục tiêu < hòa vốn            → đang lỗ theo thiết kế
//   tight = hòa vốn ≤ mục tiêu < hòa vốn × dangerFactor → vùng vàng, lãi mỏng
//   ok    = từ vùng an toàn trở lên
//   null  = campaign không đặt mục tiêu (đấu thầu thủ công) hoặc chưa có hòa vốn
// safeTarget = hòa vốn × dangerFactor, làm tròn LÊN 0,1 (Shopee nhận 1 số lẻ).
// ============================================================

export type RoasTargetStatus = "below" | "tight" | "ok";

export interface RoasTargetCheck {
  status: RoasTargetStatus;
  target: number;
  breakevenRoas: number;
  /** Mục tiêu nên đặt = hòa vốn × dangerFactor, làm tròn lên 0,1. */
  safeTarget: number;
}

export function assessRoasTarget(input: {
  roasTarget: number | null | undefined;
  breakevenRoas: number | null | undefined;
  dangerFactor: number;
}): RoasTargetCheck | null {
  const target = Number(input.roasTarget);
  const be = Number(input.breakevenRoas);
  if (!(target > 0) || !(be > 0)) return null;
  const factor = input.dangerFactor > 0 ? input.dangerFactor : 1;
  const safeTarget = Math.ceil(be * factor * 10 - 1e-9) / 10;
  const status: RoasTargetStatus =
    target < be ? "below" : target < be * factor ? "tight" : "ok";
  return { status, target, breakevenRoas: be, safeTarget };
}

// ============================================================
// ĐỢT E (24/09/2026) — RỔ THỨ TƯ: ĐANG LÃI NHƯNG BỊ CHẶN PHÂN PHỐI
//
// Vòng tối ưu của người chạy ads có 4 rổ: lỗ nặng → tắt; lỗ nhẹ → hạ ngân
// sách / nâng mục tiêu; lãi mỏng → giữ; LÃI TỐT NHƯNG BỊ CHẶN → nới. Ba rổ đầu
// đã có (Q1–Q4 + đợt A), rổ cuối là rổ kiếm thêm tiền và Hubsell còn thiếu.
// Hai kiểu chặn Shopee cho sửa được:
//   budget_capped  = ngày nào cũng tiêu gần hết ngân sách ngày → ngân sách là
//                    thứ chặn đơn (Shopee ngừng hiển thị khi hết ngân sách ngày).
//   target_binding = đấu thầu tự động, ROAS thực dưới mục tiêu đang đặt nhưng
//                    trên hòa vốn → sàn chỉ đấu tới mức đạt mục tiêu nên phân
//                    phối dè dặt (cơ chế Shopee mô tả ở
//                    get_product_recommended_roi_target: lower bound = nhiều
//                    hiển thị hơn, upper bound = ít hơn).
// Căn cứ số:
//   - Cửa sổ 7 NGÀY TRỌN, bỏ hôm nay, đòi ≥ DELIVERY_MIN_FULL_DAYS ngày có
//     tiêu tiền — bài học 14/09 (đơn broad về trễ, hôm nay không được dùng).
//   - "Đang lãi" = ROAS 7 ngày ≥ hòa vốn × dangerFactor (cùng mốc vùng an toàn
//     của đợt A) VÀ verdict Trợ lý = healthy VÀ mục tiêu (nếu có) đã ở vùng ok.
//   - BUDGET_CAP_PCT = 90: MẶC ĐỊNH TỰ ĐẶT — Shopee không công bố mốc; số ngày
//     thường tiêu sát trần chứ hiếm khi đúng 100%. TikTok dùng 80% cho tính
//     năng tự tăng ngân sách của GMV Max; Shopee lấy chặt hơn để không réo sớm.
// CHỈ GỢI Ý — Hubsell không tự tăng ngân sách / hạ mục tiêu (anh Trung chốt
// "chỉ gợi ý" 23/09 cho TikTok, áp cùng cho Shopee).
// ============================================================

export const BUDGET_CAP_PCT = 90;
export const DELIVERY_MIN_FULL_DAYS = 3;

export type DeliveryStatus = "budget_capped" | "target_binding";

export interface DeliveryCheck {
  status: DeliveryStatus;
  /** ROAS 7 ngày trọn (bỏ hôm nay). */
  roas: number;
  breakevenRoas: number;
  /** Mốc mục tiêu KHÔNG nên hạ xuống dưới = hòa vốn × dangerFactor, làm tròn lên 0,1. */
  safeTarget: number;
  /** Ngân sách ngày trên sàn (0 = không giới hạn). */
  budget: number;
  /** Chi tiêu trung bình của những ngày trọn CÓ tiêu tiền. */
  avgDailySpend: number;
  /** % ngân sách ngày đang dùng; null khi không giới hạn. */
  budgetUsedPct: number | null;
  roasTarget: number | null;
  /** Số ngày trọn có tiêu tiền trong 7 ngày (cỡ mẫu). */
  fullDays: number;
}

export function assessDelivery(input: {
  status: string;
  verdict: AssistantVerdict | null;
  roasTargetCheck: RoasTargetCheck | null;
  breakevenRoas: number | null | undefined;
  budget: number;
  roasTarget: number | null | undefined;
  /** 7 ngày trọn trước hôm nay: tổng chi, tổng GMV broad, số ngày có tiêu tiền. */
  prev7: { spend: number; gmv: number; daysWithSpend: number };
  dangerFactor: number;
}): DeliveryCheck | null {
  if (input.status !== "ongoing" || input.verdict !== "healthy") return null;
  const be = Number(input.breakevenRoas);
  if (!(be > 0)) return null;
  const { spend, gmv, daysWithSpend } = input.prev7;
  if (daysWithSpend < DELIVERY_MIN_FULL_DAYS || !(spend > 0)) return null;
  const factor = input.dangerFactor > 0 ? input.dangerFactor : 1;
  const roas = gmv / spend;
  if (roas < be * factor) return null;
  if (input.roasTargetCheck && input.roasTargetCheck.status !== "ok") return null;

  const safeTarget = Math.ceil(be * factor * 10 - 1e-9) / 10;
  const budget = Number(input.budget) || 0;
  const avgDailySpend = spend / daysWithSpend;
  const budgetUsedPct = budget > 0 ? Math.round((avgDailySpend / budget) * 100) : null;
  const roasTarget =
    input.roasTarget != null && Number(input.roasTarget) > 0 ? Number(input.roasTarget) : null;
  const base = {
    roas,
    breakevenRoas: be,
    safeTarget,
    budget,
    avgDailySpend,
    budgetUsedPct,
    roasTarget,
    fullDays: daysWithSpend,
  };
  if (budgetUsedPct != null && budgetUsedPct >= BUDGET_CAP_PCT) {
    return { status: "budget_capped", ...base };
  }
  if (roasTarget != null && roas < roasTarget) {
    return { status: "target_binding", ...base };
  }
  return null;
}

// ============================================================
// ĐỢT B (24/09/2026) — HẠ NGÂN SÁCH TRƯỚC, TẮT SAU ("bleed control")
//
// Người chạy ads chuyên nghiệp tránh tắt campaign đang lỗ ngay lần đầu: tắt là
// mất giai đoạn học máy + thứ hạng, bật lại phải học từ đầu. Nấc đầu là khóa
// trần tiền mất: hạ ngân sách ngày, để campaign sống; ngày sau vẫn lỗ mới tắt.
// Mức hạ (docs/ADS-SHOPEE-KHAI-THAC-API.md mục 3 đợt B, anh Trung duyệt 17/09):
//   ngân sách mới = max(CUT_KEEP_RATIO × ngân sách hiện tại, CUT_SPEND_RATIO × chi
//   tiêu TB ngày 7 ngày trước), làm tròn CUT_ROUND_VND. Hai tỷ lệ là MẶC ĐỊNH TỰ
//   ĐẶT (không sàn nào công bố): giữ ≥ 50% để campaign còn phân phối, 70% chi
//   tiêu thật để trần có nghĩa với campaign đang tiêu dưới ngân sách.
// Ngân sách KHÔNG GIỚI HẠN (0) mà lỗ → đặt trần = 70% chi tiêu TB ngày (không có
// chi tiêu để làm căn cứ thì không hạ, executor tắt như cũ). Mức tối thiểu của
// sàn KHÔNG tự đoán: Shopee tự từ chối (ads.campaign.error_daily_budget_range),
// lỗi ghi nguyên văn vào sổ.
// ============================================================

export const CUT_KEEP_RATIO = 0.5;
export const CUT_SPEND_RATIO = 0.7;
export const CUT_ROUND_VND = 1000;

export interface BudgetCutPlan {
  /** Ngân sách ngày mới (đồng, bội số CUT_ROUND_VND). */
  newBudget: number;
  /** Ngân sách hiện tại (0 = không giới hạn). */
  budget: number;
  avgDailySpend7d: number;
  /** Căn cứ chọn mức — tiếng Việt kèm số, ghi sổ nguyên văn. */
  basis: string;
}

export function planBudgetCut(input: { budget: number; avgDailySpend7d: number }): BudgetCutPlan | null {
  const budget = Number(input.budget) || 0;
  const avg = Number(input.avgDailySpend7d) || 0;
  const round = (v: number) => Math.max(CUT_ROUND_VND, Math.round(v / CUT_ROUND_VND) * CUT_ROUND_VND);
  if (budget <= 0) {
    if (avg <= 0) return null; // không có chi tiêu làm căn cứ đặt trần
    const newBudget = round(avg * CUT_SPEND_RATIO);
    return {
      newBudget,
      budget,
      avgDailySpend7d: avg,
      basis: `Ngân sách đang KHÔNG giới hạn — đặt trần ${vnd(newBudget)}/ngày = ${Math.round(CUT_SPEND_RATIO * 100)}% chi tiêu trung bình ngày 7 ngày qua (${vnd(avg)}).`,
    };
  }
  const keep = budget * CUT_KEEP_RATIO;
  const bySpend = avg * CUT_SPEND_RATIO;
  const newBudget = round(Math.max(keep, bySpend));
  if (newBudget >= budget) return null; // không còn gì để hạ
  const basis =
    bySpend > keep
      ? `Hạ ngân sách ngày ${vnd(budget)} → ${vnd(newBudget)} = ${Math.round(CUT_SPEND_RATIO * 100)}% chi tiêu trung bình ngày 7 ngày qua (${vnd(avg)}).`
      : `Hạ ngân sách ngày ${vnd(budget)} → ${vnd(newBudget)} = ${Math.round(CUT_KEEP_RATIO * 100)}% ngân sách hiện tại (chi tiêu trung bình ngày ${vnd(avg)} thấp hơn mức này).`;
  return { newBudget, budget, avgDailySpend7d: avg, basis };
}
