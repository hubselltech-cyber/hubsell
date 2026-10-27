// ============================================================
// SỨC KHỎE NỀN TẢNG — collector 3 lớp + dấu hiệu + gợi ý (docs/HQ-SUC-KHOE.md)
//
// Đọc số HIỆN TẠI từ DB + tiến trình, không gọi sàn. Mọi truy vấn là COUNT có
// index hoặc câu pg_* nhẹ; câu nào bị Supabase chặn quyền thì trả null, không
// vỡ trang. Worker workers/health-watch.ts gọi theo nhịp để chụp snapshot và
// cảnh báo; route /api/admin/health gọi để vẽ trang.
// ============================================================

import v8 from "v8";
import { ChannelAppKind, ChannelName, Prisma, WebhookJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { queueStartError, queueStats, type QueueStat } from "../lib/queue";
import { DEAD_QUEUES } from "../lib/queue-config";
import { collectInvoiceHealth, invoiceSignal, type InvoiceHealth } from "./invoice-health";
import { DELIVERY_FAIL_FEATURE } from "../integrations/shopee/delivery-fail";
import { ADS_CADENCE } from "../config/ads-cadence";
import {
  ADS_QUOTA_MILESTONES,
  CAPACITY_MILESTONES,
  CURRENT_INFRA,
  HEALTH_THRESHOLDS as T,
  METRIC_LABEL,
  levelFor,
  ramLevel,
  isMilestoneReached,
  isMilestoneReachedOrPassed,
  locateOnTimeline,
  nextAdsQuotaMilestone,
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

/** "shopee:2044679 tới 14:32 (bậc 1 · 10', lần 4)" — giờ VN, hàm thuần (test). */
export function breakerDetailText(b: { app: string; pausedUntil: string; level: number; tripCount: number }): string {
  const until = new Date(b.pausedUntil).toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
  });
  const pauseMin = Math.min(60, 5 * 2 ** Math.max(0, b.level));
  return `${b.app} tới ${until} (bậc ${b.level} · ${pauseMin}', lần ${b.tripCount})`;
}

/**
 * Mức thẻ Cầu dao (17/10/2026): bão 429 BẬC 0 (nghỉ 5' rồi tự mở, 429 lẻ tẻ của
 * sàn) chỉ VÀNG — đỏ khi đóng liên tiếp (bậc ≥ 1) hoặc sàn báo vượt trần theo
 * app thật (lý do không phải "Bão 429"). Hàm thuần (test).
 */
export function breakerSignalLevel(
  paused: Array<{ reason: string | null; level: number }>,
  trips24h: number,
  warnTrips24h: number
): SignalLevel {
  if (paused.some((b) => b.level >= 1 || !b.reason?.startsWith("Bão 429"))) return "crit";
  if (paused.length) return "warn";
  return trips24h >= warnTrips24h ? "warn" : "ok";
}

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
  /** Gian Shopee ACTIVE (không ngủ đông) đã nối app Hubsell Ads — MẪU SỐ QUOTA Ads API (quota tính theo app,
   *  docs/ADS-NHIP-CANH-BAO.md 13.5: mốc Đ2 200 / Đ3 500 / Đ4 800). Vắng ở ảnh chụp trước 19/10/2026. */
  channelsHubsellAds: number;
  channelsDisconnected: number; // tổng gian DISCONNECTED (kể cả rớt lâu ngày)
  channelsDisconnected24h: number; // gian MỚI rớt trong 24h — dấu hiệu token/ủy quyền
  ordersTotal: number;
  ordersPerDay7d: number;
  ordersPeakDay30d: number;
  webhooksPerDay7d: number;
}

/**
 * Mốc nước quét đơn theo gian (Channel.ordersWatermarkAt / ordersCatchupBeforeAt,
 * lát 3.2 giai đoạn 3) — đếm trên các gian đang quét (ACTIVE, có token, 3 sàn).
 */
