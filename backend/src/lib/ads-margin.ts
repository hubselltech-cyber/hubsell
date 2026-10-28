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
//     (marginsFromRows, đường "rows": lưới đỡ + công cụ đối chiếu) và tra kết
//     quả đã gom trong database (marginsFromGroups, đường "sql", mặc định).
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
  /** `itemId` = SPU của dòng (sổ dòng hàng, từ OrderItem.externalId — Lát 1a); null/bỏ trống = dòng chưa có id → khớp theo mã. */
  items: { sku: string; itemId?: string | null; price: number; quantity: number; costPriceAtSale: number }[];
}

/** Phanh số đơn của cửa sổ biên lãi một gian khi giữ dòng gọn trong RAM. Chỉ đường "rows" còn dùng. */
export const MARGIN_MAX_ORDERS = 20_000;

/**
 * Nơi cộng biên lãi của Trợ lý quảng cáo Shopee/Lazada: "sql" = GROUP BY trên sổ
 * dòng hàng (mặc định từ 30/09/2026); "rows" = duyệt mảng dòng gọn đọc từ sổ cái
 * (lưới đỡ khi câu gom lỗi, công cụ đối chiếu, test). Công tắc env
 * ADS_MARGIN_SOURCE đã gỡ 14/10/2026.
 */
