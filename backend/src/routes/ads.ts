import { Router } from "express";
import { ChannelName } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { computePnlRow, fetchPnlOrders } from "./finance";
import { getAdsTotalBalance } from "../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../integrations/shopee/service";

const router = Router();

// ============================================================
// TRỢ LÝ QUẢNG CÁO SHOPEE — GĐ1: DASHBOARD DỮ LIỆU THẬT (READ-ONLY)
//
// GET /api/ads/shopee?channelId=&days=7|30
//
// Điểm khác biệt so với Seller Center: mỗi campaign được gắn thêm ROAS HÒA VỐN
// tính từ P&L THẬT của chính các SKU trong campaign (giá vốn + phí sàn đã đối
// soát/ước tính của Shopee — computePnlRow là SSOT, không bịa %):
//
//   biên lãi ròng m = lợi nhuận (chưa trừ ads) / doanh thu thực tế
//   ROAS hòa vốn   = 1 / m   (ROAS ads dưới ngưỡng này là ĐỐT TIỀN dù ROAS dương)
//
// Phân bổ P&L đơn → campaign theo TỶ TRỌNG DOANH THU của các SKU thuộc campaign
// trong từng đơn (đơn ghép nhiều SP không bị tính trùng). Campaign quá ít đơn
// (<MIN_ORDERS_FOR_MARGIN) rơi về biên lãi TOÀN SHOP, đánh dấu marginSource để
// UI nói thật với người dùng số này lấy từ đâu.
//
// Chỉ ADMIN (mount adminOnly ở app.ts) — chi phí Ads là dữ liệu tài chính.
// ============================================================

/** Cửa sổ P&L để ước biên lãi — cố định 30 ngày cho đủ mẫu, KHÔNG theo ?days. */
const MARGIN_WINDOW_DAYS = 30;
/** Campaign cần tối thiểu bấy nhiêu đơn khớp SKU mới dùng biên lãi riêng. */
const MIN_ORDERS_FOR_MARGIN = 5;

