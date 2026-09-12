// ============================================================
// KẾ HOẠCH SỨC CHỨA — NGUỒN DUY NHẤT cho mục "Sức khỏe" của Hubsell HQ
// (docs/HQ-SUC-KHOE.md, anh Trung chốt 12/09/2026)
//
// Gồm: (1) gói hạ tầng ĐANG DÙNG (anh sửa tay khi nâng — Render/Supabase không
// lộ gói qua API), (2) ngưỡng dấu hiệu quá tải, (3) TIMELINE mốc tăng trưởng:
// chạm khi nào, nâng gói gì, việc phải làm gì. Hàm thuần bên dưới để worker và
// trang HQ dùng chung, có test.
// ============================================================

// ---------- 1. Gói đang dùng (SỬA TAY KHI NÂNG GÓI) ----------

export interface InfraPlan {
  /** Tên gói hiển thị. */
  webPlan: string;
  workerPlan: string;
  dbPlan: string;
  /** RAM tiến trình web (MB) theo gói Render. */
  webRamMb: number;
  /** RAM worker (MB); 0 = chưa tách worker (chạy chung web). */
  workerRamMb: number;
  /** Dung lượng DB gói (MB). Supabase Free 500MB, Pro 8GB. */
  dbSizeMb: number;
  /** Trần kết nối DB (Supabase Free: ~60 direct, pooler session 200). */
  dbMaxConnections: number;
  /** Chi phí ước/tháng (USD) của tổ hợp hiện tại. */
  monthlyUsd: number;
}

export const CURRENT_INFRA: InfraPlan = {
  webPlan: "Render Free (512MB, 0.1 CPU)",
  workerPlan: "Chưa tách (HUBSELL_ROLE=all)",
  dbPlan: "Supabase Free (500MB)",
  webRamMb: 512,
  workerRamMb: 0,
  dbSizeMb: 500,
  dbMaxConnections: 60,
  monthlyUsd: 0,
};

// ---------- 2. Ngưỡng dấu hiệu (WORKER + INFRA) ----------

export const HEALTH_THRESHOLDS = {
  /** Gian trễ hạn quét nhanh quá N phút = "trễ". */
  fastOverdueMin: 15,
  /** Tỷ lệ gian trễ (%) hoặc số gian trễ tuyệt đối → cảnh báo quá tải worker. */
  overdueRatioPct: 5,
  overdueAbs: 20,
  /** Hàng đợi webhook: số job chờ / tuổi job cũ nhất (phút). */
  webhookPending: 200,
  webhookOldestMin: 30,
  /** % gói DB / RAM / kết nối → vàng, đỏ. */
  dbPctWarn: 60,
  dbPctCrit: 80,
  ramPctWarn: 70,
  ramPctCrit: 85,
  connPctWarn: 60,
  connPctCrit: 80,
  /** Gian DISCONNECTED tăng ≥ N trong 24h → cảnh báo token/ủy quyền. */
  disconnectedDelta24h: 3,
  /** Dự báo chạm mốc trong ≤ N ngày → nhắc trước. */
  etaWarnDays: 14,
} as const;

// ---------- 3. Timeline mốc ----------

/** Các đại lượng dùng làm điều kiện chạm mốc. */
export interface GrowthMetrics {
  channels: number; // gian ACTIVE (Shopee+Lazada+TikTok, không tính Offline)
  owners: number; // chủ shop
  ordersPerDay: number; // TB 7 ngày
  dbPct: number; // % gói DB
  ramPct: number; // % RAM gói
  connPct: number; // % kết nối gói
}

export type MetricKey = keyof GrowthMetrics;

export interface MilestoneCondition {
  metric: MetricKey;
  gte: number;
}

export interface MilestoneUpgrade {
  what: string;
  usdPerMonth: number;
}

export interface CapacityMilestone {
  key: string;
  title: string;
  /** Chạm khi BẤT KỲ điều kiện nào đúng. Rỗng = mốc hiện tại (M0). */
  conditions: MilestoneCondition[];
  upgrades: MilestoneUpgrade[];
  checklist: string[];
  note?: string;
}

