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

import {
  ChannelName,
  FeeAuditStatus,
  KocSampleStatus,
  ReturnStatus,
  ShippingDisputeStatus,
  ShippingStatus,
} from "@prisma/client";
import { notify } from "./notifications";
import { prisma } from "../lib/prisma";
import { computePnlRow, fetchPnlOrders } from "../routes/finance";
import {
  assistantDecisionActive,
  computeChannelAdsInsights,
  vnDateKey,
} from "../integrations/shopee/ads-insights";
import type { AssistantTrigger } from "../integrations/shopee/ads-assistant-rules";
import { getAdsTotalBalance } from "../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../integrations/shopee/service";
import { getAdsCampaignList, lazAdsNum } from "../integrations/lazada/client";
import { getValidLazadaAccessToken } from "../integrations/lazada/service";
import {
  DELIVERY_FAIL_TAB_HREF,
  effectiveDeliveryFailConfig,
} from "../integrations/shopee/delivery-fail";

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

// ── Ngưỡng Trợ lý quảng cáo Shopee (verdict rule engine GĐ2 → Trung tâm điều hành) ──
/** Ví ads dự kiến cạn dưới mức này (giờ) thì phát cảnh báo Low Balance. */
const ADS_WALLET_LOW_HOURS = 24;

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
export interface DetectedAlert {
  type: string;
  dedupeKey: string;
  tag: "inventory" | "finance" | "channel" | "ads" | "tax";
  severity: "high" | "medium" | "low";
  title: string;
  summary: string;
  /** ActionParams cho nút xử lý phía frontend — hiện là deep-link nội bộ.
   *  `source` = nhãn sàn phát sinh cảnh báo (badge "Shopee"/"TikTok"… trên thẻ). */
  payload: { kind: "navigate"; href: string; label: string; source?: string };
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
      // Route mới sau điều chuyển menu 08/08; /finance/loss-orders cũ vẫn redirect
      payload: {
        kind: "navigate",
        href: "/operations-assistant/loss-orders",
        label: "Xem đơn lỗ",
      },
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
      // Route mới sau điều chuyển menu 08/08; /finance/shipping-alerts cũ vẫn redirect
      payload: {
        kind: "navigate",
        href: "/warehouse/shipping-alerts",
        label: "Mở Đối soát phí ship",
      },
    },
  ];
}

// ── Ngưỡng Kiểm toán phí sàn (đồng bộ với routes/finance.ts — sửa là sửa CẢ HAI) ──
/** Khoản sàn trả thiếu dưới mức này coi là lệch vặt, không báo. */
const FEE_AUDIT_SHORTFALL_MIN = 1_000;
/** Rổ "quá hạn chưa trả": quá N ngày từ mốc giao thành công. */
const FEE_AUDIT_PENDING_DAYS = 7;
/** Đơn cũ chưa có mốc giao — đếm từ ngày đặt với biên rộng hơn hẳn. */
const FEE_AUDIT_FALLBACK_DAYS = 21;
/** Trần tuổi đơn của rổ "quá hạn chưa trả" — đơn cổ hơn cửa sổ đối soát 90
 *  ngày của worker thì sàn không còn sao kê để giải ngân, báo là báo oan. */
const FEE_AUDIT_MAX_AGE_DAYS = 90;

/**
 * KIỂM TOÁN PHÍ SÀN (rổ #2 + #3 — rổ #1 truy thu ship đã có detectShippingFeeDiff):
 *   · "sàn trả THIẾU": payout thật thấp hơn số ước tính CỦA CHÍNH SÀN đã snapshot
 *     trước giải ngân (payoutShortfall, ghi ở syncShopeeSettlements), còn CHO_XU_LY.
 *   · "giao xong QUÁ HẠN chưa trả": đơn DELIVERED không hoàn, chưa isSettled,
 *     quá hạn từ mốc giao — chỉ soi Shopee/Lazada (sàn có luồng đối soát thật).
 */
