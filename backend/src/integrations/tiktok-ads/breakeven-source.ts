// ============================================================
// HÒA VỐN QUẢNG CÁO TikTok — NẠP TỪ DATABASE + BỘ ĐỆM
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 12)
//
// Hai đường cộng cho cùng một kết quả (luật ở lib/tiktok-breakeven.ts):
//   "sql"  (mặc định): GROUP BY trên sổ dòng hàng (ledgerTiktokBreakevenByGroup)
//          — đủ mọi đơn, RAM chỉ giữ một dòng kết quả cho mỗi nhóm.
//   "rows" (đường lui TIKTOK_BREAKEVEN_SOURCE=rows, gỡ ~07/10): giữ dòng gọn của
//          đơn 60 ngày trong RAM rồi duyệt; có phanh TIKTOK_BREAKEVEN_MAX_ORDERS.
// Hai nơi dùng (hòa vốn chiến dịch, tab Hòa vốn sản phẩm) cùng dựng MỘT bộ nhóm
// nên ở đường "sql" dùng chung một lượt gom.
// ============================================================

import { ChannelName } from "@prisma/client";
import { dateKey, vnDateKey } from "../../lib/ads-dates";
import { buildAdsGroupSets, campaignGroupKey, groupSkusByItemId, type AdsGroupSets } from "../../lib/ads-margin";
import { registerCostCacheInvalidator } from "../../lib/cost-cache-invalidation";
import type { DateRangeFilter } from "../../lib/date-range";
import { prisma } from "../../lib/prisma";
import {
  resolveReportSource,
  resolveTiktokBreakevenSource,
  type ReportSource,
  type TiktokBreakevenSource,
} from "../../lib/report-source";
import {
  TIKTOK_BREAKEVEN_MAX_ORDERS,
  TIKTOK_MARGIN_WINDOW_DAYS,
  breakevensFromGroups,
  breakevensFromRows,
  tiktokCampaignCheckOf,
  tiktokGroupMappingOf,
  tiktokMarginWindowRange,
  type BreakevenPnlRow,
  type ChannelBreakevens,
  type LedgerTiktokBreakevenGroup,
  type LedgerTiktokBreakevenMapping,
  type TiktokCampaignCheck,
  type TiktokCheckWindows,
  type TiktokGroupMapping,
} from "../../lib/tiktok-breakeven";
import { computePnlRow, forEachPnlOrderPage } from "../../routes/finance";
import { ensureLedgerFresh, ledgerCompactOrders, ledgerTiktokBreakevenByGroup } from "../../services/order-ledger";

/** Định danh gian truyền vào các phép tính hòa vốn. */
export interface TiktokBreakevenChannel {
  id: string;
  userId: string;
}

const scopeOf = (channel: TiktokBreakevenChannel) => ({
  userId: channel.userId,
  id: channel.id,
  channelName: ChannelName.TIKTOK,
});

// ------------------------------------------------------------
// Chiến dịch + sản phẩm sàn → bộ nhóm, khoảng tự kiểm
// ------------------------------------------------------------

