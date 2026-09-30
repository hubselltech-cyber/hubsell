// ============================================================
// BIÊN LÃI QUẢNG CÁO Shopee / Lazada — LUẬT + BỘ NHÓM SKU (thuần, không gọi DB)
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md)
//
// Biên lãi ròng chưa trừ quảng cáo của một nhóm SKU trong cửa sổ 30 ngày là đầu
// vào của ROAS hòa vốn, kết luận của Trợ lý và gợi ý chạy quảng cáo. File này
// giữ phần KHÔNG phụ thuộc nơi cộng:
//   · luật: bỏ đơn hủy, Lazada chỉ đơn đã đối soát, đơn thiếu giá vốn đứng
//     ngoài biên lãi, đơn nhiều SKU phân bổ theo giá trị dòng, ngưỡng độ phủ;
//   · bộ nhóm của một gian: toàn gian, mỗi chiến dịch, mỗi sản phẩm sàn;
//   · mặt tiền ChannelMargins với hai bản — cộng trên mảng đơn trong RAM
//     (marginsFromRows, đường lui "rows") và tra kết quả đã gom trong database
//     (marginsFromGroups, đường "sql").
// Nạp dữ liệu + bộ đệm: integrations/shopee/ads-margin-source.ts.
// Câu SQL gom: services/order-ledger.ts (ledgerMarginByGroup).
// ============================================================

import { createHash } from "crypto";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { startOfDaysAgo } from "./ads-dates";
import type { DateRangeFilter } from "./date-range";

/** Định danh gian truyền vào các phép tính — channelName quyết định luật của sàn. */
export interface AdsInsightChannel {
  id: string;
  userId: string;
  channelName: ChannelName;
}

/** Cửa sổ P&L để ước biên lãi — cố định 30 ngày cho đủ mẫu, KHÔNG theo ?days. */
export const MARGIN_WINDOW_DAYS = 30;

/** Cửa sổ biên lãi tính tới lúc gọi: MARGIN_WINDOW_DAYS ngày, theo ngày tạo đơn. */
export function marginWindowRange(): DateRangeFilter {
  return { gte: startOfDaysAgo(MARGIN_WINDOW_DAYS), lte: new Date() };
}

/**
 * Phần của một dòng Lãi/Lỗ mà các phép tính quảng cáo cần (biên lãi theo tập
 * SKU, nhịp bán, cờ thiếu giá vốn theo dòng hàng). Dòng computePnlRow đầy đủ
 * gán vào được; mặc định dựng từ SỔ CÁI ĐƠN (loadMarginRows ở ads-margin-source).
 */
export interface MarginRow {
  createdAt: Date;
  shippingStatus: ShippingStatus;
  isSettled: boolean;
  /** Doanh thu thực tế của đơn = Giá trị đơn − voucher/xu shop. */
  actualRevenue: number;
  /** Lợi nhuận đơn (chưa trừ quảng cáo). */
  profit: number;
  missingCostPrice: boolean;
  items: { sku: string; price: number; quantity: number; costPriceAtSale: number }[];
}

/** Phanh số đơn của cửa sổ biên lãi một gian — cùng mức với đường cũ (fetchPnlRows). Chỉ đường "rows" còn dùng. */
export const MARGIN_MAX_ORDERS = 20_000;

/**
 * Lọc tập đơn P&L làm NGUYÊN LIỆU biên lãi theo đặc thù nguồn phí của sàn:
 *   - Shopee: giữ cả đơn chờ đối soát — phí trên đơn đã là SỐ ƯỚC TÍNH của
 *     chính sàn (syncShopeePendingEscrowEstimates) nên biên lãi vẫn đúng.
 *   - Lazada: CHỈ đơn ĐÃ đối soát — sàn không có API ước tính phí, đơn chưa
 *     có sao kê mang phí = 0 làm biên lãi ảo cao → ROAS hòa vốn ảo thấp
 *     (quyết định anh Trung 14/08). Logic thuần, EXPORT cho vitest.
 */
