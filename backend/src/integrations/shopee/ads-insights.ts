// ============================================================
// TRỢ LÝ QUẢNG CÁO — LÕI TÍNH TOÁN DÙNG CHUNG (GĐ3 tách từ routes/ads)
//
// Một nguồn duy nhất cho: lát cắt cửa sổ today/3d/7d/30d, biên lãi ròng theo
// SKU campaign (phân bổ tỷ trọng doanh thu, SSOT computePnlRow), ROAS hòa vốn
// và verdict rule engine. BA người dùng:
//   - routes/ads.ts  : dashboard + verdict hiển thị
//   - ads-auto-execute.ts : executor GĐ3 quyết hành động trong worker
//   - ops-alerts.ts  : detector cảnh báo Trung tâm điều hành
// Route và executor mà tự tính riêng thì có ngày hai nơi lệch số — người dùng
// thấy badge "Ổn" nhưng executor lại tạm dừng campaign. Tách ra đây để không bao
// giờ xảy ra chuyện đó.
//
// 12/08/2026: lõi này TRUNG LẬP SÀN — Lazada dùng chung (bảng AdsCampaign/
// DailyPerf/Config chung, chỉ khác channelName khi kéo nền P&L). File vẫn nằm
// integrations/shopee/ vì Shopee đặt nền + đỡ xáo import đang chạy production.
// ============================================================

