// ============================================================
// ĐỐI CHIẾU HAI ĐƯỜNG CỘNG BIÊN LÃI QUẢNG CÁO Shopee/Lazada
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 5, 6)
//
// "rows" (duyệt mảng đơn trong RAM) ↔ "sql" (GROUP BY trên sổ dòng hàng), cho
// MỘT gian, ở hai tầng:
//   1. Tầng số gốc — cùng một cửa sổ, cùng bộ nhóm: từng nhóm (toàn gian, từng
//      chiến dịch, từng sản phẩm) phải bằng nhau: số đơn TUYỆT ĐỐI, tiền lệch
//      không quá 1 đồng (làm tròn 2 số lẻ của phần phân bổ theo dòng), độ phủ
//      giá vốn và việc "có kết luận biên lãi hay không" giống nhau; nhịp bán
//      từng sản phẩm bằng tuyệt đối.
//   2. Tầng kết quả cuối — chạy ba phép tính khách nhìn thấy (chiến dịch + kết
//      luận của Trợ lý, bảng hòa vốn sản phẩm, gợi ý chạy quảng cáo) ở cả hai
//      đường rồi so từng trường.
// Dùng bởi lệnh `scripts/ledger-backfill.ts ads-compare` (prod) và test tích hợp
// trên DB dev. Sống cùng đường "rows": gỡ khi gỡ đường lui (~07/10). Chuỗi mô tả
// lệch viết KHÔNG DẤU để đọc được trên Render Shell.
// ============================================================

import { ChannelName } from "@prisma/client";
import {
  MARGIN_MAX_ORDERS,
  SHOP_GROUP,
  adsGroupMappingOf,
  marginOf,
  marginWindowRange,
  marginsFromGroups,
  marginsFromRows,
  pnlRowsForMargin,
  type AdsGroupSets,
  type AdsInsightChannel,
  type MarginBase,
} from "../../lib/ads-margin";
import { diffJson, keyBy, type JsonDiffOptions } from "../../lib/json-diff";
import type { AdsMarginSource } from "../../lib/report-source";
import { computeChannelAdsInsights, computeChannelProductBreakeven } from "./ads-insights";
import { loadAdsGroupSets, loadMarginGroups, loadMarginRows } from "./ads-margin-source";
import { computeChannelAdsRecommendations } from "./ads-recommend-data";

/** Lệch tiền tối đa được chấp nhận ở tổng theo nhóm (anh Trung chốt 30/09/2026). */
export const MARGIN_COMPARE_MONEY_TOLERANCE = 1;

export interface MarginCompareReport {
  /** Số nhóm đã so ở tầng số gốc (tính cả nhóm toàn gian). */
  groups: number;
  /** Số đơn của cửa sổ mà đường "rows" giữ trong RAM (sau khi lọc theo sàn). */
  rowsOrders: number;
  /** Đường "rows" đã chạm phanh MARGIN_MAX_ORDERS — hai đường KHÁC nhau là đúng, không kết luận được. */
  capped: boolean;
  /** Toàn gian ở hai đường: số đơn có giá vốn và doanh thu (để nhìn nhanh). */
  shop: { rows: MarginBase; sql: MarginBase };
  /** Lệch tiền lớn nhất gặp phải trong mọi nhóm (đồng). */
  maxMoneyDiff: number;
  baseMismatches: string[];
  paceMismatches: string[];
  endToEndMismatches: string[];
  timing: { rowsMs: number; sqlMs: number };
  ok: boolean;
}

function diffBase(key: string, a: MarginBase, b: MarginBase, out: string[]): number {
  const why: string[] = [];
  if (a.orders !== b.orders) why.push(`orders ${a.orders}/${b.orders}`);
  if (a.missingCostOrders !== b.missingCostOrders) {
    why.push(`missingCostOrders ${a.missingCostOrders}/${b.missingCostOrders}`);
  }
  if (a.costCoveragePct !== b.costCoveragePct) why.push(`coverage ${a.costCoveragePct}/${b.costCoveragePct}`);
  let maxDiff = 0;
  for (const k of ["revenue", "profit", "missingCostRevenue"] as const) {
    const d = Math.abs(a[k] - b[k]);
    if (d > maxDiff) maxDiff = d;
    if (d > MARGIN_COMPARE_MONEY_TOLERANCE) why.push(`${k} ${a[k].toFixed(2)}/${b[k].toFixed(2)}`);
  }
  if ((marginOf(a) === null) !== (marginOf(b) === null)) why.push("margin null/khac null");
  if (why.length) out.push(`${key}: ${why.join(", ")}`);
  return maxDiff;
}

