// ============================================================
// TRUNG TÂM ĐIỀU HÀNH — DETECTOR CẢNH BÁO THẬT (OpsAlert hợp nhất)
//
// Mỗi detector quét MỘT loại sự cố trên dữ liệu thật của chủ shop và trả về
// danh sách "điều kiện đang tồn tại". scanOpsAlerts() hoà giải danh sách đó
// với bảng OpsAlert:
//   · Điều kiện mới        → tạo bản ghi OPEN + ghi một dòng nhật ký vận hành.
//   · Điều kiện còn        → cập nhật nội dung (đếm/số tiền mới nhất).
//   · Điều kiện đã hết     → AUTO_CLOSED (thẻ tự biến mất, KHÔNG bắt tick tay).
//   · Chủ shop tick tay    → RESOLVED: ẩn cho tới khi điều kiện hết hẳn rồi
//     tái phát mới mở lại — tôn trọng quyết định "tôi biết rồi" của seller.
//
// Chạy khi GET /state (mở Dashboard), throttle 10 phút mỗi chủ shop — không
// cần cron riêng. Mọi lỗi được nuốt: quét hỏng không được làm vỡ Dashboard.
// ============================================================

import { ChannelName, ShippingDisputeStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { computePnlRow, fetchPnlOrders } from "./routes/finance";

/** Giãn cách tối thiểu giữa hai lượt quét của CÙNG một chủ shop. */
const SCAN_INTERVAL_MS = 10 * 60 * 1000;
/** Cửa sổ quét đơn lỗ (đơn Đã giao tạo trong N ngày gần nhất). */
const LOSS_WINDOW_DAYS = 7;
/** Cửa sổ quét chênh phí ship chờ khiếu nại. */
const SHIPPING_WINDOW_DAYS = 30;
/** Cửa sổ "SKU có bán" — chỉ báo cháy hàng cho SKU phát sinh đơn gần đây. */
const SELLING_WINDOW_DAYS = 30;
/** Tổng lỗ / tổng chênh phí từ mức này trở lên thì nâng severity lên high. */
const HIGH_LOSS_THRESHOLD = 500_000;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}₫`;

/** Nhãn sàn hiển thị trong câu cảnh báo. */
const CHANNEL_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok Shop",
  OFFLINE: "Offline",
};

/** Một điều kiện sự cố mà detector phát hiện được (chưa gắn với DB). */
interface DetectedAlert {
  type: string;
  dedupeKey: string;
  tag: "inventory" | "finance" | "channel" | "ads" | "tax";
  severity: "high" | "medium" | "low";
  title: string;
  summary: string;
  /** ActionParams cho nút xử lý phía frontend — hiện là deep-link nội bộ. */
  payload: { kind: "navigate"; href: string; label: string };
}

// ─────────────────────────── DETECTORS ───────────────────────────

/**
 * CHÁY HÀNG: SKU liên kết kho vật lý, CÓ phát sinh đơn trong 30 ngày (đang bán
 * thật) nhưng tồn khả dụng ≤ 0 → đang mất doanh thu từng giờ. Gom theo GIAN để
 * một gian nhiều SKU cháy chỉ chiếm một thẻ.
 */
async function detectStockouts(ownerId: string): Promise<DetectedAlert[]> {
  const mappings = await prisma.channelProduct.findMany({
    where: {
      productId: { not: null },
      channel: {
        userId: ownerId,
        status: "ACTIVE",
        channelName: { not: ChannelName.OFFLINE },
      },
    },
    select: {
      channel: { select: { id: true, shopName: true, channelName: true } },
      product: {
        select: {
          id: true,
          skuCode: true,
          quantityInStock: true,
          holdQuantity: true,
        },
      },
    },
  });

  const stockouts = mappings.filter(
    (m) => m.product && m.product.quantityInStock - m.product.holdQuantity <= 0
  );
  if (stockouts.length === 0) return [];

  // Chỉ giữ SKU có đơn gần đây — SKU ngừng kinh doanh tồn 0 không phải sự cố.
  const sellingRows = await prisma.orderItem.findMany({
    where: {
      productId: { in: [...new Set(stockouts.map((m) => m.product!.id))] },
      order: {
        createdAt: { gte: daysAgo(SELLING_WINDOW_DAYS) },
        channel: { userId: ownerId },
      },
    },
    select: { productId: true },
    distinct: ["productId"],
  });
  const selling = new Set(sellingRows.map((r) => r.productId));

  // Gom theo gian: mỗi gian một thẻ, liệt kê tối đa 3 SKU đầu.
  const byChannel = new Map<
    string,
    { shopName: string; channelName: string; skus: Set<string> }
  >();
  for (const m of stockouts) {
    if (!selling.has(m.product!.id)) continue;
    const g = byChannel.get(m.channel.id) ?? {
      shopName: m.channel.shopName,
      channelName: m.channel.channelName,
      skus: new Set<string>(),
    };
    g.skus.add(m.product!.skuCode);
    byChannel.set(m.channel.id, g);
  }

  const alerts: DetectedAlert[] = [];
  for (const [channelId, g] of byChannel) {
    const skus = [...g.skus];
    const head = skus.slice(0, 3).join(", ");
    const more = skus.length > 3 ? ` +${skus.length - 3} SKU khác` : "";
    alerts.push({
      type: "stockout",
      dedupeKey: channelId,
      tag: "inventory",
      severity: "high",
      title:
        skus.length > 1
          ? `${skus.length} SKU đang cháy hàng trên gian "${g.shopName}" (${CHANNEL_LABEL[g.channelName] ?? g.channelName})`
          : `SKU ${skus[0]} đang cháy hàng trên gian "${g.shopName}"`,
      summary: `${head}${more} có đơn trong ${SELLING_WINDOW_DAYS} ngày qua nhưng tồn khả dụng đã hết — đang mất doanh thu. Nhập thêm kho để hệ thống tự đẩy tồn mở bán lại.`,
      payload: { kind: "navigate", href: "/products", label: "Kiểm tra tồn kho" },
    });
  }
  return alerts;
}

/**
 * GIAN MẤT KẾT NỐI: status DISCONNECTED (hết hạn uỷ quyền do cron token-refresh
 * đánh dấu, hoặc chủ shop tự ngắt rồi quên) — đơn mới và tồn kho KHÔNG đồng bộ.
 */
async function detectDisconnectedChannels(ownerId: string): Promise<DetectedAlert[]> {
  const channels = await prisma.channel.findMany({
    where: {
      userId: ownerId,
      status: "DISCONNECTED",
      refreshToken: { not: null },
      channelName: { not: ChannelName.OFFLINE },
    },
    select: { id: true, shopName: true, channelName: true },
  });

  return channels.map((c) => ({
    type: "channel-disconnected",
    dedupeKey: c.id,
    tag: "channel" as const,
    severity: "high" as const,
    title: `Gian "${c.shopName}" (${CHANNEL_LABEL[c.channelName] ?? c.channelName}) đang mất kết nối`,
    summary:
      "Hết hạn uỷ quyền hoặc đã ngắt kết nối — đơn mới, tồn kho và đối soát KHÔNG được đồng bộ. Kết nối lại để tránh sót đơn.",
    payload: { kind: "navigate", href: "/channels", label: "Kết nối lại gian" },
  }));
}

/**
 * ĐƠN LỖ: đơn Đã giao trong 7 ngày có lợi nhuận ≤ 0 (số từ computePnlRow —
 * cùng nguồn với trang Đơn lỗ). Một thẻ tổng hợp, bấm vào xem từng đơn.
 */
async function detectLossOrders(ownerId: string): Promise<DetectedAlert[]> {
  const orders = await fetchPnlOrders(
    { userId: ownerId },
    { gte: daysAgo(LOSS_WINDOW_DAYS), lte: new Date() },
    ShippingStatus.DELIVERED
  );
  if (orders.length === 0) return [];

  const losses = orders
    .map(computePnlRow)
    .filter((r) => !r.missingCostPrice && r.profitAfterTax <= 0);
  if (losses.length === 0) return [];

  const totalLoss = losses.reduce((s, r) => s + Math.abs(r.profitAfterTax), 0);
  return [
    {
      type: "loss-orders",
      dedupeKey: "rolling-7d",
      tag: "finance",
      severity: totalLoss >= HIGH_LOSS_THRESHOLD ? "high" : "medium",
      title: `${losses.length} đơn giao gần đây bị LỖ — tổng ${vnd(totalLoss)}`,
      summary: `Trong ${LOSS_WINDOW_DAYS} ngày qua có ${losses.length} đơn Đã giao lợi nhuận âm (phí thật từ sao kê sàn). Bấm xem từng đơn lỗ do giá vốn hay do phí sàn để điều chỉnh giá bán.`,
      payload: { kind: "navigate", href: "/finance/loss-orders", label: "Xem đơn lỗ" },
    },
  ];
}

/**
 * CHÊNH PHÍ SHIP: đơn bị sàn trừ phí vận chuyển NHIỀU HƠN mức báo ban đầu và
 * còn ở trạng thái "Chờ khiếu nại" — tiền đòi lại được nếu khiếu nại sớm.
 */
async function detectShippingFeeDiff(ownerId: string): Promise<DetectedAlert[]> {
  const agg = await prisma.order.aggregate({
    where: {
      channel: { userId: ownerId },
      shippingFeeDiff: { gt: 0 },
      shippingDisputeStatus: ShippingDisputeStatus.CHO_KHIEU_NAI,
      createdAt: { gte: daysAgo(SHIPPING_WINDOW_DAYS) },
    },
    _count: { _all: true },
    _sum: { shippingFeeDiff: true },
  });

  const count = agg._count._all;
  if (count === 0) return [];
  const total = Number(agg._sum.shippingFeeDiff ?? 0);

  return [
    {
      type: "shipping-fee-diff",
      dedupeKey: "rolling-30d",
      tag: "finance",
      severity: total >= HIGH_LOSS_THRESHOLD ? "high" : "medium",
      title: `${count} đơn bị sàn trừ THÊM phí ship — tổng ${vnd(total)} chờ khiếu nại`,
      summary: `${SHIPPING_WINDOW_DAYS} ngày qua sàn khấu trừ phí vận chuyển cao hơn mức báo ban đầu trên ${count} đơn. Khiếu nại sớm để đòi lại tiền trước khi quá hạn đối soát.`,
      payload: {
        kind: "navigate",
        href: "/finance/shipping-alerts",
        label: "Mở Đối soát phí ship",
      },
    },
  ];
}

// ─────────────────────────── HOÀ GIẢI & THROTTLE ───────────────────────────

const lastScanAt = new Map<string, number>();

/** Ghi một dòng nhật ký vận hành khi cảnh báo mới xuất hiện / tái phát. */
async function logAlertActivity(ownerId: string, a: DetectedAlert): Promise<void> {
  await prisma.opsActivity.create({
    data: { ownerId, tag: a.tag, message: `⚠️ ${a.title}` },
  });
}

/**
 * Quét toàn bộ detector cho một chủ shop rồi hoà giải với bảng OpsAlert.
 * Throttle 10 phút/owner (bỏ qua bằng force=true). KHÔNG BAO GIỜ ném lỗi.
 */
export async function scanOpsAlerts(ownerId: string, force = false): Promise<void> {
  try {
    const last = lastScanAt.get(ownerId) ?? 0;
    if (!force && Date.now() - last < SCAN_INTERVAL_MS) return;
    lastScanAt.set(ownerId, Date.now());

    // Mỗi detector lỗi riêng lẻ không được kéo sập các detector còn lại.
    const detected: DetectedAlert[] = [];
    const detectors = [
      detectStockouts,
      detectDisconnectedChannels,
      detectLossOrders,
      detectShippingFeeDiff,
    ];
    for (const detect of detectors) {
      try {
        detected.push(...(await detect(ownerId)));
      } catch (err) {
        console.error(`[Ops-alerts] Detector ${detect.name} lỗi:`, (err as Error).message);
      }
    }

    const existing = await prisma.opsAlert.findMany({ where: { ownerId } });
    const byKey = new Map(existing.map((r) => [`${r.type}|${r.dedupeKey}`, r]));
    const desired = new Set(detected.map((d) => `${d.type}|${d.dedupeKey}`));

    for (const d of detected) {
      const row = byKey.get(`${d.type}|${d.dedupeKey}`);
      const content = {
        tag: d.tag,
        severity: d.severity,
        title: d.title,
        summary: d.summary,
        payload: JSON.stringify(d.payload),
      };

      if (!row) {
        await prisma.opsAlert.create({
          data: { ownerId, type: d.type, dedupeKey: d.dedupeKey, ...content },
        });
        await logAlertActivity(ownerId, d);
      } else if (row.status === "AUTO_CLOSED") {
        // Điều kiện TÁI PHÁT sau khi đã hết → mở lại như cảnh báo mới
        // (createdAt mới để nhãn "Mới" và thứ tự phản ánh đúng lần tái phát).
        await prisma.opsAlert.update({
          where: { id: row.id },
          data: { ...content, status: "OPEN", createdAt: new Date(), resolvedAt: null },
        });
        await logAlertActivity(ownerId, d);
      } else {
        // OPEN: cập nhật số liệu mới nhất. RESOLVED: cũng cập nhật nội dung
        // nhưng giữ trạng thái ẩn — tôn trọng tick "Đã xử lý" của chủ shop.
        await prisma.opsAlert.update({ where: { id: row.id }, data: content });
      }
    }

    // Điều kiện đã hết → tự đóng (cả bản OPEN lẫn RESOLVED).
    for (const row of existing) {
      if (row.status === "AUTO_CLOSED") continue;
      if (!desired.has(`${row.type}|${row.dedupeKey}`)) {
        await prisma.opsAlert.update({
          where: { id: row.id },
          data: { status: "AUTO_CLOSED" },
        });
      }
    }
  } catch (err) {
    console.error("[Ops-alerts] Lỗi vòng quét:", err);
  }
}
