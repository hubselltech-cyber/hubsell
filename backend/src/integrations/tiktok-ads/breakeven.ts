// ============================================================
// TIKTOK ADS — ROI HÒA VỐN (GMV Max)
//
// Câu hỏi: với giá vốn + phí sàn thật của shop, ROI của TikTok phải trên bao
// nhiêu thì quảng cáo mới KHÔNG LỖ? → hòa vốn = 1 ÷ biên lãi TRƯỚC quảng cáo.
// Đây là căn cứ cho mọi ngưỡng của luật loại video (ROI mục tiêu, mức loại) —
// trước 18/09 các ngưỡng đó đặt theo cảm tính.
//
// KHÁC Shopee/Lazada ở hai chỗ, đều vì cách TikTok tính tiền:
//   1. PHÍ GMV MAX ĐÃ NẰM TRONG LỢI NHUẬN ĐƠN. Sàn trừ "Nạp tiền quảng cáo từ
//      đơn hàng" ngay trong quyết toán từng đơn (TiktokOrderSettlement.feeGmvMax,
//      số CÓ DẤU, âm = bị trừ; mapper dồn vào order.serviceFee). computePnlRow
//      vì thế trả lợi nhuận ĐÃ trừ quảng cáo → phải CỘNG NGƯỢC khoản này mới ra
//      biên lãi trước quảng cáo:  lãi trước ads = profit − feeGmvMax.
//   2. MẪU SỐ PHẢI CÙNG ĐỊNH NGHĨA VỚI "DOANH THU" CỦA TIKTOK. ROI của TikTok =
//      gross_revenue ÷ chi phí, mà gross_revenue tính trên đơn ĐẶT — đơn hủy /
//      hoàn về sau KHÔNG bị rút ra. Nên ở đây đơn HỦY vẫn góp doanh thu vào mẫu
//      số nhưng góp 0 đồng lãi (không lấy "lỗ ảo" bằng giá vốn của computePnlRow
//      — hàng hủy quay lại kho). Đơn hoàn giữ nguyên dòng P&L (thất thu thật).
//      Hệ quả: hòa vốn nghiêng về phía CAO (dè dặt) — đúng hướng "giữ tiền".
//      Để kiểm giả định này, chiến dịch có biên lãi riêng trả kèm `check`: doanh
//      thu Hubsell thấy trên các SKU của chiến dịch vs doanh thu TikTok báo cho
//      chính chiến dịch đó, cùng 30 ngày.
//
// Đơn nào được tính:
//   · có bản kê TikTok (thật hoặc ước tính của sàn) — đơn chưa có bản kê mang phí
//     = 0 làm biên lãi ảo cao (cùng lý do Lazada chỉ lấy đơn đã đối soát);
//   · MỌI dòng hàng đều có giá vốn — đơn thiếu giá vốn bị loại khỏi cả tử lẫn mẫu
//     và cộng vào `missingCostRevenue` để UI nói rõ "tính trên X% doanh thu".
// Đơn nhiều SKU phân bổ theo tỷ trọng giá trị hàng của SKU khớp (như Shopee).
// ============================================================

