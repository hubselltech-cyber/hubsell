import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import {
  ChannelName,
  KocExpenseKind,
  KocExpenseState,
  KocPartnerStatus,
  KocSampleStatus,
  Prisma,
  ReturnStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { channelScope, readChannelName } from "../lib/channel-filter";
import { parseDateRange } from "../lib/date-range";
import { computePnlRow } from "./finance";
import { parseLazadaAmount } from "../integrations/lazada/service";

const router = Router();

// ============================================================
// MẠNG LƯỚI KOC & AFFILIATE — DỮ LIỆU THẬT TỪ SÀN (READ-ONLY)
//
// Nguồn sự thật: Order.affiliateFee — cột này được các luồng đối soát THẬT
// đang chạy ghi vào bằng token shop đã liên kết sẵn (KHÔNG cần uỷ quyền thêm):
//   · Shopee : escrow get_escrow_detail → order_ams_commission_fee (hoa hồng
//              Affiliate AMS) — xem integrations/shopee/settlements.ts
//   · Lazada : Finance API fee_name "tiếp thị liên kết"/"affiliate" — xem
//              integrations/lazada/service.ts (mapFeeName → feeAffiliate)
//   · TikTok : chờ shop thật uỷ quyền (hiện DB chỉ có gian giả lập); khi
//              settlements TikTok bật, phí affiliate đổ vào cùng cột này.
//
// Đơn có affiliateFee > 0 nghĩa là sàn XÁC NHẬN đơn đó đến từ kênh affiliate
// và đã trừ hoa hồng thật — đó là mẫu số Net-ROI đáng tin duy nhất hiện có.
// GIỚI HẠN THÀNH THẬT: API seller của Shopee/Lazada KHÔNG trả danh tính
// creator từng đơn, nên số liệu thật dừng ở cấp GIAN HÀNG; bảng hồ sơ theo
// từng KOC vẫn là preview cho tới khi có nguồn attribution (TikTok Affiliate
// API khi có shop thật + app được duyệt scope).
// ============================================================

/** Đọc ?days= (mặc định 30, kẹp 1..365) → mốc thời gian bắt đầu. */
function sinceFromQuery(req: AuthRequest): { days: number; since: Date } {
  const raw = Number(req.query.days);
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 30;
  return { days, since: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
}

/**
 * Bộ lọc thời gian hợp nhất: ưu tiên cặp `?from=&to=` chuẩn của mọi trang báo
 * cáo (DateRangePicker — yêu cầu chủ shop 30/08: bộ lọc KOC phải giống bên
 * Tài chính/Tổng quan); không có thì rơi về `?days=` để tương thích ngược.
 */
function resolveRange(req: AuthRequest): {
  filter: Prisma.DateTimeFilter;
  days: number;
} {
  const range = parseDateRange(req.query);
  if (range) {
    // lte = 23:59:59.999 ngày cuối → +1ms rồi chia là ra đúng số ngày lịch.
    const days = Math.max(
      1,
      Math.ceil((range.lte.getTime() + 1 - range.gte.getTime()) / 86_400_000)
    );
    return { filter: range, days };
  }
  const { days, since } = sinceFromQuery(req);
  return { filter: { gte: since }, days };
}

/** Trạng thái hoàn được coi là "đơn hoàn" khi tính tỷ lệ hoàn affiliate. */
const RETURN_STATUSES: ReturnStatus[] = Object.values(ReturnStatus).filter(
  (s) => s !== ReturnStatus.NONE
);

// ------------------------------------------------------------
// GET /api/koc/summary?days=30
// Tổng hợp affiliate THẬT theo sàn + theo gian hàng, kèm trạng thái liên kết
// (token còn sống không, đồng bộ lần cuối khi nào) để UI nói thẳng nguồn nào
// đang có dữ liệu, nguồn nào đang chờ.
// ------------------------------------------------------------
router.get("/summary", async (req: AuthRequest, res) => {
  const { days, filter: createdFilter } = resolveRange(req);

  // Mọi gian trong tầm nhìn (kể cả gian chưa có đơn affiliate) — để báo cáo
  // được cả trạng thái kết nối, không chỉ những gian có số.
  const channels = await prisma.channel.findMany({
    // Gian OFFLINE không có affiliate — chỉ báo cáo 3 sàn.
    where: {
      ...channelScope(req),
      channelName: { in: [ChannelName.TIKTOK, ChannelName.SHOPEE, ChannelName.LAZADA] },
    },
    select: {
      id: true,
      channelName: true,
      shopName: true,
      externalShopId: true,
      status: true,
      lastSyncAt: true,
      // Chỉ lấy CỜ có token + hạn — tuyệt đối không trả giá trị token ra API.
      apiToken: true,
      accessTokenExpireAt: true,
    },
  });

  const affiliateWhere: Prisma.OrderWhereInput = {
    channel: channelScope(req),
    affiliateFee: { gt: 0 },
    createdAt: createdFilter,
  };

  // Gộp theo GIAN HÀNG: GMV, số đơn, hoa hồng, tiền đã hoàn.
  const grouped = await prisma.order.groupBy({
    by: ["channelId"],
    where: affiliateWhere,
    _count: { _all: true },
    _sum: { totalAmount: true, affiliateFee: true, refundedAmount: true, actualPayout: true },
  });

  // Số ĐƠN HOÀN trong tập affiliate (đếm riêng vì groupBy không lồng filter).
  const refundGrouped = await prisma.order.groupBy({
    by: ["channelId"],
    where: { ...affiliateWhere, returnStatus: { in: RETURN_STATUSES } },
    _count: { _all: true },
  });
  const refundCountByChannel = new Map(
    refundGrouped.map((g) => [g.channelId, g._count._all])
  );

  const statsByChannel = new Map(grouped.map((g) => [g.channelId, g]));

  const shops = channels.map((c) => {
    const g = statsByChannel.get(c.id);
    const gmv = Number(g?._sum.totalAmount ?? 0);
    const refunded = Number(g?._sum.refundedAmount ?? 0);
    return {
      channelId: c.id,
      channelName: c.channelName,
      shopName: c.shopName,
      externalShopId: c.externalShopId,
      // Trạng thái quyền access của liên kết — cờ, không lộ token.
      connected: c.status === "ACTIVE" && Boolean(c.apiToken),
      accessTokenExpireAt: c.accessTokenExpireAt,
      lastSyncAt: c.lastSyncAt,
      affiliate: {
        orders: g?._count._all ?? 0,
        gmv,
        commission: Number(g?._sum.affiliateFee ?? 0),
        refundedAmount: refunded,
        refundedOrders: refundCountByChannel.get(c.id) ?? 0,
        netRevenue: gmv - refunded,
        actualPayout: Number(g?._sum.actualPayout ?? 0),
      },
    };
  });

  // Gộp tiếp theo SÀN — khung 3 sàn cố định để UI luôn vẽ đủ TikTok/Shopee/
  // Lazada kể cả sàn chưa liên kết (trạng thái "chờ kết nối" cũng là thông tin).
  const platforms = (["TIKTOK", "SHOPEE", "LAZADA"] as ChannelName[]).map((name) => {
    const mine = shops.filter((s) => s.channelName === name);
    const sum = (f: (s: (typeof shops)[number]) => number) =>
      mine.reduce((acc, s) => acc + f(s), 0);
    return {
      channelName: name,
      shopCount: mine.length,
      connectedCount: mine.filter((s) => s.connected).length,
      affiliate: {
        orders: sum((s) => s.affiliate.orders),
        gmv: sum((s) => s.affiliate.gmv),
        commission: sum((s) => s.affiliate.commission),
        refundedAmount: sum((s) => s.affiliate.refundedAmount),
        refundedOrders: sum((s) => s.affiliate.refundedOrders),
        netRevenue: sum((s) => s.affiliate.netRevenue),
      },
    };
  });

  const total = {
    orders: platforms.reduce((a, p) => a + p.affiliate.orders, 0),
    gmv: platforms.reduce((a, p) => a + p.affiliate.gmv, 0),
    commission: platforms.reduce((a, p) => a + p.affiliate.commission, 0),
    refundedAmount: platforms.reduce((a, p) => a + p.affiliate.refundedAmount, 0),
    netRevenue: platforms.reduce((a, p) => a + p.affiliate.netRevenue, 0),
  };

  res.json({ days, since: createdFilter.gte ?? null, platforms, shops, total });
});

// ------------------------------------------------------------
// GET /api/koc/orders?days=30&channelName=&channelId=&page=1&pageSize=20
// Danh sách ĐƠN AFFILIATE THẬT (sàn đã trừ hoa hồng) — bằng chứng từng dòng
// cho các con số tổng hợp ở /summary.
// ------------------------------------------------------------
router.get("/orders", async (req: AuthRequest, res) => {
  const { days, filter: createdFilter } = resolveRange(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));

  const where: Prisma.OrderWhereInput = {
    channel: channelScope(req),
    affiliateFee: { gt: 0 },
    createdAt: createdFilter,
  };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        orderCode: true,
        createdAt: true,
        totalAmount: true,
        affiliateFee: true,
        returnStatus: true,
        refundedAmount: true,
        isSettled: true,
        actualPayout: true,
        channel: { select: { channelName: true, shopName: true } },
      },
    }),
  ]);

  res.json({
    days,
    page,
    pageSize,
    total,
    orders: orders.map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      createdAt: o.createdAt,
      channelName: o.channel.channelName,
      shopName: o.channel.shopName,
      gmv: Number(o.totalAmount),
      commission: Number(o.affiliateFee),
      returnStatus: o.returnStatus,
      refundedAmount: Number(o.refundedAmount),
      isSettled: o.isSettled,
      actualPayout: Number(o.actualPayout),
    })),
  });
});

