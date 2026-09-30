// ============================================================
// ĐỐI CHIẾU HAI ĐƯỜNG CỘNG HÒA VỐN QUẢNG CÁO TikTok
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 12)
//
// "rows" (duyệt mảng đơn trong RAM) ↔ "sql" (GROUP BY trên sổ dòng hàng), cho
// MỘT gian, ở hai tầng:
//   1. Tầng số gốc — cùng một cửa sổ, cùng bộ nhóm, cùng khoảng tự kiểm: từng
//      nhóm (toàn gian, từng chiến dịch, từng sản phẩm) phải bằng nhau: số đơn đã
//      đối soát / hủy cùng lứa / chờ kết cục TUYỆT ĐỐI, tiền lệch không quá 1
//      đồng (làm tròn 2 số lẻ của phần phân bổ theo dòng), độ phủ giá vốn và
//      việc "có ROI hòa vốn hay không" giống nhau; số tự kiểm mẫu số của từng
//      chiến dịch lệch không quá 1 đồng; danh sách sản phẩm có đơn giống nhau;
//      đà bán từng sản phẩm bằng tuyệt đối.
//   2. Tầng kết quả cuối — chạy hai phép tính khách nhìn thấy (hòa vốn gian +
//      từng chiến dịch, tab Hòa vốn sản phẩm) ở cả hai đường rồi so từng trường.
// Dùng bởi lệnh `scripts/ledger-backfill.ts ads-compare --platform TIKTOK` (prod)
// và test tích hợp trên DB dev. Sống cùng đường "rows": gỡ khi gỡ đường lui.
// Chuỗi mô tả lệch viết KHÔNG DẤU để đọc được trên Render Shell.
// ============================================================

import { SHOP_GROUP, type AdsGroupSets } from "../../lib/ads-margin";
import { diffJson, keyBy, type JsonDiffOptions } from "../../lib/json-diff";
import type { TiktokBreakevenSource } from "../../lib/report-source";
import {
  TIKTOK_BREAKEVEN_MAX_ORDERS,
  breakevensFromGroups,
  breakevensFromRows,
  tiktokGroupMappingOf,
  tiktokMarginWindowRange,
  toTiktokBreakeven,
  type BreakevenBase,
  type TiktokCheckWindows,
} from "../../lib/tiktok-breakeven";
import { BREAKEVEN_MIN_COVERAGE_PCT } from "./auto-rules";
import { computeTiktokAdsBreakevenUncached, computeTiktokProductBreakevensUncached } from "./breakeven";
import {
  loadBreakevenGroups,
  loadBreakevenInputs,
  loadBreakevenRows,
  type TiktokBreakevenChannel,
} from "./breakeven-source";

/** Lệch tiền tối đa được chấp nhận ở tổng theo nhóm — cùng mức anh Trung chốt 30/09/2026 cho Shopee/Lazada. */
export const BREAKEVEN_COMPARE_MONEY_TOLERANCE = 1;

export interface BreakevenCompareReport {
  /** Số nhóm đã so ở tầng số gốc (tính cả nhóm toàn gian). */
  groups: number;
  /** Số đơn của cửa sổ mà đường "rows" giữ trong RAM. */
  rowsOrders: number;
  /** Đường "rows" đã chạm phanh TIKTOK_BREAKEVEN_MAX_ORDERS — hai đường KHÁC nhau là đúng, không kết luận được. */
  capped: boolean;
  /** Toàn gian ở hai đường (để nhìn nhanh). */
  shop: { rows: BreakevenBase; sql: BreakevenBase };
  /** Lệch tiền lớn nhất gặp phải trong mọi nhóm (đồng). */
  maxMoneyDiff: number;
  baseMismatches: string[];
  checkMismatches: string[];
  paceMismatches: string[];
  endToEndMismatches: string[];
  timing: { rowsMs: number; sqlMs: number };
  ok: boolean;
}

const COUNT_KEYS = ["settledOrders", "cancelledOrders", "pendingOrders"] as const;
const MONEY_KEYS = ["revenue", "profitBeforeAds", "adFee", "missingCostRevenue"] as const;

function diffBase(key: string, a: BreakevenBase, b: BreakevenBase, out: string[]): number {
  const why: string[] = [];
  for (const k of COUNT_KEYS) if (a[k] !== b[k]) why.push(`${k} ${a[k]}/${b[k]}`);
  let maxDiff = 0;
  for (const k of MONEY_KEYS) {
    const d = Math.abs(a[k] - b[k]);
    if (d > maxDiff) maxDiff = d;
    if (d > BREAKEVEN_COMPARE_MONEY_TOLERANCE) why.push(`${k} ${a[k].toFixed(2)}/${b[k].toFixed(2)}`);
  }
  const x = toTiktokBreakeven(a, "shop");
  const y = toTiktokBreakeven(b, "shop");
  if (x.costCoveragePct !== y.costCoveragePct) why.push(`coverage ${x.costCoveragePct}/${y.costCoveragePct}`);
  if ((x.breakevenRoi === null) !== (y.breakevenRoi === null)) why.push("breakevenRoi null/khac null");
  if (x.negativeMargin !== y.negativeMargin) why.push(`negativeMargin ${x.negativeMargin}/${y.negativeMargin}`);
  if (why.length) out.push(`${key}: ${why.join(", ")}`);
  return maxDiff;
}