export function pnlRowsForMargin<
  T extends { isSettled: boolean; shippingStatus: ShippingStatus },
>(rows: T[], channelName: ChannelName): T[] {
  // LOẠI ĐƠN HỦY (anh Trung 19/08 — ROAS hòa vốn TC025 "bò" 11x → 22x): đơn
  // CANCELLED vẫn mang đủ giá vốn trong computePnlRow (hàng đã hoàn kho nhưng
  // orderCost không thu hồi) + tiền hoàn = full doanh thu → mỗi đơn hủy là một
  // khoản "lỗ ảo" bằng nguyên giá vốn, tích lũy theo thời gian kéo biên lãi
  // 11,9% xuống 4,4%. Tổng quan/Báo cáo dòng tiền đã loại CANCELLED khỏi
  // activeRows — đây phải cùng phạm vi. Đơn HOÀN (returnStatus) vẫn giữ: thất
  // thu thật, vốn tự thu hồi khi nhập kho lại.
  const active = rows.filter((r) => r.shippingStatus !== ShippingStatus.CANCELLED);
  return channelName === ChannelName.LAZADA ? active.filter((r) => r.isSettled) : active;
}

/**
 * Ngưỡng độ phủ giá vốn để TIN biên lãi: ≥ 90% doanh thu (đã lọc theo SKU) phải
 * có giá vốn — cùng số với TikTok (hằng riêng BREAKEVEN_MIN_COVERAGE_PCT ở
 * tiktok-ads/auto-rules).
 * 90 là mặc định chọn: dưới đó biên lãi chỉ đại diện một phần doanh thu.
 */
export const MARGIN_MIN_COST_COVERAGE_PCT = 90;

export interface MarginBase {
  /** Số đơn CÓ giá vốn được tính vào biên lãi. */
  orders: number;
  revenue: number;
  profit: number;
  /** Đơn thiếu giá vốn — BỊ LOẠI khỏi biên lãi (28/09/2026, anh Trung). */
  missingCostOrders: number;
  /** Doanh thu (đã phân bổ theo SKU) của các đơn thiếu giá vốn — để tính độ phủ. */
  missingCostRevenue: number;
  /** % doanh thu có giá vốn; null = chưa có đơn nào. */
  costCoveragePct: number | null;
}

/**
 * Biên lãi trên một tập SKU (null = toàn shop). Đơn nhiều SKU phân bổ doanh
 * thu/lãi theo tỷ trọng giá trị hàng của SKU khớp.
 *
 * ★ 28/09/2026 — ĐƠN THIẾU GIÁ VỐN BỊ LOẠI khỏi cả tử lẫn mẫu (giống TikTok).
 *   Trước đó chúng vẫn được cộng vào: lợi nhuận của đơn giá vốn 0 = doanh thu −
 *   phí sàn, chưa trừ tiền hàng → biên lãi thổi cao → ROAS hòa vốn THẤP hơn
 *   thật, seller tưởng ROAS 3 đã lãi mà thực ra phải 4 mới hòa. Nay doanh thu
 *   của chúng dồn vào missingCostRevenue để báo độ phủ; dưới ngưỡng thì không
 *   kết luận (marginOf trả null).
 */
export function marginOverRows(rows: MarginRow[], skuSet: Set<string> | null): MarginBase {
  let orders = 0;
  let revenue = 0;
  let profit = 0;
  let missingCostOrders = 0;
  let missingCostRevenue = 0;
  for (const row of rows) {
    const itemTotal = row.items.reduce((s, it) => s + it.price * it.quantity, 0);
    if (itemTotal <= 0) continue;
    const matchTotal = skuSet
      ? row.items
          .filter((it) => skuSet.has(it.sku))
          .reduce((s, it) => s + it.price * it.quantity, 0)
      : itemTotal;
    if (matchTotal <= 0) continue;
    const ratio = matchTotal / itemTotal;
    if (row.missingCostPrice) {
      missingCostOrders++;
      missingCostRevenue += row.actualRevenue * ratio;
      continue;
    }
    orders++;
    revenue += row.actualRevenue * ratio;
    profit += row.profit * ratio;
  }
  return marginBaseFromSums({ orders, revenue, profit, missingCostOrders, missingCostRevenue });
}