export interface WatermarkHealth {
  /** Gian đang quét (ACTIVE, có token, 3 sàn, KHÔNG ngủ đông). */
  channels: number;
  /** Gian ngủ đông (hết gói quá ân hạn) — worker bỏ qua, mốc đứng yên, không tính trễ. Vắng ở ảnh chụp trước 16/10/2026. */
  hibernated?: number;
  /** Gian đã có mốc (lượt quét đầu sau deploy / sau khi nối mới đặt mốc). */
  withMark: number;
  /** Gian đang vét dở vì lượt trước bị cắt (ordersCatchupBeforeAt khác NULL). */
  catchingUp: number;
  /** Gian có mốc cũ hơn T.watermarkLagWarnMin / T.watermarkLagCritMin. */
  lagOver60: number;
  lagOver6h: number;
  /** Tuổi mốc lớn nhất (phút) + gian đó. null = chưa gian nào có mốc. */
  maxLagMin: number | null;
  maxLagShop: string | null;
}

export interface WorkerLayer {
  overdueFast15: number;
  overdueFast60: number;
  overduePulse: number;
  /** Gian đang LÙI RIÊNG vì 429 tầng shop (lát 2, 19/10/2026: Channel.adsBackoffUntil > now). Vắng ở ảnh chụp cũ. */
  adsBackingOff?: number;
  lockedStale: number;
  webhookPending: number;
  webhookOldestMin: number | null;
  misaPending: number;
  stockPushPending: number;
  deliveryOverdue: number;
  breakersPaused: string[];
  /** Cầu dao đang đóng: lý do sàn trả + mở lại lúc nào (giờ VN) + bậc — để HQ đọc là biết vì sao (16/10/2026). */
  breakersDetail: Array<{ app: string; reason: string | null; pausedUntil: string; level: number; tripCount: number }>;
  breakerTrips24h: number;
  syncStalled: number; // syncFailCount >= 3
  /** Tên (≤ 3) gian ACTIVE lỗi ≥ 3 lượt kèm lỗi rút gọn — để HQ hành động ngay, không phải tra SQL. */
  syncStalledNames?: string[];
  adsAuthDisconnected: number;
  /** Hàng đợi bền pg-boss (giai đoạn 2). null = chưa khởi động / không đọc được. */
  durableQueues: QueueStat[] | null;
  durableQueueError: string | null;
  /** Hộp thư đến chung webhook_events: dòng đang chờ + dòng chờ lâu nhất (phút). */
  inboxPending: number;
  inboxOldestMin: number | null;
  /** Đường hóa đơn (bước 5 lát 14). null = không đọc được; vắng mặt ở ảnh chụp đời trước 03/10/2026. */
  invoice?: InvoiceHealth | null;
  /** Mốc nước quét đơn (lát 3.6). null = không đọc được; vắng mặt ở ảnh chụp trước 15/10/2026. */
  watermark?: WatermarkHealth | null;
}

