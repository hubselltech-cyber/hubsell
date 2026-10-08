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
import { roasText as roasTxt, vndText as vnd } from "../../lib/ads-format";

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
   *  khi probe xác minh enum edit_action + quyền write trên shop thật.
   *  Không có trần lệnh mỗi ngày (gỡ 01/10/2026): bản lưu cũ còn trường
   *  maxActionsPerDay thì normalize bỏ qua. */
  /** HẠ MỤC TIÊU THEO BIÊN LÃI (08/10/2026): lãi tối thiểu muốn giữ lại sau quảng cáo trên mỗi 100đ doanh thu.
   *  Sàn "ROAS an toàn" = 1 / (biên − minKeepPer100/100) — xem profitFloorRoas. */
  profit: { minKeepPer100: number };
  autoExecute: {
    mode: "off" | "dry_run" | "live";
    /** ĐỢT B (24/09): campaign lỗ (pause_now) thì HẠ NGÂN SÁCH NGÀY trước (change_budget),
     *  ngày sau vẫn lỗ mới tạm dừng; bật lại thì trả ngân sách cũ. Vọt chi (spike) vẫn
     *  tắt ngay. Chỉ Shopee có lệnh đổi ngân sách; Lazada luôn tắt như cũ. */
    cutBudgetFirst: boolean;
  };
}

/** Lãi tối thiểu muốn giữ sau quảng cáo (đ/100đ doanh thu) — MẶC ĐỊNH TỰ CHỌN; căn cứ xem mục "SÀN ROAS AN TOÀN" bên dưới. */
export const DEFAULT_MIN_KEEP_PER_100 = 5;

export const DEFAULT_SHOPEE_ASSISTANT_CONFIG: ShopeeAssistantConfig = {
  enabled: true,
  floor: { minSpend7d: 100_000, minClicks7d: 50 },
  hard: { enabled: true, zeroOrderSpend7d: 150_000, breakevenFactor: 0.95 },
  review: { enabled: true, dangerFactor: 1.1 },
  spike: { enabled: true, dayMultiple: 2, minTodaySpend: 100_000 },
  grace: { enabled: true, minOrders7d: 30 },
  profit: { minKeepPer100: DEFAULT_MIN_KEEP_PER_100 },
  autoExecute: { mode: "off", cutBudgetFirst: true },
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
    profit: {
      // Trần 99: lãi mong muốn ≥ 100đ/100đ là vô nghĩa (không ROAS nào đạt) — bản lưu rác về mặc định.
      minKeepPer100: (() => {
        const v = num(sect("profit").minKeepPer100, d.profit.minKeepPer100);
        return v < 100 ? v : d.profit.minKeepPer100;
      })(),
    },
    autoExecute: {
      mode: (AUTO_EXECUTE_MODES as readonly string[]).includes(
        String(sect("autoExecute").mode)
      )
        ? (String(sect("autoExecute").mode) as "off" | "dry_run" | "live")
        : d.autoExecute.mode,
      cutBudgetFirst: bool(sect("autoExecute").cutBudgetFirst, d.autoExecute.cutBudgetFirst),
    },
  };
}

// ---------- Format helpers cho reasons ----------

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

// HẠ MỤC TIÊU ROAS THEO NẤC (04/10/2026, anh Trung: "12,5 giảm một phát về 7,5
// có sâu quá không"). safeTarget là SÀN không được thủng, KHÔNG phải đích một
// lần. Căn cứ:
//   - Shopee, GMV Max FAQ (ads.shopee.ph/learn/faq/478/1829, mục chỉnh ROAS):
//     mỗi lần tăng / giảm KHÔNG QUÁ 20%; đổi mục tiêu là vào lại giai đoạn học
//     ít nhất 7 ngày; nên nhìn 7–14 ngày, bỏ qua dao động từng ngày.
//   - Google Ads (support.google.com/google-ads/answer/10433846): tránh đổi
//     mục tiêu nhiều lần trong một chu kỳ chuyển đổi, chờ 1–2 chu kỳ rồi đánh giá.
// ANH TRUNG CHỐT 04/10: mỗi nấc 10% (nửa trần 20% của Shopee) và KHÓA CỨNG 48 GIỜ
// giữa hai nấc — trong 48 giờ sau khi mục tiêu đổi, không gợi ý hạ tiếp. (Shopee
// nói giai đoạn học ít nhất 7 ngày; 48 giờ là mức anh chọn để gợi ý không quá chậm.)
// Mốc đổi = AdsCampaign.roasTargetChangedAt, chính xác tới nhịp đồng bộ quảng cáo.
export const TARGET_STEP_PCT = 0.1;
export const TARGET_STEP_WAIT_HOURS = 48;

