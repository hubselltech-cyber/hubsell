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

/** Trường tiền ở kết quả cuối — so theo lệch tuyệt đối; các số còn lại so tương đối. */
const END_TO_END_MONEY_KEYS = new Set(["revenue", "revenue30d"]);
const END_TO_END_RELATIVE_TOLERANCE = 1e-4;

/** So đệ quy hai giá trị JSON. Số nguyên ở cả hai bên phải bằng tuyệt đối (số đơn, điểm, số lượng). */
function diffDeep(a: unknown, b: unknown, path: string, key: string, out: string[]): void {
  if (out.length >= 20) return;
  if (typeof a === "number" && typeof b === "number") {
    const d = Math.abs(a - b);
    const ok = END_TO_END_MONEY_KEYS.has(key)
      ? d <= MARGIN_COMPARE_MONEY_TOLERANCE
      : Number.isInteger(a) && Number.isInteger(b)
        ? d === 0
        : d <= END_TO_END_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
    if (!ok) out.push(`${path}: ${a}/${b}`);
    return;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a)}/${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: mang/doi tuong`);
    return;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  for (const k of new Set([...ka, ...kb])) {
    diffDeep((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, k, out);
  }
}

/** Mảng → đối tượng theo khóa, để thứ tự sắp xếp (theo doanh thu, điểm) không gây lệch giả. */
function keyed<T>(list: T[], idOf: (x: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of list) out[idOf(x)] = x;
  return out;
}

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
      campaigns: keyed(
        insights.items.map(({ row, ...rest }) => ({ id: row.id, ...rest })),
        (c) => c.id
      ),
    },
    breakeven: { ...breakeven, rows: keyed(breakeven.rows, (r) => r.itemId) },
    recommendations: recommendations && {
      ...recommendations,
      rows: keyed(recommendations.rows, (r) => r.itemId),
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
    diffDeep(viaRows, viaSql, "ketqua", "", endToEndMismatches);
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