export interface InfraLayer {
  dbSizeMb: number | null;
  dbTopTables: { table: string; mb: number }[];
  dbConnections: number | null;
  dbMaxConnections: number | null;
  ramMb: number; // RSS — mức hệ điều hành đang giữ cho tiến trình
  heapMb: number; // heap đang dùng thật
  heapLimitMb: number | null; // trần heap V8 (cờ --max-old-space-size trong npm start)
  heapPct: number | null;
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
  const d1 = new Date(now - DAY_MS);
  const [ownersTotal, ownersNew7d, channelsRows, disconnected, disconnected24h, ordersTotal, orders7d, adsChannels, webhooks7d, activeOwnerRows, peak, hubsellAdsShops] =
    await Promise.all([
      safe("user.count", prisma.user.count({ where: { ownerId: null, isPlatformAdmin: false } }), 0),
      safe("user.count", prisma.user.count({ where: { ownerId: null, isPlatformAdmin: false, createdAt: { gte: d7 } } }), 0),
      safe("channel.groupBy", prisma.channel.groupBy({
        by: ["channelName"],
        where: { status: "ACTIVE", channelName: { not: ChannelName.OFFLINE } },
        _count: { _all: true },
      }), []),
      safe("channel.count", prisma.channel.count({ where: { status: "DISCONNECTED" } }), 0),
      safe("channel.count", prisma.channel.count({ where: { status: "DISCONNECTED", disconnectedAt: { gte: d1 } } }), 0),
      safe("order.count", prisma.order.count(), 0),
      safe("order.count", prisma.order.count({ where: { createdAt: { gte: d7 } } }), 0),
      safe("adsCampaign.findMany", prisma.adsCampaign.findMany({
        where: { status: "ongoing", channel: { status: "ACTIVE" } },
        distinct: ["channelId"],
        select: { channelId: true },
      }), []),
      safe("webhookLog.count", Promise.all([
        prisma.shopeeWebhookLog.count({ where: { createdAt: { gte: d7 } } }),
        prisma.tiktokWebhookLog.count({ where: { createdAt: { gte: d7 } } }),
        // Hộp thư đến chung của giai đoạn 2 — sàn nào chuyển sang rồi thì sự kiện mới nằm ở đây.
        prisma.webhookEvent.count({
          where: { source: { in: ["SHOPEE", "LAZADA", "TIKTOK"] }, createdAt: { gte: d7 } },
        }),
      ]).then((counts) => counts.reduce((s, n) => s + n, 0)), 0),
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
      // Gian Shopee nối Hubsell Ads còn hiệu lực — mẫu số quota Ads (19/10/2026).
      safe("channelAppAuth.count", prisma.channelAppAuth.count({
        where: {
          app: ChannelAppKind.HUBSELL_ADS,
          status: "ACTIVE",
          channel: { status: "ACTIVE", channelName: ChannelName.SHOPEE, hibernatedAt: null },
        },
      }), 0),
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
    channelsHubsellAds: hubsellAdsShops,
    channelsDisconnected: disconnected,
    channelsDisconnected24h: disconnected24h,
    ordersTotal,
    ordersPerDay7d: Math.round(orders7d / 7),
    ordersPeakDay30d: Number(peak[0]?.n ?? 0),
    webhooksPerDay7d: Math.round(webhooks7d / 7),
  };
}

/**
 * Mốc nước quét đơn: hai câu đếm nhẹ trên Channel (không có chỉ mục riêng — bảng gian nhỏ).
 * Gian NGỦ ĐÔNG (hibernatedAt khác NULL — chủ hết gói quá ân hạn, plan-hibernation.ts)
 * bị worker bỏ qua nên mốc đứng yên mãi: KHÔNG tính vào gian trễ (16/10/2026 HQ báo
 * vàng oan "RUXI 233'" đúng ngày 4 gian dùng thử ngủ đông), chỉ đếm riêng để HQ biết.
 */
export async function collectWatermarkHealth(): Promise<WatermarkHealth> {
  const scope = Prisma.sql`"status" = 'ACTIVE' AND "refreshToken" IS NOT NULL AND "channelName" IN ('SHOPEE', 'LAZADA', 'TIKTOK')`;
  const awake = Prisma.sql`"hibernatedAt" IS NULL`;
  const [agg] = await prisma.$queryRaw<
    { channels: number; hibernated: number; withMark: number; catchingUp: number; lagOver60: number; lagOver6h: number; maxLagSec: number | null }[]
  >`
    SELECT COUNT(*) FILTER (WHERE ${awake})::int AS "channels",
           COUNT(*) FILTER (WHERE NOT (${awake}))::int AS "hibernated",
           COUNT("ordersWatermarkAt") FILTER (WHERE ${awake})::int AS "withMark",
           COUNT("ordersCatchupBeforeAt") FILTER (WHERE ${awake})::int AS "catchingUp",
           COUNT(*) FILTER (WHERE ${awake} AND "ordersWatermarkAt" < now() - make_interval(mins => ${T.watermarkLagWarnMin}::int))::int AS "lagOver60",
           COUNT(*) FILTER (WHERE ${awake} AND "ordersWatermarkAt" < now() - make_interval(mins => ${T.watermarkLagCritMin}::int))::int AS "lagOver6h",
           MAX(EXTRACT(EPOCH FROM (now() - "ordersWatermarkAt"))) FILTER (WHERE ${awake})::float AS "maxLagSec"
    FROM "Channel" WHERE ${scope}`;
  const worst =
    agg?.maxLagSec != null
      ? await prisma.$queryRaw<{ shopName: string; channelName: string }[]>`
          SELECT "shopName", "channelName" FROM "Channel"
          WHERE ${scope} AND ${awake} AND "ordersWatermarkAt" IS NOT NULL
          ORDER BY "ordersWatermarkAt" ASC LIMIT 1`
      : [];
  return {
    channels: agg?.channels ?? 0,
    hibernated: agg?.hibernated ?? 0,
    withMark: agg?.withMark ?? 0,
    catchingUp: agg?.catchingUp ?? 0,
    lagOver60: agg?.lagOver60 ?? 0,
    lagOver6h: agg?.lagOver6h ?? 0,
    maxLagMin: agg?.maxLagSec != null ? Math.round(agg.maxLagSec / 60) : null,
    maxLagShop: worst[0] ? `${worst[0].channelName} · ${worst[0].shopName}` : null,
  };
}

export async function collectWorker(): Promise<WorkerLayer> {
  const now = Date.now();
  const t15 = new Date(now - T.fastOverdueMin * 60 * 1000);
  const t60 = new Date(now - 60 * 60 * 1000);
  const t2h = new Date(now - 2 * 60 * 60 * 1000);
  const staleLock = new Date(now - 15 * 60 * 1000);
  const staleAdsLock = new Date(now - ADS_CADENCE.LOCK_STALE_MIN * 60 * 1000);
  const syncable = {
    status: "ACTIVE" as const,
    refreshToken: { not: null },
    hibernatedAt: null, // gian ngủ đông (hết gói quá ân hạn) không tính là "trễ quét"
    channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK] },
  };
  const [overdueFast15, overdueFast60, overduePulse, lockedStale, webhookPending, oldest, misaPending, stockPushPending, deliveryOverdue, breakers, syncStalled, adsAuthDisconnected, tiktokPending, tiktokOldest, durableQueues, inbox, invoice, watermark, adsBackingOff] =
    await Promise.all([
      safe("channel.count", prisma.channel.count({ where: { ...syncable, syncLockedAt: null, nextFastSyncAt: { lt: t15 } } }), 0),
      safe("channel.count", prisma.channel.count({ where: { ...syncable, syncLockedAt: null, nextFastSyncAt: { lt: t60 } } }), 0),
      // Xung ads trễ: vé riêng của làn Ads (adsLockedAt, 19/10/2026) — không còn đi theo vé đơn.
      safe("channel.count", prisma.channel.count({ where: { ...syncable, adsLockedAt: null, nextAdsPulseAt: { lt: t2h } } }), 0),
      // Vé mồ côi: vé đơn cũ >15 phút HOẶC vé ads cũ > ADS_LOCK_STALE_MINUTES (lượt ngày TikTok dài nên rộng hơn).
      safe("channel.count", prisma.channel.count({
        where: { ...syncable, OR: [{ syncLockedAt: { lt: staleLock } }, { adsLockedAt: { lt: staleAdsLock } }] },
      }), 0),
      safe("shopeeWebhookLog.count", prisma.shopeeWebhookLog.count({ where: { status: WebhookJobStatus.PENDING } }), 0),
      safe("shopeeWebhookLog.findFirst", prisma.shopeeWebhookLog.findFirst({
        where: { status: WebhookJobStatus.PENDING },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }), null),
      safe("misaWebhookLog.count", prisma.misaWebhookLog.count({ where: { status: WebhookJobStatus.PENDING } }), 0),
      safe("stockPushJob.count", prisma.stockPushJob.count({ where: { status: "PENDING" } }), 0),
      // Cứu đơn đang ẨN (DELIVERY_FAIL_FEATURE=false, 12/10/2026): 3 worker không nhặt vé
      // nên vé cũ nằm "quá hạn" mãi (16/10 HQ báo 2.410) — không phải việc dồn, không đếm.
      DELIVERY_FAIL_FEATURE
        ? safe("deliveryTrackingTask.count", prisma.deliveryTrackingTask.count({ where: { nextRunAt: { lt: t60 } } }), 0)
        : Promise.resolve(0),
      safe("apiThrottleState.findMany", prisma.apiThrottleState.findMany(), []),
      safe("channel.findMany", prisma.channel.findMany({
        where: { status: "ACTIVE", syncFailCount: { gte: 3 } },
        select: { shopName: true, channelName: true, syncFailCount: true, lastSyncError: true },
        orderBy: { syncFailCount: "desc" },
        take: 50,
      }), [] as { shopName: string; channelName: ChannelName; syncFailCount: number; lastSyncError: string | null }[]),
      safe("channelAppAuth.count", prisma.channelAppAuth.count({ where: { status: "DISCONNECTED" } }), 0),
      safe("tiktokWebhookLog.count", prisma.tiktokWebhookLog.count({ where: { status: WebhookJobStatus.PENDING } }), 0),
      safe("tiktokWebhookLog.findFirst", prisma.tiktokWebhookLog.findFirst({
        where: { status: WebhookJobStatus.PENDING },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }), null),
      queueStats(),
      // Hai câu dưới đi theo chỉ mục riêng phần webhook_events_open_idx (chỉ chứa dòng chờ / hỏng).
      safe(
        "webhook_events.pending",
        prisma.$queryRaw<{ n: bigint; oldest: Date | null }[]>`
        SELECT COUNT(*)::bigint AS n, MIN("createdAt") AS oldest
        FROM "webhook_events" WHERE "status" = 'PENDING'`,
        [{ n: 0n, oldest: null }]
      ),
      safe<InvoiceHealth | null>("invoice.health", collectInvoiceHealth(new Date(now)), null),
      safe<WatermarkHealth | null>("channel.watermark", collectWatermarkHealth(), null),
      safe("channel.count", prisma.channel.count({ where: { ...syncable, adsBackoffUntil: { gt: new Date(now) } } }), 0),
    ]);
  const d24 = now - DAY_MS;
  // Hàng đợi webhook sàn = Shopee + TikTok gộp (cùng khuôn, cùng SLA).
  const oldestAny = [oldest, tiktokOldest]
    .filter((x): x is { createdAt: Date } => Boolean(x))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
  return {
    overdueFast15,
    overdueFast60,
    overduePulse,
    adsBackingOff,
    lockedStale,
    webhookPending: webhookPending + tiktokPending,
    webhookOldestMin: oldestAny ? Math.round((now - oldestAny.createdAt.getTime()) / 60000) : null,
    misaPending,
    stockPushPending,
    deliveryOverdue,
    breakersPaused: breakers.filter((b) => b.pausedUntil && b.pausedUntil.getTime() > now).map((b) => b.app),
    breakersDetail: breakers
      .filter((b) => b.pausedUntil && b.pausedUntil.getTime() > now)
      .map((b) => ({
        app: b.app,
        reason: b.reason,
        pausedUntil: b.pausedUntil!.toISOString(),
        level: b.level,
        tripCount: b.tripCount,
      })),
    breakerTrips24h: breakers.filter((b) => b.updatedAt.getTime() > d24).reduce((s, b) => s + (b.level + 1), 0),
    syncStalled: syncStalled.length,
    syncStalledNames: syncStalled.slice(0, 3).map((c) => {
      const code = /lỗi: ([a-z_]+)/i.exec(c.lastSyncError ?? "")?.[1] ?? (c.lastSyncError ? c.lastSyncError.slice(0, 40) : "?");
      return `${c.shopName} · ${c.channelName} · ${c.syncFailCount} lượt · ${code}`;
    }),
    adsAuthDisconnected,
    durableQueues,
    durableQueueError: durableQueues ? null : queueStartError(),
    inboxPending: Number(inbox[0]?.n ?? 0),
    inboxOldestMin: inbox[0]?.oldest ? Math.round((now - inbox[0].oldest.getTime()) / 60000) : null,
    invoice,
    watermark,
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
  const heapMb = Math.round(mem.heapUsed / 1048576);
  const heapLimitMb = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576) || null;
  const plan = CURRENT_INFRA;
  const ramCap = plan.workerRamMb > 0 && (process.env.HUBSELL_ROLE ?? "all") === "worker" ? plan.workerRamMb : plan.webRamMb;
  const connCap = plan.dbMaxConnections || dbMaxConnections;
  return {
    dbSizeMb,
    dbTopTables,
    dbConnections,
    dbMaxConnections,
    ramMb,
    heapMb,
    heapLimitMb,
    heapPct: heapLimitMb ? Math.round((heapMb / heapLimitMb) * 100) : null,
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
    shopeeAdsShops: m.growth.channelsHubsellAds ?? 0,
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
      adsShops: m.growth.channelsHubsellAds ?? 0,
      metrics: m as unknown as object,
    },
  });
}

