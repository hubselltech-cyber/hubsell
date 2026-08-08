import { Router } from "express";
import { ChannelName, Prisma, ReturnStatus } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { channelScope } from "../channel-filter";

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
  const { days, since } = sinceFromQuery(req);

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
    createdAt: { gte: since },
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

  res.json({ days, since, platforms, shops, total });
});

// ------------------------------------------------------------
// GET /api/koc/orders?days=30&channelName=&channelId=&page=1&pageSize=20
// Danh sách ĐƠN AFFILIATE THẬT (sàn đã trừ hoa hồng) — bằng chứng từng dòng
// cho các con số tổng hợp ở /summary.
// ------------------------------------------------------------
router.get("/orders", async (req: AuthRequest, res) => {
  const { days, since } = sinceFromQuery(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));

  const where: Prisma.OrderWhereInput = {
    channel: channelScope(req),
    affiliateFee: { gt: 0 },
    createdAt: { gte: since },
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

export default router;