/** Mọi thứ phép tính hòa vốn cần NGOÀI đơn hàng — dùng chung cho hòa vốn chiến dịch lẫn tab Hòa vốn sản phẩm. */
export async function loadBreakevenInputs(channelId: string) {
  const [campaigns, channelProducts] = await Promise.all([
    prisma.adsCampaign.findMany({
      where: { channelId },
      select: {
        id: true,
        name: true,
        status: true,
        roasTarget: true,
        itemIds: true,
        dailyPerf: {
          where: { date: { gte: new Date(`${vnDateKey(TIKTOK_MARGIN_WINDOW_DAYS - 1)}T00:00:00Z`) } },
          select: { date: true, broadGmv: true, expense: true },
        },
      },
    }),
    prisma.channelProduct.findMany({
      where: { channelId, externalId: { not: null } },
      select: { channelSku: true, externalId: true, productName: true, imageUrl: true, channelStock: true },
    }),
  ]);
  // externalId TikTok = "productId-skuId" (tiktok-adapter) — productId chính là item_group_id của report GMV Max.
  const skusByProductId = groupSkusByItemId(channelProducts);
  const sets: AdsGroupSets = buildAdsGroupSets(skusByProductId, campaigns);

  // Tự kiểm mẫu số trên đúng những ngày Hubsell CÓ số TikTok của chiến dịch (tới hết hôm qua — hôm nay còn dở).
  const yesterday = vnDateKey(1);
  const checkByCampaignRowId = new Map<string, TiktokCampaignCheck>();
  const checkFrom = new Map<string, string>();
  for (const c of campaigns) {
    const check = tiktokCampaignCheckOf(
      c.dailyPerf.map((p) => ({ day: dateKey(p.date), gmv: Number(p.broadGmv) })),
      yesterday
    );
    if (!check) continue;
    checkByCampaignRowId.set(c.id, check);
    checkFrom.set(campaignGroupKey(c.id), check.from);
  }
  const checks: TiktokCheckWindows = { from: checkFrom, to: yesterday };
  return { campaigns, channelProducts, skusByProductId, sets, checks, checkByCampaignRowId };
}

export type TiktokBreakevenInputs = Awaited<ReturnType<typeof loadBreakevenInputs>>;

// ------------------------------------------------------------
// Đường "rows": dòng gọn của từng đơn
// ------------------------------------------------------------

/**
 * Đơn 60 ngày của gian ở dạng gọn (tối đa TIKTOK_BREAKEVEN_MAX_ORDERS đơn mới nhất) theo nguồn số (docs/SO-CAI-DON.md mục 9.7):
 *   - "ledger" (mặc định từ 30/09/2026): hai câu SELECT trên sổ cái đơn + bảng bản kê TikTok (chỉ lấy cờ "ước tính") —
 *     không đọc bảng đơn kèm dòng hàng / kho / bản kê đầy đủ, không tính lại computePnlRow ở mỗi lượt mở trang.
 *   - "orders" (LEDGER_REPORTS_SOURCE=orders): đường cũ đọc đơn theo trang qua computePnlRow.
 * Hai đường cho cùng dòng BreakevenPnlRow (có test trên DB dev).
 * `range`: công cụ đối chiếu truyền CÙNG một cửa sổ cho hai đường cộng.
 */
export async function loadBreakevenRows(
  channel: TiktokBreakevenChannel,
  source: ReportSource = resolveReportSource(undefined, process.env.LEDGER_REPORTS_SOURCE),
  range: DateRangeFilter = tiktokMarginWindowRange()
): Promise<BreakevenPnlRow[]> {
  const scope = scopeOf(channel);
  const rows: BreakevenPnlRow[] = [];
  if (source === "orders") {
    // Đọc THEO TRANG rồi rút ngay thành dòng gọn (22/09/2026 — gian ~185 đơn/ngày = ~11.000 đơn kèm include nặng, giữ nguyên
    // cả mảng từng làm Render hết heap).
    await forEachPnlOrderPage(scope, range, { max: TIKTOK_BREAKEVEN_MAX_ORDERS }, (page) => {
      for (const o of page) {
        const r = computePnlRow(o);
        rows.push({
          createdAt: r.createdAt,
          shippingStatus: r.shippingStatus,
          // Chỉ bản kê THẬT mới là "đã đối soát"; số ước tính của sàn (estimated) thì chưa.
          isSettled: r.isSettled && r.tiktok != null && (r.tiktok as { estimated?: boolean }).estimated !== true,
          // Chỉ giữ 3 trường phép tính cần — bỏ tham chiếu tới object sản phẩm của trang.
          items: r.items.map((it) => ({ sku: it.sku, price: it.price, quantity: it.quantity })),
          actualRevenue: r.actualRevenue,
          profit: r.profit,
          missingCostPrice: r.missingCostPrice,
          tiktok: r.tiktok ? { feeGmvMax: Number((r.tiktok as Record<string, unknown>).feeGmvMax) || 0 } : null,
        });
      }
    });
    return rows;
  }
  // Giá vốn vừa nhập phải vào hòa vốn ngay → tính nốt dòng bẩn của cửa sổ trước khi đọc.
  await ensureLedgerFresh(scope, range, { maxInline: 1000 });
  const { orders } = await ledgerCompactOrders(scope, range, TIKTOK_BREAKEVEN_MAX_ORDERS, { withTiktokSettlement: true });
  for (const o of orders) {
    rows.push({
      createdAt: o.createdAt,
      shippingStatus: o.shippingStatus,
      isSettled: o.isSettled && o.tiktok != null && !o.tiktok.estimated,
      items: o.items.map((it) => ({ sku: it.sku, price: it.price, quantity: it.quantity })),
      actualRevenue: o.actualRevenue,
      profit: o.profit,
      missingCostPrice: o.missingCostPrice,
      tiktok: o.tiktok ? { feeGmvMax: o.feeGmvMax } : null,
    });
  }
  return rows;
}