async function detectFeeAudit(ownerId: string): Promise<DetectedAlert[]> {
  const alerts: DetectedAlert[] = [];

  const shortAgg = await prisma.order.aggregate({
    where: {
      channel: { userId: ownerId },
      payoutShortfall: { gte: FEE_AUDIT_SHORTFALL_MIN },
      payoutAuditStatus: FeeAuditStatus.CHO_XU_LY,
      createdAt: { gte: daysAgo(SHIPPING_WINDOW_DAYS) },
    },
    _count: { _all: true },
    _sum: { payoutShortfall: true },
  });
  if (shortAgg._count._all > 0) {
    const total = Number(shortAgg._sum.payoutShortfall ?? 0);
    alerts.push({
      type: "fee-audit-shortfall",
      dedupeKey: "rolling-30d",
      tag: "finance",
      severity: total >= HIGH_MONEY_THRESHOLD ? "high" : "medium",
      title: `${shortAgg._count._all} đơn sàn trả THIẾU so với số sàn tự ước tính — tổng ${vnd(total)}`,
      summary: `Số tiền giải ngân thực tế thấp hơn số Shopee tự ước tính trước đó trên ${shortAgg._count._all} đơn (đã loại đơn hoàn tiền). Mở Kiểm toán phí sàn xem chênh từng đơn và gửi khiếu nại.`,
      payload: {
        kind: "navigate",
        href: "/finance/fee-audit?tab=payout",
        label: "Mở Kiểm toán phí sàn",
      },
    });
  }

  const now = Date.now();
  const pendingRows = await prisma.order.findMany({
    where: {
      channel: {
        userId: ownerId,
        channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
      },
      isSettled: false,
      shippingStatus: ShippingStatus.DELIVERED,
      returnStatus: ReturnStatus.NONE,
      // Trần tuổi đứng NGOÀI OR — cả hai nhánh đều phải trong cửa sổ 90 ngày.
      createdAt: { gte: daysAgo(FEE_AUDIT_MAX_AGE_DAYS) },
      OR: [
        { deliveredAt: { lt: new Date(now - FEE_AUDIT_PENDING_DAYS * DAY_MS) } },
        {
          deliveredAt: null,
          createdAt: { lt: new Date(now - FEE_AUDIT_FALLBACK_DAYS * DAY_MS) },
        },
      ],
    },
    select: { expectedPayout: true, totalAmount: true },
  });
  if (pendingRows.length > 0) {
    const total = pendingRows.reduce(
      (s, o) => s + Number(o.expectedPayout ?? o.totalAmount),
      0
    );
    alerts.push({
      type: "fee-audit-pending",
      dedupeKey: "overdue",
      tag: "finance",
      severity: total >= HIGH_MONEY_THRESHOLD ? "high" : "medium",
      title: `${pendingRows.length} đơn giao xong đã lâu mà sàn CHƯA trả tiền — ${vnd(total)} đang treo`,
      summary: `Đơn giao thành công quá ${FEE_AUDIT_PENDING_DAYS} ngày nhưng chưa thấy sàn giải ngân. Kiểm tra ví sàn/đối soát — tiền treo lâu có thể là đơn bị sàn giữ lại hoặc lỗi đối soát.`,
      payload: {
        kind: "navigate",
        href: "/finance/fee-audit?tab=pending",
        label: "Mở Kiểm toán phí sàn",
      },
    });
  }

  return alerts;
}

/**
 * SỔ KOC — BÙNG MẪU: phiếu hàng mẫu đã gửi, quá hạn lên bài (postDeadlineAt)
 * mà KOC vẫn im lặng. Mỗi phiếu quá hạn là tiền mẫu (giá vốn + ship) đang có
 * nguy cơ mất trắng — nhắc chủ shop đòi bài hoặc đánh dấu bùng + blacklist.
 */