/** Kết quả cuối: trường tiền so theo lệch tuyệt đối, các số không nguyên còn lại so tương đối. */
const END_TO_END_DIFF: JsonDiffOptions = {
  moneyKeys: new Set(["revenue", "revenue30d"]),
  moneyTolerance: MARGIN_COMPARE_MONEY_TOLERANCE,
  relativeTolerance: 1e-4,
};

async function endToEndSnapshot(channel: AdsInsightChannel, marginSource: AdsMarginSource) {
  const [insights, breakeven, recommendations] = await Promise.all([
    computeChannelAdsInsights(channel, { marginSource }),
    computeChannelProductBreakeven(channel, { marginSource }),
    // Gợi ý chạy quảng cáo chỉ có ở Shopee.
    channel.channelName === ChannelName.SHOPEE
      ? computeChannelAdsRecommendations(channel, { marginSource })
      : null,
  ]);
  return {
    insights: {
      shop: insights.shop,
      // `row` là dòng database (giống nhau ở hai đường) — chỉ giữ phần do biên lãi quyết định.
      campaigns: keyBy(
        insights.items.map(({ row, ...rest }) => ({ id: row.id, ...rest })),
        (c) => c.id
      ),
    },
    breakeven: { ...breakeven, rows: keyBy(breakeven.rows, (r) => r.itemId) },
    recommendations: recommendations && {
      ...recommendations,
      rows: keyBy(recommendations.rows, (r) => r.itemId),
    },
  };
}

/**
 * So hai đường cộng cho một gian Shopee/Lazada. `extraSets`: nhóm thêm của test
 * (khóa không được trùng nhóm thật). `endToEnd: false` → chỉ so tầng số gốc.
 */
export async function compareMarginSources(
  channel: AdsInsightChannel,
  opts: { extraSets?: AdsGroupSets; endToEnd?: boolean } = {}
): Promise<MarginCompareReport> {
  const range = marginWindowRange();
  const sets: AdsGroupSets = await loadAdsGroupSets(channel.id);
  for (const [key, skus] of opts.extraSets ?? []) {
    if (sets.has(key)) throw new Error(`compareMarginSources: nhom them "${key}" trung nhom that`);
    sets.set(key, skus);
  }

  const t0 = Date.now();
  const ledgerRows = await loadMarginRows(channel, "ledger", range);
  const rows = pnlRowsForMargin(ledgerRows, channel.channelName);
  const t1 = Date.now();
  const sqlGroups = await loadMarginGroups(channel, adsGroupMappingOf(sets), range);
  const t2 = Date.now();

  const fromRows = marginsFromRows(rows, sets, range.lte.getTime());
  const fromSql = marginsFromGroups(sqlGroups);

  const baseMismatches: string[] = [];
  let maxMoneyDiff = 0;
  const keys = [SHOP_GROUP, ...sets.keys()];
  for (const key of keys) {
    const d = diffBase(key, fromRows.base(key), fromSql.base(key), baseMismatches);
    if (d > maxMoneyDiff) maxMoneyDiff = d;
  }
  // Kết quả SQL không được có nhóm nằm ngoài bộ nhóm đã gửi.
  for (const key of sqlGroups.keys()) {
    if (key !== SHOP_GROUP && !sets.has(key)) baseMismatches.push(`${key}: nhom la trong ket qua sql`);
  }

  const paceMismatches: string[] = [];
  const paceRows = fromRows.productPace();
  const paceSql = fromSql.productPace();
  for (const itemId of new Set([...paceRows.keys(), ...paceSql.keys()])) {
    const a = paceRows.get(itemId);
    const b = paceSql.get(itemId);
    if (
      !a || !b ||
      a.units30d !== b.units30d || a.units7d !== b.units7d || a.unitsNoCost !== b.unitsNoCost
    ) {
      paceMismatches.push(`${itemId}: ${JSON.stringify(a ?? null)}/${JSON.stringify(b ?? null)}`);
    }
  }

  const endToEndMismatches: string[] = [];
  if (opts.endToEnd !== false) {
    const [viaRows, viaSql] = await Promise.all([
      endToEndSnapshot(channel, "rows"),
      endToEndSnapshot(channel, "sql"),
    ]);
    diffJson(viaRows, viaSql, "ketqua", endToEndMismatches, END_TO_END_DIFF);
  }

  const capped = ledgerRows.length >= MARGIN_MAX_ORDERS;
  return {
    groups: keys.length,
    rowsOrders: rows.length,
    capped,
    shop: { rows: fromRows.base(SHOP_GROUP), sql: fromSql.base(SHOP_GROUP) },
    maxMoneyDiff,
    baseMismatches,
    paceMismatches,
    endToEndMismatches,
    timing: { rowsMs: t1 - t0, sqlMs: t2 - t1 },
    ok:
      !capped &&
      baseMismatches.length === 0 &&
      paceMismatches.length === 0 &&
      endToEndMismatches.length === 0,
  };
}