// ------------------------------------------------------------
// Đường "sql": kết quả gom theo nhóm
// ------------------------------------------------------------

/**
 * Gom trong database cho MỌI nhóm của gian — một câu SQL, không nhớ đệm. Tính
 * nốt dòng bẩn của cửa sổ trước (giá vốn vừa nhập phải vào hòa vốn ngay), như
 * loadBreakevenRows. Mốc 7 / 30 ngày của đà bán lùi từ `range.lte`.
 */
export async function loadBreakevenGroups(
  channel: TiktokBreakevenChannel,
  mapping: LedgerTiktokBreakevenMapping,
  range: DateRangeFilter = tiktokMarginWindowRange()
): Promise<Map<string, LedgerTiktokBreakevenGroup>> {
  const scope = scopeOf(channel);
  await ensureLedgerFresh(scope, range, { maxInline: 1000 });
  return ledgerTiktokBreakevenByGroup(scope, range, mapping, { paceNow: range.lte });
}

/**
 * Nhớ KẾT QUẢ gom theo gian (nhỏ — không nhớ đơn hàng), thời hạn `ADS_PNL_CACHE_MIN`
 * (mặc định 30 phút) — cùng cấu hình và cùng lệnh xóa khi nhập giá vốn với bộ
 * đệm biên lãi Shopee/Lazada (ads-margin-source.ts). Anh Trung chốt 30/09/2026:
 * câu gom của gian 600.000 đơn / 60 ngày mất khoảng 5 giây (đo trên DB dev), chạy
 * lại mỗi 45 giây khi khách mở trang là quá dày; nguyên liệu hòa vốn 60 ngày đổi
 * rất chậm nên trễ tối đa 30 phút (đơn / bản kê mới về) không đổi quyết định
 * nào, còn giá vốn vừa nhập thì xóa đệm ngay. Bộ nhóm hoặc khoảng tự kiểm đổi →
 * `digest` khác → gom lại ngay (khoảng tự kiểm đổi mỗi khi sang ngày mới). Hòa
 * vốn chiến dịch và tab Hòa vốn sản phẩm dùng chung một lượt gom; các lượt gọi
 * đang chờ cũng vậy. Chiến dịch + số quảng cáo theo ngày KHÔNG nằm trong bộ đệm
 * này — vẫn đọc tươi ở mỗi lượt tính (memoizeByChannel 45 giây ở breakeven.ts).
 * Đường "rows" không dùng bộ đệm này.
 */
const BREAKEVEN_GROUPS_TTL_MS = Math.max(0, Number(process.env.ADS_PNL_CACHE_MIN ?? 30) || 0) * 60_000;
const BREAKEVEN_GROUPS_MAX_CHANNELS = 500;
const breakevenGroupsCache = new Map<
  string,
  { at: number; digest: string; groups: Promise<Map<string, LedgerTiktokBreakevenGroup>> }
>();
registerCostCacheInvalidator((ids) => ids.forEach((id) => breakevenGroupsCache.delete(id)));