async function detectKocSampleOverdue(ownerId: string): Promise<DetectedAlert[]> {
  const overdue = await prisma.kocSampleShipment.findMany({
    where: {
      ownerId,
      status: KocSampleStatus.WAITING,
      postDeadlineAt: { lt: new Date() },
    },
    select: { cost: true },
  });
  if (overdue.length === 0) return [];
  const total = overdue.reduce((s, x) => s + Number(x.cost), 0);
  return [
    {
      type: "koc-sample-overdue",
      dedupeKey: "overdue",
      tag: "finance",
      severity: total >= HIGH_MONEY_THRESHOLD ? "high" : "medium",
      title: `${overdue.length} KOC quá hạn chưa đăng bài sau khi nhận mẫu — ${vnd(total)} tiền mẫu đang treo`,
      summary:
        "Hàng mẫu đã gửi nhưng quá hạn lên bài mà chưa thấy content. Nhắn đòi bài sớm, hoặc đánh dấu BÙNG để đưa KOC vào danh sách đen — lần sau hệ thống tự chặn gửi mẫu.",
      payload: {
        kind: "navigate",
        href: "/koc-marketing/samples?overdue=1",
        label: "Mở Sổ hàng mẫu",
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
  // Gian đã sync được CHIẾN DỊCH ads → detectShopeeAdsAssistant bên dưới báo
  // spike theo TỪNG campaign (chính xác + deep-link nội bộ) — nhường, tránh
  // báo đúp cùng một hiện tượng. Detector này giữ vai trò lưới an toàn cho
  // gian chỉ có tổng chi AdSpend (Lazada/TikTok sau này, gian lỗi sync campaign).
  const campaignChannels = await prisma.adsCampaign.findMany({
    where: { channel: { userId: ownerId } },
    select: { channelId: true },
    distinct: ["channelId"],
  });
  const hasCampaignData = new Set(campaignChannels.map((r) => r.channelId));

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
    if (hasCampaignData.has(channelId)) continue; // Trợ lý Shopee lo gian này
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
        source: CHANNEL_LABEL[latest.channel.channelName],
      },
    });
  }
  return alerts;
}

// ─────────── TRỢ LÝ QUẢNG CÁO SHOPEE → TRUNG TÂM ĐIỀU HÀNH ───────────
//
// Nguồn verdict là rule engine GĐ2 (computeChannelAdsInsights — CÙNG lõi với
// trang /ads/shopee và executor GĐ3, không tính lại luật). Chỉ đẩy 3 kịch bản
// "báo động đỏ" lên Trung tâm điều hành, GOM MỖI KỊCH BẢN MỘT THẺ/GIAN để
// không nhấn chìm cảnh báo KHO/TÀI CHÍNH (quyết định 10/08, anh Trung):
//   ads-spend-spike      = verdict spike (Q3 — vọt chi hôm nay, không bù nổi)
//   ads-zero-order-drain = pause_now nhánh zero_order (đốt tiền 0 đơn)
//   ads-roas-risk        = pause_now nhánh below_breakeven (ROAS dưới hòa vốn thật)
//   ads-low-balance      = ví ads dự kiến cạn < 24h (số dư gọi sống mỗi lượt quét)
// review/grace Ở LẠI trang /ads/shopee — vùng vàng không réo còi điều hành.
// Campaign chủ shop ĐÃ QUYẾT (decisionActive) bị loại từ nguồn → thẻ tự đóng.

/** Lát cắt tối giản của một campaign cho việc gom kịch bản — thuần để test. */
export interface ShopeeAdsCampaignSignal {
  campaignId: string;
  name: string;
  verdict: string | null;
  triggers: AssistantTrigger[];
  /** Chủ shop đã quyết trên /ads/shopee và verdict chưa đổi loại. */
  decisionActive: boolean;
  spendToday: number;
  spend7d: number;
}

export interface ShopeeAdsScenarioGroups {
  spendSpike: ShopeeAdsCampaignSignal[];
  zeroOrderDrain: ShopeeAdsCampaignSignal[];
  roasRisk: ShopeeAdsCampaignSignal[];
}

/**
 * Chia campaign vào 3 kịch bản báo động đỏ — mỗi campaign vào ĐÚNG MỘT nhóm
 * (dính cả zero_order lẫn below_breakeven thì xếp zero_order: 0 đơn là nặng hơn).
 */
export function groupShopeeAdsScenarios(
  campaigns: ShopeeAdsCampaignSignal[]
): ShopeeAdsScenarioGroups {
  const groups: ShopeeAdsScenarioGroups = {
    spendSpike: [],
    zeroOrderDrain: [],
    roasRisk: [],
  };
  for (const c of campaigns) {
    if (c.decisionActive) continue; // người đã quyết — máy không réo lại
    if (c.verdict === "spike") groups.spendSpike.push(c);
    else if (c.verdict === "pause_now") {
      if (c.triggers.includes("zero_order")) groups.zeroOrderDrain.push(c);
      else if (c.triggers.includes("below_breakeven")) groups.roasRisk.push(c);
    }
  }
  return groups;
}