/** Kết quả cuối: trường tiền so theo lệch tuyệt đối, các số không nguyên còn lại (biên lãi, ROI) so tương đối. */
const END_TO_END_DIFF: JsonDiffOptions = {
  moneyKeys: new Set(["revenue", "profitBeforeAds", "missingCostRevenue", "revenuePlaced", "tiktokGmv"]),
  moneyTolerance: BREAKEVEN_COMPARE_MONEY_TOLERANCE,
  relativeTolerance: 1e-4,
};

async function endToEndSnapshot(channel: TiktokBreakevenChannel, source: TiktokBreakevenSource) {
  const [campaigns, products] = await Promise.all([
    computeTiktokAdsBreakevenUncached(channel, { source }),
    computeTiktokProductBreakevensUncached(channel, BREAKEVEN_MIN_COVERAGE_PCT, { source }),
  ]);
  return {
    campaigns: { shop: campaigns.shop, byCampaignRowId: Object.fromEntries(campaigns.byCampaignRowId) },
    products: { ...products, products: keyBy(products.products, (p) => p.productId) },
  };
}

/**
 * So hai đường cộng cho một gian TikTok. `extraSets` / `extraCheckFrom`: nhóm thêm
 * và ngày đầu tự kiểm của nhóm thêm, cho test (khóa không được trùng nhóm thật).
 * `endToEnd: false` → chỉ so tầng số gốc.
 */
export async function compareBreakevenSources(
  channel: TiktokBreakevenChannel,
  opts: { extraSets?: AdsGroupSets; extraCheckFrom?: ReadonlyMap<string, string>; endToEnd?: boolean } = {}
): Promise<BreakevenCompareReport> {
  const range = tiktokMarginWindowRange();
  const inputs = await loadBreakevenInputs(channel.id);
  const sets: AdsGroupSets = new Map(inputs.sets);
  for (const [key, skus] of opts.extraSets ?? []) {
    if (sets.has(key)) throw new Error(`compareBreakevenSources: nhom them "${key}" trung nhom that`);
    sets.set(key, skus);
  }
  const checks: TiktokCheckWindows = {
    from: new Map([...inputs.checks.from, ...(opts.extraCheckFrom ?? [])]),
    to: inputs.checks.to,
  };

  const t0 = Date.now();
  const rows = await loadBreakevenRows(channel, "ledger", range);
  const t1 = Date.now();
  const sqlGroups = await loadBreakevenGroups(channel, tiktokGroupMappingOf(sets, checks), range);
  const t2 = Date.now();

  const fromRows = breakevensFromRows(rows, sets, checks, range.lte.getTime());
  const fromSql = breakevensFromGroups(sqlGroups);

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
  // Danh sách sản phẩm của tab Hòa vốn sản phẩm: cùng tập sản phẩm có dòng hàng có giá.
  const productsRows = fromRows.productBases();
  const productsSql = fromSql.productBases();
  for (const productId of new Set([...productsRows.keys(), ...productsSql.keys()])) {
    if (!productsRows.has(productId) || !productsSql.has(productId)) {
      baseMismatches.push(`san pham ${productId}: co o rows ${productsRows.has(productId)}, co o sql ${productsSql.has(productId)}`);
    }
  }

  const checkMismatches: string[] = [];
  for (const key of checks.from.keys()) {
    const a = fromRows.placedRevenue(key);
    const b = fromSql.placedRevenue(key);
    const d = Math.abs(a - b);
    if (d > maxMoneyDiff) maxMoneyDiff = d;
    if (d > BREAKEVEN_COMPARE_MONEY_TOLERANCE) checkMismatches.push(`${key}: ${a.toFixed(2)}/${b.toFixed(2)}`);
  }

  // Đà bán: sản phẩm vắng mặt ở một đường = số 0 ở đường kia.
  const paceMismatches: string[] = [];
  const paceRows = fromRows.productPace();
  const paceSql = fromSql.productPace();
  for (const productId of new Set([...paceRows.keys(), ...paceSql.keys()])) {
    const a = paceRows.get(productId) ?? { units7d: 0, units30d: 0 };
    const b = paceSql.get(productId) ?? { units7d: 0, units30d: 0 };
    if (a.units7d !== b.units7d || a.units30d !== b.units30d) {
      paceMismatches.push(`${productId}: ${JSON.stringify(a)}/${JSON.stringify(b)}`);
    }
  }

  const endToEndMismatches: string[] = [];
  if (opts.endToEnd !== false) {
    const [viaRows, viaSql] = await Promise.all([endToEndSnapshot(channel, "rows"), endToEndSnapshot(channel, "sql")]);
    diffJson(viaRows, viaSql, "ketqua", endToEndMismatches, END_TO_END_DIFF);
  }

  const capped = rows.length >= TIKTOK_BREAKEVEN_MAX_ORDERS;
  return {
    groups: keys.length,
    rowsOrders: rows.length,
    capped,
    shop: { rows: fromRows.base(SHOP_GROUP), sql: fromSql.base(SHOP_GROUP) },
    maxMoneyDiff,
    baseMismatches,
    checkMismatches,
    paceMismatches,
    endToEndMismatches,
    timing: { rowsMs: t1 - t0, sqlMs: t2 - t1 },
    ok:
      !capped &&
      baseMismatches.length === 0 &&
      checkMismatches.length === 0 &&
      paceMismatches.length === 0 &&
      endToEndMismatches.length === 0,
  };
}
