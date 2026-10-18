// ============================================================
// BIÊN LÃI QUẢNG CÁO Shopee / Lazada — NẠP TỪ DATABASE + BỘ ĐỆM
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md)
//
// Hai đường cộng cho cùng một kết quả (luật ở lib/ads-margin.ts):
//   "sql"  (mặc định): GROUP BY trên sổ dòng hàng (ledgerMarginByGroup) — đủ mọi
//          đơn, RAM chỉ giữ một dòng kết quả cho mỗi nhóm.
//   "rows" : dòng gọn của cả cửa sổ đọc từ SỔ CÁI (ledgerCompactOrders) rồi duyệt
//          trong RAM; có phanh MARGIN_MAX_ORDERS. Từ 14/10/2026 chỉ còn hai nơi
//          dùng: lưới đỡ khi câu gom lỗi (anh Trung chốt 30/09) và công cụ đối
//          chiếu / test (`source` truyền tường minh). Công tắc env
//          ADS_MARGIN_SOURCE và đường đọc đơn gốc đã gỡ.
// Ba nơi dùng (chiến dịch, bảng hòa vốn sản phẩm, gợi ý chạy quảng cáo) cùng
// dựng MỘT bộ nhóm nên dùng chung một lượt gom.
// ============================================================

import { ChannelName } from "@prisma/client";
import {
  MARGIN_MAX_ORDERS,
  SALES_PACE_RECENT_MS,
  adsGroupMappingOf,
  buildAdsGroupSets,
  groupSkusByItemId,
  marginGroupStatsOf,
  marginWindowRange,
  marginsFromGroups,
  marginsFromRows,
  pnlRowsForMargin,
  type AdsGroupMapping,
  type AdsGroupSets,
  type AdsInsightChannel,
  type AdsMarginSource,
  type ChannelMargins,
  type LedgerMarginOptions,
  type MarginCheckWindows,
  type MarginGroupStats,
  type MarginRow,
} from "../../lib/ads-margin";
import { registerCostCacheInvalidator } from "../../lib/cost-cache-invalidation";
import type { DateRangeFilter } from "../../lib/date-range";
import { prisma } from "../../lib/prisma";
import { ensureLedgerFresh, ledgerCompactOrders, ledgerMarginByGroup, ledgerPlacedRevenueByGroup } from "../../services/order-ledger";

// ------------------------------------------------------------
// Đường "rows": dòng gọn của từng đơn
// ------------------------------------------------------------

/**
 * Đơn của MỘT gian trong cửa sổ, dạng gọn, mới nhất trước, đọc từ SỔ CÁI
 * (docs/SO-CAI-DON.md mục 9.7): hai câu SELECT — không đọc bảng đơn kèm dòng
 * hàng / kho / bản kê, không tính lại computePnlRow ở mỗi lượt. Tính nốt dòng
 * bẩn của cửa sổ trước (giá vốn vừa nhập phải vào biên lãi ngay).
 * `range`: công cụ đối chiếu truyền CÙNG một cửa sổ cho hai đường cộng.
 */
