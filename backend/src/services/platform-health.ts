// ============================================================
// SỨC KHỎE NỀN TẢNG — collector 3 lớp + dấu hiệu + gợi ý (docs/HQ-SUC-KHOE.md)
//
// Đọc số HIỆN TẠI từ DB + tiến trình, không gọi sàn. Mọi truy vấn là COUNT có
// index hoặc câu pg_* nhẹ; câu nào bị Supabase chặn quyền thì trả null, không
// vỡ trang. Worker workers/health-watch.ts gọi theo nhịp để chụp snapshot và
// cảnh báo; route /api/admin/health gọi để vẽ trang.
// ============================================================

import { ChannelName, WebhookJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  CAPACITY_MILESTONES,
  CURRENT_INFRA,
  HEALTH_THRESHOLDS as T,
  METRIC_LABEL,
  levelFor,
  locateOnTimeline,
  milestoneEta,
  slopePerDay,
  type CapacityMilestone,
  type GrowthMetrics,
  type MetricKey,
  type MilestoneEta,
  type SignalLevel,
  type TrendPoint,
} from "../config/capacity-plan";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Một truy vấn hỏng (bảng chưa có ở môi trường này, quyền pg_* bị chặn...) không
 * được làm vỡ cả trang Sức khỏe — trả giá trị dự phòng + log một dòng.
 */
async function safe<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    const first = String((err as Error).message).split(String.fromCharCode(10))[0];
    console.warn(`[Health] không đọc được ${label}: ${first}`);
    return fallback;
  }
}

// ---------- Kiểu số liệu ----------

export interface GrowthLayer {
  ownersTotal: number;
  ownersActive30d: number;
  ownersNew7d: number;
  channelsActive: number; // Shopee+Lazada+TikTok ACTIVE
  channelsByPlatform: Record<string, number>;
  channelsAds: number; // gian có campaign ongoing
  channelsDisconnected: number;
  ordersTotal: number;
  ordersPerDay7d: number;
  ordersPeakDay30d: number;
  webhooksPerDay7d: number;
}

export interface WorkerLayer {
  overdueFast15: number;
  overdueFast60: number;
  overduePulse: number;
  lockedStale: number;
  webhookPending: number;
  webhookOldestMin: number | null;
  misaPending: number;
  stockPushPending: number;
  deliveryOverdue: number;
  breakersPaused: string[];
  breakerTrips24h: number;
  syncStalled: number; // syncFailCount >= 3
  adsAuthDisconnected: number;
}

export interface InfraLayer {
  dbSizeMb: number | null;
  dbTopTables: { table: string; mb: number }[];
  dbConnections: number | null;
  dbMaxConnections: number | null;
  ramMb: number;
  heapMb: number;
  uptimeSec: number;
  role: string;
  nodeVersion: string;
  gitSha: string | null;
  plan: typeof CURRENT_INFRA;
  dbPct: number | null;
  ramPct: number;
  connPct: number | null;
}

export interface HealthMetrics {
  takenAt: string;
  growth: GrowthLayer;
  worker: WorkerLayer;
  infra: InfraLayer;
}

export interface HealthSignal {
  key: string;
  label: string;
  value: string;
  level: SignalLevel;
  hint?: string;
}

// ---------- Collector ----------

