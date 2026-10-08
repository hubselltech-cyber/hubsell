// ============================================================
// HÒA VỐN QUẢNG CÁO TikTok (GMV Max) — LUẬT + MẶT TIỀN HAI ĐƯỜNG CỘNG
// (thuần, không gọi DB — docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 12)
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
//
// Hai đường cộng cho cùng một kết quả:
//   "rows": duyệt mảng đơn trong RAM (các hàm thuần ở đây) — có phanh số đơn;
//   "sql" : GROUP BY trên sổ dòng hàng (ledgerTiktokBreakevenByGroup ở
//           services/order-ledger.ts) — đủ mọi đơn.
// Nạp dữ liệu + bộ đệm: integrations/tiktok-ads/breakeven-source.ts.
// Ghép số thành kết luận: integrations/tiktok-ads/breakeven.ts.
// ============================================================

import { createHash } from "crypto";
import { ShippingStatus } from "@prisma/client";
import { startOfDaysAgo } from "./ads-dates";
import { PRODUCT_GROUP_PREFIX, SHOP_GROUP, adsGroupMappingOf, type AdsGroupSets } from "./ads-margin";
import type { DateRangeFilter } from "./date-range";

/** Cửa sổ lấy đơn (theo ngày tạo) — dài hơn Shopee vì chỉ đơn ĐÃ ĐỐI SOÁT mới được tính. Mặc định chọn, không phải số của sàn. */
export const TIKTOK_MARGIN_WINDOW_DAYS = 60;

/**
 * Khóa giữa hai nấc hạ ROI mục tiêu của TikTok = 72 giờ: tài liệu "Best practices for Product GMV Max" (ads.tiktok.com/help, đọc
 * 08/10/2026): "Keep each ROI setting for at least three full days before making adjustments." (Shopee giữ 48 giờ — anh Trung
 * chọn 04/10.) Đặt ở lib thuần để breakeven.ts và campaign-advice.ts cùng dùng mà không vòng import.
 */
export const TIKTOK_TARGET_STEP_WAIT_HOURS = 72;

/** Cửa sổ hòa vốn tính tới lúc gọi: TIKTOK_MARGIN_WINDOW_DAYS ngày, theo ngày tạo đơn. */
export function tiktokMarginWindowRange(): DateRangeFilter {
  return { gte: startOfDaysAgo(TIKTOK_MARGIN_WINDOW_DAYS), lte: new Date() };
}

/** Phanh số đơn khi giữ đơn 60 ngày của một gian trong RAM. Chỉ đường "rows" còn dùng. */
export const TIKTOK_BREAKEVEN_MAX_ORDERS = 8000;

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