/**
 * Ước số giờ còn lại của ví ads: số dư ÷ tốc độ đốt/giờ. Tốc độ đốt lấy MAX của
 * (chi hôm nay quy theo giờ đã trôi, trung bình 7 ngày ÷ 24) — lấy max để thận
 * trọng: sáng sớm chưa tiêu gì thì nhịp 7 ngày vẫn giữ mẫu, ngày đang vọt chi
 * thì nhịp hôm nay phản ánh đúng đám cháy. Không có nhịp đốt nào (> 0) → null.
 */
export function estimateAdsWalletHoursLeft(input: {
  balance: number;
  spendToday: number;
  /** Số giờ đã trôi của hôm nay theo GIỜ VN (kẹp tối thiểu 1 để khỏi chia 0). */
  hoursElapsedToday: number;
  avgDailySpend7d: number;
}): number | null {
  const todayRate = input.spendToday / Math.max(1, input.hoursElapsedToday);
  const burnPerHour = Math.max(todayRate, input.avgDailySpend7d / 24);
  if (burnPerHour <= 0) return null;
  return input.balance / burnPerHour;
}

/** Số giờ đã trôi của hôm nay theo giờ VN (server Render chạy UTC). */
function hoursElapsedTodayVN(): number {
  return (Date.now() / 3_600_000 + 7) % 24;
}

