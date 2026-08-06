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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Giãn cách tối thiểu giữa hai lượt quét của CÙNG một chủ shop. */
const SCAN_INTERVAL_MS = 10 * 60 * 1000;
/** Cửa sổ quét đơn lỗ (đơn Đã giao tạo trong N ngày gần nhất). */
const LOSS_WINDOW_DAYS = 7;
/** Cửa sổ quét chênh phí ship chờ khiếu nại. */
const SHIPPING_WINDOW_DAYS = 30;
/** Cửa sổ "SKU có bán" — chỉ báo cháy hàng cho SKU phát sinh đơn gần đây. */
const SELLING_WINDOW_DAYS = 30;
/** Số tiền (lỗ / chênh phí / chi ads) từ mức này trở lên → nâng severity lên high. */
const HIGH_MONEY_THRESHOLD = 500_000;

// ── Ngưỡng cảnh báo Ads đột biến ──
/** Chi ads ngày gần nhất ≥ 1.5× trung bình 7 ngày trước = đột biến. */
const ADS_SPIKE_RATIO = 1.5;
/** Dưới mức này/ngày thì bỏ qua (tránh báo vặt shop chạy ads nhỏ). */
const ADS_MIN_SPEND = 100_000;
const ADS_BASELINE_DAYS = 7;
/** Đơn ngày spike phải TĂNG quá hệ số này so với TB thì mới coi là "ads hiệu quả" (bỏ qua). */
const ADS_ORDER_GROWTH_OK = 1.2;

/** Số nhịp auto-sync (10'/nhịp) lỗi LIÊN TIẾP thì báo "sàn trễ đồng bộ". */
const SYNC_STALL_THRESHOLD = 3;