/** Năm tổng của một nhóm → MarginBase (thêm độ phủ giá vốn). Dùng chung cho cả hai đường cộng. */
export function marginBaseFromSums(sums: Omit<MarginBase, "costCoveragePct">): MarginBase {
  const scoped = sums.revenue + sums.missingCostRevenue;
  return {
    orders: sums.orders,
    revenue: sums.revenue,
    profit: sums.profit,
    missingCostOrders: sums.missingCostOrders,
    missingCostRevenue: sums.missingCostRevenue,
    costCoveragePct: scoped > 0 ? Math.round((sums.revenue / scoped) * 100) : null,
  };
}

/** Biên lãi từ MarginBase — null khi chưa có đơn có giá vốn hoặc độ phủ dưới ngưỡng. */
export function marginOf(base: MarginBase): number | null {
  if (base.orders === 0 || base.revenue <= 0) return null;
  if ((base.costCoveragePct ?? 0) < MARGIN_MIN_COST_COVERAGE_PCT) return null;
  return base.profit / base.revenue;
}

/** Độ phủ dưới ngưỡng → biên lãi bị giữ lại (để giao diện nói "chưa đủ giá vốn"). */
export function lowCostCoverage(base: MarginBase): boolean {
  return base.costCoveragePct != null && base.costCoveragePct < MARGIN_MIN_COST_COVERAGE_PCT;
}

// ------------------------------------------------------------
// Bộ nhóm SKU của một gian
// ------------------------------------------------------------

/** Nhóm "mọi dòng hàng của gian" — câu gom trong database luôn trả nhóm này. */
export const SHOP_GROUP = "shop";

const CAMPAIGN_GROUP_PREFIX = "c:";
const PRODUCT_GROUP_PREFIX = "p:";

/** Nhóm của một chiến dịch (AdsCampaign.id) = mọi SKU của các sản phẩm nằm trong chiến dịch. */
export const campaignGroupKey = (campaignRowId: string): string => `${CAMPAIGN_GROUP_PREFIX}${campaignRowId}`;

/** Nhóm của một sản phẩm sàn (item_id) = mọi SKU phân loại của sản phẩm. */
export const productGroupKey = (itemId: string): string => `${PRODUCT_GROUP_PREFIX}${itemId}`;

/** Khóa nhóm → tập mã SKU sàn của nhóm. Không chứa SHOP_GROUP (nhóm đó là mọi dòng). */
export type AdsGroupSets = Map<string, Set<string>>;

/** SKU sàn gom theo item_id — phần trước dấu "-" của externalId ("item" | "item-model"). */
export function groupSkusByItemId(
  channelProducts: { channelSku: string; externalId: string | null }[]
): Map<string, Set<string>> {
  const skusByItemId = new Map<string, Set<string>>();
  for (const cp of channelProducts) {
    const itemId = (cp.externalId ?? "").split("-")[0];
    if (!itemId) continue;
    let set = skusByItemId.get(itemId);
    if (!set) skusByItemId.set(itemId, (set = new Set()));
    set.add(cp.channelSku);
  }
  return skusByItemId;
}

/**
 * Bộ nhóm của một gian: mỗi sản phẩm sàn một nhóm, mỗi chiến dịch một nhóm (hợp
 * SKU của các item trong itemIds; chiến dịch chưa biết SKU → tập rỗng). Thuần.
 */
