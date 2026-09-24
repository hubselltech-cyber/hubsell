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

import {
  ChannelName,
  ShippingStatus,
  type AdsCampaign,
  type AdsCampaignDailyPerf,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { computePnlRow, fetchPnlOrders } from "../../routes/finance";
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

type PnlRow = ReturnType<typeof computePnlRow>;

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

export async function fetchChannelPnlRows(channel: AdsInsightChannel): Promise<PnlRow[]> {
  const pnlOrders = await fetchPnlOrders(
    { userId: channel.userId, id: channel.id, channelName: channel.channelName },
    { gte: startOfDaysAgo(MARGIN_WINDOW_DAYS), lte: new Date() }
  );
  return pnlRowsForMargin(pnlOrders.map(computePnlRow), channel.channelName);
}

/**
 * Biên lãi ròng (chưa trừ ads) trên một tập SKU — null = tính toàn shop.
 * Đơn nhiều SKU phân bổ doanh thu/lãi theo tỷ trọng giá trị hàng của SKU khớp.
 */
function marginOverRows(
  pnlRows: PnlRow[],
  skuSet: Set<string> | null
): { orders: number; revenue: number; profit: number; missingCostOrders: number } {
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
  };
}

/**
 * Tính trọn bộ insight + verdict cho MỌI campaign của một gian Shopee.
 * dailyPerf kèm theo là 30 ngày — caller hiển thị tự cắt cửa sổ ngắn hơn.
 * `opts.perfFromKey`: bộ lọc trang xem xa hơn 30 ngày thì nạp thêm số cũ cho
 * lớp hiển thị; các cửa sổ rule engine (today/3d/7d/30d) so theo mốc ngày nên
 * không đổi kết quả dù nạp rộng hơn.
 */
export async function computeChannelAdsInsights(
  channel: AdsInsightChannel,
  opts: { perfFromKey?: string } = {}
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

  // ---- Nền P&L 30 ngày để tính biên lãi (chưa trừ ads) ----
  const pnlRows = await fetchChannelPnlRows(channel);

  // Map SKU sàn → campaign qua externalId của ChannelProduct ("item" | "item-model").
  const channelProducts = await prisma.channelProduct.findMany({
    where: { channelId: channel.id, externalId: { not: null } },
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

  const marginOver = (skuSet: Set<string> | null) => marginOverRows(pnlRows, skuSet);

  const shopMarginBase = marginOver(null);
  const shopMargin =
    shopMarginBase.revenue > 0 ? shopMarginBase.profit / shopMarginBase.revenue : null;
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

    // Biên lãi riêng của campaign từ P&L các SKU trong campaign.
    const itemIds = c.itemIds ? c.itemIds.split(",") : [];
    const skuSet = new Set<string>();
    for (const itemId of itemIds) {
      for (const sku of skusByItemId.get(itemId) ?? []) skuSet.add(sku);
    }
    const own =
      skuSet.size > 0
        ? marginOver(skuSet)
        : { orders: 0, revenue: 0, profit: 0, missingCostOrders: 0 };
    const useOwn = own.orders >= MIN_ORDERS_FOR_MARGIN && own.revenue > 0;
    const margin = useOwn ? own.profit / own.revenue : shopMargin;
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
  /** Biên lãi ròng (chưa trừ ads); null = chưa có đơn P&L nào khớp. */
  margin: number | null;
  /** 1/biên lãi; null khi chưa đủ dữ liệu hoặc biên ≤ 0 (lỗ trước ads). */
  breakevenRoas: number | null;
  /** Biên ≤ 0: bán đã lỗ chưa tính ads — cấm chỉ định chạy ads. */
  lossBeforeAds: boolean;
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
  };
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
  /** Tập đơn P&L đã nạp sẵn (Gợi ý chạy ads dùng chung, khỏi kéo 2 lần). */
  preloadedPnlRows?: PnlRow[]
): Promise<ChannelProductBreakeven> {
  const [pnlRows, channelProducts, campaignRows, configRow] = await Promise.all([
    preloadedPnlRows ?? fetchChannelPnlRows(channel),
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
      select: { status: true, itemIds: true, roasTarget: true },
    }),
    prisma.adsAssistantConfig.findUnique({ where: { channelId: channel.id } }),
  ]);
  const config = normalizeAssistantConfig(configRow?.config);

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

  const shopBase = marginOverRows(pnlRows, null);
  const shopMargin = shopBase.revenue > 0 ? shopBase.profit / shopBase.revenue : null;

  const rows: ProductBreakevenRow[] = [...groups.entries()].map(([itemId, g]) => {
    const base = marginOverRows(pnlRows, g.skus);
    const margin = base.orders > 0 && base.revenue > 0 ? base.profit / base.revenue : null;
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
    rows,
    shop: {
      margin: shopMargin,
      breakevenRoas: shopMargin != null && shopMargin > 0 ? 1 / shopMargin : null,
      pnlOrders: shopBase.orders,
      missingCostOrders: shopBase.missingCostOrders,
    },
    safeRoasFactor: config.review.dangerFactor,
  };
}
