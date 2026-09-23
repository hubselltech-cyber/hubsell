// ============================================================
// TIKTOK ADS — ROI HÒA VỐN (GMV Max)
//
// Câu hỏi: với giá vốn + phí sàn thật của shop, ROI của TikTok phải trên bao
// nhiêu thì quảng cáo mới KHÔNG LỖ? → hòa vốn = 1 ÷ biên lãi TRƯỚC quảng cáo.
// Đây là căn cứ cho mọi ngưỡng của luật loại video (ROI mục tiêu, mức loại) —
// trước 18/09 các ngưỡng đó đặt theo cảm tính.
//
// ★ CHỈ TÍNH ĐƠN ĐÃ CÓ KẾT CỤC CUỐI (anh Trung 18/09: "chỉ tính trên đơn đã giao
//   thành công và hoàn thành công… TikTok đối soát rất lâu… phải tính trên đơn đã
//   đối soát thành công"):
//     · đơn ĐÃ ĐỐI SOÁT THẬT (Order.isSettled — bản kê TikTok estimated = false):
//       gồm cả đơn giao thành công lẫn đơn hoàn xong, phí và tiền hoàn đều là số
//       cuối của sàn. Đơn đang giao / vừa giao / đang hoàn / mới có số ƯỚC TÍNH
//       của sàn → KHÔNG tính: kết cục chưa chốt, đưa vào là biên lãi ảo.
//     · đơn HỦY: cũng là kết cục cuối (xem điểm 2 bên dưới), nhưng chỉ lấy đơn
//       hủy CÙNG LỨA với đơn đã đối soát — tạo không muộn hơn đơn đã đối soát mới
//       nhất. Đơn hủy chốt trong vài giờ còn đối soát mất hàng tuần; không cắt
//       cùng lứa thì mấy tuần gần nhất chỉ toàn đơn hủy, tỷ lệ hủy bị thổi phồng.
//   Vì đơn mới chưa đối soát nên cửa sổ là 60 ngày theo ngày tạo đơn (Shopee dùng
//   30): phần đóng góp thật thường là đơn tạo từ ~2 tuần trước trở về. 60 là mặc
//   định chọn cho đủ mẫu, không phải số của sàn.
//
// KHÁC Shopee/Lazada ở hai chỗ, đều vì cách TikTok tính tiền:
//   1. PHÍ GMV MAX ĐÃ NẰM TRONG LỢI NHUẬN ĐƠN. Sàn trừ "Nạp tiền quảng cáo từ
//      đơn hàng" ngay trong quyết toán từng đơn (TiktokOrderSettlement.feeGmvMax,
//      số CÓ DẤU, âm = bị trừ; mapper dồn vào order.serviceFee). computePnlRow
//      vì thế trả lợi nhuận ĐÃ trừ quảng cáo → phải CỘNG NGƯỢC khoản này mới ra
//      biên lãi trước quảng cáo:  lãi trước ads = profit − feeGmvMax.
//   2. MẪU SỐ PHẢI CÙNG ĐỊNH NGHĨA VỚI "DOANH THU" CỦA TIKTOK. ROI của TikTok =
//      gross_revenue ÷ chi phí, mà gross_revenue tính trên đơn ĐẶT — đơn hủy /
//      hoàn về sau KHÔNG bị rút ra (tiền quảng cáo cho đơn đó vẫn mất). Nên đơn
//      HỦY góp doanh thu vào mẫu số nhưng góp 0 đồng lãi (không lấy "lỗ ảo" bằng
//      giá vốn của computePnlRow — hàng hủy quay lại kho). Hệ quả: hòa vốn
//      nghiêng về phía CAO (dè dặt) — đúng hướng "giữ tiền".
//      ★ GIẢ ĐỊNH chưa kiểm bằng số prod → kết quả trả kèm `check`: doanh thu MỌI
//      đơn đặt Hubsell thấy vs doanh thu TikTok báo, cùng SKU, cùng khoảng ngày.
//
// Đơn thiếu giá vốn (đã có kết cục cuối) bị loại khỏi cả tử lẫn mẫu và cộng vào
// `missingCostRevenue` để UI nói rõ "tính trên X% doanh thu có giá vốn".
// Đơn nhiều SKU phân bổ theo tỷ trọng giá trị hàng của SKU khớp (như Shopee).
// ============================================================