export function buildAdsGroupSets(
  skusByItemId: ReadonlyMap<string, Set<string>>,
  campaigns: Iterable<{ id: string; itemIds: string }>
): AdsGroupSets {
  const sets: AdsGroupSets = new Map();
  for (const [itemId, skus] of skusByItemId) sets.set(productGroupKey(itemId), skus);
  for (const c of campaigns) {
    const skuSet = new Set<string>();
    for (const itemId of c.itemIds ? c.itemIds.split(",") : []) {
      for (const sku of skusByItemId.get(itemId) ?? []) skuSet.add(sku);
    }
    sets.set(campaignGroupKey(c.id), skuSet);
  }
  return sets;
}

/** Bộ nhóm ở dạng gửi được vào câu SQL: hai mảng song song + dấu vân tay để nhận biết bộ nhóm đổi. */
export interface AdsGroupMapping {
  groups: string[];
  skus: string[];
  digest: string;
}

/** Trải bộ nhóm thành các cặp (nhóm, SKU) xếp thứ tự cố định — cùng bộ nhóm luôn ra cùng `digest`. */
export function adsGroupMappingOf(sets: AdsGroupSets): AdsGroupMapping {
  const pairs: [string, string][] = [];
  for (const [group, skus] of sets) for (const sku of skus) pairs.push([group, sku]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const hash = createHash("sha1");
  for (const [group, sku] of pairs) hash.update(`${group}\u0000${sku}\u0001`);
  return { groups: pairs.map((p) => p[0]), skus: pairs.map((p) => p[1]), digest: hash.digest("hex") };
}

// ------------------------------------------------------------
// Nhịp bán + mặt tiền chung của hai đường cộng
// ------------------------------------------------------------

/** Nhịp bán của một sản phẩm trong cửa sổ biên lãi + lượng bán mà dòng hàng chưa có giá vốn. */
export interface GroupSalesPace {
  units30d: number;
  units7d: number;
  unitsNoCost: number;
}

/** "Gần đây" của nhịp bán: 7 ngày lùi từ lúc tính. */
export const SALES_PACE_RECENT_MS = 7 * 86_400_000;

/**
 * Nhịp bán theo item từ mảng đơn (đường "rows"). Thiếu giá vốn xét theo CHÍNH
 * dòng hàng của sản phẩm — cờ cấp đơn dính cả sản phẩm khác trong đơn. Thuần.
 */
export function salesPaceByItem(
  rows: MarginRow[],
  itemBySku: ReadonlyMap<string, string>,
  nowMs: number = Date.now()
): Map<string, GroupSalesPace> {
  const since7 = nowMs - SALES_PACE_RECENT_MS;
  const sales = new Map<string, GroupSalesPace>();
  for (const row of rows) {
    const recent = new Date(row.createdAt).getTime() >= since7;
    for (const it of row.items) {
      const itemId = itemBySku.get(it.sku);
      if (!itemId) continue;
      let s = sales.get(itemId);
      if (!s) sales.set(itemId, (s = { units30d: 0, units7d: 0, unitsNoCost: 0 }));
      s.units30d += it.quantity;
      if (recent) s.units7d += it.quantity;
      if (!(it.costPriceAtSale > 0)) s.unitsNoCost += it.quantity;
    }
  }
  return sales;
}

/** Biên lãi + nhịp bán của mọi nhóm của một gian — cùng mặt tiền cho hai đường cộng. */
export interface ChannelMargins {
  /** SHOP_GROUP, campaignGroupKey(...) hoặc productGroupKey(...). Nhóm không có đơn → toàn 0, độ phủ null. */
  base(groupKey: string): MarginBase;
  /** Theo item_id; chỉ có item có dòng hàng trong cửa sổ. */
  productPace(): Map<string, GroupSalesPace>;
}

const EMPTY_MARGIN_BASE: MarginBase = Object.freeze(marginOverRows([], null));

/** Đường "rows": cộng trên mảng đơn đã lọc theo sàn (pnlRowsForMargin). `nowMs` = mốc "bây giờ" của nhịp bán. */
export function marginsFromRows(rows: MarginRow[], sets: AdsGroupSets, nowMs?: number): ChannelMargins {
  return {
    base(groupKey) {
      if (groupKey === SHOP_GROUP) return marginOverRows(rows, null);
      const skus = sets.get(groupKey);
      return skus && skus.size > 0 ? marginOverRows(rows, skus) : EMPTY_MARGIN_BASE;
    },
    productPace() {
      // Một SKU sàn chỉ thuộc một sản phẩm (ChannelProduct unique theo gian + SKU).
      const itemBySku = new Map<string, string>();
      for (const [groupKey, skus] of sets) {
        if (!groupKey.startsWith(PRODUCT_GROUP_PREFIX)) continue;
        const itemId = groupKey.slice(PRODUCT_GROUP_PREFIX.length);
        for (const sku of skus) itemBySku.set(sku, itemId);
      }
      return salesPaceByItem(rows, itemBySku, nowMs);
    },
  };
}

// ------------------------------------------------------------
// Đường "sql": hợp đồng với câu gom trong database (services/order-ledger.ts)
// ------------------------------------------------------------

/** Tổng của MỘT nhóm SKU trong cửa sổ (số thô — nơi gọi tự suy ra biên lãi / độ phủ giá vốn). */
export interface LedgerMarginGroup {
  /** Số đơn CÓ giá vốn có dòng hàng thuộc nhóm (một đơn nhiều dòng cùng nhóm đếm một lần). */
  orders: number;
  /** Doanh thu thực tế / lợi nhuận của các đơn đó, phần phân bổ về dòng thuộc nhóm. */
  revenue: number;
  profit: number;
  /** Đơn thiếu giá vốn (cờ cấp đơn) — đứng ngoài biên lãi, chỉ để tính độ phủ. */
  missingCostOrders: number;
  missingCostRevenue: number;
  /** Số lượng bán của nhóm: cả cửa sổ / từ mốc `recentSince` / các dòng giá vốn dòng = 0. */
  units: number;
  unitsRecent: number;
  unitsNoCost: number;
}

/** Hai mảng song song (nhóm, mã SKU sàn); một SKU được thuộc nhiều nhóm. */
export interface LedgerMarginMapping {
  groups: readonly string[];
  skus: readonly string[];
}

export interface LedgerMarginOptions {
  /** Chỉ đơn đã đối soát (Lazada: đơn chưa có sao kê mang phí = 0). */
  settledOnly: boolean;
  /** Mốc "gần đây" của nhịp bán (unitsRecent). */
  recentSince: Date;
}

/** Kết quả gom của một nhóm ở đường "sql". */
export interface MarginGroupStats {
  base: MarginBase;
  pace: GroupSalesPace;
}

/** Số thô của câu gom → biên lãi + nhịp bán của nhóm. */
export function marginGroupStatsOf(raw: LedgerMarginGroup): MarginGroupStats {
  return {
    base: marginBaseFromSums(raw),
    pace: { units30d: raw.units, units7d: raw.unitsRecent, unitsNoCost: raw.unitsNoCost },
  };
}

/** Đường "sql": tra trong kết quả đã gom sẵn. */
export function marginsFromGroups(groups: ReadonlyMap<string, MarginGroupStats>): ChannelMargins {
  return {
    base: (groupKey) => groups.get(groupKey)?.base ?? EMPTY_MARGIN_BASE,
    productPace() {
      const sales = new Map<string, GroupSalesPace>();
      for (const [groupKey, stats] of groups) {
        if (groupKey.startsWith(PRODUCT_GROUP_PREFIX)) {
          sales.set(groupKey.slice(PRODUCT_GROUP_PREFIX.length), stats.pace);
        }
      }
      return sales;
    },
  };
}