const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

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

  // CÙNG LUẬT với trang Đơn lỗ (orders-analysis): lợi nhuận ≤ 0 là LỖ, KHÔNG
  // loại đơn thiếu giá vốn — thiếu giá vốn mà vẫn âm nghĩa là phí sàn đã ăn
  // hết doanh thu, càng phải báo. Thẻ nói N đơn thì trang mở ra cũng đúng N.
  const losses = orders.map(computePnlRow).filter((r) => r.profitAfterTax <= 0);
  if (losses.length === 0) return [];

  const totalLoss = losses.reduce((s, r) => s + Math.abs(r.profitAfterTax), 0);
  return [
    {
      type: "loss-orders",
      dedupeKey: "rolling-7d",
      tag: "finance",
      severity: totalLoss >= HIGH_MONEY_THRESHOLD ? "high" : "medium",
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
      severity: total >= HIGH_MONEY_THRESHOLD ? "high" : "medium",
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

/**
 * SÀN TRỄ ĐỒNG BỘ: worker order-auto-sync (10'/nhịp) lỗi liên tiếp ≥ 3 nhịp
 * với một gian ACTIVE (~30 phút không kéo được đơn) — đơn mới đang KHÔNG về
 * Hubsell. Sync thành công là syncFailCount reset 0 → thẻ tự đóng.
 */
async function detectSyncStalled(ownerId: string): Promise<DetectedAlert[]> {
  const channels = await prisma.channel.findMany({
    where: {
      userId: ownerId,
      status: "ACTIVE",
      syncFailCount: { gte: SYNC_STALL_THRESHOLD },
      channelName: { not: ChannelName.OFFLINE },
    },
    select: {
      id: true,
      shopName: true,
      channelName: true,
      syncFailCount: true,
      lastSyncError: true,
      lastSyncAt: true,
    },
  });

  return channels.map((c) => {
    const lastOk = c.lastSyncAt
      ? `Lần đồng bộ thành công gần nhất: ${c.lastSyncAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.`
      : "Chưa có lần đồng bộ thành công nào.";
    return {
      type: "channel-sync-stalled",
      dedupeKey: c.id,
      tag: "channel" as const,
      severity: "high" as const,
      title: `Gian "${c.shopName}" (${CHANNEL_LABEL[c.channelName] ?? c.channelName}) trễ đồng bộ đơn — ${c.syncFailCount} nhịp lỗi liên tiếp`,
      summary: `Đơn mới đang KHÔNG kéo về được Hubsell. Lỗi gần nhất: ${c.lastSyncError ?? "không rõ"}. ${lastOk} Kiểm tra kết nối/uỷ quyền gian hàng.`,
      payload: { kind: "navigate" as const, href: "/channels", label: "Kiểm tra gian hàng" },
    };
  });
}

/**
 * ADS ĐỘT BIẾN NHƯNG CHUYỂN ĐỔI THẤP: chi ads Shopee (bảng AdSpend, sync mỗi
 * giờ) của ngày gần nhất ≥ 1.5× trung bình 7 ngày trước, nhưng số đơn trong
 * ngày KHÔNG tăng tương ứng. Hubsell chưa điều khiển được ads sàn nên nút xử
 * lý là link mở Seller Center để seller tự kiểm tra chiến dịch.
 */
async function detectAdsSpike(ownerId: string): Promise<DetectedAlert[]> {
  const rows = await prisma.adSpend.findMany({
    where: {
      channel: { userId: ownerId },
      date: { gte: daysAgo(ADS_BASELINE_DAYS + 3) },
    },
    select: {
      channelId: true,
      date: true,
      amount: true,
      channel: { select: { shopName: true, channelName: true } },
    },
  });
  if (rows.length === 0) return [];

  const byChannel = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byChannel.get(r.channelId) ?? [];
    list.push(r);
    byChannel.set(r.channelId, list);
  }

  const alerts: DetectedAlert[] = [];
  for (const [channelId, list] of byChannel) {
    // Ngày gần nhất CÓ chi tiêu — mốc so sánh (ngày hôm nay có thể mới sync một phần).
    const spendDays = list
      .filter((r) => Number(r.amount) > 0)
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    if (spendDays.length === 0) continue;
    const latest = spendDays[0];
    const spend = Number(latest.amount);
    if (spend < ADS_MIN_SPEND) continue;

    // Trung bình 7 ngày TRƯỚC ngày spike (ngày không có dòng = chi 0).
    const baseStart = latest.date.getTime() - ADS_BASELINE_DAYS * DAY_MS;
    const baseline =
      list
        .filter((r) => r.date.getTime() >= baseStart && r.date < latest.date)
        .reduce((s, r) => s + Number(r.amount), 0) / ADS_BASELINE_DAYS;

    const isSpike =
      baseline > 0 ? spend >= baseline * ADS_SPIKE_RATIO : spend >= 2 * ADS_MIN_SPEND;
    if (!isSpike) continue;

    // Đơn của gian trong NGÀY spike (AdSpend.date theo múi giờ sàn — VN, UTC+7)
    // so với trung bình đơn/ngày của 7 ngày baseline. Đơn tăng theo thì thôi.
    const dayStart = new Date(latest.date.getTime() - 7 * 3_600_000);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const baseOrdersStart = new Date(dayStart.getTime() - ADS_BASELINE_DAYS * DAY_MS);
    const [ordersToday, ordersBase] = await Promise.all([
      prisma.order.count({
        where: { channelId, createdAt: { gte: dayStart, lt: dayEnd } },
      }),
      prisma.order.count({
        where: { channelId, createdAt: { gte: baseOrdersStart, lt: dayStart } },
      }),
    ]);
    const avgOrders = ordersBase / ADS_BASELINE_DAYS;
    if (ordersToday > avgOrders * ADS_ORDER_GROWTH_OK) continue; // ads đang ra đơn — không báo

    const dayKey = latest.date.toISOString().slice(0, 10);
    const dd = dayKey.slice(8, 10), mm = dayKey.slice(5, 7);
    alerts.push({
      type: "ads-spike",
      dedupeKey: `${channelId}:${dayKey}`,
      tag: "ads",
      severity: spend >= HIGH_MONEY_THRESHOLD ? "high" : "medium",
      title: `Chi phí Ads gian "${latest.channel.shopName}" tăng đột biến — ${vnd(spend)} ngày ${dd}/${mm}`,
      summary: `Trung bình 7 ngày trước chỉ ${vnd(baseline)}/ngày, nhưng đơn trong ngày không tăng tương ứng (${ordersToday} đơn so với TB ${avgOrders.toFixed(1)}/ngày). Vào ${CHANNEL_LABEL[latest.channel.channelName] ?? "sàn"} Seller Center kiểm tra chiến dịch đang đốt tiền.`,
      payload: {
        kind: "navigate",
        href: "https://banhang.shopee.vn",
        label: "Mở Shopee Seller Center",
      },
    });
  }
  return alerts;
}

// ════════════ ĐỢT 3 — KHUNG CHỜ TRIỂN KHAI (làm cả thể khi có API TikTok) ════════════
//
// Quyết định 06/08/2026 (anh Trung): Đợt 3 CHỈ dựng khung đặc tả, triển khai
// trọn gói khi TikTok Shop cấp API thật. Khi làm: viết detector theo đặc tả
// dưới đây rồi thêm vào mảng `detectors` trong scanOpsAlerts() — khung
// OpsAlert/UI/deep-link đã dùng chung, KHÔNG cần sửa gì thêm ở frontend.
//
// (7) type "customer-refusal" — KHÁCH BOM HÀNG (dữ liệu ĐÃ CÓ SẴN):
//     · Điều kiện: cùng `Order.customerPhone` (nullable — bỏ qua đơn không có
//       số; sàn trả số đã che dạng "0908****21" vẫn dedupe được trong phạm vi
//       một sàn) có ≥ 3 đơn CANCELLED trong 14 ngày gần nhất.
//     · dedupeKey: `${channelId}:${customerPhone}` — tự đóng khi cửa sổ 14
//       ngày trôi qua khỏi các đơn hủy.
//     · tag "channel", severity medium (high nếu tổng giá trị đơn hủy ≥ 500k).
//     · Action: navigate `/orders?search=<phone>` (trang Đơn hàng đã có ô tìm
//       kiếm) để seller xem chuỗi đơn của khách rồi tự quyết chặn/gọi xác minh.
//     · Thay thế thẻ mock al-chn-2 khi lên sóng.
//
// (8) MỞ RỘNG "ads-spike" cho Lazada + TikTok:
//     · Bảng AdSpend đã đa kênh theo channelId — detectAdsSpike phía trên tự
//       chạy cho mọi sàn NGAY KHI worker có luồng sync chi ads của sàn đó
//       (thêm nhánh trong order-auto-sync.ts giống syncShopeeAdsSpend).
//     · Việc cần làm: client API ads Lazada/TikTok (đọc chi tiêu theo ngày)
//       + href Seller Center theo sàn trong payload (hiện hardcode Shopee).
//
// (9) type "tax-error" — LỖI HÓA ĐƠN/KÝ SỐ (chờ module Invoicing chạy thương mại):
//     · Chỉ báo khi PHÁT SINH LỖI (lỗi kết nối API hóa đơn, lỗi ký số, webhook
//       MISA trả TAX_MISMATCH) — đúng thiết kế Empty State (Beta) của tag THUẾ.
//     · Nguồn: Order.einvoiceStatus = FAILED + bảng nhật ký webhook MISA.
//     · tag "tax", KE_TOAN thao tác; action navigate `/invoicing/history`.

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
      detectSyncStalled,
      detectAdsSpike,
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