export async function collectGrowth(): Promise<GrowthLayer> {
  const now = Date.now();
  const d7 = new Date(now - 7 * DAY_MS);
  const d30 = new Date(now - 30 * DAY_MS);
  const [ownersTotal, ownersNew7d, channelsRows, disconnected, ordersTotal, orders7d, adsChannels, webhooks7d, activeOwnerRows, peak] =
    await Promise.all([
      safe("user.count", prisma.user.count({ where: { ownerId: null, isPlatformAdmin: false } }), 0),
      safe("user.count", prisma.user.count({ where: { ownerId: null, isPlatformAdmin: false, createdAt: { gte: d7 } } }), 0),
      safe("channel.groupBy", prisma.channel.groupBy({
        by: ["channelName"],
        where: { status: "ACTIVE", channelName: { not: ChannelName.OFFLINE } },
        _count: { _all: true },
      }), []),
      safe("channel.count", prisma.channel.count({ where: { status: "DISCONNECTED" } }), 0),
      safe("order.count", prisma.order.count(), 0),
      safe("order.count", prisma.order.count({ where: { createdAt: { gte: d7 } } }), 0),
      safe("adsCampaign.findMany", prisma.adsCampaign.findMany({
        where: { status: "ongoing", channel: { status: "ACTIVE" } },
        distinct: ["channelId"],
        select: { channelId: true },
      }), []),
      safe("shopeeWebhookLog.count", prisma.shopeeWebhookLog.count({ where: { createdAt: { gte: d7 } } }), 0),
      // Chủ shop hoạt động = có đơn 30 ngày (qua gian).
      safe("channel.findMany", prisma.channel.findMany({
        where: { orders: { some: { createdAt: { gte: d30 } } } },
        distinct: ["userId"],
        select: { userId: true },
      }), []),
      safe(
        "order.peakDay",
        prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COALESCE(MAX(c), 0)::bigint AS n FROM (
          SELECT COUNT(*) AS c FROM "Order" WHERE "createdAt" >= ${d30} GROUP BY DATE("createdAt")
        ) t`,
        [{ n: 0n }]
      ),
    ]);
  const channelsByPlatform: Record<string, number> = {};
  let channelsActive = 0;
  for (const r of channelsRows) {
    channelsByPlatform[r.channelName] = r._count._all;
    channelsActive += r._count._all;
  }
  return {
    ownersTotal,
    ownersActive30d: activeOwnerRows.length,
    ownersNew7d,
    channelsActive,
    channelsByPlatform,
    channelsAds: adsChannels.length,
    channelsDisconnected: disconnected,
    ordersTotal,
    ordersPerDay7d: Math.round(orders7d / 7),
    ordersPeakDay30d: Number(peak[0]?.n ?? 0),
    webhooksPerDay7d: Math.round(webhooks7d / 7),
  };
}

export async function collectWorker(): Promise<WorkerLayer> {
  const now = Date.now();
  const t15 = new Date(now - T.fastOverdueMin * 60 * 1000);
  const t60 = new Date(now - 60 * 60 * 1000);
  const t2h = new Date(now - 2 * 60 * 60 * 1000);
  const staleLock = new Date(now - 15 * 60 * 1000);
  const syncable = {
    status: "ACTIVE" as const,
    refreshToken: { not: null },
    channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
  };
  const [overdueFast15, overdueFast60, overduePulse, lockedStale, webhookPending, oldest, misaPending, stockPushPending, deliveryOverdue, breakers, syncStalled, adsAuthDisconnected] =
    await Promise.all([
      safe("channel.count", prisma.channel.count({ where: { ...syncable, syncLockedAt: null, nextFastSyncAt: { lt: t15 } } }), 0),
      safe("channel.count", prisma.channel.count({ where: { ...syncable, syncLockedAt: null, nextFastSyncAt: { lt: t60 } } }), 0),
      safe("channel.count", prisma.channel.count({ where: { ...syncable, syncLockedAt: null, nextAdsPulseAt: { lt: t2h } } }), 0),
      safe("channel.count", prisma.channel.count({ where: { ...syncable, syncLockedAt: { lt: staleLock } } }), 0),
      safe("shopeeWebhookLog.count", prisma.shopeeWebhookLog.count({ where: { status: WebhookJobStatus.PENDING } }), 0),
      safe("shopeeWebhookLog.findFirst", prisma.shopeeWebhookLog.findFirst({
        where: { status: WebhookJobStatus.PENDING },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }), null),
      safe("misaWebhookLog.count", prisma.misaWebhookLog.count({ where: { status: WebhookJobStatus.PENDING } }), 0),
      safe("stockPushJob.count", prisma.stockPushJob.count({ where: { status: "PENDING" } }), 0),
      safe("deliveryTrackingTask.count", prisma.deliveryTrackingTask.count({ where: { nextRunAt: { lt: t60 } } }), 0),
      safe("apiThrottleState.findMany", prisma.apiThrottleState.findMany(), []),
      safe("channel.count", prisma.channel.count({ where: { status: "ACTIVE", syncFailCount: { gte: 3 } } }), 0),
      safe("channelAppAuth.count", prisma.channelAppAuth.count({ where: { status: "DISCONNECTED" } }), 0),
    ]);
  const d24 = now - DAY_MS;
  return {
    overdueFast15,
    overdueFast60,
    overduePulse,
    lockedStale,
    webhookPending,
    webhookOldestMin: oldest ? Math.round((now - oldest.createdAt.getTime()) / 60000) : null,
    misaPending,
    stockPushPending,
    deliveryOverdue,
    breakersPaused: breakers.filter((b) => b.pausedUntil && b.pausedUntil.getTime() > now).map((b) => b.app),
    breakerTrips24h: breakers.filter((b) => b.updatedAt.getTime() > d24).reduce((s, b) => s + (b.level + 1), 0),
    syncStalled,
    adsAuthDisconnected,
  };
}

export async function collectInfra(): Promise<InfraLayer> {
  let dbSizeMb: number | null = null;
  let dbTopTables: { table: string; mb: number }[] = [];
  let dbConnections: number | null = null;
  let dbMaxConnections: number | null = null;
  try {
    const size = await prisma.$queryRaw<{ mb: number }[]>`SELECT (pg_database_size(current_database()) / 1048576.0)::float AS mb`;
    dbSizeMb = Math.round(Number(size[0]?.mb ?? 0));
    const tables = await prisma.$queryRaw<{ table: string; mb: number }[]>`
      SELECT relname AS "table", (pg_total_relation_size(c.oid) / 1048576.0)::float AS mb
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 5`;
    dbTopTables = tables.map((t) => ({ table: t.table, mb: Math.round(Number(t.mb) * 10) / 10 }));
  } catch {
    // Supabase có thể chặn pg_class với role thường — hiện "không đọc được".
  }
  try {
    const conn = await prisma.$queryRaw<{ n: bigint; max: string }[]>`
      SELECT (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database())::bigint AS n,
             current_setting('max_connections') AS max`;
    dbConnections = Number(conn[0]?.n ?? 0);
    dbMaxConnections = Number(conn[0]?.max ?? 0) || null;
  } catch {
    // như trên
  }
  const mem = process.memoryUsage();
  const ramMb = Math.round(mem.rss / 1048576);
  const plan = CURRENT_INFRA;
  const ramCap = plan.workerRamMb > 0 && (process.env.HUBSELL_ROLE ?? "all") === "worker" ? plan.workerRamMb : plan.webRamMb;
  const connCap = plan.dbMaxConnections || dbMaxConnections;
  return {
    dbSizeMb,
    dbTopTables,
    dbConnections,
    dbMaxConnections,
    ramMb,
    heapMb: Math.round(mem.heapUsed / 1048576),
    uptimeSec: Math.round(process.uptime()),
    role: process.env.HUBSELL_ROLE ?? "all",
    nodeVersion: process.version,
    gitSha: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
    plan,
    dbPct: dbSizeMb != null ? Math.round((dbSizeMb / plan.dbSizeMb) * 100) : null,
    ramPct: Math.round((ramMb / ramCap) * 100),
    connPct: dbConnections != null && connCap ? Math.round((dbConnections / connCap) * 100) : null,
  };
}

export async function collectHealth(): Promise<HealthMetrics> {
  const [growth, worker, infra] = await Promise.all([collectGrowth(), collectWorker(), collectInfra()]);
  return { takenAt: new Date().toISOString(), growth, worker, infra };
}

/** Rút 6 đại lượng điều kiện mốc từ metrics đầy đủ. */
export function toGrowthMetrics(m: HealthMetrics): GrowthMetrics {
  return {
    channels: m.growth.channelsActive,
    owners: m.growth.ownersTotal,
    ordersPerDay: m.growth.ordersPerDay7d,
    dbPct: m.infra.dbPct ?? 0,
    ramPct: m.infra.ramPct,
    connPct: m.infra.connPct ?? 0,
  };
}

// ---------- Snapshot ----------

export async function saveSnapshot(m: HealthMetrics): Promise<void> {
  await prisma.platformHealthSnapshot.create({
    data: {
      takenAt: new Date(m.takenAt),
      channels: m.growth.channelsActive,
      owners: m.growth.ownersTotal,
      ordersPerDay: m.growth.ordersPerDay7d,
      dbSizeMb: m.infra.dbSizeMb ?? 0,
      ramMb: m.infra.ramMb,
      overdueFast: m.worker.overdueFast15,
      metrics: m as unknown as object,
    },
  });
}

/** Chuỗi theo NGÀY (snapshot cuối mỗi ngày) 30 ngày cho từng đại lượng. */
export async function dailyTrends(days = 30): Promise<Record<"channels" | "owners" | "ordersPerDay" | "dbSizeMb", TrendPoint[]>> {
  const rows = await prisma.platformHealthSnapshot.findMany({
    where: { takenAt: { gte: new Date(Date.now() - days * DAY_MS) } },
    orderBy: { takenAt: "asc" },
    select: { takenAt: true, channels: true, owners: true, ordersPerDay: true, dbSizeMb: true },
  });
  const byDay = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byDay.set(r.takenAt.toISOString().slice(0, 10), r); // snapshot cuối ngày thắng
  const pts = [...byDay.values()];
  const series = (k: "channels" | "owners" | "ordersPerDay" | "dbSizeMb") =>
    pts.map((r) => ({ t: r.takenAt.getTime(), v: r[k] }));
  return { channels: series("channels"), owners: series("owners"), ordersPerDay: series("ordersPerDay"), dbSizeMb: series("dbSizeMb") };
}

// ---------- Timeline + ETA ----------

export interface TimelineView {
  current: CapacityMilestone;
  next: CapacityMilestone | null;
  nextEta: MilestoneEta | null;
  trendsPerDay: Partial<Record<MetricKey, number | null>>;
  milestones: Array<{
    milestone: CapacityMilestone;
    reached: boolean;
    reachedAt: string | null;
    doneAt: string | null;
    doneBy: string | null;
    note: string | null;
    /** Điều kiện + giá trị hiện tại để hiện "gian 3/20". */
    progress: Array<{ metric: MetricKey; label: string; current: number; target: number }>;
  }>;
}

export async function buildTimeline(m: HealthMetrics): Promise<TimelineView> {
  const g = toGrowthMetrics(m);
  const { current, next } = locateOnTimeline(g);
  const trends = await dailyTrends(30);
  const dbSlopeMb = slopePerDay(trends.dbSizeMb);
  const trendsPerDay: Partial<Record<MetricKey, number | null>> = {
    channels: slopePerDay(trends.channels),
    owners: slopePerDay(trends.owners),
    ordersPerDay: slopePerDay(trends.ordersPerDay),
    // % DB tăng theo MB/ngày ÷ dung lượng gói.
    dbPct: dbSlopeMb != null ? (dbSlopeMb / CURRENT_INFRA.dbSizeMb) * 100 : null,
    ramPct: null,
    connPct: null,
  };
  const states = await prisma.platformCapacityMilestone.findMany();
  const stateByKey = new Map(states.map((s) => [s.key, s] as const));
  const milestones = CAPACITY_MILESTONES.map((ms) => {
    const st = stateByKey.get(ms.key);
    const reached = ms.conditions.length === 0 || ms.conditions.some((c) => g[c.metric] >= c.gte);
    return {
      milestone: ms,
      reached,
      reachedAt: st?.reachedAt?.toISOString() ?? null,
      doneAt: st?.doneAt?.toISOString() ?? null,
      doneBy: st?.doneBy ?? null,
      note: st?.note ?? null,
      progress: ms.conditions.map((c) => ({ metric: c.metric, label: METRIC_LABEL[c.metric], current: g[c.metric], target: c.gte })),
    };
  });
  return { current, next, nextEta: next ? milestoneEta(next, g, trendsPerDay) : null, trendsPerDay, milestones };
}

// ---------- Dấu hiệu + gợi ý ----------

export function evaluateSignals(m: HealthMetrics): HealthSignal[] {
  const w = m.worker;
  const i = m.infra;
  const total = Math.max(1, m.growth.channelsActive);
  const overduePct = Math.round((w.overdueFast15 / total) * 100);
  const out: HealthSignal[] = [];
  const push = (key: string, label: string, value: string, level: SignalLevel, hint?: string) =>
    out.push({ key, label, value, level, hint });

  push(
    "worker.overdue",
    "Gian trễ hạn quét nhanh",
    `${w.overdueFast15} gian (${overduePct}%), quá 60': ${w.overdueFast60}`,
    w.overdueFast15 >= T.overdueAbs || overduePct >= T.overdueRatioPct ? (w.overdueFast60 > 0 ? "crit" : "warn") : "ok",
    "Worker không kịp nhặt vé → thêm AUTO_SYNC_CONCURRENCY hoặc tách worker riêng"
  );
  push(
    "worker.webhook",
    "Hàng đợi webhook Shopee",
    `${w.webhookPending} chờ${w.webhookOldestMin != null ? `, cũ nhất ${w.webhookOldestMin}'` : ""}`,
    w.webhookPending >= T.webhookPending || (w.webhookOldestMin ?? 0) >= T.webhookOldestMin ? "crit" : w.webhookPending > 50 ? "warn" : "ok",
    "Đơn real-time đang chậm — worker quá tải hoặc DB chậm"
  );
  push(
    "worker.breaker",
    "Cầu dao API sàn",
    w.breakersPaused.length ? `ĐÓNG: ${w.breakersPaused.join(", ")}` : `mở (${w.breakerTrips24h} lần đóng/24h)`,
    w.breakersPaused.length ? "crit" : w.breakerTrips24h > 0 ? "warn" : "ok",
    "Sàn báo vượt trần theo app — hạ ADS_APP_QPS hoặc xin nâng quota"
  );
  push(
    "worker.queues",
    "Đẩy tồn / cứu đơn / MISA chờ",
    `${w.stockPushPending} tồn, ${w.deliveryOverdue} vé cứu đơn quá hạn, ${w.misaPending} MISA`,
    w.stockPushPending > 500 || w.deliveryOverdue > 100 ? "warn" : "ok"
  );
  push(
    "channel.token",
    "Gian rớt kết nối / sàn trễ đồng bộ",
    `${m.growth.channelsDisconnected} rớt, ${w.syncStalled} lỗi ≥3 lượt, ${w.adsAuthDisconnected} Hubsell Ads rớt`,
    m.growth.channelsDisconnected + w.syncStalled > 0 ? "warn" : "ok",
    "Seller phải ủy quyền lại — kiểm tra banner mất kết nối"
  );
  push(
    "infra.db",
    "Dung lượng DB",
    i.dbSizeMb != null ? `${i.dbSizeMb} MB / ${i.plan.dbSizeMb} MB (${i.dbPct}%)` : "không đọc được",
    i.dbPct != null ? levelFor(i.dbPct, T.dbPctWarn, T.dbPctCrit) : "ok",
    "Nâng gói Supabase hoặc bật retention/rollup"
  );
  push(
    "infra.ram",
    "RAM tiến trình",
    `${i.ramMb} MB (${i.ramPct}% gói ${i.plan.webPlan})`,
    levelFor(i.ramPct, T.ramPctWarn, T.ramPctCrit),
    "Nâng gói Render hoặc tách worker"
  );
  push(
    "infra.conn",
    "Kết nối DB",
    i.dbConnections != null ? `${i.dbConnections} / ${i.plan.dbMaxConnections}${i.connPct != null ? ` (${i.connPct}%)` : ""}` : "không đọc được",
    i.connPct != null ? levelFor(i.connPct, T.connPctWarn, T.connPctCrit) : "ok",
    "Đặt connection_limit trong DATABASE_URL, dùng pooler"
  );
  return out;
}

/** Tối đa 3 việc nên làm hôm nay: từ dấu hiệu đỏ/vàng rồi tới mốc kế tiếp. */
export function buildSuggestions(signals: HealthSignal[], tl: TimelineView): string[] {
  const out: string[] = [];
  for (const s of signals.filter((x) => x.level === "crit")) out.push(`🔴 ${s.label}: ${s.value}${s.hint ? ` — ${s.hint}` : ""}`);
  for (const s of signals.filter((x) => x.level === "warn")) out.push(`🟡 ${s.label}: ${s.value}${s.hint ? ` — ${s.hint}` : ""}`);
  const cur = tl.milestones.find((x) => x.milestone.key === tl.current.key);
  if (cur && !cur.doneAt && cur.milestone.checklist.length) {
    out.push(`☑️ Mốc ${tl.current.key} đang ở: ${cur.milestone.checklist[0]}`);
  }
  if (tl.next && tl.nextEta?.days != null && tl.nextEta.days <= T.etaWarnDays && tl.nextEta.by) {
    out.push(
      `📅 Còn ≈${tl.nextEta.days} ngày chạm mốc ${tl.next.key} (${METRIC_LABEL[tl.nextEta.by.metric]} ≥ ${tl.nextEta.by.gte}) — chuẩn bị: ${tl.next.upgrades.map((u) => u.what).join("; ")}`
    );
  }
  return out.slice(0, 3);
}
