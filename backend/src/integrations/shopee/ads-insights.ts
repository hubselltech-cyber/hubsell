// ============================================================
// TRỢ LÝ QUẢNG CÁO — LÕI TÍNH TOÁN DÙNG CHUNG (GĐ3 tách từ routes/ads)
//
// Một nguồn duy nhất cho: lát cắt cửa sổ today/3d/7d/30d, biên lãi ròng theo
// SKU campaign (phân bổ tỷ trọng doanh thu, SSOT computePnlRow), ROAS hòa vốn
// và verdict rule engine, cùng bảng ROAS hòa vốn theo sản phẩm. BA người dùng:
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
//
// 30/09/2026: file này chỉ còn phần GHÉP số thành kết luận. Luật biên lãi + bộ
// nhóm SKU ở lib/ads-margin.ts; nạp từ database + bộ đệm ở ./ads-margin-source.ts;
// các hàm ngày ở lib/ads-dates.ts.
// ============================================================

import { ChannelName, type AdsCampaign, type AdsCampaignDailyPerf, type Prisma } from "@prisma/client";
import { dateKey, dateKeyToDbDate, startOfDaysAgo, vnDateKey, vnDateKeyOf } from "../../lib/ads-dates";
import {
  MARGIN_MIN_COST_COVERAGE_PCT,
  SHOP_GROUP,
  buildAdsGroupSets,
  campaignGroupKey,
  groupSkusByItemId,
  lowCostCoverage,
  marginCheckProblem,
  marginOf,
  productGroupKey,
  type AdsInsightChannel,
  type ChannelMargins,
  type MarginCheck,
  type MarginCheckWindows,
} from "../../lib/ads-margin";
import { prisma } from "../../lib/prisma";
import type { AdsMarginSource } from "../../lib/ads-margin";
import {
  ASSISTANT_WINDOWS,
  assessDelivery,
  stepProfitCheck,
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
import { fetchChannelMargins } from "./ads-margin-source";

/** Campaign cần tối thiểu bấy nhiêu đơn khớp SKU mới dùng biên lãi riêng. */
export const MIN_ORDERS_FOR_MARGIN = 5;

export type CampaignWithPerf = AdsCampaign & { dailyPerf: AdsCampaignDailyPerf[] };

export interface CampaignInsight {
  row: CampaignWithPerf;
  itemIds: string[];
  windows: Record<AssistantWindowKey, AssistantWindowMetrics>;
  avgDailySpend7d: number;
  margin: number | null;
  marginSource: "campaign" | "shop" | null;
  marginOrders: number;
  breakevenRoas: number | null;
  /** Tự kiểm một chiều với direct_gmv (Lát 4); null = chiến dịch chưa có số sàn trong 30 ngày. */
  check: MarginCheck | null;
  /** Lý do hòa vốn CHƯA TIN ĐƯỢC (tự kiểm lệch quá ngưỡng) — khi có thì margin/breakevenRoas đã bị xóa. */
  breakevenProblem: string | null;
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
  /**
   * `row.dailyPerf` CHỈ chứa dòng có số khác 0 (25/11/2026, docs/DONG-BO-GIAI-DOAN-3.md mục 8) — cộng dồn thì như cũ,
   * nhưng đừng đếm ngày hay lấy ngày đầu/cuối từ đó; cần thì dùng `perfDays`. Ngoại lệ: chiến dịch vừa bị HẠ mục tiêu
   * ROAS được nạp đủ mọi dòng (stepProfitCheck đếm theo ngày).
   */
  items: CampaignInsight[];
  /** Mọi ngày (≥ mốc nạp) có ÍT NHẤT một dòng số của các chiến dịch đã nạp, kể cả dòng toàn 0 — biểu đồ cần đủ ngày. */
  perfDays: string[];
  shop: {
    margin: number | null;
    breakevenRoas: number | null;
    pnlOrders: number;
    missingCostOrders: number;
    /** Đơn có giá vốn quà cao hơn doanh thu đơn — đã bị loại khỏi biên lãi. */
    suspectGiftOrders: number;
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
/** Chiến dịch cần nạp: còn hiệu lực, hoặc đã kết thúc nhưng có số khác 0 từ `perfFloor`. */
export function campaignsWorthLoading(perfFloor: Date): Prisma.AdsCampaignWhereInput {
  return {
    OR: [
      { status: { notIn: ["ended", "closed", "deleted"] } },
      {
        dailyPerf: {
          some: {
            date: { gte: perfFloor },
            OR: [
              { expense: { not: 0 } },
              { impression: { not: 0 } },
              { clicks: { not: 0 } },
              { broadOrder: { not: 0 } },
              { broadGmv: { not: 0 } },
              { directOrder: { not: 0 } },
              { directGmv: { not: 0 } },
            ],
          },
        },
      },
    ],
  };
}

/** Dòng số có ít nhất một cột khác 0 — dòng toàn 0 không góp gì vào phép cộng nào. */
const NONZERO_PERF: Prisma.AdsCampaignDailyPerfWhereInput = {
  OR: [
    { expense: { not: 0 } },
    { impression: { not: 0 } },
    { clicks: { not: 0 } },
    { broadOrder: { not: 0 } },
    { broadGmv: { not: 0 } },
    { directOrder: { not: 0 } },
    { directGmv: { not: 0 } },
    { broadOrderAmount: { not: 0 } },
    { directOrderAmount: { not: 0 } },
  ],
};

/** Đường lui: `ADS_LOAD_ZERO_PERF_ROWS=1` nạp lại mọi dòng như trước 25/11/2026 (test đối chứng cũng dùng). */
function loadZeroPerfRows(): boolean {
  return process.env.ADS_LOAD_ZERO_PERF_ROWS === "1";
}

/** Chiến dịch có phép so lãi trước/sau nấc hạ mục tiêu (stepProfitCheck đếm NGÀY → cần cả dòng toàn 0). */
function needsAllPerfDays(c: AdsCampaign): boolean {
  return (
    c.roasTargetChangedAt != null &&
    c.roasTarget != null &&
    c.roasTargetPrev != null &&
    Number(c.roasTargetPrev) > Number(c.roasTarget)
  );
}

/**
 * Lượt đang tính dở theo (gian, mốc nạp, nguồn biên, ngày VN): lượt thứ hai cùng khóa chờ chung kết quả thay vì nạp lại
 * (25/11/2026: log có 2 lượt /api/quang-cao/shopee cùng lúc ngay trước khi RSS lên 461 MB). Chỉ gộp lúc ĐANG chạy,
 * xong là xóa — không thành bộ đệm, số luôn mới như cũ. Người gọi KHÔNG được sửa kết quả (dùng chung).
 */
const inFlightInsights = new Map<string, Promise<ChannelAdsInsights>>();

export function computeChannelAdsInsights(
  channel: AdsInsightChannel,
  opts: { perfFromKey?: string; marginSource?: AdsMarginSource } = {}
): Promise<ChannelAdsInsights> {
  const key = [
    channel.id,
    dateKey(perfFloorOf(opts.perfFromKey)),
    opts.marginSource ?? "",
    vnDateKey(0),
    loadZeroPerfRows() ? "all" : "nz",
  ].join("|");
  const running = inFlightInsights.get(key);
  if (running) return running;
  const p = computeChannelAdsInsightsNow(channel, opts).finally(() => inFlightInsights.delete(key));
  inFlightInsights.set(key, p);
  return p;
}

function perfFloorOf(perfFromKey: string | undefined): Date {
  let perfFloor = startOfDaysAgo(30);
  if (perfFromKey) {
    const wanted = dateKeyToDbDate(perfFromKey);
    if (wanted < perfFloor) perfFloor = wanted;
  }
  return perfFloor;
}

async function computeChannelAdsInsightsNow(
  channel: AdsInsightChannel,
  opts: { perfFromKey?: string; marginSource?: AdsMarginSource }
): Promise<ChannelAdsInsights> {
  const perfFloor = perfFloorOf(opts.perfFromKey);
  const allRows = loadZeroPerfRows();
  // Chiến dịch đã kết thúc mà không có số nào trong khoảng thì không có gì để tính hay hiển thị, nên không nạp. Gian có 5.000
  // chiến dịch cũ kèm 131.162 dòng số toàn 0 từng làm RSS tăng 532 MB trong một lượt, web 512 MB chết (03/11/2026).
  // 25/11/2026: gian 3.946 chiến dịch còn 996 chiến dịch được nạp × ~30 dòng, 98 % dòng toàn 0 → chỉ nạp dòng khác 0;
  // ba chỗ cần biết dòng toàn 0 (ngày đầu có số, ngày biểu đồ, so nấc hạ) lấy bằng truy vấn gộp ở DB bên dưới.
  const campaignRows: CampaignWithPerf[] = await prisma.adsCampaign.findMany({
    where: { channelId: channel.id, ...campaignsWorthLoading(perfFloor) },
    include: { dailyPerf: { where: { date: { gte: perfFloor }, ...(allRows ? {} : NONZERO_PERF) } } },
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

  // Phần dòng toàn 0 còn ảnh hưởng tới kết quả — lấy gọn ở DB (một dòng mỗi chiến dịch / mỗi ngày), không nạp từng dòng.
  const perfDaySet = new Set<string>();
  /** Ngày đầu có dòng số (kể cả toàn 0) trong [30 ngày, hôm qua] — mốc tự kiểm Lát 4. */
  const firstPerfKey = new Map<string, string>();
  if (allRows) {
    for (const c of campaignRows) {
      for (const p of c.dailyPerf) {
        const key = dateKey(p.date);
        perfDaySet.add(key);
        if (key > yesterdayKey || key < windowFloorKey["30d"]) continue;
        const prev = firstPerfKey.get(c.id);
        if (prev === undefined || key < prev) firstPerfKey.set(c.id, key);
      }
    }
  } else if (campaignRows.length > 0) {
    const ids = campaignRows.map((c) => c.id);
    const stepIds = campaignRows.filter(needsAllPerfDays).map((c) => c.id);
    const [firsts, days, stepRows] = await Promise.all([
      prisma.adsCampaignDailyPerf.groupBy({
        by: ["adsCampaignId"],
        where: {
          adsCampaignId: { in: ids },
          // Cùng mốc nạp với include ở trên (gte perfFloor) + đúng cửa sổ vòng lặp cũ.
          AND: [{ date: { gte: perfFloor } }, { date: { gte: dateKeyToDbDate(windowFloorKey["30d"]) } }],
          date: { lte: dateKeyToDbDate(yesterdayKey) },
        },
        _min: { date: true },
      }),
      prisma.adsCampaignDailyPerf.groupBy({
        by: ["date"],
        where: { adsCampaignId: { in: ids }, date: { gte: perfFloor } },
      }),
      stepIds.length > 0
        ? prisma.adsCampaignDailyPerf.findMany({ where: { adsCampaignId: { in: stepIds }, date: { gte: perfFloor } } })
        : Promise.resolve([] as AdsCampaignDailyPerf[]),
    ]);
    for (const f of firsts) if (f._min.date) firstPerfKey.set(f.adsCampaignId, dateKey(f._min.date));
    for (const d of days) perfDaySet.add(dateKey(d.date));
    if (stepRows.length > 0) {
      const full = new Map<string, AdsCampaignDailyPerf[]>();
      for (const r of stepRows) {
        const list = full.get(r.adsCampaignId);
        if (list) list.push(r);
        else full.set(r.adsCampaignId, [r]);
      }
      for (const c of campaignRows) {
        const list = full.get(c.id);
        if (list) c.dailyPerf = list;
      }
    }
  }
  const perfDays = [...perfDaySet].sort();

  // Map SKU sàn → campaign qua externalId của ChannelProduct ("item" | "item-model").
  const channelProducts = await prisma.channelProduct.findMany({
    where: { channelId: channel.id, externalId: { not: null } },
    select: { channelSku: true, externalId: true },
  });

  // ---- Tự kiểm doanh thu một chiều (Lát 4, 18/10/2026): Shopee direct_gmv là cận dưới của doanh thu Hubsell thấy cho sản phẩm
  // của chiến dịch. Khoảng tự kiểm của mỗi chiến dịch = từ ngày đầu CÓ số sàn trong 30 ngày tới hết hôm qua (hôm nay còn dở).
  const checkFrom = new Map<string, string>();
  const directGmvOf = new Map<string, number>();
  for (const c of campaignRows) {
    if (!c.itemIds) continue;
    // Ngày đầu tính cả dòng toàn 0 (giữ đúng như trước 25/11/2026); tổng direct chỉ cần dòng khác 0.
    const from = firstPerfKey.get(c.id) ?? "";
    let direct = 0;
    for (const p of c.dailyPerf) {
      const key = dateKey(p.date);
      if (key > yesterdayKey || key < windowFloorKey["30d"]) continue;
      direct += Number(p.directGmv);
    }
    if (from) {
      checkFrom.set(campaignGroupKey(c.id), from);
      directGmvOf.set(c.id, direct);
    }
  }
  const checks: MarginCheckWindows = { from: checkFrom, to: yesterdayKey };

  // ---- Biên lãi 30 ngày (chưa trừ ads): toàn gian + riêng từng chiến dịch ----
  const margins = await fetchChannelMargins(
    channel,
    buildAdsGroupSets(groupSkusByItemId(channelProducts), campaignRows),
    opts.marginSource,
    checks
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
    // Tự kiểm một chiều (Lát 4): Hubsell thấy ít hơn 75% doanh thu sàn gán trực tiếp cho sản phẩm của chiến dịch → cây sản phẩm
    // thiếu đơn → KHÔNG đưa hòa vốn (kể cả mượn gian), luật tự động / auto-execute coi là không có mốc (null = không hành động).
    const from = checkFrom.get(campaignGroupKey(c.id));
    const check: MarginCheck | null = from
      ? { revenuePlaced: margins.placedRevenue(campaignGroupKey(c.id)), platformDirectGmv: directGmvOf.get(c.id) ?? 0, from, to: yesterdayKey }
      : null;
    const breakevenProblem = marginCheckProblem(check) || null;
    const margin = breakevenProblem ? null : useOwn ? ownMargin : shopMargin;
    const marginSource: "campaign" | "shop" | null = breakevenProblem
      ? null
      : useOwn
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
      roasTargetChangedAt: c.roasTargetChangedAt,
      minKeepPer100: config.profit.minKeepPer100,
      // So lãi tuyệt đối 2 ngày trọn trước / sau nấc HẠ gần nhất (dailyPerf 30 ngày có sẵn ở đây).
      stepCheck:
        margin != null
          ? stepProfitCheck({
              days: c.dailyPerf.map((p) => ({ date: dateKey(p.date), expense: Number(p.expense), gmv: Number(p.broadGmv) })),
              margin,
              roasTarget,
              roasTargetPrev: c.roasTargetPrev != null ? Number(c.roasTargetPrev) : null,
              changedOn: c.roasTargetChangedAt ? vnDateKeyOf(c.roasTargetChangedAt) : null,
              today: vnDateKey(0),
            })
          : null,
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
      check,
      breakevenProblem,
      assessment,
      roasTargetCheck,
      deliveryCheck,
    };
  });

  return {
    config,
    items,
    perfDays,
    shop: {
      margin: shopMargin,
      breakevenRoas: shopBreakeven,
      pnlOrders: shopMarginBase.orders,
      missingCostOrders: shopMarginBase.missingCostOrders,
      suspectGiftOrders: shopMarginBase.suspectGiftOrders,
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
  /** Số đơn có giá vốn quà cao hơn doanh thu đơn đã bị loại khỏi biên lãi của sản phẩm. */
  suspectGiftOrders: number;
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
      suspectGiftOrders: base.suspectGiftOrders,
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