// ------------------------------------------------------------
// GET /api/koc/channel-detail?channelName=SHOPEE|LAZADA|TIKTOK&days=30
// Bức tranh affiliate THẬT của MỘT sàn — nguồn số cho 3 trang kênh của
// module KOC. TikTok dùng CHUNG endpoint này (cổng chờ): khi có shop thật
// uỷ quyền + settlements ghi affiliateFee, số tự chảy vào không cần sửa API.
//
// Trả về:
//   shops   — từng gian của sàn: trạng thái liên kết + số affiliate riêng
//   totals  — gộp sàn, kèm tỷ trọng affiliate/tổng GMV sàn cùng kỳ
//   series  — chuỗi NGÀY (đủ mọi ngày trong kỳ, ngày trống = 0) để vẽ chart
//   topSkus — SKU được affiliate bán chạy; hoa hồng cấp ĐƠN được PHÂN BỔ về
//             dòng theo tỷ trọng giá trị dòng (ước lượng — sàn không trả
//             hoa hồng theo dòng, ghi chú rõ trên UI)
// ------------------------------------------------------------
router.get("/channel-detail", async (req: AuthRequest, res) => {
  const { days, since } = sinceFromQuery(req);
  const rawName = String(req.query.channelName ?? "").trim().toUpperCase();
  if (!["SHOPEE", "LAZADA", "TIKTOK"].includes(rawName)) {
    res.status(400).json({ error: "channelName phải là SHOPEE, LAZADA hoặc TIKTOK" });
    return;
  }
  const channelName = rawName as ChannelName;
  const scope = { ...channelScope(req), channelName };

  const [channels, shopAgg, affGrouped, affOrders] = await Promise.all([
    prisma.channel.findMany({
      where: scope,
      select: {
        id: true,
        shopName: true,
        externalShopId: true,
        status: true,
        lastSyncAt: true,
        apiToken: true,
        accessTokenExpireAt: true,
      },
    }),
    // Tổng GMV + số đơn TOÀN SÀN cùng kỳ — mẫu số của tỷ trọng affiliate.
    prisma.order.aggregate({
      where: { channel: scope, createdAt: { gte: since } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.order.groupBy({
      by: ["channelId"],
      where: { channel: scope, affiliateFee: { gt: 0 }, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { totalAmount: true, affiliateFee: true, refundedAmount: true },
    }),
    // Đơn affiliate kèm dòng hàng — nguồn cho series ngày + top SKU.
    // take 5000 là trần an toàn; vượt trần thì series/topSku thiếu phần đuôi
    // nhưng các con số tổng bên trên vẫn đúng (tính bằng aggregate riêng).
    prisma.order.findMany({
      where: { channel: scope, affiliateFee: { gt: 0 }, createdAt: { gte: since } },
      select: {
        createdAt: true,
        totalAmount: true,
        affiliateFee: true,
        returnStatus: true,
        items: {
          select: { channelSku: true, productName: true, quantity: true, price: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 5000,
    }),
  ]);

  const affByChannel = new Map(affGrouped.map((g) => [g.channelId, g]));
  const shops = channels.map((c) => {
    const g = affByChannel.get(c.id);
    return {
      channelId: c.id,
      shopName: c.shopName,
      externalShopId: c.externalShopId,
      connected: c.status === "ACTIVE" && Boolean(c.apiToken),
      /// Đã uỷ quyền OAuth THẬT với sàn hay chưa — gian giả lập không có
      /// externalShopId (đây là cách trang TikTok nhận biết "cổng chờ").
      authorizedReal: Boolean(c.externalShopId),
      accessTokenExpireAt: c.accessTokenExpireAt,
      lastSyncAt: c.lastSyncAt,
      affiliate: {
        orders: g?._count._all ?? 0,
        gmv: Number(g?._sum.totalAmount ?? 0),
        commission: Number(g?._sum.affiliateFee ?? 0),
        refundedAmount: Number(g?._sum.refundedAmount ?? 0),
      },
    };
  });

  // ----- Chuỗi ngày: khởi tạo đủ mọi ngày trong kỳ rồi cộng dồn đơn vào -----
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const series: { date: string; gmv: number; commission: number; orders: number }[] = [];
  const seriesIndex = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    seriesIndex.set(dayKey(d), series.length);
    series.push({
      date: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`,
      gmv: 0,
      commission: 0,
      orders: 0,
    });
  }

  // ----- Top SKU: gom dòng hàng, phân bổ hoa hồng đơn theo tỷ trọng dòng -----
  const skuMap = new Map<
    string,
    { channelSku: string; productName: string; quantity: number; gmv: number; commission: number }
  >();
  let refundedOrders = 0;

  for (const o of affOrders) {
    const idx = seriesIndex.get(dayKey(o.createdAt));
    if (idx !== undefined) {
      series[idx].gmv += Number(o.totalAmount);
      series[idx].commission += Number(o.affiliateFee);
      series[idx].orders += 1;
    }
    if (RETURN_STATUSES.includes(o.returnStatus)) refundedOrders += 1;

    const lineTotal = o.items.reduce(
      (s, it) => s + Number(it.price) * it.quantity,
      0
    );
    for (const it of o.items) {
      const lineGmv = Number(it.price) * it.quantity;
      const entry = skuMap.get(it.channelSku) ?? {
        channelSku: it.channelSku,
        productName: it.productName,
        quantity: 0,
        gmv: 0,
        commission: 0,
      };
      entry.quantity += it.quantity;
      entry.gmv += lineGmv;
      if (lineTotal > 0) {
        entry.commission += Number(o.affiliateFee) * (lineGmv / lineTotal);
      }
      skuMap.set(it.channelSku, entry);
    }
  }

  const topSkus = [...skuMap.values()]
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 10)
    .map((s) => ({ ...s, commission: Math.round(s.commission) }));

  const gmv = shops.reduce((s, x) => s + x.affiliate.gmv, 0);
  const commission = shops.reduce((s, x) => s + x.affiliate.commission, 0);
  const refundedAmount = shops.reduce((s, x) => s + x.affiliate.refundedAmount, 0);
  const shopGmv = Number(shopAgg._sum.totalAmount ?? 0);

  res.json({
    days,
    channelName,
    shops,
    totals: {
      orders: shops.reduce((s, x) => s + x.affiliate.orders, 0),
      gmv,
      commission,
      refundedAmount,
      refundedOrders,
      netRevenue: gmv - refundedAmount,
      shopGmv,
      shopOrders: shopAgg._count._all,
      /// % GMV toàn sàn đến từ affiliate — thước đo mức phụ thuộc vào KOC.
      sharePct: shopGmv > 0 ? (gmv / shopGmv) * 100 : 0,
    },
    series,
    topSkus,
  });
});

// ============================================================
// SỔ KOC (nhịp 1, 30/08/2026) — HỒ SƠ KOC + HÀNG MẪU + BOOKING + ATTRIBUTION
//
// Thay tầng mock của /koc-marketing bằng CRUD thật trên 4 bảng koc_*.
// Danh tính KOC theo đơn KHÔNG có trong API sàn — nguồn duy nhất là file
// "Báo cáo chuyển đổi" TTLK người bán (xuất web Seller Center) qua
// POST /import-ams, hoặc gán tay. Lãi ròng từng KOC tính bằng computePnlRow
// (SSOT tài chính) trên tập đơn đã attribution — không bịa từ % lãi gộp.
// ============================================================

/** Ngưỡng badge — giữ đúng ngưỡng thiết kế cũ ở frontend koc-data.ts. */
const KOC_REFUND_WARN_PCT = 15;
const KOC_STAR_ROI = 3;
/** Hạn lên bài mặc định của phiếu mẫu — theo chuẩn Sample Integrity (14 ngày). */
const SAMPLE_DEADLINE_DAYS_DEFAULT = 14;

/** include đủ quan hệ để computePnlRow bóc số — CHÉP ĐÚNG shape PnlOrder
 *  của routes/finance.ts (structural typing: thừa field không sao, thiếu là vỡ). */
const PNL_INCLUDE = {
  channel: { select: { channelName: true, shopName: true } },
  items: { include: { product: { select: { skuCode: true, imageUrl: true } } } },
  inventoryLogs: {
    where: { changeQuantity: { lt: 0 } },
    include: { product: { select: { costPrice: true } } },
  },
  lazadaSettlement: true,
} satisfies Prisma.OrderInclude;

const PARTNER_STATUSES = Object.values(KocPartnerStatus);
const EXPENSE_KINDS = Object.values(KocExpenseKind);
const EXPENSE_STATES = Object.values(KocExpenseState);

/** Chuỗi từ body — trim, rơi về mặc định khi không phải string. */
const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v.trim() : fallback;

// ------------------------------------------------------------
// GET /api/koc/partners?days=90
// Danh sách KOC kèm TOÀN BỘ số dẫn xuất trong kỳ (SSOT tính ở đây — FE chỉ
// render): đơn/GMV/hoa hồng từ attribution, lãi ròng thật Σ profitAfterTax,
// chi mẫu + booking, Net-ROI, badge. Kèm số đơn affiliate CHƯA gán KOC để UI
// nhắc import file báo cáo chuyển đổi.
// ------------------------------------------------------------
router.get("/partners", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const { days, filter: createdFilter } = resolveRange(req);
    // Lọc theo sàn (?channelName=): đơn lọc qua channelScope; hồ sơ KOC lọc
    // theo platform để chi phí mẫu/booking của KOC sàn khác không lẫn vào.
    const channelName = readChannelName(req);

    const [partners, sampleGroups, expenseGroups, orders, unattributed, lastImport] =
      await Promise.all([
        prisma.kocPartner.findMany({
          where: { ownerId, ...(channelName ? { platform: channelName } : {}) },
          orderBy: { createdAt: "asc" },
        }),
        prisma.kocSampleShipment.groupBy({
          by: ["kocId", "status"],
          where: { ownerId, exportedAt: createdFilter },
          _count: { _all: true },
          _sum: { cost: true },
        }),
        // Chi booking tính CẢ PENDING: hợp đồng đã ký là chi phí đã cam kết —
        // Net-ROI phải nhìn thấy trước khi tiền rời két.
        prisma.kocExpense.groupBy({
          by: ["kocId"],
          where: { ownerId, createdAt: createdFilter, kocId: { not: null } },
          _sum: { amount: true },
        }),
        // Đơn ĐÃ gán KOC trong kỳ — include đủ shape cho computePnlRow.
        prisma.order.findMany({
          where: {
            channel: channelScope(req),
            kocAttribution: { ownerId },
            createdAt: createdFilter,
          },
          include: { ...PNL_INCLUDE, kocAttribution: { select: { kocId: true } } },
          take: 5000, // trần an toàn — cùng lý do channel-detail
        }),
        prisma.order.count({
          where: {
            channel: channelScope(req),
            affiliateFee: { gt: 0 },
            kocAttribution: null,
            createdAt: createdFilter,
          },
        }),
        // Lần import file báo cáo gần nhất — UI nhắc "X ngày chưa import".
        prisma.kocOrderAttribution.findFirst({
          where: { ownerId },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);

    // Gom số mẫu / chi phí / đơn theo kocId.
    const now = Date.now();
    const sampleByKoc = new Map<
      string,
      { cost: number; count: number; waiting: number; burned: number }
    >();
    for (const g of sampleGroups) {
      const e = sampleByKoc.get(g.kocId) ?? { cost: 0, count: 0, waiting: 0, burned: 0 };
      e.cost += Number(g._sum.cost ?? 0);
      e.count += g._count._all;
      if (g.status === KocSampleStatus.WAITING) e.waiting += g._count._all;
      if (g.status === KocSampleStatus.BURNED) e.burned += g._count._all;
      sampleByKoc.set(g.kocId, e);
    }
    // Mẫu QUÁ HẠN suy diễn (WAITING + quá deadline) — đếm riêng vì groupBy
    // không lồng được điều kiện thời gian theo dòng.
    const overdueGroups = await prisma.kocSampleShipment.groupBy({
      by: ["kocId"],
      where: {
        ownerId,
        status: KocSampleStatus.WAITING,
        postDeadlineAt: { lt: new Date(now) },
      },
      _count: { _all: true },
    });
    const overdueByKoc = new Map(overdueGroups.map((g) => [g.kocId, g._count._all]));

    const bookingByKoc = new Map(
      expenseGroups.map((g) => [g.kocId as string, Number(g._sum.amount ?? 0)])
    );

    const orderStats = new Map<
      string,
      { orders: number; gmv: number; commission: number; refundedOrders: number; refundedAmount: number; netProfit: number }
    >();
    for (const o of orders) {
      const kocId = o.kocAttribution?.kocId;
      if (!kocId) continue;
      const row = computePnlRow(o);
      const e =
        orderStats.get(kocId) ??
        { orders: 0, gmv: 0, commission: 0, refundedOrders: 0, refundedAmount: 0, netProfit: 0 };
      e.orders += 1;
      e.gmv += Number(o.totalAmount);
      e.commission += Number(o.affiliateFee);
      if (o.returnStatus !== ReturnStatus.NONE) e.refundedOrders += 1;
      e.refundedAmount += row.refundedAmount;
      // Lãi ròng THẬT của đơn (payout − giá vốn) — hoa hồng/phí sàn đã net
      // trong payout, KHÔNG trừ hoa hồng lần hai.
      e.netProfit += row.profitAfterTax;
      orderStats.set(kocId, e);
    }

    const items = partners.map((p) => {
      const os = orderStats.get(p.id) ?? {
        orders: 0, gmv: 0, commission: 0, refundedOrders: 0, refundedAmount: 0, netProfit: 0,
      };
      const smp = sampleByKoc.get(p.id) ?? { cost: 0, count: 0, waiting: 0, burned: 0 };
      const bookingFee = bookingByKoc.get(p.id) ?? 0;
      const netRevenue = os.gmv - os.refundedAmount;
      const totalCost = os.commission + bookingFee + smp.cost;
      // Lợi nhuận ròng của mối hợp tác = Σ lãi thật các đơn − booking − mẫu.
      const netProfit = Math.round(os.netProfit - bookingFee - smp.cost);
      const refundRate = os.orders > 0 ? (os.refundedOrders / os.orders) * 100 : 0;
      const roi = totalCost > 0 ? netRevenue / totalCost : 0;
      // Badge cùng luật thiết kế cũ: cảnh báo đè khen; khen cần cả lãi + ROI.
      const ratings: string[] = [];
      if (os.orders > 0 || totalCost > 0) {
        if (netProfit < 0) ratings.push("LOSS");
        if (refundRate > KOC_REFUND_WARN_PCT) ratings.push("HIGH_REFUND");
        if (ratings.length === 0 && netProfit > 0 && roi >= KOC_STAR_ROI) ratings.push("STAR");
      }
      return {
        id: p.id,
        name: p.name,
        handle: p.handle,
        platform: p.platform,
        followers: p.followers,
        contact: p.contact,
        note: p.note,
        status: p.status,
        createdAt: p.createdAt,
        stats: {
          orders: os.orders,
          gmv: Math.round(os.gmv),
          commission: Math.round(os.commission),
          refundedOrders: os.refundedOrders,
          refundedAmount: Math.round(os.refundedAmount),
          refundRate: Math.round(refundRate * 10) / 10,
          netRevenue: Math.round(netRevenue),
          sampleCost: Math.round(smp.cost),
          sampleCount: smp.count,
          samplesWaiting: smp.waiting,
          samplesOverdue: overdueByKoc.get(p.id) ?? 0,
          samplesBurned: smp.burned,
          bookingFee: Math.round(bookingFee),
          totalCost: Math.round(totalCost),
          netProfit,
          roi: Math.round(roi * 100) / 100,
          ratings,
        },
      };
    });

    res.json({
      days,
      partners: items,
      attributedOrders: orders.length,
      // Đơn affiliate sàn xác nhận nhưng CHƯA biết của KOC nào — mồi nhắc
      // seller import file báo cáo chuyển đổi.
      unattributedOrders: unattributed,
      lastImportAt: lastImport?.createdAt ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------
// GET /api/koc/top-products?from&to&channelName&channelId
// SẢN PHẨM HIỆU QUẢ QUA KÊNH AFFILIATE (yêu cầu chủ shop 30/08): gom dòng
// hàng của mọi đơn affiliate trong kỳ, đa sàn. Hoa hồng + tiền hoàn cấp ĐƠN
// được PHÂN BỔ về dòng theo tỷ trọng giá trị (ước lượng — sàn không trả phí
// theo dòng; cùng công thức topSkus của /channel-detail, ghi chú rõ trên UI).
// ------------------------------------------------------------
router.get("/top-products", async (req: AuthRequest, res, next) => {
  try {
    const { days, filter: createdFilter } = resolveRange(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
    const orders = await prisma.order.findMany({
      where: {
        channel: channelScope(req),
        affiliateFee: { gt: 0 },
        createdAt: createdFilter,
      },
      select: {
        totalAmount: true,
        affiliateFee: true,
        refundedAmount: true,
        returnStatus: true,
        channel: { select: { channelName: true } },
        items: {
          select: { channelSku: true, productName: true, quantity: true, price: true },
        },
      },
      take: 5000, // trần an toàn — tổng hợp trên mẫu lớn nhất 5000 đơn gần nhất
    });

    const bySku = new Map<
      string,
      {
        channelSku: string;
        productName: string;
        channelName: ChannelName;
        quantity: number;
        orders: number;
        refundedOrders: number;
        gmv: number;
        commission: number;
        refundedAmount: number;
      }
    >();
    for (const o of orders) {
      const lineTotal = o.items.reduce((s, it) => s + Number(it.price) * it.quantity, 0);
      const isRefund = RETURN_STATUSES.includes(o.returnStatus);
      for (const it of o.items) {
        const lineGmv = Number(it.price) * it.quantity;
        const share = lineTotal > 0 ? lineGmv / lineTotal : 0;
        const e = bySku.get(it.channelSku) ?? {
          channelSku: it.channelSku,
          productName: it.productName,
          channelName: o.channel.channelName,
          quantity: 0,
          orders: 0,
          refundedOrders: 0,
          gmv: 0,
          commission: 0,
          refundedAmount: 0,
        };
        e.quantity += it.quantity;
        e.orders += 1;
        if (isRefund) e.refundedOrders += 1;
        e.gmv += lineGmv;
        e.commission += Number(o.affiliateFee) * share;
        e.refundedAmount += Number(o.refundedAmount) * share;
        bySku.set(it.channelSku, e);
      }
    }

    const sorted = [...bySku.values()].sort((a, b) => b.gmv - a.gmv);
    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

    // Ảnh SKU: CHỈ tra cho trang đang xem (≤50 dòng) — DB chỉ lưu URL ảnh
    // (chuỗi ~100 ký tự), ảnh thật trình duyệt tải thẳng từ CDN sàn nên báo
    // cáo có ảnh KHÔNG làm nặng database. Ưu tiên ảnh sàn (ChannelProduct),
    // rơi về ảnh kho vật lý khi SKU đã liên kết.
    const imageBySku = new Map<string, string>();
    if (pageRows.length > 0) {
      const cps = await prisma.channelProduct.findMany({
        where: {
          channel: channelScope(req),
          channelSku: { in: pageRows.map((p) => p.channelSku) },
        },
        select: {
          channelSku: true,
          imageUrl: true,
          product: { select: { imageUrl: true } },
        },
      });
      for (const cp of cps) {
        const url = cp.imageUrl || cp.product?.imageUrl;
        if (url && !imageBySku.has(cp.channelSku)) imageBySku.set(cp.channelSku, url);
      }
    }

    const products = pageRows
      .map((p) => ({
        imageUrl: imageBySku.get(p.channelSku) ?? null,
        ...p,
        gmv: Math.round(p.gmv),
        commission: Math.round(p.commission),
        refundedAmount: Math.round(p.refundedAmount),
        netRevenue: Math.round(p.gmv - p.refundedAmount),
        refundRate: p.orders > 0 ? Math.round((p.refundedOrders / p.orders) * 1000) / 10 : 0,
        // "Mỗi sản phẩm mất bao nhiêu tiền hoa hồng" (yêu cầu chủ shop 30/08):
        // bình quân 1 đơn vị bán ra qua affiliate tốn bao nhiêu đ hoa hồng —
        // số để so với LÃI GỘP/SP khi quyết định đẩy mẫu/booking SKU nào.
        commissionPerUnit: p.quantity > 0 ? Math.round(p.commission / p.quantity) : 0,
        // % hoa hồng thực trên GMV của SKU (cùng phân bổ ước lượng).
        commissionRate: p.gmv > 0 ? Math.round((p.commission / p.gmv) * 1000) / 10 : 0,
      }));

    res.json({
      days,
      sampledOrders: orders.length,
      total: sorted.length,
      page,
      pageSize,
      products,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/koc/partners — thêm KOC vào mạng lưới
router.post("/partners", async (req: AuthRequest, res, next) => {
  try {
    const name = str(req.body?.name);
    if (!name) {
      res.status(400).json({ error: "Tên KOC không được để trống" });
      return;
    }
    const platformRaw = str(req.body?.platform).toUpperCase();
    const platform =
      platformRaw in ChannelName && platformRaw !== "OFFLINE"
        ? (platformRaw as ChannelName)
        : ChannelName.SHOPEE;
    const followers = Math.max(0, Math.round(Number(req.body?.followers) || 0));
    try {
      const created = await prisma.kocPartner.create({
        data: {
          ownerId: req.ownerId!,
          name,
          handle: str(req.body?.handle),
          platform,
          followers,
          contact: str(req.body?.contact),
          note: str(req.body?.note),
        },
      });
      res.status(201).json(created);
    } catch (err) {
      // Trùng unique (ownerId, name) — nói thẳng thay vì 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: `Đã có KOC tên "${name}" trong mạng lưới` });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// PATCH /api/koc/partners/:id — sửa hồ sơ / đổi trạng thái (kể cả BLACKLISTED)
router.patch("/partners/:id", async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.kocPartner.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId! },
    });
    if (!existing) {
      res.status(404).json({ error: "Không tìm thấy KOC" });
      return;
    }
    const b = req.body ?? {};
    const statusRaw = str(b.status).toUpperCase();
    const updated = await prisma.kocPartner.update({
      where: { id: existing.id },
      data: {
        ...(typeof b.name === "string" && b.name.trim() ? { name: b.name.trim() } : {}),
        ...(typeof b.handle === "string" ? { handle: b.handle.trim() } : {}),
        ...(typeof b.contact === "string" ? { contact: b.contact.trim() } : {}),
        ...(typeof b.note === "string" ? { note: b.note.trim() } : {}),
        ...(Number.isFinite(Number(b.followers))
          ? { followers: Math.max(0, Math.round(Number(b.followers))) }
          : {}),
        ...(PARTNER_STATUSES.includes(statusRaw as KocPartnerStatus)
          ? { status: statusRaw as KocPartnerStatus }
          : {}),
      },
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(409).json({ error: "Tên KOC này đã tồn tại trong mạng lưới" });
      return;
    }
    next(err);
  }
});

// ------------------------------------------------------------
// HÀNG MẪU — phiếu xuất có DEADLINE lên bài (chống bùng mẫu)
// ------------------------------------------------------------

// GET /api/koc/samples?status=&overdue=1
router.get("/samples", async (req: AuthRequest, res, next) => {
  try {
    const statusRaw = str(req.query.status as string).toUpperCase();
    const overdueOnly = req.query.overdue === "1";
    const where: Prisma.KocSampleShipmentWhereInput = {
      ownerId: req.ownerId!,
      ...(Object.values(KocSampleStatus).includes(statusRaw as KocSampleStatus)
        ? { status: statusRaw as KocSampleStatus }
        : {}),
      ...(overdueOnly
        ? { status: KocSampleStatus.WAITING, postDeadlineAt: { lt: new Date() } }
        : {}),
    };
    const samples = await prisma.kocSampleShipment.findMany({
      where,
      orderBy: [{ status: "asc" }, { postDeadlineAt: "asc" }],
      include: { koc: { select: { id: true, name: true, platform: true, status: true } } },
      take: 500,
    });
    const now = Date.now();
    res.json({
      samples: samples.map((s) => ({
        id: s.id,
        kocId: s.kocId,
        kocName: s.koc.name,
        kocStatus: s.koc.status,
        platform: s.koc.platform,
        sku: s.sku,
        productName: s.productName,
        qty: s.qty,
        unitCost: Number(s.unitCost),
        cost: Number(s.cost),
        exportedAt: s.exportedAt,
        postDeadlineAt: s.postDeadlineAt,
        status: s.status,
        postedAt: s.postedAt,
        contentUrl: s.contentUrl,
        deductedStock: s.deductedStock,
        note: s.note,
        overdue: s.status === KocSampleStatus.WAITING && s.postDeadlineAt.getTime() < now,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/koc/samples — tạo phiếu xuất mẫu (tùy chọn trừ kho vật lý)
router.post("/samples", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const b = req.body ?? {};
    const qty = Math.round(Number(b.qty));
    if (!Number.isFinite(qty) || qty < 1) {
      res.status(400).json({ error: "Số lượng mẫu phải từ 1 trở lên" });
      return;
    }
    const koc = await prisma.kocPartner.findFirst({
      where: { id: str(b.kocId), ownerId },
    });
    if (!koc) {
      res.status(404).json({ error: "Không tìm thấy KOC" });
      return;
    }
    if (koc.status === KocPartnerStatus.BLACKLISTED) {
      res.status(400).json({
        error: `"${koc.name}" đang trong danh sách đen (bùng mẫu) — bỏ chặn ở hồ sơ KOC trước khi gửi tiếp`,
      });
      return;
    }

    const deadlineDays = Math.min(
      90,
      Math.max(1, Math.round(Number(b.deadlineDays) || SAMPLE_DEADLINE_DAYS_DEFAULT))
    );
    const exportedAt = new Date();
    const postDeadlineAt = new Date(exportedAt.getTime() + deadlineDays * 86_400_000);

    // Mẫu từ KHO VẬT LÝ: chốt giá vốn tại thời điểm xuất + (tùy chọn) trừ tồn.
    const productId = str(b.productId) || null;
    if (productId) {
      const product = await prisma.product.findFirst({
        where: { id: productId, userId: ownerId },
      });
      if (!product) {
        res.status(404).json({ error: "Không tìm thấy sản phẩm trong kho" });
        return;
      }
      const unitCost = Number(product.costPrice);
      const deductStock = b.deductStock !== false; // mặc định TRỪ kho
      if (deductStock && product.quantityInStock < qty) {
        res.status(400).json({
          error: `Kho chỉ còn ${product.quantityInStock} — không đủ ${qty} mẫu`,
        });
        return;
      }
      const created = await prisma.$transaction(async (tx) => {
        const shipment = await tx.kocSampleShipment.create({
          data: {
            ownerId,
            kocId: koc.id,
            productId: product.id,
            sku: product.skuCode,
            productName: product.productName,
            qty,
            unitCost,
            cost: unitCost * qty,
            exportedAt,
            postDeadlineAt,
            deductedStock: deductStock,
            note: str(b.note),
          },
        });
        if (deductStock) {
          await tx.product.update({
            where: { id: product.id },
            data: { quantityInStock: { decrement: qty } },
          });
          await tx.inventoryLog.create({
            data: {
              productId: product.id,
              changeQuantity: -qty,
              type: "EXPORT",
              reason: `Xuất hàng mẫu KOC "${koc.name}" (Sổ KOC)`,
            },
          });
        }
        return shipment;
      });
      res.status(201).json(created);
      return;
    }

    // Mẫu NGOÀI kho (không link SKU): nhập tay tên + giá trị.
    const productName = str(b.productName);
    if (!productName) {
      res.status(400).json({ error: "Chọn SKU kho hoặc nhập tên sản phẩm mẫu" });
      return;
    }
    const unitCost = Math.max(0, Math.round(Number(b.unitCost) || 0));
    const created = await prisma.kocSampleShipment.create({
      data: {
        ownerId,
        kocId: koc.id,
        productName,
        sku: str(b.sku),
        qty,
        unitCost,
        cost: unitCost * qty,
        exportedAt,
        postDeadlineAt,
        note: str(b.note),
      },
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/koc/samples/:id — nghiệm thu: đã đăng (kèm link) / bùng (kèm tùy
// chọn cho KOC vào danh sách đen) / sửa hạn.
router.patch("/samples/:id", async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.kocSampleShipment.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId! },
    });
    if (!existing) {
      res.status(404).json({ error: "Không tìm thấy phiếu mẫu" });
      return;
    }
    const b = req.body ?? {};
    const statusRaw = str(b.status).toUpperCase();
    const nextStatus = Object.values(KocSampleStatus).includes(
      statusRaw as KocSampleStatus
    )
      ? (statusRaw as KocSampleStatus)
      : undefined;
    const deadline = b.postDeadlineAt ? new Date(String(b.postDeadlineAt)) : undefined;

    const updated = await prisma.kocSampleShipment.update({
      where: { id: existing.id },
      data: {
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(nextStatus === KocSampleStatus.POSTED
          ? { postedAt: existing.postedAt ?? new Date() }
          : {}),
        ...(typeof b.contentUrl === "string" ? { contentUrl: b.contentUrl.trim() } : {}),
        ...(typeof b.note === "string" ? { note: b.note.trim() } : {}),
        ...(deadline && !Number.isNaN(deadline.getTime())
          ? { postDeadlineAt: deadline }
          : {}),
      },
    });

    // Đánh dấu BÙNG kèm blacklist=true → khóa luôn KOC (chặn phiếu mẫu mới).
    if (nextStatus === KocSampleStatus.BURNED && b.blacklist === true) {
      await prisma.kocPartner.update({
        where: { id: existing.kocId },
        data: { status: KocPartnerStatus.BLACKLISTED },
      });
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------
// CHI PHÍ BOOKING & HỢP ĐỒNG MCN — bảng riêng, KHÔNG tự ghi sang Thu chi
// vận hành (tránh đếm đôi khi seller đã nhập bên đó; UI ghi chú rõ).
// ------------------------------------------------------------

router.get("/expenses", async (req: AuthRequest, res, next) => {
  try {
    const expenses = await prisma.kocExpense.findMany({
      where: { ownerId: req.ownerId! },
      orderBy: [{ state: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      include: { koc: { select: { name: true, platform: true } } },
      take: 500,
    });
    res.json({
      expenses: expenses.map((e) => ({
        id: e.id,
        kocId: e.kocId,
        kocName: e.koc?.name ?? e.displayName,
        platform: e.koc?.platform ?? null,
        contractCode: e.contractCode,
        kind: e.kind,
        amount: Number(e.amount),
        dueDate: e.dueDate,
        state: e.state,
        note: e.note,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/expenses", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const b = req.body ?? {};
    const amount = Math.round(Number(b.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "Số tiền phải lớn hơn 0" });
      return;
    }
    const kocId = str(b.kocId) || null;
    if (kocId) {
      const koc = await prisma.kocPartner.findFirst({ where: { id: kocId, ownerId } });
      if (!koc) {
        res.status(404).json({ error: "Không tìm thấy KOC" });
        return;
      }
    } else if (!str(b.displayName)) {
      res.status(400).json({ error: "Chọn KOC hoặc nhập tên đơn vị nhận (MCN...)" });
      return;
    }
    const kindRaw = str(b.kind).toUpperCase();
    const stateRaw = str(b.state).toUpperCase();
    const dueDate = b.dueDate ? new Date(String(b.dueDate)) : null;
    const created = await prisma.kocExpense.create({
      data: {
        ownerId,
        kocId,
        displayName: str(b.displayName),
        contractCode: str(b.contractCode),
        kind: EXPENSE_KINDS.includes(kindRaw as KocExpenseKind)
          ? (kindRaw as KocExpenseKind)
          : KocExpenseKind.BOOKING,
        amount,
        dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
        state: EXPENSE_STATES.includes(stateRaw as KocExpenseState)
          ? (stateRaw as KocExpenseState)
          : KocExpenseState.PAID,
        note: str(b.note),
      },
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch("/expenses/:id", async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.kocExpense.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId! },
    });
    if (!existing) {
      res.status(404).json({ error: "Không tìm thấy khoản chi" });
      return;
    }
    const b = req.body ?? {};
    const stateRaw = str(b.state).toUpperCase();
    const amount = Number(b.amount);
    const dueDate = b.dueDate ? new Date(String(b.dueDate)) : undefined;
    const updated = await prisma.kocExpense.update({
      where: { id: existing.id },
      data: {
        ...(Number.isFinite(amount) && amount > 0 ? { amount: Math.round(amount) } : {}),
        ...(EXPENSE_STATES.includes(stateRaw as KocExpenseState)
          ? { state: stateRaw as KocExpenseState }
          : {}),
        ...(typeof b.contractCode === "string" ? { contractCode: b.contractCode.trim() } : {}),
        ...(typeof b.note === "string" ? { note: b.note.trim() } : {}),
        ...(dueDate && !Number.isNaN(dueDate.getTime()) ? { dueDate } : {}),
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/expenses/:id", async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.kocExpense.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId! },
    });
    if (!existing) {
      res.status(404).json({ error: "Không tìm thấy khoản chi" });
      return;
    }
    await prisma.kocExpense.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------
// POST /api/koc/import-ams — IMPORT FILE "BÁO CÁO CHUYỂN ĐỔI" TTLK NGƯỜI BÁN
//
// File xuất từ web Seller Center (Hệ thống TTLK dành cho Người bán) có hoa
// hồng TỪNG ĐƠN kèm đối tác chia sẻ link. Đây là nguồn danh tính KOC-theo-đơn
// DUY NHẤT hiện có (API seller không trả). Cột được dò linh hoạt theo nhiều
// alias vì sàn có thể đổi tên cột — dò không ra thì báo thẳng tên cột đã thấy.
// Idempotent: chạy lại cùng file → upsert cùng kết quả.
// ------------------------------------------------------------

const uploadAms = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls|csv)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("Chỉ chấp nhận file Excel (.xlsx/.xls) hoặc .csv"));
  },
});

router.post("/import-ams", uploadAms.single("file"), async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    if (!req.file) {
      res.status(400).json({ error: "Chưa chọn file báo cáo để tải lên" });
      return;
    }
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      res.status(400).json({ error: "File không có sheet dữ liệu nào" });
      return;
    }
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (rows.length === 0) {
      res.status(400).json({ error: "File không có dòng dữ liệu nào" });
      return;
    }

    // Dò cột theo alias, không phân biệt hoa thường (cùng khuôn import giá vốn).
    const keys = Object.keys(rows[0]);
    const findKey = (...aliases: string[]): string | null => {
      for (const alias of aliases) {
        const hit = keys.find(
          (k) => k.trim().toLowerCase() === alias.trim().toLowerCase()
        );
        if (hit) return hit;
      }
      // Vòng 2: khớp "chứa" — file sàn hay kèm chú thích trong tên cột.
      for (const alias of aliases) {
        const hit = keys.find((k) =>
          k.trim().toLowerCase().includes(alias.trim().toLowerCase())
        );
        if (hit) return hit;
      }
      return null;
    };

    const orderKey = findKey(
      "Mã đơn hàng", "Order ID", "OrderID", "order_id", "Mã đơn", "order_sn", "Order SN", "ID đơn hàng"
    );
    const partnerKey = findKey(
      "Tên đăng nhập đối tác", "Tên đối tác", "Đối tác", "Tên đăng nhập",
      "Username", "Affiliate", "Creator", "KOC", "Người chia sẻ", "Sub_id", "Sub ID"
    );
    const commissionKey = findKey(
      "Tổng hoa hồng", "Hoa hồng ước tính", "Hoa hồng", "Commission", "Est. Commission", "Phí hoa hồng"
    );
    if (!orderKey || !partnerKey) {
      res.status(400).json({
        error:
          `Không nhận diện được cột ${!orderKey ? "MÃ ĐƠN HÀNG" : "ĐỐI TÁC/KOC"} trong file. ` +
          `Các cột thấy được: ${keys.slice(0, 15).join(", ")}`,
      });
      return;
    }

    // Bóc dòng hợp lệ.
    const parsed: { orderCode: string; partner: string; commission: number }[] = [];
    const errors: { row: number; message: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const excelRow = i + 2;
      const orderCode = String(rows[i][orderKey] ?? "").trim();
      const partner = String(rows[i][partnerKey] ?? "").trim();
      if (!orderCode && !partner) continue; // dòng trống
      if (!orderCode || !partner) {
        errors.push({ row: excelRow, message: "Thiếu mã đơn hoặc tên đối tác" });
        continue;
      }
      const commission = commissionKey
        ? Math.max(0, Math.round(parseLazadaAmount(rows[i][commissionKey])))
        : 0;
      parsed.push({ orderCode, partner, commission });
    }
    if (parsed.length === 0) {
      res.status(400).json({ error: "Không có dòng hợp lệ nào trong file", errors });
      return;
    }

    // Khớp đơn trong phạm vi shop (mã đơn sàn trùng nhau giữa 2 gian là cực
    // hiếm — lấy đơn đầu khớp).
    const dbOrders = await prisma.order.findMany({
      where: {
        channel: { userId: ownerId },
        orderCode: { in: [...new Set(parsed.map((p) => p.orderCode))] },
      },
      select: { id: true, orderCode: true, channel: { select: { channelName: true } } },
    });
    const orderByCode = new Map(dbOrders.map((o) => [o.orderCode, o]));

    // Auto-tạo hồ sơ KOC theo tên đối tác (idempotent nhờ unique ownerId+name).
    const partnerNames = [...new Set(parsed.map((p) => p.partner))];
    let partnersCreated = 0;
    const partnerIdByName = new Map<string, string>();
    for (const name of partnerNames) {
      const firstOrder = parsed.find((p) => p.partner === name && orderByCode.has(p.orderCode));
      const platform = firstOrder
        ? orderByCode.get(firstOrder.orderCode)!.channel.channelName
        : ChannelName.SHOPEE;
      const existing = await prisma.kocPartner.findUnique({
        where: { ownerId_name: { ownerId, name } },
      });
      if (existing) {
        partnerIdByName.set(name, existing.id);
      } else {
        const created = await prisma.kocPartner.create({
          data: { ownerId, name, platform, note: "Tự tạo từ file báo cáo chuyển đổi TTLK" },
        });
        partnersCreated++;
        partnerIdByName.set(name, created.id);
      }
    }

    // Upsert attribution từng đơn.
    let matched = 0;
    const unmatchedOrders: string[] = [];
    for (const p of parsed) {
      const order = orderByCode.get(p.orderCode);
      if (!order) {
        if (unmatchedOrders.length < 50) unmatchedOrders.push(p.orderCode);
        continue;
      }
      const kocId = partnerIdByName.get(p.partner)!;
      await prisma.kocOrderAttribution.upsert({
        where: { orderId: order.id },
        create: { ownerId, orderId: order.id, kocId, commission: p.commission },
        update: { kocId, commission: p.commission },
      });
      matched++;
    }

    res.json({
      totalRows: rows.length,
      validRows: parsed.length,
      matched,
      unmatchedCount: parsed.length - matched,
      unmatchedOrders,
      partnersCreated,
      errors,
      columns: { order: orderKey, partner: partnerKey, commission: commissionKey },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