// SÀN "ROAS AN TOÀN" THEO BIÊN LÃI + VẠCH "MỤC TIÊU ĐANG GHÌM" (anh Trung 08/10/2026, ca ANO TikTok: ROI thực 13,84 /
// mục tiêu 15 / hòa vốn 5,58 / tiêu 12% ngân sách mà máy nói "chưa thấy gì cần sửa" vì ROI đã ≥ 90% mục tiêu).
//   - Sàn an toàn = 1 / (biên − lãi mong muốn/100): công thức "mục tiêu = 1/(biên − lãi ròng mong muốn)" của giới Amazon ACoS
//     (Target ACoS = margin − desired profit; BQool) — chính là POAS tối thiểu diễn đạt bằng ROAS. Thay cho "hòa vốn × 1,1"
//     (hệ số không nói được giữ bao nhiêu lãi). Sàn này không bao giờ thấp hơn hòa vốn × dangerFactor (vùng vàng của đợt A).
//   - DEFAULT_MIN_KEEP_PER_100 = 5đ/100đ: MẶC ĐỊNH TỰ CHỌN (không sàn nào công bố), khách sửa trong Cấu hình Trợ lý. Với biên
//     ~18% nó trùng mốc 1,4 × hòa vốn mà blog ngành hay khuyên (Top Growth Marketing: 1,3–1,5 × break-even).
//   - TARGET_BINDING_BAND 1,1: ROAS thực < mục tiêu × 1,1 (kể cả đã đạt) + ngân sách còn dư → mục tiêu là thứ đang ghìm
//     (TikTok: "lower ROI targets boost delivery and GMV, higher targets may limit spend"; Shopee: lower bound = nhiều hiển
//     thị hơn). ROAS vượt mục tiêu quá 10% mà vẫn tiêu ít → thứ chặn nằm ở video / sản phẩm, hạ mục tiêu không giúp.
//     Số 1,1 là MẶC ĐỊNH TỰ CHỌN, đối xứng với mốc "đạt từ 90%" của TikTok.
//   - stepProfitCheck: thước đo ROAS BIÊN rẻ tiền — so LÃI TUYỆT ĐỐI (GMV × biên − chi) của STEP_CHECK_DAYS ngày trọn sau nấc
//     hạ với cùng số ngày trước đó; không tăng → hạ thêm không ra thêm tiền, giữ mục tiêu (lợi nhuận lớn nhất khi đồng kế
//     tiếp vẫn trả trên hòa vốn — WorkMagic / SegmentStream về marginal ROAS). Chỉ xét khi lần đổi gần nhất là HẠ (roasTargetPrev).
export const TARGET_BINDING_BAND = 1.1;
export const STEP_CHECK_DAYS = 2;

/** Sàn ROAS giữ được `minKeepPer100` đ lãi / 100đ doanh thu, làm tròn LÊN 0,1. null = biên không đủ cho mức lãi đó. */
export function profitFloorRoas(margin: number, minKeepPer100: number): number | null {
  if (!Number.isFinite(margin) || margin <= 0) return null;
  const left = margin - Math.max(0, minKeepPer100) / 100;
  if (!(left > 0)) return null;
  return Math.ceil((1 / left) * 10 - 1e-9) / 10;
}