import { createHash } from "crypto";
import {
  ChannelName,
  ShippingStatus,
  type AdsCampaign,
  type AdsCampaignDailyPerf,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { registerCostCacheInvalidator } from "../../lib/cost-cache-invalidation";
import type { DateRangeFilter } from "../../lib/date-range";
import { fetchPnlRows } from "../../routes/finance";
import { resolveReportSource, type ReportSource } from "../../lib/report-source";
import {
  ensureLedgerFresh,
  ledgerCompactOrders,
  ledgerMarginByGroup,
  LEDGER_MARGIN_SHOP_GROUP,
  type LedgerMarginOptions,
} from "../../services/order-ledger";
import {
  ASSISTANT_WINDOWS,
  assessDelivery,
  assessRoasTarget,
  evaluateShopeeCampaign,
  normalizeAssistantConfig,
  type AssistantAssessment,
  type DeliveryCheck,
  type RoasTargetCheck,
  type AssistantWindowKey,
  type AssistantWindowMetrics,
  type ShopeeAssistantConfig,
} from "./ads-assistant-rules";

/** Cửa sổ P&L để ước biên lãi — cố định 30 ngày cho đủ mẫu, KHÔNG theo ?days. */
export const MARGIN_WINDOW_DAYS = 30;
/** Campaign cần tối thiểu bấy nhiêu đơn khớp SKU mới dùng biên lãi riêng. */
export const MIN_ORDERS_FOR_MARGIN = 5;

export function startOfDaysAgo(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

/** "YYYY-MM-DD" theo UTC — cột @db.Date lưu 00:00 UTC nên đọc bằng UTC mới đúng ngày. */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" của N ngày trước theo GIỜ VN — ngày trong AdsCampaignDailyPerf
 *  là ngày của SÀN (múi giờ VN), server Render chạy UTC nên phải cộng 7h. */
export function vnDateKey(daysAgo: number): string {
  return new Date(Date.now() + 7 * 3600_000 - daysAgo * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// ---- Khoảng ngày của BỘ LỌC trang Trợ lý quảng cáo (24/09/2026) ----
//
// Trang Shopee/Lazada dùng bộ lọc chuẩn của app (?from=&to= theo NGÀY SÀN, giờ
// VN) thay cho 4 nút cứng Hôm nay/7/14/30 ngày. Số hiệu suất đọc từ DB, xung
// ads không dọn dòng cũ nên xem "Tháng trước" là có số thật (từ ngày gian bắt
// đầu kéo). Trần 90 ngày là MẶC ĐỊNH TỰ ĐẶT theo ngân sách RAM sau sự cố OOM
// 09/2026: mỗi campaign một dòng/ngày, gian 150 campaign × 90 ngày ≈ 13.500 dòng
// Decimal một lượt mở trang — không phải giới hạn của sàn, nới được khi cần.
export const ADS_RANGE_MAX_DAYS = 90;

export interface AdsDateRange {
  /** "YYYY-MM-DD" ngày đầu (ngày sàn). */
  fromKey: string;
  /** "YYYY-MM-DD" ngày cuối (ngày sàn), không quá hôm nay. */
  toKey: string;
  /** Số ngày trong khoảng, tính cả hai đầu. */
  days: number;
  /** true = ngày đầu bị kéo lên vì vượt trần ADS_RANGE_MAX_DAYS. */
  clamped: boolean;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" hợp lệ (đúng định dạng + ngày tồn tại) → chính nó, sai → null. */
function validDateKey(v: unknown): string | null {
  if (typeof v !== "string" || !DATE_KEY_RE.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  // Chặn 2026-02-31 (JS tự nhảy sang tháng sau).
  return new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

/** Dời "YYYY-MM-DD" đi N ngày (âm = lùi). */
export function shiftDateKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Số ngày từ a tới b tính cả hai đầu (a ≤ b). */
function daysInclusive(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Đọc ?from=&to= của bộ lọc chuẩn (ưu tiên) hoặc ?days= (đường cũ) thành khoảng
 * ngày sàn đã chuẩn hóa: đảo lại nếu chọn ngược, cắt về hôm nay nếu chọn tương
 * lai, kéo ngày đầu lên nếu dài quá trần (báo `clamped` để UI nói rõ).
 */
export function resolveAdsDateRange(
  query: { from?: unknown; to?: unknown; days?: unknown },
  todayKey: string = vnDateKey(0)
): AdsDateRange {
  const from = validDateKey(query.from);
  const to = validDateKey(query.to);
  if (from && to) {
    let [start, end] = from <= to ? [from, to] : [to, from];
    if (end > todayKey) end = todayKey;
    if (start > end) start = end;
    const floor = shiftDateKey(end, -(ADS_RANGE_MAX_DAYS - 1));
    const clamped = start < floor;
    if (clamped) start = floor;
    return { fromKey: start, toKey: end, days: daysInclusive(start, end), clamped };
  }
  const n = Number(query.days);
  const days = Number.isFinite(n) ? Math.min(ADS_RANGE_MAX_DAYS, Math.max(1, Math.trunc(n))) : 7;
  return { fromKey: shiftDateKey(todayKey, -(days - 1)), toKey: todayKey, days, clamped: false };
}

/** "YYYY-MM-DD" (ngày sàn) → Date 00:00 UTC — đúng cách cột @db.Date lưu. */
export function dateKeyToDbDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

export type CampaignWithPerf = AdsCampaign & { dailyPerf: AdsCampaignDailyPerf[] };

/**
 * Phần của một dòng Lãi/Lỗ mà các phép tính quảng cáo cần (biên lãi theo tập
 * SKU, nhịp bán, cờ thiếu giá vốn theo dòng hàng). Dòng computePnlRow đầy đủ
 * gán vào được; từ 30/09/2026 mặc định dựng từ SỔ CÁI ĐƠN (loadMarginRows).
 */
export interface PnlRow {
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

/** Cửa sổ biên lãi tính tới lúc gọi: MARGIN_WINDOW_DAYS ngày, theo ngày tạo đơn. */
export function marginWindowRange(): DateRangeFilter {
  return { gte: startOfDaysAgo(MARGIN_WINDOW_DAYS), lte: new Date() };
}

/**
 * Đơn của MỘT gian trong cửa sổ, dạng gọn, mới nhất trước — theo nguồn số
 * (docs/SO-CAI-DON.md mục 9.7):
 *   - "ledger" (mặc định): hai câu SELECT trên sổ cái — không đọc bảng đơn kèm
 *     dòng hàng / kho / bản kê, không tính lại computePnlRow ở mỗi lượt. Tính
 *     nốt dòng bẩn của cửa sổ trước (giá vốn vừa nhập phải vào biên lãi ngay).
 *   - "orders" (LEDGER_REPORTS_SOURCE=orders): đường cũ fetchPnlRows.
 * `range`: công cụ đối chiếu truyền CÙNG một cửa sổ cho hai đường cộng.
 */
export async function loadMarginRows(
  channel: AdsInsightChannel,
  source: ReportSource = resolveReportSource(undefined, process.env.LEDGER_REPORTS_SOURCE),
  range: DateRangeFilter = marginWindowRange()
): Promise<PnlRow[]> {
  const scope = { userId: channel.userId, id: channel.id, channelName: channel.channelName };
  if (source === "orders") {
    return (await fetchPnlRows(scope, range, { max: MARGIN_MAX_ORDERS })).rows;
  }
  await ensureLedgerFresh(scope, range, { maxInline: 1000 });
  const { orders } = await ledgerCompactOrders(scope, range, MARGIN_MAX_ORDERS);
  return orders;
}

/** Nền P&L 30 ngày của một gian (chưa trừ ads) — nguyên liệu tính biên lãi. */
/** Định danh gian truyền vào lõi — channelName quyết định nhánh P&L của sàn. */
export interface AdsInsightChannel {
  id: string;
  userId: string;
  channelName: ChannelName;
}

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
 * CACHE nền P&L 30 ngày theo gian (RAM tiến trình, TTL `ADS_PNL_CACHE_MIN`, mặc
 * định 30'). Đây là truy vấn nặng nhất của Trợ lý (tới 2.000 đơn kèm items, kho,
 * bản kê): trước 27/09/2026 pulse ads 30'/60', quét cảnh báo 6 lần/giờ và trang
 * Ads mỗi nơi kéo lại một bản từ DB → egress Supabase ~2 GB/ngày (vượt 4× gói
 * Free). Biên lãi 30 ngày đổi rất chậm nên trễ ≤30' không đổi quyết định nào;
 * số campaign/perf vẫn đọc tươi ở computeChannelAdsInsights. Bản trả về là
 * bản sao nông để caller lọc/sắp xếp không làm bẩn cache.
 */
const PNL_CACHE_TTL_MS =
  Math.max(0, Number(process.env.ADS_PNL_CACHE_MIN ?? 30) || 0) * 60_000;
const PNL_CACHE_MAX_CHANNELS = 200;
const pnlRowsCache = new Map<string, { at: number; rows: Promise<PnlRow[]> }>();

export async function fetchChannelPnlRows(
  channel: AdsInsightChannel,
  opts: { fresh?: boolean } = {}
): Promise<PnlRow[]> {
  const hit = pnlRowsCache.get(channel.id);
  if (!opts.fresh && hit && Date.now() - hit.at < PNL_CACHE_TTL_MS) {
    return (await hit.rows).slice();
  }
  const rows = (async () =>
    pnlRowsForMargin(await loadMarginRows(channel), channel.channelName))();
  if (PNL_CACHE_TTL_MS > 0) {
    if (pnlRowsCache.size >= PNL_CACHE_MAX_CHANNELS) {
      const oldest = pnlRowsCache.keys().next().value;
      if (oldest !== undefined) pnlRowsCache.delete(oldest);
    }
    pnlRowsCache.set(channel.id, { at: Date.now(), rows });
    rows.catch(() => pnlRowsCache.delete(channel.id)); // lỗi thì không giữ bản hỏng
  }
  return (await rows).slice();
}

/** Xóa cache biên lãi của một gian ở CẢ hai đường cộng (gọi khi cần số tươi ngay, VD sau đối soát tay). */
export function invalidateChannelPnlRows(channelId: string): void {
  pnlRowsCache.delete(channelId);
  marginGroupsCache.delete(channelId);
}
// Nhập giá vốn / áp cho đơn cũ → biên lãi đổi → xóa cache của các gian đó ngay
// (28/09: giữ 30' làm bảng ROAS hòa vốn báo "chưa có giá vốn" dù đã vá xong).
registerCostCacheInvalidator((ids) => ids.forEach(invalidateChannelPnlRows));

/**
 * Biên lãi ròng (chưa trừ ads) trên một tập SKU — null = tính toàn shop.
 * Đơn nhiều SKU phân bổ doanh thu/lãi theo tỷ trọng giá trị hàng của SKU khớp.
 */
/**
 * Ngưỡng độ phủ giá vốn để TIN biên lãi: ≥ 90% doanh thu (đã lọc theo SKU) phải
 * có giá vốn — cùng số với TikTok (BREAKEVEN_MIN_COVERAGE_PCT ở tiktok-ads/
 * auto-rules; không import chéo vì breakeven TikTok đã import file này).
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
export function marginOverRows(pnlRows: PnlRow[], skuSet: Set<string> | null): MarginBase {
  let orders = 0;
  let revenue = 0;
  let profit = 0;
  let missingCostOrders = 0;
  let missingCostRevenue = 0;
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

// ============================================================
// BIÊN LÃI THEO NHÓM SKU — HAI ĐƯỜNG CỘNG, MỘT KẾT QUẢ
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md)
//
//   "rows": giữ dòng gọn của cả cửa sổ trong RAM rồi duyệt (marginOverRows). Có
//           phanh MARGIN_MAX_ORDERS — chạm phanh thì chỉ đại diện đơn mới nhất.
//   "sql" : GROUP BY trên sổ dòng hàng trong database (ledgerMarginByGroup) —
//           đủ mọi đơn, RAM chỉ giữ một dòng kết quả cho mỗi nhóm.
// Luật giống nhau ở cả hai đường: bỏ đơn hủy, Lazada chỉ đơn đã đối soát, đơn
// thiếu giá vốn đứng ngoài biên lãi, đơn nhiều SKU phân bổ theo giá trị dòng.
// Ba nơi dùng (chiến dịch, bảng hòa vốn sản phẩm, gợi ý chạy quảng cáo) cùng
// dựng MỘT bộ nhóm nên cùng một lượt gom trong database.
// ============================================================

/** Nơi cộng biên lãi của Trợ lý quảng cáo Shopee/Lazada. */
export type AdsMarginSource = "rows" | "sql";

/**
 * Công tắc env ADS_MARGIN_SOURCE: `sql` = gom trong database; còn lại = `rows`
 * (đường lui, giữ một tuần sau khi đổi mặc định). Khi báo cáo đã lui về đơn gốc
 * (LEDGER_REPORTS_SOURCE=orders) thì sổ cái không còn là nguồn số → luôn `rows`.
 */
export function resolveAdsMarginSource(
  env: string | undefined = process.env.ADS_MARGIN_SOURCE,
  reportsEnv: string | undefined = process.env.LEDGER_REPORTS_SOURCE
): AdsMarginSource {
  if (resolveReportSource(undefined, reportsEnv) === "orders") return "rows";
  return env?.trim().toLowerCase() === "sql" ? "sql" : "rows";
}

/** Nhóm "mọi dòng hàng của gian". */
export const SHOP_GROUP = LEDGER_MARGIN_SHOP_GROUP;
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
  pnlRows: PnlRow[],
  itemBySku: ReadonlyMap<string, string>,
  nowMs: number = Date.now()
): Map<string, GroupSalesPace> {
  const since7 = nowMs - SALES_PACE_RECENT_MS;
  const sales = new Map<string, GroupSalesPace>();
  for (const row of pnlRows) {
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
export function marginsFromRows(pnlRows: PnlRow[], sets: AdsGroupSets, nowMs?: number): ChannelMargins {
  return {
    base(groupKey) {
      if (groupKey === SHOP_GROUP) return marginOverRows(pnlRows, null);
      const skus = sets.get(groupKey);
      return skus && skus.size > 0 ? marginOverRows(pnlRows, skus) : EMPTY_MARGIN_BASE;
    },
    productPace() {
      // Một SKU sàn chỉ thuộc một sản phẩm (ChannelProduct unique theo gian + SKU).
      const itemBySku = new Map<string, string>();
      for (const [groupKey, skus] of sets) {
        if (!groupKey.startsWith(PRODUCT_GROUP_PREFIX)) continue;
        const itemId = groupKey.slice(PRODUCT_GROUP_PREFIX.length);
        for (const sku of skus) itemBySku.set(sku, itemId);
      }
      return salesPaceByItem(pnlRows, itemBySku, nowMs);
    },
  };
}

/** Kết quả gom của một nhóm ở đường "sql". */
export interface MarginGroupStats {
  base: MarginBase;
  pace: GroupSalesPace;
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

/**
 * Tùy chọn của câu gom cho một sàn — phần luật của pnlRowsForMargin nói bằng SQL
 * (Lazada chỉ đơn đã đối soát; đơn hủy thì câu gom luôn bỏ) + mốc nhịp bán.
 */
export function marginGroupOptions(channelName: ChannelName, range: DateRangeFilter): LedgerMarginOptions {
  return {
    settledOnly: channelName === ChannelName.LAZADA,
    recentSince: new Date(range.lte.getTime() - SALES_PACE_RECENT_MS),
  };
}

/**
 * Gom trong database cho MỌI nhóm của gian — một câu SQL, không nhớ đệm. Tính
 * nốt dòng bẩn của cửa sổ trước (giá vốn vừa nhập phải vào biên lãi ngay), như
 * loadMarginRows. Mốc "7 ngày gần đây" của nhịp bán lùi từ `range.lte`.
 */
export async function loadMarginGroups(
  channel: AdsInsightChannel,
  mapping: Pick<AdsGroupMapping, "groups" | "skus">,
  range: DateRangeFilter = marginWindowRange()
): Promise<Map<string, MarginGroupStats>> {
  const scope = { userId: channel.userId, id: channel.id, channelName: channel.channelName };
  await ensureLedgerFresh(scope, range, { maxInline: 1000 });
  const raw = await ledgerMarginByGroup(scope, range, mapping, marginGroupOptions(channel.channelName, range));
  const groups = new Map<string, MarginGroupStats>();
  for (const [groupKey, g] of raw) {
    groups.set(groupKey, {
      base: marginBaseFromSums(g),
      pace: { units30d: g.units, units7d: g.unitsRecent, unitsNoCost: g.unitsNoCost },
    });
  }
  return groups;
}

/**
 * Nhớ KẾT QUẢ gom theo gian (không nhớ đơn) — cùng thời hạn ADS_PNL_CACHE_MIN
 * và cùng lệnh xóa khi nhập giá vốn với bộ đệm đường "rows". Bộ nhóm đổi (thêm
 * sản phẩm, chiến dịch đổi danh sách item) → `digest` khác → gom lại ngay. Các
 * lượt gọi đang chờ dùng chung một lượt gom.
 */
const marginGroupsCache = new Map<
  string,
  { at: number; digest: string; groups: Promise<Map<string, MarginGroupStats>> }
>();

async function fetchChannelMarginGroups(
  channel: AdsInsightChannel,
  mapping: AdsGroupMapping
): Promise<Map<string, MarginGroupStats>> {
  const hit = marginGroupsCache.get(channel.id);
  if (hit && hit.digest === mapping.digest && Date.now() - hit.at < PNL_CACHE_TTL_MS) {
    return hit.groups;
  }
  const groups = loadMarginGroups(channel, mapping);
  if (PNL_CACHE_TTL_MS > 0) {
    if (!hit && marginGroupsCache.size >= PNL_CACHE_MAX_CHANNELS) {
      const oldest = marginGroupsCache.keys().next().value;
      if (oldest !== undefined) marginGroupsCache.delete(oldest);
    }
    marginGroupsCache.set(channel.id, { at: Date.now(), digest: mapping.digest, groups });
    groups.catch(() => {
      // lỗi thì không giữ bản hỏng (chỉ gỡ nếu chưa bị lượt gom mới hơn thay)
      if (marginGroupsCache.get(channel.id)?.groups === groups) marginGroupsCache.delete(channel.id);
    });
  }
  return groups;
}

/** Biên lãi + nhịp bán của mọi nhóm của gian theo đường cộng đang bật (có nhớ đệm). */
export async function fetchChannelMargins(
  channel: AdsInsightChannel,
  sets: AdsGroupSets,
  source: AdsMarginSource = resolveAdsMarginSource()
): Promise<ChannelMargins> {
  if (source === "sql") {
    return marginsFromGroups(await fetchChannelMarginGroups(channel, adsGroupMappingOf(sets)));
  }
  return marginsFromRows(await fetchChannelPnlRows(channel), sets);
}

/** Bộ nhóm của một gian đọc thẳng từ database — cho công cụ đối chiếu và test. */
export async function loadAdsGroupSets(channelId: string): Promise<AdsGroupSets> {
  const [channelProducts, campaigns] = await Promise.all([
    prisma.channelProduct.findMany({
      where: { channelId, externalId: { not: null } },
      select: { channelSku: true, externalId: true },
    }),
    prisma.adsCampaign.findMany({ where: { channelId }, select: { id: true, itemIds: true } }),
  ]);
  return buildAdsGroupSets(groupSkusByItemId(channelProducts), campaigns);
}

export interface CampaignInsight {
  row: CampaignWithPerf;
  itemIds: string[];
  windows: Record<AssistantWindowKey, AssistantWindowMetrics>;
  avgDailySpend7d: number;
  margin: number | null;
  marginSource: "campaign" | "shop" | null;
  marginOrders: number;
  breakevenRoas: number | null;
  assessment: AssistantAssessment;
  /** Đợt A: mục tiêu ROAS seller đặt trên sàn so với hòa vốn (null = không đặt / chưa có hòa vốn). */
  roasTargetCheck: RoasTargetCheck | null;
  /** Đợt E: đang lãi nhưng bị ngân sách chặn / mục tiêu bó phân phối (null = không có gì để nới). */
  deliveryCheck: DeliveryCheck | null;
}

/**
 * Quyết định của chủ shop trên một cảnh báo còn hiệu lực (verdict CHƯA đổi loại
 * từ lúc quyết) — dùng chung cho executor GĐ3 và detector Trung tâm điều hành:
 * người đã quyết thì máy không réo lại, ở bất kỳ nơi hiển thị nào.
 */
export function assistantDecisionActive(insight: CampaignInsight): boolean {
  const c = insight.row;
  return (
    c.assistantDecision !== "" &&
    insight.assessment.verdict !== null &&
    c.assistantDecisionVerdict === insight.assessment.verdict
  );
}

export interface ChannelAdsInsights {
  config: ShopeeAssistantConfig;
  items: CampaignInsight[];
  shop: {
    margin: number | null;
    breakevenRoas: number | null;
    pnlOrders: number;
    missingCostOrders: number;
    /** % doanh thu 30 ngày có giá vốn (đơn thiếu đã bị loại khỏi biên lãi). */
    costCoveragePct: number | null;
  };
}

/**
 * Tính trọn bộ insight + verdict cho MỌI campaign của một gian Shopee.
 * dailyPerf kèm theo là 30 ngày — caller hiển thị tự cắt cửa sổ ngắn hơn.
 * `opts.perfFromKey`: bộ lọc trang xem xa hơn 30 ngày thì nạp thêm số cũ cho
 * lớp hiển thị; các cửa sổ rule engine (today/3d/7d/30d) so theo mốc ngày nên
 * không đổi kết quả dù nạp rộng hơn.
 * `opts.marginSource`: ép đường cộng biên lãi (công cụ đối chiếu); bỏ trống = theo env.
 */
export async function computeChannelAdsInsights(
  channel: AdsInsightChannel,
  opts: { perfFromKey?: string; marginSource?: AdsMarginSource } = {}
): Promise<ChannelAdsInsights> {
  let perfFloor = startOfDaysAgo(30);
  if (opts.perfFromKey) {
    const wanted = dateKeyToDbDate(opts.perfFromKey);
    if (wanted < perfFloor) perfFloor = wanted;
  }
  const campaignRows = await prisma.adsCampaign.findMany({
    where: { channelId: channel.id },
    include: { dailyPerf: { where: { date: { gte: perfFloor } } } },
  });

  const configRow = await prisma.adsAssistantConfig.findUnique({
    where: { channelId: channel.id },
  });
  const config = normalizeAssistantConfig(configRow?.config);

  // Mốc cửa sổ theo NGÀY SÀN (giờ VN): key ngày nhỏ nhất thuộc mỗi cửa sổ.
  const windowFloorKey: Record<AssistantWindowKey, string> = {
    today: vnDateKey(0),
    "3d": vnDateKey(2),
    "7d": vnDateKey(6),
    "30d": vnDateKey(29),
  };
  const yesterdayKey = vnDateKey(1);
  const weekAgoKey = vnDateKey(7);

  // Map SKU sàn → campaign qua externalId của ChannelProduct ("item" | "item-model").
  const channelProducts = await prisma.channelProduct.findMany({
    where: { channelId: channel.id, externalId: { not: null } },
    select: { channelSku: true, externalId: true },
  });

  // ---- Biên lãi 30 ngày (chưa trừ ads): toàn gian + riêng từng chiến dịch ----
  const margins = await fetchChannelMargins(
    channel,
    buildAdsGroupSets(groupSkusByItemId(channelProducts), campaignRows),
    opts.marginSource
  );

  const shopMarginBase = margins.base(SHOP_GROUP);
  // null khi độ phủ giá vốn dưới ngưỡng — thà không kết luận còn hơn số lạc quan.
  const shopMargin = marginOf(shopMarginBase);
  const shopBreakeven = shopMargin != null && shopMargin > 0 ? 1 / shopMargin : null;

  const items: CampaignInsight[] = campaignRows.map((c) => {
    // Lát cắt cửa sổ + trung bình ngày 7 ngày TRƯỚC hôm nay (mẫu so spike).
    const windows = {} as Record<AssistantWindowKey, AssistantWindowMetrics>;
    for (const k of ASSISTANT_WINDOWS) {
      windows[k] = { spend: 0, clicks: 0, broadOrder: 0, broadGmv: 0 };
    }
    let prev7Spend = 0;
    // Đợt E: cùng 7 ngày trọn — thêm GMV broad + số ngày có tiêu tiền (cỡ mẫu).
    let prev7Gmv = 0;
    let prev7DaysWithSpend = 0;
    for (const p of c.dailyPerf) {
      const key = dateKey(p.date);
      for (const k of ASSISTANT_WINDOWS) {
        if (key >= windowFloorKey[k]) {
          windows[k].spend += Number(p.expense);
          windows[k].clicks += p.clicks;
          windows[k].broadOrder += p.broadOrder;
          windows[k].broadGmv += Number(p.broadGmv);
        }
      }
      if (key >= weekAgoKey && key <= yesterdayKey) {
        const expense = Number(p.expense);
        prev7Spend += expense;
        prev7Gmv += Number(p.broadGmv);
        if (expense > 0) prev7DaysWithSpend++;
      }
    }
    const avgDailySpend7d = prev7Spend / 7;

    // Biên lãi riêng của campaign từ P&L các SKU trong campaign (chưa biết SKU → toàn 0).
    const itemIds = c.itemIds ? c.itemIds.split(",") : [];
    const own = margins.base(campaignGroupKey(c.id));
    const ownMargin = marginOf(own);
    const useOwn = own.orders >= MIN_ORDERS_FOR_MARGIN && ownMargin != null;
    const margin = useOwn ? ownMargin : shopMargin;
    const marginSource: "campaign" | "shop" | null = useOwn
      ? "campaign"
      : shopMargin != null
        ? "shop"
        : null;
    const breakevenRoas = margin != null && margin > 0 ? 1 / margin : null;

    const assessment = evaluateShopeeCampaign(
      { status: c.status, breakevenRoas, windows, avgDailySpend7d },
      config
    );
    const roasTarget = c.roasTarget != null ? Number(c.roasTarget) : null;
    const roasTargetCheck = assessRoasTarget({
      roasTarget,
      breakevenRoas,
      dangerFactor: config.review.dangerFactor,
    });
    const deliveryCheck = assessDelivery({
      status: c.status,
      verdict: assessment.verdict,
      roasTargetCheck,
      breakevenRoas,
      budget: Number(c.budget),
      roasTarget,
      prev7: { spend: prev7Spend, gmv: prev7Gmv, daysWithSpend: prev7DaysWithSpend },
      dangerFactor: config.review.dangerFactor,
    });

    return {
      row: c,
      itemIds,
      windows,
      avgDailySpend7d,
      margin,
      marginSource,
      marginOrders: useOwn ? own.orders : shopMarginBase.orders,
      breakevenRoas,
      assessment,
      roasTargetCheck,
      deliveryCheck,
    };
  });

  return {
    config,
    items,
    shop: {
      margin: shopMargin,
      breakevenRoas: shopBreakeven,
      pnlOrders: shopMarginBase.orders,
      missingCostOrders: shopMarginBase.missingCostOrders,
      costCoveragePct: shopMarginBase.costCoveragePct,
    },
  };
}

// ============================================================
// BẢNG ROAS HÒA VỐN THEO SẢN PHẨM — tra cứu TRƯỚC khi tạo campaign
// (campaign chỉ có hòa vốn SAU khi đã chạy; bảng này trả lời "SP này đặt
// ROAS mục tiêu bao nhiêu thì không lỗ" ngay từ lúc lên chiến dịch).
// Đơn vị gom nhóm = item_id của sàn (một sản phẩm Shopee, gồm mọi phân loại)
// vì ads sản phẩm Shopee nhắm theo item, không theo model.
// ============================================================

export interface ProductBreakevenRow {
  /** item_id phía Shopee — dùng đối chiếu với itemIds của campaign. */
  itemId: string;
  productName: string;
  /** Số SKU sàn (phân loại) thuộc sản phẩm. */
  skuCount: number;
  /** SKU TỔNG cấp sản phẩm (item_sku Shopee) — null nếu người bán không đặt. */
  itemSku: string | null;
  /** SKU phân loại người bán TỰ ĐẶT (đã lọc khóa tổng hợp SPE-…) — cho tìm kiếm/tooltip. */
  sellerSkus: string[];
  /** Số đơn P&L 30 ngày có chứa SKU của sản phẩm (cỡ mẫu của biên lãi). */
  orders: number;
  /** Doanh thu thực nhận phân bổ cho sản phẩm trong 30 ngày. */
  revenue: number;
  /** Biên lãi ròng (chưa trừ ads); null = chưa có đơn có giá vốn hoặc độ phủ giá vốn dưới ngưỡng. */
  margin: number | null;
  /** 1/biên lãi; null khi chưa đủ dữ liệu, độ phủ thấp, hoặc biên ≤ 0 (lỗ trước ads). */
  breakevenRoas: number | null;
  /** Biên ≤ 0: bán đã lỗ chưa tính ads — cấm chỉ định chạy ads. */
  lossBeforeAds: boolean;
  /** % doanh thu 30 ngày của sản phẩm có giá vốn; null = chưa có đơn. */
  costCoveragePct: number | null;
  /** Độ phủ dưới ngưỡng MARGIN_MIN_COST_COVERAGE_PCT → chưa kết luận hòa vốn. */
  lowCostCoverage: boolean;
  /** Số đơn thiếu giá vốn đã bị loại khỏi biên lãi của sản phẩm. */
  missingCostOrders: number;
  /** Sản phẩm đang nằm trong ít nhất một campaign đang chạy. */
  runningAds: boolean;
  /** Đợt A: mục tiêu ROAS thấp nhất đang đặt trên campaign chạy có SP này so với hòa vốn. */
  roasTargetCheck: RoasTargetCheck | null;
}

export interface ChannelProductBreakeven {
  rows: ProductBreakevenRow[];
  shop: {
    margin: number | null;
    breakevenRoas: number | null;
    pnlOrders: number;
    missingCostOrders: number;
    costCoveragePct: number | null;
  };
  /** Ngưỡng độ phủ giá vốn (%) đang áp — FE ghi trong tooltip. */
  minCoveragePct: number;
  /** Hệ số vùng an toàn từ config Trợ lý (Q2 dangerFactor) — FE gợi ý ROAS mục tiêu. */
  safeRoasFactor: number;
}

/**
 * "SKU tổng" cho sản phẩm LAZADA — Lazada không có item_sku cấp sản phẩm như
 * Shopee (adapter cố tình để null). QUYẾT ĐỊNH ANH TRUNG 12/08 tối: KHÔNG suy
 * đoán/cắt tiền tố (mỗi seller một quy ước đặt SKU, cắt là sai chuẩn của họ) —
 * hiển thị NGUYÊN VĂN SKU seller đã đặt:
 *   · đúng 1 phân loại (trùng nhau cũng tính) → lấy trọn SKU đó làm SKU tổng.
 *   · nhiều phân loại khác nhau → null; FE hiện ĐỦ danh sách SKU phân loại
 *     ngay trong ô (rút gọn thị giác + tooltip đầy đủ), tìm kiếm vẫn bắt hết.
 * Logic thuần, EXPORT cho vitest.
 */
export function deriveLazadaItemSku(sellerSkus: string[]): string | null {
  const unique = [...new Set(sellerSkus.map((s) => s.trim()).filter(Boolean))];
  return unique.length === 1 ? unique[0] : null;
}

export async function computeChannelProductBreakeven(
  channel: AdsInsightChannel,
  opts: { marginSource?: AdsMarginSource } = {}
): Promise<ChannelProductBreakeven> {
  return (await computeProductBreakevenWithMargins(channel, opts)).breakeven;
}

/**
 * Bảng hòa vốn sản phẩm kèm bộ biên lãi đã dùng để tính — Gợi ý chạy ads lấy
 * nhịp bán từ chính bộ đó, khỏi gom lần hai.
 * `opts.marginSource`: ép đường cộng biên lãi (công cụ đối chiếu); bỏ trống = theo env.
 */
export async function computeProductBreakevenWithMargins(
  channel: AdsInsightChannel,
  opts: { marginSource?: AdsMarginSource } = {}
): Promise<{ breakeven: ChannelProductBreakeven; margins: ChannelMargins }> {
  const [channelProducts, campaignRows, configRow] = await Promise.all([
    prisma.channelProduct.findMany({
      where: { channelId: channel.id, externalId: { not: null } },
      select: {
        channelSku: true,
        externalId: true,
        productName: true,
        itemSku: true,
      },
    }),
    prisma.adsCampaign.findMany({
      where: { channelId: channel.id },
      select: { id: true, status: true, itemIds: true, roasTarget: true },
    }),
    prisma.adsAssistantConfig.findUnique({ where: { channelId: channel.id } }),
  ]);
  const config = normalizeAssistantConfig(configRow?.config);
  // Cùng bộ nhóm với computeChannelAdsInsights → đường "sql" dùng chung một lượt gom.
  const margins = await fetchChannelMargins(
    channel,
    buildAdsGroupSets(groupSkusByItemId(channelProducts), campaignRows),
    opts.marginSource
  );

  const ongoingItemIds = new Set<string>();
  // Đợt A: mục tiêu ROAS THẤP NHẤT đang đặt trên campaign chạy có chứa SP.
  const targetByItemId = new Map<string, number>();
  for (const c of campaignRows) {
    if (c.status !== "ongoing" || !c.itemIds) continue;
    const target = c.roasTarget != null ? Number(c.roasTarget) : 0;
    for (const id of c.itemIds.split(",")) {
      ongoingItemIds.add(id);
      if (target > 0) {
        const prev = targetByItemId.get(id);
        if (prev == null || target < prev) targetByItemId.set(id, target);
      }
    }
  }

  // Gom SKU theo item_id — giữ tên/SKU tổng của dòng đầu tiên có dữ liệu.
  const groups = new Map<
    string,
    { productName: string; itemSku: string | null; skus: Set<string> }
  >();
  for (const cp of channelProducts) {
    const itemId = (cp.externalId ?? "").split("-")[0];
    if (!itemId) continue;
    let g = groups.get(itemId);
    if (!g) {
      groups.set(
        itemId,
        (g = { productName: cp.productName, itemSku: cp.itemSku, skus: new Set() })
      );
    }
    if (!g.itemSku && cp.itemSku) g.itemSku = cp.itemSku;
    g.skus.add(cp.channelSku);
  }

  const shopBase = margins.base(SHOP_GROUP);
  const shopMargin = marginOf(shopBase);

  const rows: ProductBreakevenRow[] = [...groups.entries()].map(([itemId, g]) => {
    const base = margins.base(productGroupKey(itemId));
    // Đơn thiếu giá vốn đã bị loại; độ phủ dưới ngưỡng → null (không kết luận).
    const margin = marginOf(base);
    // SKU người bán tự đặt — bỏ khóa tổng hợp sinh khi SKU trống: Shopee
    // `SPE-{item}`/`SPE-{item}-{model}`, Lazada `LZD-{item}-{sku}` — khách
    // không nhận ra các mã máy tự đặt đó.
    const sellerSkus = [...g.skus]
      .filter(
        (s) =>
          s !== `SPE-${itemId}` &&
          !s.startsWith(`SPE-${itemId}-`) &&
          !s.startsWith(`LZD-${itemId}-`)
      )
      .sort();
    // Lazada không có item_sku cấp sản phẩm → suy gốc chung từ SKU phân loại
    // ngay lúc đọc (không ghi DB — quét lại sản phẩm không làm lệch nguồn).
    const itemSku =
      g.itemSku ??
      (channel.channelName === ChannelName.LAZADA
        ? deriveLazadaItemSku(sellerSkus)
        : null);
    return {
      itemId,
      productName: g.productName,
      skuCount: g.skus.size,
      itemSku,
      sellerSkus,
      orders: base.orders,
      revenue: base.revenue,
      margin,
      breakevenRoas: margin != null && margin > 0 ? 1 / margin : null,
      lossBeforeAds: margin != null && margin <= 0,
      costCoveragePct: base.costCoveragePct,
      lowCostCoverage: lowCostCoverage(base),
      missingCostOrders: base.missingCostOrders,
      runningAds: ongoingItemIds.has(itemId),
      roasTargetCheck: assessRoasTarget({
        roasTarget: targetByItemId.get(itemId) ?? null,
        breakevenRoas: margin != null && margin > 0 ? 1 / margin : null,
        dangerFactor: config.review.dangerFactor,
      }),
    };
  });
  // Doanh thu lớn đứng trước — SP chưa có đơn chìm xuống đáy.
  rows.sort((a, b) => b.revenue - a.revenue);

  return {
    breakeven: {
      rows,
      shop: {
        margin: shopMargin,
        breakevenRoas: shopMargin != null && shopMargin > 0 ? 1 / shopMargin : null,
        pnlOrders: shopBase.orders,
        missingCostOrders: shopBase.missingCostOrders,
        costCoveragePct: shopBase.costCoveragePct,
      },
      minCoveragePct: MARGIN_MIN_COST_COVERAGE_PCT,
      safeRoasFactor: config.review.dangerFactor,
    },
    margins,
  };
}