function startOfDaysAgo(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

/** "YYYY-MM-DD" theo UTC — cột @db.Date lưu 00:00 UTC nên đọc bằng UTC mới đúng ngày. */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

router.get("/shopee", async (req: AuthRequest, res, next) => {
  try {
    // ---- Gian Shopee của shop (ADMIN thấy hết — không cần allowedChannelIds) ----
    const channels = await prisma.channel.findMany({
      where: {
        userId: req.ownerId!,
        channelName: ChannelName.SHOPEE,
        status: "ACTIVE",
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, shopName: true, externalShopId: true },
    });
    if (channels.length === 0) {
      res.json({ channels: [], selectedChannelId: null, days: 7, wallet: null, summary: null, campaigns: [], series: [] });
      return;
    }

    const requestedId =
      typeof req.query.channelId === "string" ? req.query.channelId : "";
    const selected =
      channels.find((c) => c.id === requestedId) ?? channels[0];
    const days = req.query.days === "30" ? 30 : 7;
    const perfStart = startOfDaysAgo(days);

    // ---- Campaign + hiệu suất trong cửa sổ ----
    const campaignRows = await prisma.adsCampaign.findMany({
      where: { channelId: selected.id },
      include: { dailyPerf: { where: { date: { gte: perfStart } } } },
    });

    // ---- Nền P&L 30 ngày để tính biên lãi (chưa trừ ads) ----
    const pnlOrders = await fetchPnlOrders(
      { userId: req.ownerId!, id: selected.id, channelName: ChannelName.SHOPEE },
      { gte: startOfDaysAgo(MARGIN_WINDOW_DAYS), lte: new Date() }
    );
    const pnlRows = pnlOrders.map(computePnlRow);

    // Map SKU sàn → campaign qua externalId của ChannelProduct ("item" | "item-model").
    const channelProducts = await prisma.channelProduct.findMany({
      where: { channelId: selected.id, externalId: { not: null } },
      select: { channelSku: true, externalId: true },
    });
    const skusByItemId = new Map<string, Set<string>>();
    for (const cp of channelProducts) {
      const itemId = (cp.externalId ?? "").split("-")[0];
      if (!itemId) continue;
      let set = skusByItemId.get(itemId);
      if (!set) skusByItemId.set(itemId, (set = new Set()));
      set.add(cp.channelSku);
    }

    /** Biên lãi ròng (chưa trừ ads) trên một tập SKU — null nếu SKU rỗng = tính toàn shop. */
    function marginOver(skuSet: Set<string> | null): {
      orders: number;
      revenue: number;
      profit: number;
      missingCostOrders: number;
    } {
      let orders = 0;
      let revenue = 0;
      let profit = 0;
      let missingCostOrders = 0;
      for (const row of pnlRows) {
        const itemTotal = row.items.reduce((s, it) => s + it.price * it.quantity, 0);
        if (itemTotal <= 0) continue;
        const matchTotal = skuSet
          ? row.items
              .filter((it) => skuSet.has(it.sku))
              .reduce((s, it) => s + it.price * it.quantity, 0)
          : itemTotal;
        if (matchTotal <= 0) continue;
        const ratio = matchTotal / itemTotal;
        orders++;
        revenue += row.actualRevenue * ratio;
        profit += row.profit * ratio;
        if (row.missingCostPrice) missingCostOrders++;
      }
      return { orders, revenue, profit, missingCostOrders };
    }

    const shopMarginBase = marginOver(null);
    const shopMargin =
      shopMarginBase.revenue > 0 ? shopMarginBase.profit / shopMarginBase.revenue : null;
    const shopBreakeven =
      shopMargin != null && shopMargin > 0 ? 1 / shopMargin : null;

    // ---- Tổng hợp từng campaign ----
    const campaigns = campaignRows.map((c) => {
      const perf = c.dailyPerf.reduce(
        (acc, p) => {
          acc.spend += Number(p.expense);
          acc.impression += p.impression;
          acc.clicks += p.clicks;
          acc.broadOrder += p.broadOrder;
          acc.broadGmv += Number(p.broadGmv);
          acc.directOrder += p.directOrder;
          acc.directGmv += Number(p.directGmv);
          return acc;
        },
        { spend: 0, impression: 0, clicks: 0, broadOrder: 0, broadGmv: 0, directOrder: 0, directGmv: 0 }
      );

      // Biên lãi riêng của campaign từ P&L các SKU trong campaign.
      const itemIds = c.itemIds ? c.itemIds.split(",") : [];
      const skuSet = new Set<string>();
      for (const itemId of itemIds) {
        for (const sku of skusByItemId.get(itemId) ?? []) skuSet.add(sku);
      }
      const own = skuSet.size > 0 ? marginOver(skuSet) : { orders: 0, revenue: 0, profit: 0, missingCostOrders: 0 };
      const useOwn = own.orders >= MIN_ORDERS_FOR_MARGIN && own.revenue > 0;
      const margin = useOwn ? own.profit / own.revenue : shopMargin;
      const marginSource: "campaign" | "shop" | null =
        useOwn ? "campaign" : shopMargin != null ? "shop" : null;
      const breakevenRoas = margin != null && margin > 0 ? 1 / margin : null;

      // Lãi/lỗ THẬT ước tính của campaign trong cửa sổ: phần lãi ròng của doanh
      // thu direct do ads mang về, trừ tiền ads. Thận trọng dùng direct (không
      // tính broad — đơn "ăn theo" 7 ngày có thể vẫn về mà không cần ads).
      const estProfit =
        margin != null ? perf.directGmv * margin - perf.spend : null;

      return {
        id: c.id,
        campaignId: c.campaignId,
        name: c.name,
        adType: c.adType,
        status: c.status,
        placement: c.placement,
        biddingMethod: c.biddingMethod,
        budget: Number(c.budget),
        roasTarget: c.roasTarget != null ? Number(c.roasTarget) : null,
        startTime: c.startTime,
        endTime: c.endTime,
        itemCount: itemIds.length,
        ...perf,
        roasBroad: perf.spend > 0 ? perf.broadGmv / perf.spend : null,
        roasDirect: perf.spend > 0 ? perf.directGmv / perf.spend : null,
        margin,
        marginSource,
        marginOrders: useOwn ? own.orders : shopMarginBase.orders,
        breakevenRoas,
        estProfit,
        // margin ≤ 0: SKU này đang LỖ ngay cả trước ads — cảnh báo riêng.
        lossBeforeAds: margin != null && margin <= 0,
      };
    });
    campaigns.sort((a, b) => b.spend - a.spend);

    // ---- Chuỗi ngày cho biểu đồ (gộp mọi campaign) ----
    const seriesMap = new Map<string, { spend: number; broadGmv: number; directGmv: number }>();
    for (const c of campaignRows) {
      for (const p of c.dailyPerf) {
        const key = dateKey(p.date);
        const point = seriesMap.get(key) ?? { spend: 0, broadGmv: 0, directGmv: 0 };
        point.spend += Number(p.expense);
        point.broadGmv += Number(p.broadGmv);
        point.directGmv += Number(p.directGmv);
        seriesMap.set(key, point);
      }
    }
    const series = [...seriesMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ---- Chi tiêu ads TOÀN SHOP từ AdSpend (nguồn đối chiếu — gồm cả loại
    // quảng cáo không nằm trong campaign sản phẩm) ----
    const adSpendAgg = await prisma.adSpend.aggregate({
      where: { channelId: selected.id, date: { gte: perfStart } },
      _sum: { amount: true },
    });

    const totals = campaigns.reduce(
      (acc, c) => {
        acc.spend += c.spend;
        acc.broadOrder += c.broadOrder;
        acc.broadGmv += c.broadGmv;
        acc.directOrder += c.directOrder;
        acc.directGmv += c.directGmv;
        if (c.estProfit != null) acc.estProfit += c.estProfit;
        return acc;
      },
      { spend: 0, broadOrder: 0, broadGmv: 0, directOrder: 0, directGmv: 0, estProfit: 0 }
    );

    // ---- Số dư ví ads real-time (gọi sống, lỗi không làm hỏng dashboard) ----
    let wallet: { balance: number } | null = null;
    try {
      const channel = await prisma.channel.findUnique({ where: { id: selected.id } });
      if (channel) {
        const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
        const bal = await getAdsTotalBalance({ accessToken, shopId });
        const balance = Number(bal.response?.total_balance);
        if (Number.isFinite(balance)) wallet = { balance };
      }
    } catch {
      wallet = null; // app chưa có quyền / token lỗi — dashboard vẫn hiển thị
    }

    res.json({
      channels,
      selectedChannelId: selected.id,
      days,
      wallet,
      summary: {
        ...totals,
        roasBroad: totals.spend > 0 ? totals.broadGmv / totals.spend : null,
        roasDirect: totals.spend > 0 ? totals.directGmv / totals.spend : null,
        adSpendTotal: Number(adSpendAgg._sum.amount ?? 0),
        shopMargin,
        shopBreakevenRoas: shopBreakeven,
        marginWindowDays: MARGIN_WINDOW_DAYS,
        pnlOrders: shopMarginBase.orders,
        missingCostOrders: shopMarginBase.missingCostOrders,
      },
      campaigns,
      series,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