/** Liệt kê tối đa 3 tên campaign, phần dư gộp thành "+N chiến dịch khác". */
function campaignListText(list: ShopeeAdsCampaignSignal[]): string {
  const names = list
    .slice(0, 3)
    .map((c) => `"${c.name || `#${c.campaignId}`}"`)
    .join(", ");
  return list.length > 3 ? `${names} +${list.length - 3} chiến dịch khác` : names;
}

/** Nhãn + đường dẫn trang ads theo sàn — mọi text/deep-link của thẻ đi qua đây. */
export interface AdsAlertPlatform {
  label: string; // "Shopee" | "Lazada" — cũng là badge nguồn trên FE (SOURCE_META)
  path: string; // "/ads/shopee" | "/ads/lazada"
}
const ADS_ALERT_SHOPEE: AdsAlertPlatform = { label: "Shopee", path: "/ads/shopee" };
const ADS_ALERT_LAZADA: AdsAlertPlatform = { label: "Lazada", path: "/ads/lazada" };

/** 1 campaign → deep-link thẳng campaign; nhiều → bộ lọc "cần xử lý" của trang ads. */
function adsDeepLink(
  path: string,
  channelId: string,
  list: ShopeeAdsCampaignSignal[]
): string {
  return list.length === 1
    ? `${path}?channelId=${channelId}&campaign_id=${encodeURIComponent(list[0].campaignId)}`
    : `${path}?channelId=${channelId}&needs_action=1`;
}

/**
 * Dựng các thẻ cảnh báo từ nhóm kịch bản + trạng thái ví — THUẦN, vitest đánh
 * thẳng. dedupeKey = channelId (type đã phân biệt kịch bản trong khoá hoà giải).
 * Dùng chung Shopee + Lazada qua `platform` (mặc định Shopee — giữ chữ ký cũ
 * cho test và detector hiện có).
 */
export function buildShopeeAdsAssistantAlerts(
  shop: { channelId: string; shopName: string },
  groups: ShopeeAdsScenarioGroups,
  wallet: { balance: number; hoursLeft: number | null } | null,
  platform: AdsAlertPlatform = ADS_ALERT_SHOPEE
): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];
  const base = {
    dedupeKey: shop.channelId,
    tag: "ads" as const,
  };
  const payload = (list: ShopeeAdsCampaignSignal[]) => ({
    kind: "navigate" as const,
    href: adsDeepLink(platform.path, shop.channelId, list),
    label: "Xử lý chiến dịch",
    source: platform.label,
  });

  const spike = groups.spendSpike;
  if (spike.length > 0) {
    const totalToday = spike.reduce((s, c) => s + c.spendToday, 0);
    alerts.push({
      ...base,
      type: "ads-spend-spike",
      severity: "high",
      title:
        spike.length > 1
          ? `${spike.length} chiến dịch ${platform.label} vọt chi bất thường hôm nay — gian "${shop.shopName}"`
          : `Chiến dịch ${campaignListText(spike)} vọt chi bất thường hôm nay — gian "${shop.shopName}"`,
      summary: `Hôm nay đã tiêu ${vnd(totalToday)}, vượt xa nhịp ngày thường mà doanh thu chưa bù nổi hòa vốn: ${campaignListText(spike)}. Kiểm tra ngay trước khi cháy thêm ngân sách.`,
      payload: payload(spike),
    });
  }

  const drain = groups.zeroOrderDrain;
  if (drain.length > 0) {
    const total7d = drain.reduce((s, c) => s + c.spend7d, 0);
    alerts.push({
      ...base,
      type: "ads-zero-order-drain",
      severity: "high",
      title: `Ads đốt ${vnd(total7d)} nhưng KHÔNG ra đơn nào — ${drain.length > 1 ? `${drain.length} chiến dịch` : "chiến dịch " + campaignListText(drain)} gian "${shop.shopName}"`,
      summary: `${campaignListText(drain)} tiêu vượt ngưỡng trong cửa sổ gần nhất mà 0 đơn — tiền đang chảy một chiều. Trợ lý đề xuất tạm dừng để cắt lỗ.`,
      payload: payload(drain),
    });
  }

  const roas = groups.roasRisk;
  if (roas.length > 0) {
    const total7d = roas.reduce((s, c) => s + c.spend7d, 0);
    alerts.push({
      ...base,
      type: "ads-roas-risk",
      severity: total7d >= HIGH_MONEY_THRESHOLD ? "high" : "medium",
      title: `ROAS dưới hòa vốn thật — ${roas.length > 1 ? `${roas.length} chiến dịch` : "chiến dịch " + campaignListText(roas)} gian "${shop.shopName}" đang lỗ`,
      summary: `${campaignListText(roas)} có ROAS thấp hơn ngưỡng hòa vốn tính từ lãi/lỗ thật của SKU — mỗi đồng ads đang lỗ thật. Đã tiêu ${vnd(total7d)} trong 7 ngày gần nhất.`,
      payload: payload(roas),
    });
  }

  if (
    wallet &&
    wallet.hoursLeft != null &&
    wallet.hoursLeft < ADS_WALLET_LOW_HOURS
  ) {
    alerts.push({
      ...base,
      type: "ads-low-balance",
      severity: "high",
      title: `Ví ${platform.label} Ads gian "${shop.shopName}" sắp cạn — còn ${vnd(wallet.balance)}`,
      summary: `Với tốc độ đốt hiện tại, ví quảng cáo dự kiến cạn trong ~${Math.max(1, Math.round(wallet.hoursLeft))} giờ nữa — chiến dịch sẽ dừng giữa chừng nếu không nạp thêm.`,
      payload: {
        kind: "navigate",
        href: `${platform.path}?channelId=${shop.channelId}`,
        label: "Kiểm tra ví Ads",
        source: platform.label,
      },
    });
  }

  return alerts;
}

/**
 * Thẻ VÍ ADS LAZADA HẾT TIỀN — THUẦN, vitest đánh thẳng. Lazada không có API
 * số dư ví như Shopee; nguồn tin là CỜ `adAccountBalanceStatus` = 0 trên dòng
 * searchCampaignList (sàn tự báo "tài khoản ads hết số dư"). Không ước được
 * "còn N giờ" — thẻ nói thẳng trạng thái sàn báo, severity high vì lúc cờ bật
 * là quảng cáo ĐÃ ngừng hiển thị.
 */