export type AdsMarginSource = "rows" | "sql";

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
export function marginOverRows(rows: MarginRow[], skuSet: ReadonlySet<string> | null): MarginBase {
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
          .filter((it) => lineInGroup(it, skuSet))
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
/** Tiền tố khóa nhóm sản phẩm — phần sau tiền tố là item_id / product id của sàn. */
export const PRODUCT_GROUP_PREFIX = "p:";

/** Nhóm của một chiến dịch (AdsCampaign.id) = mọi SKU của các sản phẩm nằm trong chiến dịch. */
export const campaignGroupKey = (campaignRowId: string): string => `${CAMPAIGN_GROUP_PREFIX}${campaignRowId}`;

/** Nhóm của một sản phẩm sàn (item_id) = mọi SKU phân loại của sản phẩm. */
export const productGroupKey = (itemId: string): string => `${PRODUCT_GROUP_PREFIX}${itemId}`;

/**
 * Khóa nhóm → tập KHÓA DÒNG HÀNG của nhóm. Không chứa SHOP_GROUP (nhóm đó là mọi dòng).
 *
 * ★ "ID TRƯỚC, MÃ SAU" (Lát 1b, 18/10/2026 — docs/MO-HINH-CAY-SAN-PHAM-SAN.md B4): một tập chứa hai loại khóa —
 *   · `"i:<itemId>"` (itemKey): SPU của sàn — mọi dòng hàng CÓ id lá (OrderItem.externalId, từ Lát 1a) khớp CHỈ bằng khóa này;
 *   · mã SKU sàn thô: đường lui cho dòng hàng CHƯA có id (đơn trước 18/10, Lazada).
 * Dòng có id mà SPU không thuộc nhóm thì KHÔNG khớp dù mã trùng — id là danh tính, mã chỉ là chữ. Nhờ vậy đơn của sản phẩm
 * khác dùng chung mã không bị kéo vào, và đơn về trước khi danh mục có lá vẫn gom đúng khi sổ có itemId.
 */
export type AdsGroupSets = Map<string, Set<string>>;

const ITEM_KEY_PREFIX = "i:";

/** Khóa nhóm của một SPU trong tập khóa dòng hàng. Mã SKU thô không bao giờ bắt đầu bằng "i:" (sàn không cho dấu ":" trong mã). */
export const itemKey = (itemId: string): string => `${ITEM_KEY_PREFIX}${itemId}`;

/** Khóa của MỘT dòng hàng: có SPU → "i:<itemId>", không có → mã SKU thô. Cùng công thức với COALESCE('i:' || itemId, channelSku) trong SQL. */
export function lineGroupKey(it: { sku: string; itemId?: string | null }): string {
  return it.itemId ? itemKey(it.itemId) : it.sku;
}

/** Dòng hàng có thuộc nhóm không — id trước, mã sau. */
export function lineInGroup(it: { sku: string; itemId?: string | null }, keys: ReadonlySet<string>): boolean {
  return keys.has(lineGroupKey(it));
}

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
 * Bộ nhóm của một gian: mỗi sản phẩm sàn một nhóm = khóa SPU + mã các lá; mỗi chiến dịch một nhóm = hợp của các item trong
 * itemIds (khóa SPU của từng item KỂ CẢ item chưa có trong danh mục — dòng đơn mang id vẫn gom đúng; mã các lá đã biết làm
 * đường lui); chiến dịch chưa biết item → tập rỗng. Thuần.
 */
export function buildAdsGroupSets(
  skusByItemId: ReadonlyMap<string, Set<string>>,
  campaigns: Iterable<{ id: string; itemIds: string }>
): AdsGroupSets {
  const sets: AdsGroupSets = new Map();
  for (const [itemId, skus] of skusByItemId) sets.set(productGroupKey(itemId), new Set([itemKey(itemId), ...skus]));
  for (const c of campaigns) {
    const keys = new Set<string>();
    for (const itemId of c.itemIds ? c.itemIds.split(",").filter(Boolean) : []) {
      keys.add(itemKey(itemId));
      for (const sku of skusByItemId.get(itemId) ?? []) keys.add(sku);
    }
    sets.set(campaignGroupKey(c.id), keys);
  }
  return sets;
}

/**
 * Bộ nhóm ở dạng gửi được vào câu SQL: hai mảng song song (nhóm, khóa dòng hàng) + khoảng tự kiểm theo cặp + dấu vân tay để
 * nhận biết bộ nhóm / khoảng tự kiểm đổi (khoảng đổi mỗi khi sang ngày mới).
 */
export interface AdsGroupMapping {
  groups: string[];
  /** Khóa dòng hàng: "i:<itemId>" hoặc mã SKU thô (xem AdsGroupSets). */
  keys: string[];
  /** Ngày đầu tự kiểm của nhóm ở cùng vị trí ("" = nhóm không tự kiểm). */
  checkFrom: string[];
  /** Ngày cuối tự kiểm chung ("" = không tự kiểm). */
  checkTo: string;
  digest: string;
}

/** Trải bộ nhóm (+ khoảng tự kiểm) thành các cặp (nhóm, khóa) xếp thứ tự cố định — cùng đầu vào luôn ra cùng `digest`. */
export function adsGroupMappingOf(sets: AdsGroupSets, checks?: MarginCheckWindows): AdsGroupMapping {
  const pairs: [string, string][] = [];
  for (const [group, keys] of sets) for (const key of keys) pairs.push([group, key]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const hash = createHash("sha1");
  for (const [group, key] of pairs) hash.update(`${group}\u0000${key}\u0001`);
  if (checks) {
    hash.update(`\u0002${checks.to}`);
    for (const [group, from] of [...checks.from].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      hash.update(`\u0002${group}\u0000${from}`);
    }
  }
  return {
    groups: pairs.map((p) => p[0]),
    keys: pairs.map((p) => p[1]),
    checkFrom: pairs.map((p) => checks?.from.get(p[0]) ?? ""),
    checkTo: checks?.to ?? "",
    digest: hash.digest("hex"),
  };
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
  itemByKey: ReadonlyMap<string, string>,
  nowMs: number = Date.now()
): Map<string, GroupSalesPace> {
  const since7 = nowMs - SALES_PACE_RECENT_MS;
  const sales = new Map<string, GroupSalesPace>();
  for (const row of rows) {
    const recent = new Date(row.createdAt).getTime() >= since7;
    for (const it of row.items) {
      const itemId = itemByKey.get(lineGroupKey(it));
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

// ------------------------------------------------------------
// TỰ KIỂM DOANH THU VỚI SÀN — Lát 4 (18/10/2026, docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 10)
// ------------------------------------------------------------
//
// Shopee CPC chỉ báo doanh thu GÁN CHO QUẢNG CÁO: broad_gmv gom cả sản phẩm khác trong gian (không so được), direct_gmv = đơn
// của chính sản phẩm quảng cáo → là CẬN DƯỚI hợp lệ: doanh thu Hubsell thấy cho các sản phẩm của chiến dịch (mọi đơn đặt, cùng
// những ngày) không thể thấp hơn số sàn gán trực tiếp cho chúng. Thấp hơn rõ rệt = cây sản phẩm Hubsell thiếu đơn (ca TC025
// 18/10) → hòa vốn chưa tin được. Chiều cao hơn là bình thường (đơn tự nhiên) → KHÔNG kiểm. TikTok từng so hai chiều với
// doanh thu gán cho chiến dịch — đã BỎ 28/10/2026 (khách xoay sản phẩm giữa chiến dịch + LIVE thì TikTok lệch 2–6× dù biên
// lãi đúng); TikTok nay đo lỗi cây trực tiếp bằng unlinkedRevenue (lib/tiktok-breakeven.ts đầu tệp). Shopee giữ phép một
// chiều này tới khi đo lại (PROGRESS 28/10 tối).

/** Khoảng tự kiểm: mỗi nhóm (chiến dịch) một ngày đầu riêng (ngày đầu có số sàn), chung ngày cuối (hết hôm qua). */
export interface MarginCheckWindows {
  /** campaignGroupKey → "YYYY-MM-DD". */
  from: ReadonlyMap<string, string>;
  to: string;
}

export interface MarginCheck {
  /** Doanh thu MỌI đơn đặt Hubsell thấy cho sản phẩm của chiến dịch trong [from, to]. */
  revenuePlaced: number;
  /** Doanh thu sàn gán TRỰC TIẾP cho chính các sản phẩm đó (Shopee direct_gmv) cùng khoảng ngày. */
  platformDirectGmv: number;
  from: string;
  to: string;
}

/**
 * Ngưỡng lệch tự kiểm doanh thu Shopee (một chiều, marginCheckProblem): 25% — MẶC ĐỊNH TỰ CHỌN (anh Trung chốt 18/10/2026), chưa
 * có số nào của sàn. Căn cứ đo prod 18/10: Shopee 95 chiến dịch đang chạy: 74 ≥ 100%, 8 ở 80–100% (nhiễu gán ngày: sàn ghi đơn về
 * ngày bấm quảng cáo), 3 ở 64–74% (ca thật), còn lại gian ngủ đông. 25% chừa đủ vùng nhiễu mà vẫn bắt được lỗi cây.
 * TikTok không còn dùng số này từ 28/10/2026 (xem chú thích trên).
 */
export const BREAKEVEN_CHECK_MAX_GAP_PCT = 25;

/** Lý do hòa vốn chưa tin được theo tự kiểm một chiều; "" = ổn hoặc không có gì để so. Thuần. */
export function marginCheckProblem(check: MarginCheck | null | undefined): string {
  if (!check || !(check.platformDirectGmv > 0)) return "";
  const floor = check.platformDirectGmv * (1 - BREAKEVEN_CHECK_MAX_GAP_PCT / 100);
  if (check.revenuePlaced >= floor) return "";
  const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
  const pct = Math.round((check.revenuePlaced / check.platformDirectGmv) * 100);
  return `Hubsell chỉ thấy ${pct}% doanh thu sàn gán trực tiếp cho sản phẩm của chiến dịch (${vnd(check.revenuePlaced)} so với ${vnd(check.platformDirectGmv)}) — dòng đơn chưa nối đúng sản phẩm, hòa vốn chưa tin được`;
}

/**
 * Doanh thu MỌI đơn đặt (kể cả hủy / đang giao / chưa đối soát) trên một nhóm khóa, ngày tạo (giờ VN) trong [from, to], chia theo
 * tỷ trọng giá trị hàng — cùng luật với cột actualRevenue của sổ dòng hàng (dòng giá 0 nhận 0). Dùng chung Shopee và TikTok. Thuần.
 */
export function placedRevenueOf(
  rows: { createdAt: Date; actualRevenue: number; items: { sku: string; itemId?: string | null; price: number; quantity: number }[] }[],
  keys: ReadonlySet<string>,
  from: string,
  to: string
): number {
  let sum = 0;
  for (const row of rows) {
    const day = new Date(new Date(row.createdAt).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    if (day < from || day > to) continue;
    const itemTotal = row.items.reduce((s, it) => s + it.price * it.quantity, 0);
    if (itemTotal <= 0) continue;
    const matchTotal = row.items.filter((it) => lineInGroup(it, keys)).reduce((s, it) => s + it.price * it.quantity, 0);
    sum += row.actualRevenue * (matchTotal / itemTotal);
  }
  return sum;
}

/** Biên lãi + nhịp bán của mọi nhóm của một gian — cùng mặt tiền cho hai đường cộng. */
export interface ChannelMargins {
  /** SHOP_GROUP, campaignGroupKey(...) hoặc productGroupKey(...). Nhóm không có đơn → toàn 0, độ phủ null. */
  base(groupKey: string): MarginBase;
  /** Theo item_id; chỉ có item có dòng hàng trong cửa sổ. */
  productPace(): Map<string, GroupSalesPace>;
  /** Tự kiểm: doanh thu mọi đơn đặt của nhóm trong khoảng ngày riêng của nó (0 = không có khoảng / không có đơn). */
  placedRevenue(groupKey: string): number;
}

const EMPTY_MARGIN_BASE: MarginBase = Object.freeze(marginOverRows([], null));

/**
 * Đường "rows": cộng trên mảng đơn đã lọc theo sàn (pnlRowsForMargin). `nowMs` = mốc "bây giờ" của nhịp bán. `checks` + `allRows`
 * (MỌI đơn, chưa lọc hủy / chưa đối soát) cho tự kiểm — bỏ trống thì placedRevenue dùng `rows` (test cũ) hoặc trả 0 khi không có khoảng.
 */
export function marginsFromRows(
  rows: MarginRow[],
  sets: AdsGroupSets,
  nowMs?: number,
  checks?: MarginCheckWindows,
  allRows?: MarginRow[]
): ChannelMargins {
  return {
    base(groupKey) {
      if (groupKey === SHOP_GROUP) return marginOverRows(rows, null);
      const skus = sets.get(groupKey);
      return skus && skus.size > 0 ? marginOverRows(rows, skus) : EMPTY_MARGIN_BASE;
    },
    placedRevenue(groupKey) {
      const from = checks?.from.get(groupKey);
      const keys = sets.get(groupKey);
      return from && checks && keys && keys.size > 0 ? placedRevenueOf(allRows ?? rows, keys, from, checks.to) : 0;
    },
    productPace() {
      // Khóa dòng hàng → sản phẩm: "i:<itemId>" là chính nó; mã SKU sàn chỉ thuộc một sản phẩm (ChannelProduct unique theo gian + SKU).
      const itemByKey = new Map<string, string>();
      for (const [groupKey, keys] of sets) {
        if (!groupKey.startsWith(PRODUCT_GROUP_PREFIX)) continue;
        const itemId = groupKey.slice(PRODUCT_GROUP_PREFIX.length);
        for (const key of keys) itemByKey.set(key, itemId);
      }
      return salesPaceByItem(rows, itemByKey, nowMs);
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
  /** Tự kiểm: doanh thu mọi đơn đặt của nhóm trong khoảng ngày riêng (0 = nhóm không tự kiểm). */
  placedRevenue: number;
}

/**
 * Hai mảng song song (nhóm, khóa dòng hàng "i:<itemId>" | mã SKU thô); một khóa được thuộc nhiều nhóm. `checkFrom` (cùng vị trí,
 * "" = nhóm không tự kiểm) + `checkTo` cho phần tự kiểm — bỏ trống = không tự kiểm.
 */
export interface LedgerMarginMapping {
  groups: readonly string[];
  keys: readonly string[];
  checkFrom?: readonly string[];
  checkTo?: string;
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
  placedRevenue: number;
}

/** Số thô của câu gom → biên lãi + nhịp bán của nhóm. */
export function marginGroupStatsOf(raw: LedgerMarginGroup): MarginGroupStats {
  return {
    base: marginBaseFromSums(raw),
    pace: { units30d: raw.units, units7d: raw.unitsRecent, unitsNoCost: raw.unitsNoCost },
    placedRevenue: raw.placedRevenue,
  };
}

/** Đường "sql": tra trong kết quả đã gom sẵn. */
export function marginsFromGroups(groups: ReadonlyMap<string, MarginGroupStats>): ChannelMargins {
  return {
    base: (groupKey) => groups.get(groupKey)?.base ?? EMPTY_MARGIN_BASE,
    placedRevenue: (groupKey) => groups.get(groupKey)?.placedRevenue ?? 0,
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