export async function loadMarginRows(
  channel: AdsInsightChannel,
  range: DateRangeFilter = marginWindowRange()
): Promise<MarginRow[]> {
  const scope = { userId: channel.userId, id: channel.id, channelName: channel.channelName };
  await ensureLedgerFresh(scope, range, { maxInline: 1000 });
  const { orders } = await ledgerCompactOrders(scope, range, MARGIN_MAX_ORDERS);
  return orders;
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
const MARGIN_CACHE_TTL_MS =
  Math.max(0, Number(process.env.ADS_PNL_CACHE_MIN ?? 30) || 0) * 60_000;
const MARGIN_CACHE_MAX_CHANNELS = 200;
const marginRowsCache = new Map<string, { at: number; rows: Promise<MarginRow[]> }>();

async function fetchChannelMarginRows(channel: AdsInsightChannel): Promise<MarginRow[]> {
  const hit = marginRowsCache.get(channel.id);
  if (hit && Date.now() - hit.at < MARGIN_CACHE_TTL_MS) {
    return (await hit.rows).slice();
  }
  // Nhớ bản THÔ (mọi đơn đặt) — tự kiểm (Lát 4) cần cả đơn hủy / chưa đối soát; biên lãi lọc theo luật sàn lúc dùng.
  const rows = loadMarginRows(channel);
  if (MARGIN_CACHE_TTL_MS > 0) {
    if (marginRowsCache.size >= MARGIN_CACHE_MAX_CHANNELS) {
      const oldest = marginRowsCache.keys().next().value;
      if (oldest !== undefined) marginRowsCache.delete(oldest);
    }
    marginRowsCache.set(channel.id, { at: Date.now(), rows });
    rows.catch(() => marginRowsCache.delete(channel.id)); // lỗi thì không giữ bản hỏng
  }
  return (await rows).slice();
}

// ------------------------------------------------------------
// Đường "sql": kết quả gom theo nhóm
// ------------------------------------------------------------

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
  mapping: Pick<AdsGroupMapping, "groups" | "keys"> & Partial<Pick<AdsGroupMapping, "checkFrom" | "checkTo">>,
  range: DateRangeFilter = marginWindowRange()
): Promise<Map<string, MarginGroupStats>> {
  const scope = { userId: channel.userId, id: channel.id, channelName: channel.channelName };
  await ensureLedgerFresh(scope, range, { maxInline: 1000 });
  const raw = await ledgerMarginByGroup(scope, range, mapping, marginGroupOptions(channel.channelName, range));
  const groups = new Map<string, MarginGroupStats>();
  for (const [groupKey, sums] of raw) groups.set(groupKey, marginGroupStatsOf(sums));
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
  if (hit && hit.digest === mapping.digest && Date.now() - hit.at < MARGIN_CACHE_TTL_MS) {
    return hit.groups;
  }
  const groups = loadMarginGroups(channel, mapping);
  if (MARGIN_CACHE_TTL_MS > 0) {
    if (!hit && marginGroupsCache.size >= MARGIN_CACHE_MAX_CHANNELS) {
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

/** Xóa bộ đệm biên lãi của một gian ở CẢ hai đường cộng. */
function invalidateChannelMargins(channelId: string): void {
  marginRowsCache.delete(channelId);
  marginGroupsCache.delete(channelId);
  placedRevenueCache.delete(channelId);
}
// Nhập giá vốn / áp cho đơn cũ → biên lãi đổi → xóa bộ đệm của các gian đó ngay
// (28/09: giữ 30' làm bảng ROAS hòa vốn báo "chưa có giá vốn" dù đã vá xong).
registerCostCacheInvalidator((ids) => ids.forEach(invalidateChannelMargins));

// ------------------------------------------------------------
// Mặt tiền: chọn đường cộng, có lưới đỡ
// ------------------------------------------------------------

/**
 * Sau một lượt câu gom lỗi, gian đó đi thẳng đường "rows" trong bấy lâu rồi mới
 * thử lại câu gom. 5 phút là mặc định tự chọn: đủ để không dội lại một câu đang
 * lỗi (hoặc đang quá thời gian) ở mỗi lượt mở trang, đủ ngắn để tự hồi khi
 * database hết sự cố.
 */
export const MARGIN_SQL_FAILURE_COOLDOWN_MS = 5 * 60_000;
const marginSqlFailedAt = new Map<string, number>();

/**
 * Biên lãi + nhịp bán của mọi nhóm của gian (có nhớ đệm).
 *
 * `source` bỏ trống = câu gom trong database, có LƯỚI ĐỠ (anh Trung chốt
 * 30/09/2026): câu gom lỗi thì lượt đó tính bằng đường "rows" (dòng gọn đọc từ
 * sổ cái) để khách vẫn thấy số, lỗi ghi ra log với nhãn [Ads-margin]. `source`
 * truyền tường minh (công cụ đối chiếu, test) = đúng đường đó, lỗi ném ra nguyên
 * vẹn — không để lưới đỡ che mất lệch.
 */
export async function fetchChannelMargins(
  channel: AdsInsightChannel,
  sets: AdsGroupSets,
  source?: AdsMarginSource,
  checks?: MarginCheckWindows
): Promise<ChannelMargins> {
  // Đường "rows": tự kiểm cần MỌI đơn đặt (kể cả hủy / chưa đối soát) → giữ bản thô bên cạnh bản đã lọc theo luật sàn.
  const viaRows = async () => {
    const raw = await fetchChannelMarginRows(channel);
    return marginsFromRows(pnlRowsForMargin(raw, channel.channelName), sets, undefined, checks, raw);
  };
  // Đường "sql": biên lãi theo bộ nhóm (đệm dùng chung Trợ lý / tab sản phẩm / gợi ý — digest KHÔNG gồm khoảng tự kiểm) + tự kiểm
  // bằng câu riêng nhẹ (đệm riêng theo digest có khoảng), ghép lại một mặt tiền.
  const viaSql = async () => {
    const groups = await fetchChannelMarginGroups(channel, adsGroupMappingOf(sets));
    const placed = checks ? await fetchChannelPlacedRevenue(channel, adsGroupMappingOf(sets, checks)) : new Map<string, number>();
    const base = marginsFromGroups(groups);
    return { ...base, placedRevenue: (groupKey: string) => placed.get(groupKey) ?? 0 };
  };
  if (source === "rows") return viaRows();
  if (source === "sql") return viaSql();
  const failedAt = marginSqlFailedAt.get(channel.id);
  if (failedAt === undefined || Date.now() - failedAt >= MARGIN_SQL_FAILURE_COOLDOWN_MS) {
    try {
      const margins = await viaSql();
      marginSqlFailedAt.delete(channel.id);
      return margins;
    } catch (err) {
      marginSqlFailedAt.set(channel.id, Date.now());
      console.error(
        `[Ads-margin] Câu gom biên lãi trong database LỖI ở gian ${channel.id} (${channel.channelName}) — ` +
          `lượt này và ${MARGIN_SQL_FAILURE_COOLDOWN_MS / 60_000} phút tới tính bằng đường "rows":`,
        err
      );
    }
  }
  return viaRows();
}

/**
 * Tự kiểm doanh thu (Lát 4) ở đường "sql": một câu riêng, nhớ KẾT QUẢ theo gian + digest có khoảng tự kiểm (đổi mỗi ngày),
 * cùng thời hạn và cùng lệnh xóa với đệm biên lãi.
 */
const placedRevenueCache = new Map<string, { at: number; digest: string; placed: Promise<Map<string, number>> }>();

async function fetchChannelPlacedRevenue(channel: AdsInsightChannel, mapping: AdsGroupMapping): Promise<Map<string, number>> {
  const hit = placedRevenueCache.get(channel.id);
  if (hit && hit.digest === mapping.digest && Date.now() - hit.at < MARGIN_CACHE_TTL_MS) return hit.placed;
  const scope = { userId: channel.userId, id: channel.id, channelName: channel.channelName };
  const placed = ledgerPlacedRevenueByGroup(scope, marginWindowRange(), mapping);
  if (MARGIN_CACHE_TTL_MS > 0) {
    if (!hit && placedRevenueCache.size >= MARGIN_CACHE_MAX_CHANNELS) {
      const oldest = placedRevenueCache.keys().next().value;
      if (oldest !== undefined) placedRevenueCache.delete(oldest);
    }
    placedRevenueCache.set(channel.id, { at: Date.now(), digest: mapping.digest, placed });
    placed.catch(() => {
      if (placedRevenueCache.get(channel.id)?.placed === placed) placedRevenueCache.delete(channel.id);
    });
  }
  return placed;
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