export function buildLazadaAdsWalletEmptyAlert(shop: {
  channelId: string;
  shopName: string;
}): DetectedAlert {
  return {
    dedupeKey: shop.channelId,
    tag: "ads",
    type: "ads-low-balance",
    severity: "high",
    title: `Ví Lazada Ads gian "${shop.shopName}" hết số dư — quảng cáo đang ngừng hiển thị`,
    summary:
      "Lazada báo tài khoản quảng cáo hết số dư (adAccountBalanceStatus) — các chiến dịch đang bật không thể phân phối cho tới khi nạp thêm tiền vào ví Ads trên Seller Center.",
    payload: {
      kind: "navigate",
      href: `/ads/lazada?channelId=${shop.channelId}`,
      label: "Kiểm tra ví Ads",
      source: "Lazada",
    },
  };
}

/**
 * DETECTOR: quét verdict Trợ lý quảng cáo của từng gian Shopee/Lazada ACTIVE
 * đã có dữ liệu campaign (sync mỗi giờ bởi order-auto-sync). Mỗi gian tối đa
 * MỘT call sống ra sàn (Shopee: số dư ví; Lazada: cờ ví trên trang đầu
 * searchCampaignList) — lỗi quyền/token → bỏ qua êm, 3 kịch bản campaign vẫn chạy.
 */
async function detectShopeeAdsAssistant(ownerId: string): Promise<DetectedAlert[]> {
  const channels = await prisma.channel.findMany({
    where: {
      userId: ownerId,
      channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
      status: "ACTIVE",
    },
    select: { id: true, shopName: true, channelName: true },
  });

  const alerts: DetectedAlert[] = [];
  for (const ch of channels) {
    const isLazada = ch.channelName === ChannelName.LAZADA;
    const platform = isLazada ? ADS_ALERT_LAZADA : ADS_ALERT_SHOPEE;
    const campaignCount = await prisma.adsCampaign.count({
      where: { channelId: ch.id },
    });
    if (campaignCount === 0) continue; // chưa sync campaign — detectAdsSpike lo

    const insights = await computeChannelAdsInsights({
      id: ch.id,
      userId: ownerId,
      channelName: ch.channelName,
    });
    if (!insights.config.enabled) continue; // chủ shop tắt Trợ lý của gian này

    const signals: ShopeeAdsCampaignSignal[] = insights.items
      .filter((it) => it.row.status === "ongoing")
      .map((it) => ({
        campaignId: it.row.campaignId,
        name: it.row.name,
        verdict: it.assessment.verdict,
        triggers: it.assessment.triggers ?? [],
        decisionActive: assistantDecisionActive(it),
        spendToday: it.windows.today.spend,
        spend7d: it.windows["7d"].spend,
      }));
    const groups = groupShopeeAdsScenarios(signals);

    // ---- Ví ads — call sống duy nhất/gian (throttle vòng quét gánh tần suất) ----
    let wallet: { balance: number; hoursLeft: number | null } | null = null;
    let lazadaWalletEmpty = false;
    try {
      const channel = await prisma.channel.findUnique({ where: { id: ch.id } });
      if (channel && isLazada) {
        // Lazada không có API số dư — đọc CỜ adAccountBalanceStatus (0 = hết
        // số dư) trên trang đầu searchCampaignList. Chỉ soi khi còn campaign
        // đang bật: ví cạn mà chẳng có gì chạy thì không cần réo còi.
        if (signals.length > 0) {
          const accessToken = await getValidLazadaAccessToken(channel);
          const page = await getAdsCampaignList({
            accessToken,
            startDate: vnDateKey(30),
            endDate: vnDateKey(0),
            pageNo: 1,
            pageSize: 100,
          });
          lazadaWalletEmpty = page.campaigns.some(
            (c) =>
              lazAdsNum(c.campaignSwitchStatus) === 1 &&
              c.adAccountBalanceStatus != null &&
              lazAdsNum(c.adAccountBalanceStatus) === 0
          );
        }
      } else if (channel) {
        const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
        const bal = await getAdsTotalBalance({ accessToken, shopId });
        const balance = Number(bal.response?.total_balance);
        if (Number.isFinite(balance)) {
          wallet = {
            balance,
            hoursLeft: estimateAdsWalletHoursLeft({
              balance,
              spendToday: signals.reduce((s, c) => s + c.spendToday, 0),
              hoursElapsedToday: hoursElapsedTodayVN(),
              avgDailySpend7d: insights.items.reduce(
                (s, it) => s + it.avgDailySpend7d,
                0
              ),
            }),
          };
        }
      }
    } catch {
      // App chưa có quyền ví / token lỗi — không chặn 3 kịch bản còn lại.
    }

    alerts.push(
      ...buildShopeeAdsAssistantAlerts(
        { channelId: ch.id, shopName: ch.shopName },
        groups,
        wallet,
        platform
      )
    );
    if (lazadaWalletEmpty) {
      alerts.push(
        buildLazadaAdsWalletEmptyAlert({ channelId: ch.id, shopName: ch.shopName })
      );
    }
  }
  return alerts;
}