import { ChannelName, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { computePnlRow, forEachPnlOrderPage } from "../../routes/finance";
import { MIN_ORDERS_FOR_MARGIN, dateKey, startOfDaysAgo, vnDateKey } from "../shopee/ads-insights";
import { productRunAdvice, type ProductRunAdvice } from "./product-run-advice";

/** Cửa sổ lấy đơn (theo ngày tạo) — dài hơn Shopee vì chỉ đơn ĐÃ ĐỐI SOÁT mới được tính. Mặc định chọn, không phải số của sàn. */
export const TIKTOK_MARGIN_WINDOW_DAYS = 60;
/** Phanh an toàn khi cuộn đơn 60 ngày của một gian. */
const MAX_ORDERS = 8000;

/** Phần của một dòng P&L mà phép tính hòa vốn cần — tách riêng để test không phải dựng cả đơn. */
export interface BreakevenPnlRow {
  createdAt: Date;
  shippingStatus: ShippingStatus;
  /** Đã đối soát THẬT (bản kê estimated = false). */
  isSettled: boolean;
  items: { sku: string; price: number; quantity: number }[];
  actualRevenue: number;
  profit: number;
  missingCostPrice: boolean;
  /** Bản kê TikTok của đơn (null = chưa có). feeGmvMax có dấu, âm = bị trừ. */
  tiktok: { feeGmvMax: number } | null;
}

export interface BreakevenBase {
  /** Đơn đã đối soát góp vào phép tính (giao thành công + hoàn xong). */
  settledOrders: number;
  /** Đơn hủy cùng lứa góp doanh thu vào mẫu số. */
  cancelledOrders: number;
  /** Mẫu số: doanh thu (giá gốc − chiết khấu shop) của đơn được tính, gồm đơn hủy cùng lứa. */
  revenue: number;
  /** Tử số: lợi nhuận đã cộng ngược phí GMV Max. */
  profitBeforeAds: number;
  /** Phí GMV Max sàn đã trừ trong các đơn này (số dương). */
  adFee: number;
  /** Doanh thu của đơn đã có kết cục cuối nhưng thiếu giá vốn — để tính độ phủ. */
  missingCostRevenue: number;
  /** Số đơn CHƯA có kết cục cuối (đang giao, chờ đối soát, đang hoàn, hủy ngoài lứa) — không tính. */
  pendingOrders: number;
}

const isCancelled = (r: BreakevenPnlRow) => r.shippingStatus === ShippingStatus.CANCELLED;
const isSettledFinal = (r: BreakevenPnlRow) => r.isSettled && r.tiktok != null && !isCancelled(r);

/** Mốc cùng lứa: ngày tạo của đơn ĐÃ ĐỐI SOÁT mới nhất (null = gian chưa có đơn đối soát nào trong cửa sổ). */
export function settledCohortCutoff(rows: BreakevenPnlRow[]): Date | null {
  let cutoff: Date | null = null;
  for (const r of rows) {
    if (isSettledFinal(r) && (!cutoff || r.createdAt > cutoff)) cutoff = r.createdAt;
  }
  return cutoff;
}

/** Gom nguyên liệu hòa vốn trên một tập SKU (null = toàn gian). `rows` = MỌI đơn của gian trong cửa sổ. Thuần. */
export function tiktokBreakevenBase(rows: BreakevenPnlRow[], skuSet: Set<string> | null): BreakevenBase {
  const base: BreakevenBase = {
    settledOrders: 0,
    cancelledOrders: 0,
    revenue: 0,
    profitBeforeAds: 0,
    adFee: 0,
    missingCostRevenue: 0,
    pendingOrders: 0,
  };
  const cutoff = settledCohortCutoff(rows);
  for (const row of rows) {
    const itemTotal = row.items.reduce((s, it) => s + it.price * it.quantity, 0);
    if (itemTotal <= 0) continue;
    const matchTotal = skuSet
      ? row.items.filter((it) => skuSet.has(it.sku)).reduce((s, it) => s + it.price * it.quantity, 0)
      : itemTotal;
    if (matchTotal <= 0) continue;
    const ratio = matchTotal / itemTotal;
    const revenue = row.actualRevenue * ratio;

    const cancelled = isCancelled(row);
    const final = cancelled ? cutoff != null && row.createdAt <= cutoff : isSettledFinal(row);
    if (!final) {
      base.pendingOrders++;
      continue;
    }
    if (row.missingCostPrice) {
      base.missingCostRevenue += revenue;
      continue;
    }
    base.revenue += revenue;
    if (cancelled) {
      base.cancelledOrders++;
      continue;
    }
    const feeGmvMax = row.tiktok?.feeGmvMax ?? 0;
    base.settledOrders++;
    base.profitBeforeAds += (row.profit - feeGmvMax) * ratio;
    base.adFee += -feeGmvMax * ratio;
  }
  return base;
}

/**
 * Cùng phép gom của tiktokBreakevenBase nhưng cho NHIỀU nhóm SKU trong MỘT lượt quét đơn (tab Hòa vốn sản phẩm: mỗi sản
 * phẩm một nhóm — vài trăm sản phẩm × vài nghìn đơn thì không quét lại từng nhóm). `groupOfSku`: SKU → mã nhóm; SKU không
 * có trong bảng thì bỏ qua. Kết quả của một nhóm PHẢI bằng tiktokBreakevenBase(rows, tập SKU của nhóm) — có test giữ điều đó,
 * để con số của một sản phẩm ở tab mới không bao giờ lệch con số hòa vốn của chiến dịch chỉ chứa sản phẩm đó. Thuần.
 */
export function tiktokBreakevenBaseByGroup(rows: BreakevenPnlRow[], groupOfSku: Map<string, string>): Map<string, BreakevenBase> {
  const out = new Map<string, BreakevenBase>();
  const baseOf = (g: string) => {
    let b = out.get(g);
    if (!b) out.set(g, (b = { settledOrders: 0, cancelledOrders: 0, revenue: 0, profitBeforeAds: 0, adFee: 0, missingCostRevenue: 0, pendingOrders: 0 }));
    return b;
  };
  const cutoff = settledCohortCutoff(rows);
  for (const row of rows) {
    const itemTotal = row.items.reduce((s, it) => s + it.price * it.quantity, 0);
    if (itemTotal <= 0) continue;
    const matchByGroup = new Map<string, number>();
    for (const it of row.items) {
      const g = groupOfSku.get(it.sku);
      if (g != null) matchByGroup.set(g, (matchByGroup.get(g) ?? 0) + it.price * it.quantity);
    }
    const cancelled = isCancelled(row);
    const final = cancelled ? cutoff != null && row.createdAt <= cutoff : isSettledFinal(row);
    const feeGmvMax = row.tiktok?.feeGmvMax ?? 0;
    for (const [g, matchTotal] of matchByGroup) {
      if (matchTotal <= 0) continue;
      const base = baseOf(g);
      const ratio = matchTotal / itemTotal;
      const revenue = row.actualRevenue * ratio;
      if (!final) {
        base.pendingOrders++;
        continue;
      }
      if (row.missingCostPrice) {
        base.missingCostRevenue += revenue;
        continue;
      }
      base.revenue += revenue;
      if (cancelled) {
        base.cancelledOrders++;
        continue;
      }
      base.settledOrders++;
      base.profitBeforeAds += (row.profit - feeGmvMax) * ratio;
      base.adFee += -feeGmvMax * ratio;
    }
  }
  return out;
}

export interface TiktokBreakeven {
  /** ROI hòa vốn; null = chưa tính được (thiếu dữ liệu) hoặc biên lãi ≤ 0 (xem negativeMargin). */
  breakevenRoi: number | null;
  /** Biên lãi trước quảng cáo (0,16 = 16%). */
  margin: number | null;
  /** Bán đã lỗ trước cả quảng cáo → ROI nào cũng lỗ. */
  negativeMargin: boolean;
  /** campaign = biên lãi riêng các SKU của chiến dịch; shop = mượn biên lãi toàn gian; product = riêng một sản phẩm (tab Hòa vốn sản phẩm). */
  source: "campaign" | "shop" | "product" | null;
  /** Đơn đã đối soát góp vào phép tính. */
  orders: number;
  /** Đơn hủy cùng lứa nằm trong mẫu số. */
  cancelledOrders: number;
  /** Đơn chưa có kết cục cuối bị để ngoài. */
  pendingOrders: number;
  /** % doanh thu (trong phạm vi) đã có giá vốn — dưới 100 nghĩa là hòa vốn chỉ đại diện phần đó. */
  costCoveragePct: number | null;
  /** Tự kiểm mẫu số (chỉ khi source = campaign): doanh thu MỌI đơn đặt Hubsell thấy vs TikTok báo, cùng SKU, cùng khoảng ngày. */
  check: { revenuePlaced: number; tiktokGmv: number; from: string; to: string } | null;
}

/** Từ nguyên liệu → kết quả hòa vốn. Thuần. */
export function toTiktokBreakeven(base: BreakevenBase, source: "campaign" | "shop" | "product"): TiktokBreakeven {
  const scoped = base.revenue + base.missingCostRevenue;
  const common = {
    cancelledOrders: base.cancelledOrders,
    pendingOrders: base.pendingOrders,
    costCoveragePct: scoped > 0 ? Math.round((base.revenue / scoped) * 100) : null,
    check: null,
  };
  if (base.settledOrders === 0 || base.revenue <= 0) {
    return { breakevenRoi: null, margin: null, negativeMargin: false, source: null, orders: 0, ...common };
  }
  const margin = base.profitBeforeAds / base.revenue;
  return {
    breakevenRoi: margin > 0 ? 1 / margin : null,
    margin,
    negativeMargin: margin <= 0,
    source,
    orders: base.settledOrders,
    ...common,
  };
}

/** Doanh thu MỌI đơn đặt (kể cả hủy / đang giao) trên tập SKU, ngày tạo (giờ VN) trong [from, to] — để so với doanh thu TikTok báo. Thuần. */
export function placedRevenue(rows: BreakevenPnlRow[], skuSet: Set<string>, from: string, to: string): number {
  let sum = 0;
  for (const row of rows) {
    const day = new Date(row.createdAt.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    if (day < from || day > to) continue;
    const itemTotal = row.items.reduce((s, it) => s + it.price * it.quantity, 0);
    if (itemTotal <= 0) continue;
    const matchTotal = row.items.filter((it) => skuSet.has(it.sku)).reduce((s, it) => s + it.price * it.quantity, 0);
    sum += row.actualRevenue * (matchTotal / itemTotal);
  }
  return sum;
}

export interface ChannelTiktokBreakeven {
  shop: TiktokBreakeven;
  byCampaignRowId: Map<string, TiktokBreakeven>;
}

/** Nạp MỘT LẦN mọi thứ phép tính hòa vốn cần (đơn 60 ngày qua computePnlRow, chiến dịch, sản phẩm sàn) — dùng chung cho hòa vốn chiến dịch lẫn tab Hòa vốn sản phẩm. */
async function loadBreakevenInputs(channel: { id: string; userId: string }) {
  // Đơn 60 ngày đọc THEO TRANG rồi rút ngay thành dòng gọn (22/09/2026 — trang
  // Quảng cáo TikTok gọi hàm này MỖI lần mở; gian ~185 đơn/ngày = ~11.000 đơn
  // kèm include nặng, giữ nguyên cả mảng từng làm Render hết heap).
  const rows: BreakevenPnlRow[] = [];
  const [, campaigns, channelProducts] = await Promise.all([
    forEachPnlOrderPage(
      { userId: channel.userId, id: channel.id, channelName: ChannelName.TIKTOK },
      { gte: startOfDaysAgo(TIKTOK_MARGIN_WINDOW_DAYS), lte: new Date() },
      { max: MAX_ORDERS },
      (page) => {
        for (const o of page) {
          const r = computePnlRow(o);
          rows.push({
            createdAt: r.createdAt,
            shippingStatus: r.shippingStatus,
            // Chỉ bản kê THẬT mới là "đã đối soát"; số ước tính của sàn (estimated) thì chưa.
            isSettled: r.isSettled && r.tiktok != null && (r.tiktok as { estimated?: boolean }).estimated !== true,
            // Chỉ giữ 3 trường phép tính cần — bỏ tham chiếu tới object sản phẩm của trang.
            items: r.items.map((it) => ({ sku: it.sku, price: it.price, quantity: it.quantity })),
            actualRevenue: r.actualRevenue,
            profit: r.profit,
            missingCostPrice: r.missingCostPrice,
            tiktok: r.tiktok ? { feeGmvMax: Number((r.tiktok as Record<string, unknown>).feeGmvMax) || 0 } : null,
          });
        }
      }
    ),
    prisma.adsCampaign.findMany({
      where: { channelId: channel.id },
      select: {
        id: true,
        name: true,
        status: true,
        roasTarget: true,
        itemIds: true,
        dailyPerf: {
          where: { date: { gte: new Date(`${vnDateKey(TIKTOK_MARGIN_WINDOW_DAYS - 1)}T00:00:00Z`) } },
          select: { date: true, broadGmv: true, expense: true },
        },
      },
    }),
    prisma.channelProduct.findMany({
      where: { channelId: channel.id, externalId: { not: null } },
      select: { channelSku: true, externalId: true, productName: true, imageUrl: true, channelStock: true },
    }),
  ]);
  // externalId TikTok = "productId-skuId" (tiktok-adapter) — productId chính là item_group_id của report GMV Max.
  const skusByProductId = new Map<string, Set<string>>();
  for (const cp of channelProducts) {
    const productId = (cp.externalId ?? "").split("-")[0];
    if (!productId) continue;
    let set = skusByProductId.get(productId);
    if (!set) skusByProductId.set(productId, (set = new Set()));
    set.add(cp.channelSku);
  }
  return { rows, campaigns, channelProducts, skusByProductId };
}

// ---------- NHỚ ĐỆM NGẮN + GỘP LƯỢT TÍNH TRÙNG (hạ tầng 18/09/2026) ----------
// Phép tính hòa vốn đọc tới 8.000 đơn 60 ngày qua computePnlRow và được gọi ở 7 route; MỘT lần mở trang chiến dịch bắn 2–3
// request song song, mỗi cái tính lại từ đầu. Nhớ KẾT QUẢ (nhỏ — không nhớ đơn hàng) 45 giây theo gian và cho các request
// đang chờ dùng chung một lượt tính. 45 giây là mặc định chọn: đủ gộp các request của một lần mở trang, đủ ngắn để giá vốn
// vừa nhập hiện lên gần như ngay. Nhớ trong RAM từng tiến trình — chỉ là bộ đệm đọc, không phải khóa.
const RESULT_TTL_MS = 45_000;
const RESULT_CACHE_MAX = 500;

export function memoizeByChannel<T>(compute: (channel: { id: string; userId: string }) => Promise<T>, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; value: Promise<T> }>();
  return (channel: { id: string; userId: string }): Promise<T> => {
    const hit = cache.get(channel.id);
    if (hit && now() - hit.at < RESULT_TTL_MS) return hit.value;
    const value = compute(channel);
    cache.set(channel.id, { at: now(), value });
    // Lượt tính hỏng thì không giữ lại (lần gọi sau tính lại ngay).
    value.catch(() => {
      if (cache.get(channel.id)?.value === value) cache.delete(channel.id);
    });
    if (cache.size > RESULT_CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return value;
  };
}

/** Hòa vốn toàn gian + từng chiến dịch. Chiến dịch chưa đủ mẫu / chưa biết SKU → mượn biên lãi gian. (Có nhớ đệm 45 giây.) */
export const computeTiktokAdsBreakeven = memoizeByChannel(computeTiktokAdsBreakevenUncached);

async function computeTiktokAdsBreakevenUncached(channel: { id: string; userId: string }): Promise<ChannelTiktokBreakeven> {
  const { rows, campaigns, skusByProductId } = await loadBreakevenInputs(channel);

  const shop = toTiktokBreakeven(tiktokBreakevenBase(rows, null), "shop");
  const yesterday = vnDateKey(1);

  const byCampaignRowId = new Map<string, TiktokBreakeven>();
  for (const c of campaigns) {
    const skuSet = new Set<string>();
    for (const productId of c.itemIds ? c.itemIds.split(",") : []) {
      for (const sku of skusByProductId.get(productId) ?? []) skuSet.add(sku);
    }
    const own = skuSet.size > 0 ? tiktokBreakevenBase(rows, skuSet) : null;
    if (!own || own.settledOrders < MIN_ORDERS_FOR_MARGIN || own.revenue <= 0) {
      byCampaignRowId.set(c.id, shop);
      continue;
    }
    // Tự kiểm mẫu số trên đúng những ngày Hubsell CÓ số TikTok của chiến dịch (tới hết hôm qua — hôm nay còn dở).
    const perf = c.dailyPerf.map((p) => ({ day: dateKey(p.date), gmv: Number(p.broadGmv) })).filter((p) => p.day <= yesterday);
    const from = perf.reduce((m, p) => (m === "" || p.day < m ? p.day : m), "");
    byCampaignRowId.set(c.id, {
      ...toTiktokBreakeven(own, "campaign"),
      check: from
        ? { revenuePlaced: placedRevenue(rows, skuSet, from, yesterday), tiktokGmv: perf.reduce((t, p) => t + p.gmv, 0), from, to: yesterday }
        : null,
    });
  }

  return { shop, byCampaignRowId };
}

/** Ghi danh sách sản phẩm (SPU) của chiến dịch vào AdsCampaign.itemIds khi đổi — nguồn nối chiến dịch → SKU. */
export async function saveCampaignProductIds(adsCampaignId: string, current: string, spuIds: string[]): Promise<void> {
  const next = [...new Set(spuIds.filter(Boolean))].sort().join(",");
  if (!next || next === current) return;
  await prisma.adsCampaign.update({ where: { id: adsCampaignId }, data: { itemIds: next } });
}

// ============================================================
// TAB "HÒA VỐN SẢN PHẨM" (anh Trung 18/09 khuya): ROI hòa vốn của TỪNG sản phẩm, hoàn toàn từ Lãi/Lỗ thực hiện, đúng luật
// ở đầu file (chỉ đơn ĐÃ ĐỐI SOÁT — giao thành công / hoàn xong — + đơn hủy cùng lứa; đơn chưa đối soát để ngoài). Chỉ đọc
// DB, KHÔNG gọi TikTok. Đây là nền cho phần gợi ý tạo quảng cáo về sau (cần xin thêm quyền Campaign — làm sau).
// ============================================================

/**
 * ĐÀ BÁN từng nhóm SKU: số sản phẩm bán ra 7 ngày và 30 ngày gần nhất, tính trên MỌI đơn đặt trừ đơn hủy (đây là nhịp bán,
 * không phải lãi — không cần chờ đối soát). Thuần.
 */
export function salesPaceByGroup(rows: BreakevenPnlRow[], groupOfSku: Map<string, string>, now: Date): Map<string, { units7d: number; units30d: number }> {
  const out = new Map<string, { units7d: number; units30d: number }>();
  const t7 = now.getTime() - 7 * 86400_000;
  const t30 = now.getTime() - 30 * 86400_000;
  for (const row of rows) {
    if (isCancelled(row)) continue;
    const t = row.createdAt.getTime();
    if (t < t30 || t > now.getTime()) continue;
    for (const it of row.items) {
      const g = groupOfSku.get(it.sku);
      if (g == null) continue;
      let cur = out.get(g);
      if (!cur) out.set(g, (cur = { units7d: 0, units30d: 0 }));
      cur.units30d += it.quantity;
      if (t >= t7) cur.units7d += it.quantity;
    }
  }
  return out;
}

/** Cửa sổ "ROI quảng cáo gian thực tế đạt được" của nhận định Nên chạy — cùng 30 ngày với cột Chi quảng cáo của tab. */
const RUN_ADVICE_ADS_DAYS = 30;

export type ProductBreakevenVerdict = "ok" | "target_below" | "low_sample" | "loss" | "no_cost" | "no_settled";

export interface ProductCampaignRef {
  id: string;
  name: string;
  status: string;
  roasTarget: number | null;
}

/**
 * Lãi SAU quảng cáo trên mỗi 100đ doanh thu nếu chiến dịch đạt ĐÚNG một mức ROI. Thuần — chỉ là số học trên hai số đã có:
 * biên lãi trước quảng cáo (đơn đã đối soát) − phần doanh thu trả cho quảng cáo (1 / ROI). Âm = mức ROI đó ăn vào vốn.
 * Cùng hệ quy chiếu với ROI hòa vốn: doanh thu GMV Max tính MỌI đơn của sản phẩm, biên lãi cũng tính trên mọi đơn đã đối soát.
 */
export function profitPer100AtRoi(margin: number, roi: number): number | null {
  if (!(roi > 0) || !Number.isFinite(margin)) return null;
  return Math.round((margin - 1 / roi) * 1000) / 10;
}

/** " (mỗi 100đ doanh thu lỗ khoảng Xđ)" cho câu cảnh báo mục tiêu dưới hòa vốn; rỗng khi không tính được. */
function lossAt(margin: number | null, roasTarget: number): string {
  const p = margin != null ? profitPer100AtRoi(margin, roasTarget) : null;
  if (p == null || p >= 0) return "";
  return ` (mỗi 100đ doanh thu lỗ khoảng ${Math.abs(p).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}đ)`;
}

/** Kết luận một dòng sản phẩm + lý do (cột riêng, trỏ chuột / bấm hiện lý do). Thuần. */
export function productBreakevenVerdict(
  be: TiktokBreakeven,
  campaigns: ProductCampaignRef[],
  minCoveragePct: number
): { verdict: ProductBreakevenVerdict; reason: string } {
  const roi = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  if (be.orders === 0 && (be.costCoveragePct ?? 100) < minCoveragePct) {
    return { verdict: "no_cost", reason: "Đơn đã đối soát của sản phẩm chưa có giá vốn — nhập giá vốn thì mới tính được hòa vốn." };
  }
  if (be.orders === 0) {
    return {
      verdict: "no_settled",
      reason:
        be.pendingOrders > 0
          ? `Chưa có đơn nào đã đối soát trong ${TIKTOK_MARGIN_WINDOW_DAYS} ngày (${be.pendingOrders} đơn đang giao / chờ đối soát chưa được tính).`
          : `Chưa có đơn nào đã đối soát trong ${TIKTOK_MARGIN_WINDOW_DAYS} ngày.`,
    };
  }
  if ((be.costCoveragePct ?? 100) < minCoveragePct) {
    return { verdict: "no_cost", reason: `Mới ${be.costCoveragePct}% doanh thu đã đối soát có giá vốn — con số chỉ đại diện phần đó, nhập đủ giá vốn để tin được.` };
  }
  if (be.negativeMargin) {
    return { verdict: "loss", reason: "Bán đang lỗ trước cả quảng cáo — ROI nào cũng lỗ. Xem lại giá bán, giá vốn, phí sàn trước khi chạy." };
  }
  if (be.orders < MIN_ORDERS_FOR_MARGIN) {
    return { verdict: "low_sample", reason: `Mới ${be.orders} đơn đã đối soát (cần từ ${MIN_ORDERS_FOR_MARGIN}) — con số còn dao động, xem để tham khảo.` };
  }
  const bad = campaigns.find((c) => c.status === "ongoing" && c.roasTarget != null && be.breakevenRoi != null && c.roasTarget < be.breakevenRoi);
  if (bad && be.breakevenRoi != null) {
    return {
      verdict: "target_below",
      reason:
        `Chiến dịch "${bad.name}" đang đặt ROI mục tiêu ${roi(bad.roasTarget as number)}, thấp hơn hòa vốn ${roi(be.breakevenRoi)} của sản phẩm — đạt mục tiêu vẫn lỗ` +
        `${lossAt(be.margin, bad.roasTarget as number)}. Nâng ROI mục tiêu lên ít nhất ${roi(be.breakevenRoi)}.`,
    };
  }
  if (be.breakevenRoi == null) return { verdict: "ok", reason: "" };
  // Đang chạy với mục tiêu TRÊN hòa vốn: nói luôn đạt mục tiêu thì còn lãi bao nhiêu — con số để khách tự cân giữa lãi mỗi đơn và
  // độ rộng phân phối. Không phán "nên hạ" theo một bội số tự đặt (không có căn cứ nào cho bội số đó).
  const running = campaigns.find((c) => c.status === "ongoing" && c.roasTarget != null);
  const keep = running && be.margin != null ? profitPer100AtRoi(be.margin, running.roasTarget as number) : null;
  if (running && keep != null) {
    return {
      verdict: "ok",
      reason:
        `Chiến dịch "${running.name}" đang đặt ROI mục tiêu ${roi(running.roasTarget as number)}, trên hòa vốn ${roi(be.breakevenRoi)}: đạt đúng mục tiêu thì mỗi 100đ doanh thu còn lãi khoảng ${roi(keep)}đ sau quảng cáo. ` +
        `Hạ mục tiêu thì TikTok phân phối rộng hơn nhưng lãi mỗi đơn mỏng đi — đừng đặt dưới ${roi(be.breakevenRoi)}.`,
    };
  }
  return { verdict: "ok", reason: `Đặt ROI mục tiêu từ ${roi(be.breakevenRoi)} trở lên thì quảng cáo không ăn vào vốn.` };
}

export interface ProductBreakevenRow {
  productId: string;
  name: string;
  imageUrl: string | null;
  skuCount: number;
  /** Doanh thu đã có kết cục cuối và có giá vốn (mẫu số của biên lãi). */
  revenue: number;
  /** Lãi trước quảng cáo trên phần doanh thu đó (đã cộng ngược phí GMV Max). */
  profitBeforeAds: number;
  /** Doanh thu đã có kết cục cuối nhưng THIẾU giá vốn — không vào phép tính, hiện riêng để khách thấy mình đang bỏ sót bao nhiêu. */
  missingCostRevenue: number;
  /** Đà bán: số sản phẩm bán ra (mọi đơn đặt trừ hủy) 7 và 30 ngày gần nhất. */
  units7d: number;
  units30d: number;
  /** Tồn TRÊN SÀN cộng các phân loại (ChannelProduct.channelStock); null = Hubsell chưa đọc được tồn của sản phẩm này. */
  stock: number | null;
  breakeven: TiktokBreakeven;
  /** Chiến dịch GMV Max đang chứa sản phẩm này (theo danh sách sản phẩm Hubsell đã lưu của từng chiến dịch). */
  campaigns: ProductCampaignRef[];
  verdict: ProductBreakevenVerdict;
  reason: string;
  /** Sản phẩm CHƯA nằm trong chiến dịch đang chạy + hòa vốn đã tin được → Nên chạy / Chạy thử / Chưa nên (product-run-advice.ts); còn lại null. */
  runAdvice: ProductRunAdvice | null;
}

export interface ChannelProductBreakevens {
  shop: TiktokBreakeven;
  windowDays: number;
  products: ProductBreakevenRow[];
}

/** Hòa vốn từng sản phẩm của một gian TikTok. Chỉ liệt kê sản phẩm CÓ đơn trong cửa sổ (kể cả đơn chưa đối soát). (Có nhớ đệm 45 giây.) */
const productBreakevenMemo = new Map<number, ReturnType<typeof memoizeByChannel<ChannelProductBreakevens>>>();
export function computeTiktokProductBreakevens(channel: { id: string; userId: string }, minCoveragePct: number): Promise<ChannelProductBreakevens> {
  let memo = productBreakevenMemo.get(minCoveragePct);
  if (!memo) productBreakevenMemo.set(minCoveragePct, (memo = memoizeByChannel((c) => computeTiktokProductBreakevensUncached(c, minCoveragePct))));
  return memo(channel);
}

async function computeTiktokProductBreakevensUncached(channel: { id: string; userId: string }, minCoveragePct: number): Promise<ChannelProductBreakevens> {
  const { rows, campaigns, channelProducts, skusByProductId } = await loadBreakevenInputs(channel);
  const groupOfSku = new Map<string, string>();
  for (const [productId, skus] of skusByProductId) for (const sku of skus) groupOfSku.set(sku, productId);
  const info = new Map<string, { name: string; imageUrl: string | null }>();
  for (const cp of channelProducts) {
    const productId = (cp.externalId ?? "").split("-")[0];
    if (!productId) continue;
    const cur = info.get(productId);
    if (!cur) info.set(productId, { name: cp.productName, imageUrl: cp.imageUrl });
    else if (!cur.imageUrl && cp.imageUrl) cur.imageUrl = cp.imageUrl;
  }
  const stockOf = new Map<string, number>();
  for (const cp of channelProducts) {
    const productId = (cp.externalId ?? "").split("-")[0];
    if (productId && cp.channelStock != null) stockOf.set(productId, (stockOf.get(productId) ?? 0) + cp.channelStock);
  }
  const pace = salesPaceByGroup(rows, groupOfSku, new Date());
  const campaignsOf = new Map<string, ProductCampaignRef[]>();
  for (const c of campaigns) {
    const ref = { id: c.id, name: c.name, status: c.status, roasTarget: c.roasTarget != null ? Number(c.roasTarget) : null };
    for (const productId of c.itemIds ? c.itemIds.split(",") : []) {
      const list = campaignsOf.get(productId) ?? [];
      list.push(ref);
      campaignsOf.set(productId, list);
    }
  }

  // Quảng cáo GMV Max của CẢ GIAN 30 ngày gần nhất (số TikTok báo, đã lưu DB) — mốc "ROI gian thực tế đạt được" của nhận định Nên chạy.
  const adsFrom = vnDateKey(RUN_ADVICE_ADS_DAYS - 1);
  let shopAdsSpend30d = 0;
  let shopAdsGmv30d = 0;
  for (const c of campaigns)
    for (const d of c.dailyPerf) {
      if (dateKey(d.date) < adsFrom) continue;
      shopAdsSpend30d += Number(d.expense);
      shopAdsGmv30d += Number(d.broadGmv);
    }

  const products: ProductBreakevenRow[] = [];
  for (const [productId, base] of tiktokBreakevenBaseByGroup(rows, groupOfSku)) {
    const breakeven = toTiktokBreakeven(base, "product");
    // Chiến dịch đang chạy đứng trước để cột "Đang chạy ở" và kết luận nhìn vào đúng chỗ đang tiêu tiền.
    const camps = (campaignsOf.get(productId) ?? []).sort((a, b) => Number(b.status === "ongoing") - Number(a.status === "ongoing"));
    const v = productBreakevenVerdict(breakeven, camps, minCoveragePct);
    products.push({
      productId,
      name: info.get(productId)?.name ?? "",
      imageUrl: info.get(productId)?.imageUrl ?? null,
      skuCount: skusByProductId.get(productId)?.size ?? 0,
      revenue: base.revenue,
      profitBeforeAds: base.profitBeforeAds,
      missingCostRevenue: base.missingCostRevenue,
      units7d: pace.get(productId)?.units7d ?? 0,
      units30d: pace.get(productId)?.units30d ?? 0,
      stock: stockOf.get(productId) ?? null,
      breakeven,
      campaigns: camps,
      ...v,
      runAdvice:
        v.verdict === "ok" && breakeven.margin != null && breakeven.breakevenRoi != null && !camps.some((c) => c.status === "ongoing")
          ? productRunAdvice({
              margin: breakeven.margin,
              breakevenRoi: breakeven.breakevenRoi,
              units7d: pace.get(productId)?.units7d ?? 0,
              units30d: pace.get(productId)?.units30d ?? 0,
              stock: stockOf.get(productId) ?? null,
              shopAdsSpend30d,
              shopAdsGmv30d,
            })
          : null,
    });
  }
  // Bán nhiều đứng trước — tính cả phần doanh thu thiếu giá vốn, để sản phẩm bán chạy mà chưa nhập giá vốn không chìm xuống đáy.
  const sold = (p: ProductBreakevenRow) => p.revenue + p.missingCostRevenue;
  products.sort((a, b) => sold(b) - sold(a) || b.breakeven.pendingOrders - a.breakeven.pendingOrders);
  return { shop: toTiktokBreakeven(tiktokBreakevenBase(rows, null), "shop"), windowDays: TIKTOK_MARGIN_WINDOW_DAYS, products };
}