export const CAPACITY_MILESTONES: CapacityMilestone[] = [
  {
    key: "M0",
    title: "Khởi động (shop nhà + reviewer ISV)",
    conditions: [],
    upgrades: [],
    checklist: [
      "ISV Shopee được duyệt → Go-Live app Hubsell Ads → 3 shop nhà ủy quyền lại",
      "Nhận trả lời 2 ticket quota (Shopee email, Lazada #58082) → đặt ADS_APP_QPS / ADS_PULSE_LAZADA_MINUTES",
      "Gỡ liên kết trùng shop nhà ở nick test (GIỮ admin@hubsell.vn)",
    ],
  },
  {
    key: "M1",
    title: "20 gian / 500 đơn-ngày — tách worker, lên gói trả phí",
    // Anh Trung 12/09: "một khách ngày vài nghìn đơn là cũng chết dở" → mọi mốc
    // đều phải có điều kiện ĐƠN/NGÀY, chạm 1 trong 2 (gian HOẶC đơn) là đủ.
    conditions: [
      { metric: "channels", gte: 20 },
      { metric: "ordersPerDay", gte: 500 },
      { metric: "owners", gte: 50 },
      { metric: "dbPct", gte: 60 },
    ],
    upgrades: [
      { what: "Render web Starter (512MB, không ngủ)", usdPerMonth: 7 },
      { what: "Render Background Worker Starter (HUBSELL_ROLE=worker)", usdPerMonth: 7 },
      { what: "Supabase Pro (8GB DB, backup hàng ngày, pooler)", usdPerMonth: 25 },
    ],
    checklist: [
      "Tạo service hubsell-worker-sg, copy env, HUBSELL_ROLE=worker; web đặt HUBSELL_ROLE=web (docs/DEPLOY-RENDER-SUPABASE.md Bước 2b)",
      "Thêm connection_limit=5&pool_timeout=30 vào DATABASE_URL",
      "Bật backup hàng ngày Supabase; ghi lịch restore thử",
      "Cập nhật CURRENT_INFRA trong config/capacity-plan.ts",
    ],
  },
  {
    key: "M2",
    title: "100 gian / 2.000 đơn-ngày — worker 2GB, cảnh báo ra ngoài",
    conditions: [
      { metric: "channels", gte: 100 },
      { metric: "ordersPerDay", gte: 2000 },
      { metric: "ramPct", gte: 80 },
    ],
    upgrades: [{ what: "Worker Standard (2GB RAM, 1 CPU)", usdPerMonth: 25 }],
    checklist: [
      "AUTO_SYNC_CONCURRENCY=6 trên worker",
      "Upsert hiệu suất ads theo lô (createMany/onConflict) thay từng dòng",
      "Webhook Lazada vào hàng đợi bền như Shopee",
      "Rà index Order(channelId, createdAt), OrderItem(orderId)",
    ],
  },
  {
    key: "M3",
    title: "500 gian / 10.000 đơn-ngày — DB compute + 2 worker",
    conditions: [
      { metric: "channels", gte: 500 },
      { metric: "ordersPerDay", gte: 10000 },
      { metric: "connPct", gte: 80 },
      { metric: "dbPct", gte: 70 },
    ],
    upgrades: [
      { what: "Supabase compute Small → Medium", usdPerMonth: 60 },
      { what: "Render web Standard", usdPerMonth: 25 },
      { what: "Render Key Value (Redis) cho token bucket + cầu dao toàn cục", usdPerMonth: 10 },
    ],
    checklist: [
      "2 worker instance (claim theo vé đã sẵn) — chia ADS_APP_QPS đều",
      "Retention đơn 1 năm + rollup tháng (hubsell-data-retention)",
      "Log cleanup 7 ngày cho mọi bảng log",
      "Chuyển token bucket/cầu dao sang Redis",
    ],
  },
  {
    key: "M4",
    title: "1.000 gian / 30.000 đơn-ngày — replica đọc, queue riêng, người trực",
    conditions: [
      { metric: "channels", gte: 1000 },
      { metric: "ordersPerDay", gte: 30000 },
    ],
    upgrades: [
      { what: "Supabase Team + read replica", usdPerMonth: 599 },
      { what: "Render worker Pro (4GB) ×2", usdPerMonth: 170 },
    ],
    checklist: [
      "Báo cáo/P&L/Tổng quan đọc từ replica",
      "Thay setInterval bằng queue có ưu tiên (pg-boss) cho mọi worker",
      "SLA nội bộ + lịch trực sự cố; runbook",
      "Lazada ads: tính năng có điều kiện nếu quota không được nâng",
    ],
  },
  {
    key: "M5",
    title: "5.000 gian / 100.000 đơn-ngày — tách worker theo sàn, APM",
    conditions: [
      { metric: "channels", gte: 5000 },
      { metric: "ordersPerDay", gte: 100000 },
    ],
    upgrades: [{ what: "Nhiều instance web + worker theo sàn; APM (Sentry/Datadog)", usdPerMonth: 400 }],
    checklist: [
      "Worker riêng cho Shopee / Lazada / TikTok, rate limit theo tenant",
      "APM + tracing; dashboard SLO",
    ],
  },
  {
    key: "M6",
    title: "10.000 gian / 300.000 đơn-ngày — tách đọc/ghi, partition theo tháng",
    conditions: [
      { metric: "channels", gte: 10000 },
      { metric: "ordersPerDay", gte: 300000 },
    ],
    upgrades: [{ what: "Postgres partition Order/OrderItem theo tháng; DB đọc/ghi tách", usdPerMonth: 1500 }],
    checklist: ["Kiến trúc lại đơn/kho theo shard", "SRE trực 24/7"],
  },
];