/** Cửa sổ thẻ tổng hợp giao thất bại — đơn phát hiện cũ hơn đã tự an bài. */
const DELIVERY_FAIL_WINDOW_DAYS = 7;

/**
 * GIAO THẤT BẠI: gom các đơn chạm ngưỡng "2 lượt giao không thành công" trong
 * 7 ngày thành MỘT thẻ (giống thẻ đơn lỗ) — chuông từng đơn đã bắn ngay lúc
 * worker phát hiện, thẻ này là tầng nhìn tổng cho Trung tâm điều hành.
 * Nguồn: bảng DeliveryFailNotice do scanShopeeDeliveryFails ghi.
 */
async function detectDeliveryFailed(ownerId: string): Promise<DetectedAlert[]> {
  const cfg = effectiveDeliveryFailConfig(
    await prisma.deliveryFailConfig.findUnique({ where: { ownerId } })
  );
  if (!cfg.alertEnabled) return [];

  const notices = await prisma.deliveryFailNotice.findMany({
    where: { ownerId, detectedAt: { gte: daysAgo(DELIVERY_FAIL_WINDOW_DAYS) } },
    select: {
      chatStatus: true,
      order: { select: { orderCode: true, channel: { select: { channelName: true } } } },
    },
    orderBy: { detectedAt: "desc" },
  });
  if (notices.length === 0) return [];

  const head = notices
    .slice(0, 3)
    .map((n) => n.order.orderCode)
    .join(", ");
  const more = notices.length > 3 ? ` +${notices.length - 3} đơn khác` : "";
  const sent = notices.filter((n) => n.chatStatus === "SENT").length;
  // Badge sàn trên thẻ: một sàn thì nêu đích danh, lẫn lộn thì liệt kê.
  const channels = [
    ...new Set(notices.map((n) => CHANNEL_LABEL[n.order.channel.channelName] ?? n.order.channel.channelName)),
  ];
  return [
    {
      type: "delivery-fail",
      dedupeKey: "rolling-7d",
      tag: "channel",
      severity: notices.length >= 5 ? "high" : "medium",
      title: `${notices.length} đơn giao KHÔNG thành công — nguy cơ kiện quay đầu`,
      summary:
        `${DELIVERY_FAIL_WINDOW_DAYS} ngày qua: ${head}${more} bị báo giao thất bại (Shopee: shipper hỏng 2 lượt; Lazada: sàn kết luận giao không thành công).` +
        (sent > 0 ? ` Đã tự nhắn khách ${sent} đơn qua chat sàn.` : "") +
        " Chủ động gọi khách để cứu đơn — kiện quay đầu là mất phí ship 2 chiều.",
      payload: {
        kind: "navigate",
        href: DELIVERY_FAIL_TAB_HREF,
        label: "Xem nhật ký giao thất bại",
        source: channels.join(" + "),
      },
    },
  ];
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
  // Đẩy lên CHUÔNG THÔNG BÁO (Tầng 3): cảnh báo điều hành mới/tái phát là đúng
  // loại sự kiện chủ shop cần biết ngay cả khi không mở Dashboard. notify tự
  // chống trùng + nuốt lỗi nên không đe dọa vòng quét.
  await notify(ownerId, {
    type: "ops-alert",
    title: a.title,
    body: a.summary,
    link: a.payload.href,
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
      detectFeeAudit,
      detectKocSampleOverdue,
      detectSyncStalled,
      detectAdsSpike,
      detectShopeeAdsAssistant,
      detectDeliveryFailed,
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