/** Chuỗi theo NGÀY (snapshot cuối mỗi ngày) 30 ngày cho từng đại lượng. */
export type TrendKey = "channels" | "owners" | "ordersPerDay" | "dbSizeMb" | "adsShops";

export async function dailyTrends(days = 30): Promise<Record<TrendKey, TrendPoint[]>> {
  const rows = await prisma.platformHealthSnapshot.findMany({
    where: { takenAt: { gte: new Date(Date.now() - days * DAY_MS) } },
    orderBy: { takenAt: "asc" },
    select: { takenAt: true, channels: true, owners: true, ordersPerDay: true, dbSizeMb: true, adsShops: true },
  });
  const byDay = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byDay.set(r.takenAt.toISOString().slice(0, 10), r); // snapshot cuối ngày thắng
  const pts = [...byDay.values()];
  const series = (k: TrendKey) => pts.map((r) => ({ t: r.takenAt.getTime(), v: r[k] }));
  return {
    channels: series("channels"),
    owners: series("owners"),
    ordersPerDay: series("ordersPerDay"),
    dbSizeMb: series("dbSizeMb"),
    adsShops: series("adsShops"),
  };
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
  /**
   * Mốc QUOTA ADS Shopee Đ2/Đ3/Đ4 (docs/ADS-NHIP-CANH-BAO.md 13.5, 19/10/2026) — chuỗi riêng, đếm theo gian Shopee
   * nối Hubsell Ads (quota tính theo app). Cùng khuôn với `milestones` để HQ hiện "sắp chạm" + ngày dự kiến.
   */
  adsMilestones: TimelineView["milestones"];
  adsNext: CapacityMilestone | null;
  adsNextEta: MilestoneEta | null;
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
    shopeeAdsShops: slopePerDay(trends.adsShops),
  };
  const states = await prisma.platformCapacityMilestone.findMany();
  const stateByKey = new Map(states.map((s) => [s.key, s] as const));
  const view = (ms: CapacityMilestone) => {
    const st = stateByKey.get(ms.key);
    const reached = isMilestoneReachedOrPassed(ms, g);
    return {
      milestone: ms,
      reached,
      reachedAt: st?.reachedAt?.toISOString() ?? null,
      doneAt: st?.doneAt?.toISOString() ?? null,
      doneBy: st?.doneBy ?? null,
      note: st?.note ?? null,
      progress: ms.conditions.map((c) => ({ metric: c.metric, label: METRIC_LABEL[c.metric], current: g[c.metric], target: c.gte })),
    };
  };
  const milestones = CAPACITY_MILESTONES.map(view);
  // Mốc quota Ads: "đã chạm" = đủ gian theo chuỗi riêng (không kéo theo mốc M).
  const adsMilestones = ADS_QUOTA_MILESTONES.map((ms) => ({ ...view(ms), reached: isMilestoneReached(ms, g) }));
  const adsNext = nextAdsQuotaMilestone(g);
  return {
    current,
    next,
    nextEta: next ? milestoneEta(next, g, trendsPerDay) : null,
    trendsPerDay,
    milestones,
    adsMilestones,
    adsNext,
    adsNextEta: adsNext ? milestoneEta(adsNext, g, trendsPerDay) : null,
  };
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
  push("worker.watermark", "Mốc nước quét đơn", ...watermarkSignal(w.watermark ?? null));
  push(
    "worker.webhook",
    "Hàng đợi webhook Shopee",
    `${w.webhookPending} chờ${w.webhookOldestMin != null ? `, cũ nhất ${w.webhookOldestMin}'` : ""}`,
    w.webhookPending >= T.webhookPending || (w.webhookOldestMin ?? 0) >= T.webhookOldestMin ? "crit" : w.webhookPending > 50 ? "warn" : "ok",
    "Đơn real-time đang chậm — worker quá tải hoặc DB chậm"
  );
  push("worker.durableQueue", "Hàng đợi bền", ...durableQueueSignal(w));
  push("worker.invoice", "Hóa đơn", ...invoiceSignal(w.invoice ?? null));
  push(
    "worker.breaker",
    "Cầu dao API sàn",
    w.breakersDetail.length
      ? `ĐÓNG: ${w.breakersDetail.map(breakerDetailText).join(" · ")}`
      : `mở (đóng ${w.breakerTrips24h} lần liên tiếp gần nhất, 24h)`,
    breakerSignalLevel(w.breakersDetail, w.breakerTrips24h, T.breakerTripsWarn24h),
    w.breakersDetail.length
      ? `Lý do: ${w.breakersDetail.map((b) => b.reason?.slice(0, 160) ?? "không ghi").join(" | ")}` +
          " — 'Bão 429' = ≥3 gian và ≥20 % gian đã gọi bị sàn chặn tầng shop trong 10' (bậc 0 tự mở sau 5'); mã exceed_partner_api mới là vượt trần theo app thật (xem log [ApiBudget] trên worker)"
      : "Nhiều gian cùng vượt trần theo app — xem log [ApiBudget] trên worker, hạ ADS_APP_QPS hoặc xin nâng quota"
  );
  push(
    "worker.queues",
    "Đẩy tồn / cứu đơn / MISA chờ",
    // Ảnh chụp cũ vẫn mang deliveryOverdue > 0 khi tính năng đã ẩn → chữ lẫn mức đều bỏ qua số đó.
    `${w.stockPushPending} tồn, ${DELIVERY_FAIL_FEATURE ? `${w.deliveryOverdue} vé cứu đơn quá hạn` : "cứu đơn đang ẩn"}, ${w.misaPending} MISA`,
    w.stockPushPending > 500 || (DELIVERY_FAIL_FEATURE && w.deliveryOverdue > 100) ? "warn" : "ok"
  );
  push(
    "channel.token",
    "Gian rớt kết nối / sàn trễ đồng bộ",
    `${m.growth.channelsDisconnected24h} mới rớt 24h (tổng ${m.growth.channelsDisconnected}), ${w.syncStalled} lỗi ≥3 lượt${w.syncStalledNames?.length ? ` (${w.syncStalledNames.join("; ")})` : ""}, ${w.adsAuthDisconnected} Hubsell Ads rớt`,
    // Rớt lâu ngày (khách chưa nối lại) không tính; rớt DỒN trong 24h hoặc gian đang
    // ACTIVE mà 3 nhịp không kéo được đơn mới là dấu hiệu.
    m.growth.channelsDisconnected24h >= T.disconnectedDelta24h || w.syncStalled > 0 ? "warn" : "ok",
    "Rớt dồn = token/ủy quyền hỏng hàng loạt; lỗi ≥3 lượt = gian đang ACTIVE mà sàn từ chối (KYC, quyền app…) — sàn từ chối làm mới token thì luật mất ủy quyền tự hạ gian sau 3 lần/30′"
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
    `đang dùng ${i.heapMb}${i.heapLimitMb ? `/${i.heapLimitMb}` : ""} MB heap${i.heapPct != null ? ` (${i.heapPct}%)` : ""} · hệ điều hành giữ ${i.ramMb} MB (${i.ramPct}% gói ${i.plan.webPlan})`,
    ramLevel(i.heapPct ?? null, i.ramPct),
    i.ramPct >= T.ramPctCrit
      ? "Sát trần RAM gói — Render sẽ khởi động lại tiến trình: nâng gói Render"
      : "Heap cao = có request nạp quá nhiều dữ liệu — xem log [Bộ nhớ] trên Render dò việc đang chạy lúc đó"
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

/**
 * Dấu hiệu MỐC NƯỚC quét đơn (lát 3.6): mỗi gian đang quét phải có mốc tươi hơn
 * nhịp quét giãn tối đa (60'); gian đang vét dở = lượt trước chạm trần trang.
 * Gian chưa có mốc chỉ là thông tin (vừa deploy / vừa nối / lượt đầu chưa chạy) —
 * gian lỗi liên tiếp đã có dấu hiệu "sàn trễ đồng bộ" lo.
 */
export function watermarkSignal(wm: WatermarkHealth | null): [value: string, level: SignalLevel, hint: string] {
  if (!wm) {
    return ["không đọc được", "warn", "Cột ordersWatermarkAt chưa có? — migration 20261014230000_channel_orders_watermark đã áp chưa"];
  }
  const lag = wm.maxLagMin != null ? `trễ nhất ${wm.maxLagMin}'${wm.maxLagShop ? ` (${wm.maxLagShop})` : ""}` : "chưa có mốc nào";
  const value =
    `${wm.withMark}/${wm.channels} gian có mốc · ${lag}` +
    ` · ${wm.catchingUp} đang vét dở` +
    (wm.lagOver60 > 0 ? ` · ${wm.lagOver60} gian quá ${T.watermarkLagWarnMin}'` : "") +
    (wm.hibernated ? ` · ${wm.hibernated} ngủ đông (không tính)` : "");
  const level: SignalLevel = wm.lagOver6h > 0 ? "crit" : wm.lagOver60 > 0 || wm.catchingUp > 0 ? "warn" : "ok";
  const hint =
    wm.catchingUp > 0
      ? "Gian chạm trần trang mỗi lượt — lọc log worker theo \"vét tiếp\": lặp mãi ở một gian = sàn trả dòng ngoài cửa sổ (TikTok?) hoặc gian quá lớn, xem docs/DONG-BO-GIAI-DOAN-3.md"
      : "Mốc cũ = gian bị bỏ lượt (lỗi token / sàn / worker quá tải) — xem lastSyncError gian trễ nhất; cột trống = vừa deploy hoặc gian mới";
  return [value, level, hint];
}

/**
 * Dấu hiệu của hàng đợi bền pg-boss + hộp thư đến webhook_events. Ngưỡng dùng
 * lại hai số của hàng đợi webhook cũ (T.webhookPending, T.webhookOldestMin) —
 * cùng một loại việc, chưa có căn cứ để đặt số khác. Việc nằm trong hàng đợi
 * lỗi là việc đã hết lượt thử, cần người xem.
 */
export function durableQueueSignal(
  w: Pick<WorkerLayer, "durableQueues" | "durableQueueError" | "inboxPending" | "inboxOldestMin">
): [value: string, level: SignalLevel, hint: string] {
  if (!w.durableQueues) {
    return [
      `không đọc được${w.durableQueueError ? ` (${w.durableQueueError})` : ""}`,
      "warn",
      "pg-boss chưa khởi động ở tiến trình web — xem log [Queue] trên Render; migration queue_foundation đã áp chưa?",
    ];
  }
  const dead = new Set<string>(DEAD_QUEUES);
  const work = w.durableQueues.filter((q) => !dead.has(q.name));
  const waiting = work.reduce((s, q) => s + q.ready, 0);
  const active = work.reduce((s, q) => s + q.active, 0);
  const deadCount = w.durableQueues.filter((q) => dead.has(q.name)).reduce((s, q) => s + q.ready + q.active, 0);
  const busiest = [...work].sort((a, b) => b.ready - a.ready)[0];
  const value =
    `${waiting} việc chờ, ${active} đang chạy, ${deadCount} trong hàng đợi lỗi` +
    (waiting > 0 && busiest ? ` (đông nhất ${busiest.name}: ${busiest.ready})` : "") +
    ` · hộp thư đến ${w.inboxPending} chờ${w.inboxOldestMin != null ? `, cũ nhất ${w.inboxOldestMin}'` : ""}`;
  const level: SignalLevel =
    waiting >= T.webhookPending || (w.inboxOldestMin ?? 0) >= T.webhookOldestMin
      ? "crit"
      : deadCount > 0 || waiting > 50
        ? "warn"
        : "ok";
  return [
    value,
    level,
    deadCount > 0
      ? "Có việc hết lượt thử nằm trong hàng đợi lỗi — xem log [Queue] trên worker"
      : "Việc dồn = worker quá tải hoặc sàn / database chậm",
  ];
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