export interface StepProfitCheck {
  /** Ngày sàn (VN) có lần hạ mục tiêu gần nhất. */
  changedOn: string;
  /** Lãi tuyệt đối N ngày trọn TRƯỚC ngày đổi / SAU ngày đổi (bỏ chính ngày đổi vì nửa cũ nửa mới). */
  before: number;
  after: number;
  days: number;
  /** after ≤ before: hạ không ra thêm lãi. */
  flat: boolean;
}

/**
 * So lãi tuyệt đối trước / sau nấc HẠ gần nhất. null khi: chưa từng hạ (prev null hoặc prev ≤ hiện tại), chưa đủ N ngày
 * trọn sau ngày đổi, hoặc không đủ N ngày có số trước đó. `days` = số theo ngày của chính chiến dịch (ngày sàn, bất kỳ thứ tự).
 */
export function stepProfitCheck(input: {
  days: { date: string; expense: number; gmv: number }[];
  margin: number;
  roasTarget: number | null;
  roasTargetPrev: number | null;
  changedOn: string | null;
  today: string;
  n?: number;
}): StepProfitCheck | null {
  const n = input.n ?? STEP_CHECK_DAYS;
  const changedOn = input.changedOn;
  if (!changedOn || input.roasTarget == null || input.roasTargetPrev == null) return null;
  if (!(input.roasTargetPrev > input.roasTarget)) return null;
  if (!Number.isFinite(input.margin)) return null;
  const sorted = [...input.days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const before = sorted.filter((d) => d.date < changedOn).slice(-n);
  const after = sorted.filter((d) => d.date > changedOn && d.date < input.today).slice(0, n);
  if (before.length < n || after.length < n) return null;
  const profit = (rows: { expense: number; gmv: number }[]) =>
    Math.round(rows.reduce((s, d) => s + d.gmv * input.margin - d.expense, 0));
  const b = profit(before);
  const a = profit(after);
  return { changedOn, before: b, after: a, days: n, flat: a <= b };
}

/** Nấc hạ kế tiếp của mục tiêu ROAS: giảm TARGET_STEP_PCT, 1 số lẻ, không thủng sàn.
 *  null = đã sát sàn, không còn nấc nào để hạ. */
export function nextRoasTargetStep(target: number, safeTarget: number): number | null {
  const stepped = Math.round(target * (1 - TARGET_STEP_PCT) * 10) / 10;
  const next = Math.max(stepped, safeTarget);
  return next < target ? next : null;
}

export type DeliveryStatus = "budget_capped" | "target_binding" | "target_hold";

export interface DeliveryCheck {
  status: DeliveryStatus;
  /** ROAS 7 ngày trọn (bỏ hôm nay). */
  roas: number;
  breakevenRoas: number;
  /** Mốc mục tiêu KHÔNG nên hạ xuống dưới = max(hòa vốn × dangerFactor, sàn giữ lãi mong muốn), làm tròn lên 0,1. */
  safeTarget: number;
  /** Lãi tối thiểu muốn giữ (đ/100đ doanh thu) đã dùng để tính safeTarget. */
  minKeepPer100: number;
  /** Lãi/100đ doanh thu nếu ROAS thực về đúng nextTarget (biên − 1/nextTarget); null khi không có nấc. */
  keepAtNextTarget: number | null;
  /** target_hold: lãi tuyệt đối trước / sau nấc hạ gần nhất. */
  stepCheck: StepProfitCheck | null;
  /** Ngân sách ngày trên sàn (0 = không giới hạn). */
  budget: number;
  /** Chi tiêu trung bình của những ngày trọn CÓ tiêu tiền. */
  avgDailySpend: number;
  /** % ngân sách ngày đang dùng; null khi không giới hạn. */
  budgetUsedPct: number | null;
  roasTarget: number | null;
  /** target_binding: mục tiêu nên hạ xuống ở NẤC NÀY (xem nextRoasTargetStep). */
  nextTarget: number | null;
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
  /** Mốc mục tiêu ROAS đổi gần nhất — còn trong TARGET_STEP_WAIT_HOURS thì không gợi ý hạ tiếp. */
  roasTargetChangedAt?: Date | null;
  now?: Date;
  /** Lãi tối thiểu muốn giữ (đ/100đ) — config.profit.minKeepPer100; bỏ trống = mặc định. */
  minKeepPer100?: number;
  /** Kết quả so lãi trước / sau nấc hạ gần nhất (stepProfitCheck); flat → target_hold. */
  stepCheck?: StepProfitCheck | null;
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

  const minKeepPer100 = input.minKeepPer100 ?? DEFAULT_MIN_KEEP_PER_100;
  const margin = 1 / be;
  // Sàn an toàn = cao hơn của (vùng vàng đợt A) và (sàn giữ lãi mong muốn). Biên không đủ cho lãi mong muốn → không có
  // sàn hợp lệ để hạ tới → không gợi ý hạ (Infinity làm nextRoasTargetStep trả null).
  const profitFloor = profitFloorRoas(margin, minKeepPer100);
  const safeTarget = Math.max(Math.ceil(be * factor * 10 - 1e-9) / 10, profitFloor ?? Number.POSITIVE_INFINITY);
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
    nextTarget: null,
    fullDays: daysWithSpend,
    minKeepPer100,
    keepAtNextTarget: null,
    stepCheck: input.stepCheck ?? null,
  };
  if (budgetUsedPct != null && budgetUsedPct >= BUDGET_CAP_PCT) {
    return { status: "budget_capped", ...base };
  }
  // Mục tiêu đang ghìm: ROAS thực chưa vượt mục tiêu quá TARGET_BINDING_BAND (kể cả đã đạt) + ngân sách còn dư.
  if (roasTarget != null && roas < roasTarget * TARGET_BINDING_BAND) {
    // Khóa cứng giữa hai nấc: mục tiêu vừa đổi thì để sàn chạy đủ TARGET_STEP_WAIT_HOURS.
    const changedAt = input.roasTargetChangedAt;
    const now = input.now ?? new Date();
    if (changedAt && now.getTime() - changedAt.getTime() < TARGET_STEP_WAIT_HOURS * 3_600_000) {
      return null;
    }
    // Nấc hạ gần nhất không ra thêm lãi → giữ, không hạ tiếp (đo ROAS biên bằng lãi tuyệt đối).
    if (input.stepCheck?.flat) {
      return { status: "target_hold", ...base };
    }
    // Mục tiêu đã sát sàn an toàn thì không còn gì để khuyên hạ.
    const nextTarget = nextRoasTargetStep(roasTarget, safeTarget);
    if (nextTarget == null) return null;
    const keepAtNextTarget = Math.round((margin - 1 / nextTarget) * 1000) / 10;
    return { status: "target_binding", ...base, nextTarget, keepAtNextTarget };
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

// ============================================================
// KẾT LUẬN ĐỀ XUẤT (04/10/2026, anh Trung: "Căn cứ" phải chốt bằng một dòng
// nên làm gì). Một câu duy nhất, rút từ CHÍNH các nhận định đã có (verdict,
// nhánh Q1, mục tiêu ROAS so hòa vốn, rổ bị chặn phân phối, biên lãi trước
// ads) — không thêm ngưỡng mới. Thứ tự ưu tiên: lỗ trước ads → cháy tiền →
// dưới hòa vốn → vùng vàng → đang lãi bị chặn → ổn.
// null = không có gì để khuyên (campaign không chạy và Hubsell không đụng tới).
// ============================================================

const roasText = (v: number) => `${String(Math.round(v * 10) / 10).replace(".", ",")}x`;

export function recommendAction(input: {
  verdict: AssistantVerdict | null;
  triggers?: AssistantTrigger[];
  /** Biên lãi ≤ 0: sản phẩm lỗ ngay cả khi chưa tính quảng cáo. */
  lossBeforeAds: boolean;
  roasTargetCheck: RoasTargetCheck | null;
  delivery: DeliveryCheck | null;
  /** Trợ lý đã tự ra tay với campaign này. */
  hubsellPaused: boolean;
  hubsellBudgetCut: boolean;
}): string | null {
  const { verdict, roasTargetCheck: target, delivery } = input;
  if (input.hubsellPaused) {
    return "Hubsell đã tạm dừng. Chỉ bật lại sau khi đã chỉnh giá bán hoặc mục tiêu ROAS.";
  }
  if (!verdict) return null;
  const flagged = verdict === "spike" || verdict === "pause_now" || verdict === "review";
  const raiseTarget =
    target && target.status !== "ok"
      ? `Nâng mục tiêu ROAS từ ${roasText(target.target)} lên ${roasText(target.safeTarget)}`
      : null;

  if (input.lossBeforeAds && (flagged || verdict === "grace")) {
    return "Tạm dừng. Sản phẩm đang lỗ ngay cả khi chưa tính quảng cáo, cần tăng giá bán hoặc giảm giá vốn trước khi chạy lại.";
  }
  if (verdict === "spike") {
    return "Tạm dừng ngay để chặn tiền, kiểm tra xong mới bật lại.";
  }
  if (verdict === "pause_now") {
    if (input.triggers?.includes("zero_order")) {
      return "Tạm dừng. Tiêu tiền mà không ra đơn, xem lại sản phẩm, hình ảnh và giá trước khi chạy lại.";
    }
    if (raiseTarget) return `${raiseTarget}. Vài ngày sau vẫn dưới hòa vốn thì tạm dừng.`;
    return input.hubsellBudgetCut
      ? "Hubsell đã hạ ngân sách ngày. Ngày mai vẫn dưới hòa vốn thì tạm dừng."
      : "Tạm dừng, hoặc hạ ngân sách ngày nếu muốn giữ chiến dịch.";
  }
  if (verdict === "review") {
    return raiseTarget
      ? `${raiseTarget} để có lãi an toàn.`
      : "Theo dõi thêm, chưa tăng ngân sách. Lãi đang mỏng, tăng giá bán sẽ hạ được mức hòa vốn.";
  }
  if (verdict === "grace") {
    return "Theo dõi sát, chưa dừng: chiến dịch này từng mang về nhiều đơn.";
  }
  if (verdict === "insufficient_data") {
    return "Chờ thêm dữ liệu, chưa đủ để kết luận.";
  }
  // healthy
  if (target?.status === "below") {
    return `${raiseTarget}: mục tiêu đang đặt thấp hơn hòa vốn ${roasText(target.breakevenRoas)}.`;
  }
  if (delivery?.status === "budget_capped") {
    return "Tăng ngân sách ngày: chiến dịch đang lãi và ngày nào cũng tiêu gần hết ngân sách.";
  }
  if (delivery?.status === "target_hold" && delivery.stepCheck) {
    const sc = delivery.stepCheck;
    return (
      `Giữ mục tiêu ROAS. Sau nấc hạ gần nhất (${sc.changedOn}), lãi ${sc.days} ngày sau (${vnd(sc.after)}) ` +
      `không hơn ${sc.days} ngày trước (${vnd(sc.before)}) — hạ thêm không ra thêm lãi.`
    );
  }
  if (delivery?.status === "target_binding" && delivery.roasTarget != null && delivery.nextTarget != null) {
    const keep =
      delivery.keepAtNextTarget != null
        ? ` Ở ${roasText(delivery.nextTarget)} mỗi 100đ doanh thu còn lãi khoảng ${delivery.keepAtNextTarget.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}đ.`
        : "";
    return (
      `Giảm mục tiêu ROAS một nấc, từ ${roasText(delivery.roasTarget)} xuống ${roasText(delivery.nextTarget)}, ` +
      `rồi theo dõi ${TARGET_STEP_WAIT_HOURS} giờ mới giảm tiếp.${keep} Không xuống dưới ${roasText(delivery.safeTarget)} (giữ lãi từ ${delivery.minKeepPer100}đ/100đ).`
    );
  }
  return "Giữ nguyên, chiến dịch đang ổn.";
}