async function fetchChannelBreakevenGroups(
  channel: TiktokBreakevenChannel,
  mapping: TiktokGroupMapping
): Promise<Map<string, LedgerTiktokBreakevenGroup>> {
  const hit = breakevenGroupsCache.get(channel.id);
  if (hit && hit.digest === mapping.digest && Date.now() - hit.at < BREAKEVEN_GROUPS_TTL_MS) {
    return hit.groups;
  }
  const groups = loadBreakevenGroups(channel, mapping);
  if (BREAKEVEN_GROUPS_TTL_MS > 0) {
    if (!hit && breakevenGroupsCache.size >= BREAKEVEN_GROUPS_MAX_CHANNELS) {
      const oldest = breakevenGroupsCache.keys().next().value;
      if (oldest !== undefined) breakevenGroupsCache.delete(oldest);
    }
    breakevenGroupsCache.set(channel.id, { at: Date.now(), digest: mapping.digest, groups });
    groups.catch(() => {
      // lỗi thì không giữ bản hỏng (chỉ gỡ nếu chưa bị lượt gom mới hơn thay)
      if (breakevenGroupsCache.get(channel.id)?.groups === groups) breakevenGroupsCache.delete(channel.id);
    });
  }
  return groups;
}

// ------------------------------------------------------------
// Mặt tiền: chọn đường cộng, có lưới đỡ
// ------------------------------------------------------------

/**
 * Sau một lượt câu gom lỗi, gian đó đi thẳng đường "rows" trong bấy lâu rồi mới
 * thử lại câu gom — cùng mức 5 phút với lưới đỡ của Shopee/Lazada
 * (MARGIN_SQL_FAILURE_COOLDOWN_MS): mặc định tự chọn, đủ để không dội lại một câu
 * đang lỗi ở mỗi lượt mở trang, đủ ngắn để tự hồi khi database hết sự cố.
 */
export const BREAKEVEN_SQL_FAILURE_COOLDOWN_MS = 5 * 60_000;
const breakevenSqlFailedAt = new Map<string, number>();

/**
 * Nguyên liệu hòa vốn + tự kiểm + đà bán của mọi nhóm của gian.
 *
 * `source` bỏ trống = theo env, và có LƯỚI ĐỠ như Shopee/Lazada: câu gom trong
 * database lỗi thì lượt đó tính bằng đường "rows" để khách vẫn thấy số, lỗi ghi
 * ra log với nhãn [Tiktok-breakeven]. `source` truyền tường minh (công cụ đối
 * chiếu, test) = đúng đường đó, lỗi ném ra nguyên vẹn — không để lưới đỡ che mất lệch.
 */
export async function fetchChannelBreakevens(
  channel: TiktokBreakevenChannel,
  inputs: Pick<TiktokBreakevenInputs, "sets" | "checks">,
  source?: TiktokBreakevenSource
): Promise<ChannelBreakevens> {
  const viaRows = async () => breakevensFromRows(await loadBreakevenRows(channel), inputs.sets, inputs.checks);
  const viaSql = async () =>
    breakevensFromGroups(await fetchChannelBreakevenGroups(channel, tiktokGroupMappingOf(inputs.sets, inputs.checks)));

  const resolved = source ?? resolveTiktokBreakevenSource();
  if (resolved === "rows") return viaRows();
  if (source !== undefined) return viaSql();
  const failedAt = breakevenSqlFailedAt.get(channel.id);
  if (failedAt === undefined || Date.now() - failedAt >= BREAKEVEN_SQL_FAILURE_COOLDOWN_MS) {
    try {
      const breakevens = await viaSql();
      breakevenSqlFailedAt.delete(channel.id);
      return breakevens;
    } catch (err) {
      breakevenSqlFailedAt.set(channel.id, Date.now());
      console.error(
        `[Tiktok-breakeven] Câu gom hòa vốn trong database LỖI ở gian ${channel.id} — ` +
          `lượt này và ${BREAKEVEN_SQL_FAILURE_COOLDOWN_MS / 60_000} phút tới tính bằng đường "rows":`,
        err
      );
    }
  }
  return viaRows();
}