const emptyBreakevenBase = (): BreakevenBase => ({
  settledOrders: 0,
  cancelledOrders: 0,
  revenue: 0,
  profitBeforeAds: 0,
  adFee: 0,
  missingCostRevenue: 0,
  pendingOrders: 0,
});

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
export function tiktokBreakevenBase(rows: BreakevenPnlRow[], skuSet: ReadonlySet<string> | null): BreakevenBase {
  const base = emptyBreakevenBase();
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
export function tiktokBreakevenBaseByGroup(rows: BreakevenPnlRow[], groupOfSku: ReadonlyMap<string, string>): Map<string, BreakevenBase> {
  const out = new Map<string, BreakevenBase>();
  const baseOf = (g: string) => {
    let b = out.get(g);
    if (!b) out.set(g, (b = emptyBreakevenBase()));
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
export function placedRevenue(rows: BreakevenPnlRow[], skuSet: ReadonlySet<string>, from: string, to: string): number {
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

/** Đà bán của một nhóm SKU: số sản phẩm bán ra 7 ngày và 30 ngày gần nhất. */
export interface TiktokSalesPace {
  units7d: number;
  units30d: number;
}

/** Hai mốc lùi của đà bán, tính từ lúc tính. */
export const TIKTOK_PACE_RECENT_MS = 7 * 86_400_000;
export const TIKTOK_PACE_WINDOW_MS = 30 * 86_400_000;

/**
 * ĐÀ BÁN từng nhóm SKU: số sản phẩm bán ra 7 ngày và 30 ngày gần nhất, tính trên MỌI đơn đặt trừ đơn hủy (đây là nhịp bán,
 * không phải lãi — không cần chờ đối soát). Thuần.
 */
export function salesPaceByGroup(rows: BreakevenPnlRow[], groupOfSku: ReadonlyMap<string, string>, now: Date): Map<string, TiktokSalesPace> {
  const out = new Map<string, TiktokSalesPace>();
  const t7 = now.getTime() - TIKTOK_PACE_RECENT_MS;
  const t30 = now.getTime() - TIKTOK_PACE_WINDOW_MS;
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

// ------------------------------------------------------------
// Bộ nhóm của một gian TikTok + khoảng ngày tự kiểm của từng chiến dịch
// ------------------------------------------------------------
//
// Bộ nhóm dùng chung khuôn với Shopee/Lazada (lib/ads-margin.ts): nhóm toàn gian
// SHOP_GROUP, mỗi chiến dịch campaignGroupKey(AdsCampaign.id), mỗi sản phẩm
// productGroupKey(product id) — externalId TikTok = "productId-skuId", productId
// chính là item_group_id của report GMV Max.

/**
 * Khoảng ngày (ngày sàn, giờ VN) của phép tự kiểm mẫu số: mỗi chiến dịch một
 * ngày đầu riêng (ngày đầu Hubsell CÓ số TikTok của chiến dịch), chung ngày cuối
 * (hết hôm qua — hôm nay còn dở). Chiến dịch chưa có số thì không có trong `from`.
 */
export interface TiktokCheckWindows {
  /** campaignGroupKey → "YYYY-MM-DD" ngày đầu. */
  from: ReadonlyMap<string, string>;
  /** "YYYY-MM-DD" ngày cuối, chung mọi chiến dịch. */
  to: string;
}

/** Phép tự kiểm của một chiến dịch: ngày đầu Hubsell có số TikTok + doanh thu TikTok báo từ ngày đó tới hết `to`. */
export interface TiktokCampaignCheck {
  from: string;
  tiktokGmv: number;
}

/** Từ số quảng cáo theo ngày đã lưu của một chiến dịch (ngày sàn "YYYY-MM-DD") → phép tự kiểm tới hết `to`; null = chưa có ngày nào. Thuần. */
export function tiktokCampaignCheckOf(perf: Iterable<{ day: string; gmv: number }>, to: string): TiktokCampaignCheck | null {
  let from = "";
  let tiktokGmv = 0;
  for (const p of perf) {
    if (p.day > to) continue;
    if (from === "" || p.day < from) from = p.day;
    tiktokGmv += p.gmv;
  }
  return from ? { from, tiktokGmv } : null;
}

/** Bộ nhóm ở dạng gửi được vào câu SQL (LedgerTiktokBreakevenMapping) + dấu vân tay để nhận biết bộ nhóm / khoảng tự kiểm đổi. */
export interface TiktokGroupMapping extends LedgerTiktokBreakevenMapping {
  groups: string[];
  skus: string[];
  checkFrom: string[];
  digest: string;
}

/** Trải bộ nhóm + khoảng tự kiểm thành mảng song song xếp thứ tự cố định — cùng đầu vào luôn ra cùng `digest`. */
export function tiktokGroupMappingOf(sets: AdsGroupSets, checks: TiktokCheckWindows): TiktokGroupMapping {
  const { groups, skus, digest } = adsGroupMappingOf(sets);
  const hash = createHash("sha1").update(`${digest}\u0002${checks.to}`);
  for (const [group, from] of [...checks.from].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    hash.update(`\u0002${group}\u0000${from}`);
  }
  return {
    groups,
    skus,
    checkFrom: groups.map((g) => checks.from.get(g) ?? ""),
    checkTo: checks.to,
    digest: hash.digest("hex"),
  };
}

// ------------------------------------------------------------
// Mặt tiền chung của hai đường cộng
// ------------------------------------------------------------

/** Nguyên liệu hòa vốn + tự kiểm + đà bán của mọi nhóm của một gian — cùng mặt tiền cho hai đường cộng. */
export interface ChannelBreakevens {
  /** SHOP_GROUP, campaignGroupKey(...) hoặc productGroupKey(...). Nhóm không có đơn → toàn 0. */
  base(groupKey: string): BreakevenBase;
  /** Tự kiểm mẫu số của một chiến dịch: doanh thu mọi đơn đặt của nhóm trong khoảng ngày riêng của nó (0 = không có khoảng). */
  placedRevenue(groupKey: string): number;
  /** Theo product id; chỉ sản phẩm có dòng hàng CÓ GIÁ trong cửa sổ (kể cả đơn chưa đối soát). */
  productBases(): Map<string, BreakevenBase>;
  /** Theo product id; sản phẩm không bán được gì trong 30 ngày có thể vắng mặt hoặc mang số 0. */
  productPace(): Map<string, TiktokSalesPace>;
}

const EMPTY_BREAKEVEN_BASE: BreakevenBase = Object.freeze(emptyBreakevenBase());

/** SKU → product id, từ các nhóm sản phẩm của bộ nhóm. Một SKU sàn chỉ thuộc một sản phẩm (ChannelProduct unique theo gian + SKU). */
function productOfSku(sets: AdsGroupSets): Map<string, string> {
  const out = new Map<string, string>();
  for (const [groupKey, skus] of sets) {
    if (!groupKey.startsWith(PRODUCT_GROUP_PREFIX)) continue;
    const productId = groupKey.slice(PRODUCT_GROUP_PREFIX.length);
    for (const sku of skus) out.set(sku, productId);
  }
  return out;
}

/** Đường "rows": cộng trên mảng MỌI đơn của gian trong cửa sổ. `nowMs` = mốc "bây giờ" của đà bán. */
export function breakevensFromRows(
  rows: BreakevenPnlRow[],
  sets: AdsGroupSets,
  checks: TiktokCheckWindows,
  nowMs: number = Date.now()
): ChannelBreakevens {
  return {
    base(groupKey) {
      if (groupKey === SHOP_GROUP) return tiktokBreakevenBase(rows, null);
      const skus = sets.get(groupKey);
      return skus && skus.size > 0 ? tiktokBreakevenBase(rows, skus) : EMPTY_BREAKEVEN_BASE;
    },
    placedRevenue(groupKey) {
      const from = checks.from.get(groupKey);
      const skus = sets.get(groupKey);
      return from && skus && skus.size > 0 ? placedRevenue(rows, skus, from, checks.to) : 0;
    },
    productBases: () => tiktokBreakevenBaseByGroup(rows, productOfSku(sets)),
    productPace: () => salesPaceByGroup(rows, productOfSku(sets), new Date(nowMs)),
  };
}

// ------------------------------------------------------------
// Đường "sql": hợp đồng với câu gom trong database (services/order-ledger.ts)
// ------------------------------------------------------------

/** Tổng của MỘT nhóm SKU trong cửa sổ, do câu gom trả về. */
export interface LedgerTiktokBreakevenGroup extends BreakevenBase, TiktokSalesPace {
  /** Nhóm có ít nhất một dòng hàng CÓ GIÁ trong cửa sổ (đường "rows" chỉ liệt kê sản phẩm như vậy). */
  hasPaid: boolean;
  /** Doanh thu mọi đơn đặt của nhóm trong khoảng tự kiểm của nhóm (0 = nhóm không tự kiểm). */
  placedRevenue: number;
}

/** Ba mảng song song (nhóm, mã SKU sàn, ngày đầu tự kiểm của nhóm); một SKU được thuộc nhiều nhóm. */
export interface LedgerTiktokBreakevenMapping {
  groups: readonly string[];
  skus: readonly string[];
  /** "YYYY-MM-DD" ngày đầu tự kiểm của nhóm ở cùng vị trí ("" = nhóm không tự kiểm). */
  checkFrom: readonly string[];
  /** "YYYY-MM-DD" ngày cuối tự kiểm, chung mọi nhóm. */
  checkTo: string;
}

export interface LedgerTiktokBreakevenOptions {
  /** Mốc "bây giờ" của đà bán: tính lùi 7 và 30 ngày từ đây. */
  paceNow: Date;
}

/** Đường "sql": tra trong kết quả đã gom sẵn. */
export function breakevensFromGroups(groups: ReadonlyMap<string, LedgerTiktokBreakevenGroup>): ChannelBreakevens {
  const products = function* () {
    for (const [groupKey, g] of groups) {
      if (groupKey.startsWith(PRODUCT_GROUP_PREFIX)) yield [groupKey.slice(PRODUCT_GROUP_PREFIX.length), g] as const;
    }
  };
  const baseOf = (g: LedgerTiktokBreakevenGroup): BreakevenBase => ({
    settledOrders: g.settledOrders,
    cancelledOrders: g.cancelledOrders,
    revenue: g.revenue,
    profitBeforeAds: g.profitBeforeAds,
    adFee: g.adFee,
    missingCostRevenue: g.missingCostRevenue,
    pendingOrders: g.pendingOrders,
  });
  return {
    base(groupKey) {
      const g = groups.get(groupKey);
      return g ? baseOf(g) : EMPTY_BREAKEVEN_BASE;
    },
    placedRevenue: (groupKey) => groups.get(groupKey)?.placedRevenue ?? 0,
    productBases() {
      const out = new Map<string, BreakevenBase>();
      for (const [productId, g] of products()) if (g.hasPaid) out.set(productId, baseOf(g));
      return out;
    },
    productPace() {
      const out = new Map<string, TiktokSalesPace>();
      for (const [productId, g] of products()) out.set(productId, { units7d: g.units7d, units30d: g.units30d });
      return out;
    },
  };
}