import { ChannelName, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { computePnlRow, fetchPnlOrders } from "../../routes/finance";
import { MARGIN_WINDOW_DAYS, MIN_ORDERS_FOR_MARGIN, startOfDaysAgo, vnDateKey } from "../shopee/ads-insights";

/** Phần của một dòng P&L mà phép tính hòa vốn cần — tách riêng để test không phải dựng cả đơn. */
export interface BreakevenPnlRow {
  shippingStatus: ShippingStatus;
  items: { sku: string; price: number; quantity: number }[];
  actualRevenue: number;
  profit: number;
  missingCostPrice: boolean;
  /** Bản kê TikTok của đơn (null = chưa có bản kê / ước tính nào). feeGmvMax có dấu, âm = bị trừ. */
  tiktok: { feeGmvMax: number } | null;
}

export interface BreakevenBase {
  /** Số đơn góp vào phép tính (kể cả đơn hủy). */
  orders: number;
  cancelledOrders: number;
  /** Mẫu số: doanh thu (giá gốc − chiết khấu shop) của đơn được tính, gồm đơn hủy. */
  revenue: number;
  /** Tử số: lợi nhuận đã cộng ngược phí GMV Max. */
  profitBeforeAds: number;
  /** Phí GMV Max sàn đã trừ trong các đơn này (số dương). */
  adFee: number;
  /** Doanh thu của đơn bị loại vì thiếu giá vốn — để tính độ phủ. */
  missingCostRevenue: number;
  /** Doanh thu của đơn bị loại vì chưa có bản kê của sàn. */
  noStatementRevenue: number;
}

/** Gom nguyên liệu hòa vốn trên một tập SKU (null = toàn gian). Thuần. */
export function tiktokBreakevenBase(rows: BreakevenPnlRow[], skuSet: Set<string> | null): BreakevenBase {
  const base: BreakevenBase = {
    orders: 0,
    cancelledOrders: 0,
    revenue: 0,
    profitBeforeAds: 0,
    adFee: 0,
    missingCostRevenue: 0,
    noStatementRevenue: 0,
  };
  for (const row of rows) {
    const itemTotal = row.items.reduce((s, it) => s + it.price * it.quantity, 0);
    if (itemTotal <= 0) continue;
    const matchTotal = skuSet
      ? row.items.filter((it) => skuSet.has(it.sku)).reduce((s, it) => s + it.price * it.quantity, 0)
      : itemTotal;
    if (matchTotal <= 0) continue;
    const ratio = matchTotal / itemTotal;
    const revenue = row.actualRevenue * ratio;

    if (row.missingCostPrice) {
      base.missingCostRevenue += revenue;
      continue;
    }
    if (row.shippingStatus === ShippingStatus.CANCELLED) {
      base.orders++;
      base.cancelledOrders++;
      base.revenue += revenue;
      continue;
    }
    if (!row.tiktok) {
      base.noStatementRevenue += revenue;
      continue;
    }
    base.orders++;
    base.revenue += revenue;
    base.profitBeforeAds += (row.profit - row.tiktok.feeGmvMax) * ratio;
    base.adFee += -row.tiktok.feeGmvMax * ratio;
  }
  return base;
}

export interface TiktokBreakeven {
  /** ROI hòa vốn; null = chưa tính được (thiếu dữ liệu) hoặc biên lãi ≤ 0 (xem negativeMargin). */
  breakevenRoi: number | null;
  /** Biên lãi trước quảng cáo (0,16 = 16%). */
  margin: number | null;
  /** Bán đã lỗ trước cả quảng cáo → ROI nào cũng lỗ. */
  negativeMargin: boolean;
  /** campaign = biên lãi riêng các SKU của chiến dịch; shop = mượn biên lãi toàn gian. */
  source: "campaign" | "shop" | null;
  orders: number;
  /** % doanh thu (trong phạm vi) đã có giá vốn — dưới 100 nghĩa là hòa vốn chỉ đại diện phần đó. */
  costCoveragePct: number | null;
  /** Tự kiểm mẫu số (chỉ khi source = campaign): doanh thu Hubsell thấy trên SKU của chiến dịch vs TikTok báo, 30 ngày. */
  check: { revenueSeen: number; tiktokGmv: number } | null;
}

/** Từ nguyên liệu → kết quả hòa vốn. Thuần. */
export function toTiktokBreakeven(base: BreakevenBase, source: "campaign" | "shop"): TiktokBreakeven {
  const scoped = base.revenue + base.missingCostRevenue;
  const costCoveragePct = scoped > 0 ? Math.round((base.revenue / scoped) * 100) : null;
  if (base.orders === 0 || base.revenue <= 0) {
    return { breakevenRoi: null, margin: null, negativeMargin: false, source: null, orders: 0, costCoveragePct, check: null };
  }
  const margin = base.profitBeforeAds / base.revenue;
  return {
    breakevenRoi: margin > 0 ? 1 / margin : null,
    margin,
    negativeMargin: margin <= 0,
    source,
    orders: base.orders,
    costCoveragePct,
    check: null,
  };
}

export interface ChannelTiktokBreakeven {
  shop: TiktokBreakeven;
  byCampaignRowId: Map<string, TiktokBreakeven>;
}

/** Hòa vốn toàn gian + từng chiến dịch (30 ngày). Chiến dịch chưa đủ mẫu / chưa biết SKU → mượn biên lãi gian. */
export async function computeTiktokAdsBreakeven(channel: { id: string; userId: string }): Promise<ChannelTiktokBreakeven> {
  const [orders, campaigns, channelProducts] = await Promise.all([
    fetchPnlOrders(
      { userId: channel.userId, id: channel.id, channelName: ChannelName.TIKTOK },
      { gte: startOfDaysAgo(MARGIN_WINDOW_DAYS), lte: new Date() }
    ),
    prisma.adsCampaign.findMany({
      where: { channelId: channel.id },
      select: {
        id: true,
        itemIds: true,
        dailyPerf: { where: { date: { gte: new Date(`${vnDateKey(MARGIN_WINDOW_DAYS - 1)}T00:00:00Z`) } }, select: { broadGmv: true } },
      },
    }),
    prisma.channelProduct.findMany({
      where: { channelId: channel.id, externalId: { not: null } },
      select: { channelSku: true, externalId: true },
    }),
  ]);
  const rows: BreakevenPnlRow[] = orders.map((o) => {
    const r = computePnlRow(o);
    return {
      shippingStatus: r.shippingStatus,
      items: r.items,
      actualRevenue: r.actualRevenue,
      profit: r.profit,
      missingCostPrice: r.missingCostPrice,
      tiktok: r.tiktok ? { feeGmvMax: Number((r.tiktok as Record<string, unknown>).feeGmvMax) || 0 } : null,
    };
  });

  // externalId TikTok = "productId-skuId" (tiktok-adapter) — productId chính là item_group_id của report GMV Max.
  const skusByProductId = new Map<string, Set<string>>();
  for (const cp of channelProducts) {
    const productId = (cp.externalId ?? "").split("-")[0];
    if (!productId) continue;
    let set = skusByProductId.get(productId);
    if (!set) skusByProductId.set(productId, (set = new Set()));
    set.add(cp.channelSku);
  }

  const shopBase = tiktokBreakevenBase(rows, null);
  const shop = toTiktokBreakeven(shopBase, "shop");

  const byCampaignRowId = new Map<string, TiktokBreakeven>();
  for (const c of campaigns) {
    const skuSet = new Set<string>();
    for (const productId of c.itemIds ? c.itemIds.split(",") : []) {
      for (const sku of skusByProductId.get(productId) ?? []) skuSet.add(sku);
    }
    const own = skuSet.size > 0 ? tiktokBreakevenBase(rows, skuSet) : null;
    const useOwn = own != null && own.orders - own.cancelledOrders >= MIN_ORDERS_FOR_MARGIN && own.revenue > 0;
    byCampaignRowId.set(
      c.id,
      useOwn
        ? {
            ...toTiktokBreakeven(own, "campaign"),
            check: {
              revenueSeen: own.revenue + own.missingCostRevenue + own.noStatementRevenue,
              tiktokGmv: c.dailyPerf.reduce((t, p) => t + Number(p.broadGmv), 0),
            },
          }
        : shop
    );
  }

  return { shop, byCampaignRowId };
}

/** Ghi danh sách sản phẩm (SPU) của chiến dịch vào AdsCampaign.itemIds khi đổi — nguồn nối chiến dịch → SKU. */
export async function saveCampaignProductIds(adsCampaignId: string, current: string, spuIds: string[]): Promise<void> {
  const next = [...new Set(spuIds.filter(Boolean))].sort().join(",");
  if (!next || next === current) return;
  await prisma.adsCampaign.update({ where: { id: adsCampaignId }, data: { itemIds: next } });
}