// ---------- 4. Hàm thuần ----------

/** Điều kiện nào của mốc đang thỏa với số hiện tại. */
export function metConditions(m: CapacityMilestone, g: GrowthMetrics): MilestoneCondition[] {
  return m.conditions.filter((c) => g[c.metric] >= c.gte);
}

export function isMilestoneReached(m: CapacityMilestone, g: GrowthMetrics): boolean {
  return m.conditions.length === 0 || metConditions(m, g).length > 0;
}

/**
 * Mốc "đang ở" = mốc CAO NHẤT đã chạm (chạm mốc cao thì các mốc thấp coi như
 * đã chạm — một khách 3.000 đơn/ngày với 5 gian đứng ở M2 dù M1 tính theo gian
 * chưa tới); mốc kế tiếp = mốc ngay sau mốc đang ở.
 */
export function locateOnTimeline(g: GrowthMetrics): { current: CapacityMilestone; next: CapacityMilestone | null } {
  let idx = 0;
  CAPACITY_MILESTONES.forEach((m, i) => {
    if (isMilestoneReached(m, g)) idx = i;
  });
  return { current: CAPACITY_MILESTONES[idx], next: CAPACITY_MILESTONES[idx + 1] ?? null };
}

/** Mốc này coi như đã chạm nếu chính nó HOẶC bất kỳ mốc cao hơn đã chạm. */
export function isMilestoneReachedOrPassed(m: CapacityMilestone, g: GrowthMetrics): boolean {
  const i = CAPACITY_MILESTONES.findIndex((x) => x.key === m.key);
  return CAPACITY_MILESTONES.slice(i).some((x) => isMilestoneReached(x, g));
}

/** Điểm dữ liệu theo ngày cho hồi quy (t = ngày, v = giá trị). */
export interface TrendPoint {
  t: number; // ms epoch
  v: number;
}

/** Tối thiểu số điểm để dự báo. */
export const MIN_TREND_POINTS = 7;

/**
 * Hồi quy tuyến tính đơn giản → tốc độ tăng/ngày. Trả null khi thiếu dữ liệu
 * hoặc không tăng (slope ≤ 0 → không bao giờ chạm theo xu hướng hiện tại).
 */
export function slopePerDay(points: TrendPoint[]): number | null {
  if (points.length < MIN_TREND_POINTS) return null;
  const day = 24 * 60 * 60 * 1000;
  const xs = points.map((p) => p.t / day);
  const ys = points.map((p) => p.v);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return slope > 0 ? slope : null;
}

/** Số ngày nữa để giá trị hiện tại chạm `target` theo tốc độ `slope`/ngày. */
export function daysToReach(current: number, target: number, slope: number | null): number | null {
  if (current >= target) return 0;
  if (slope == null || slope <= 0) return null;
  return Math.ceil((target - current) / slope);
}

export interface MilestoneEta {
  milestone: CapacityMilestone;
  /** Ngày sớm nhất chạm bất kỳ điều kiện nào (null = không dự báo được). */
  days: number | null;
  /** Điều kiện sẽ chạm sớm nhất. */
  by: MilestoneCondition | null;
}

/**
 * ETA của mốc kế tiếp: từng điều kiện tính ngày theo xu hướng của đại lượng
 * đó, lấy sớm nhất. `trends` = slope/ngày theo metric (null = không tăng).
 */
export function milestoneEta(
  m: CapacityMilestone,
  g: GrowthMetrics,
  trends: Partial<Record<MetricKey, number | null>>
): MilestoneEta {
  let best: { days: number; by: MilestoneCondition } | null = null;
  for (const c of m.conditions) {
    const d = daysToReach(g[c.metric], c.gte, trends[c.metric] ?? null);
    if (d == null) continue;
    if (!best || d < best.days) best = { days: d, by: c };
  }
  return { milestone: m, days: best?.days ?? null, by: best?.by ?? null };
}

/** Nhãn tiếng Việt của metric (dùng chung worker + FE). */
export const METRIC_LABEL: Record<MetricKey, string> = {
  channels: "gian hoạt động",
  owners: "chủ shop",
  ordersPerDay: "đơn/ngày",
  dbPct: "% dung lượng DB",
  ramPct: "% RAM",
  connPct: "% kết nối DB",
};

export type SignalLevel = "ok" | "warn" | "crit";

/** Xếp mức theo 2 ngưỡng vàng/đỏ. */
export function levelFor(value: number, warn: number, crit: number): SignalLevel {
  if (value >= crit) return "crit";
  if (value >= warn) return "warn";
  return "ok";
}
