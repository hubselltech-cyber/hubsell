// ============================================================
// TIKTOK ADS — ĐỒNG BỘ CAMPAIGN GMV MAX VÀO BẢNG ADS DÙNG CHUNG (chỉ đọc)
//
// Ghi vào AdsCampaign + AdsCampaignDailyPerf — cùng bảng với Shopee/Lazada, sàn
// suy từ Channel.channelName. Kéo CẢ HAI loại GMV Max (20/10/2026 — khách 69Minh
// Đương nối gian 19/10: Seller Center tab "Chiến dịch GMV Max" 26,9tr, Hubsell 9,7tr
// vì chỉ kéo Product): Product GMV Max (adType gmv_max) + LIVE GMV Max (adType
// gmv_max_live, chỉ có số chiến dịch × ngày — không soi video, không luật tự động).
// Sàn bắt buộc lọc một loại mỗi call → 2 call báo cáo + 2 call danh sách mỗi lượt.
// LIVE hỏng (sàn đổi tham số, thiếu quyền) thì ghi log và vẫn ghi Product như cũ.
// Ánh xạ từ vựng:
//   operation_status ENABLE/DISABLE → status ongoing/paused (campaign-status.ts)
//   vắng ở /gmv_max/campaign/get/     → status ended (đã xóa / kết thúc trên TikTok —
//     báo cáo chỉ có chiến dịch TIÊU TIỀN trong kỳ nên một mình nó không nói được
//     chiến dịch nào đã biến mất; xem reconcileTiktokCampaignStatuses)
//   roas_bid (ROI mục tiêu)         → roasTarget (NO_BID = phân phối tối đa → NULL)
//   cost / orders / gross_revenue   → expense / broad* VÀ direct* (GMV Max chỉ
//     có MỘT bộ số: đơn của chính SP trong campaign, gộp cả đơn tự nhiên —
//     không tách direct/broad như Shopee nên ghi trùng hai cặp).
//   impression / clicks             → 0 (tầng campaign của GMV Max không có).
//
// AdSpend (chi phí ads cấp gian theo NGÀY, cùng bảng với Shopee/Lazada) = Σ cost
// của mọi chiến dịch GMV Max trong ngày ĐỌC TỪ DB (20/10/2026: gồm cả chiến dịch
// khách đã xóa — sàn bỏ hẳn lịch sử của chúng khỏi báo cáo). Kiểm số thật 26/09/2026 (gian ANO, 692
// đơn): sàn KHÔNG trừ GMV Max trong đơn (gmv_max_ad_fee_amount = 0), tiền ads trả
// bằng số dư tài khoản quảng cáo → không ghi AdSpend thì dòng tiền THIẾU hẳn ads
// TikTok. Gian nào sàn thu theo đơn (feeGmvMax ≠ 0) → services/ads-spend.ts chỉ
// hiện tham chiếu, không cộng — tránh trừ hai lần.
//
// Một lượt = 1 call (campaign × ngày, ≤1000 dòng/trang). Tầng sản phẩm/video
// không lưu DB — soi sống khi chủ shop mở campaign (routes/ads-tiktok.ts).
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { dateKeyToDbDate, vnDateKey } from "../../lib/ads-dates";
import {
  TIKTOK_AD_TYPE_LIVE,
  TIKTOK_AD_TYPE_PRODUCT,
  reconcileTiktokCampaignStatuses,
  tiktokAdTypeOf,
  tiktokCampaignStatusOf,
} from "./campaign-status";
import { TiktokAdsApiError, getGmvMaxCampaigns, getGmvMaxStores, type GmvMaxCampaignListItem, type GmvMaxStore } from "./client";
import { fetchGmvMaxCampaignDaily, type GmvMaxCampaignDay } from "./report";
import { upsertAdsPerfBatch, type AdsPerfRow } from "../ads-perf-batch";

/** 40105 = access token sai hoặc đã bị thu hồi (docs Appendix - Return codes). */
const TOKEN_DEAD_CODES = new Set([40105]);

export interface TiktokAdsScope {
  linkId: string;
  accessToken: string;
  advertiserId: string;
  storeId: string;
}

/** Link quảng cáo còn dùng được của gian, hoặc null (chưa nối / token chết / mất quyền). */
export async function getTiktokAdsScope(channelId: string): Promise<TiktokAdsScope | null> {
  const link = await prisma.tiktokAdsStoreLink.findUnique({
    where: { channelId },
    select: {
      id: true,
      status: true,
      advertiserId: true,
      storeId: true,
      auth: { select: { accessToken: true, status: true } },
    },
  });
  if (!link || link.status !== "ACTIVE" || link.auth.status !== "ACTIVE") return null;
  return {
    linkId: link.id,
    accessToken: link.auth.accessToken,
    advertiserId: link.advertiserId,
    storeId: link.storeId,
  };
}

/** Ghi hậu quả của một lỗi sàn lên link/auth để UI nói thật và worker thôi gọi. */
export async function recordTiktokAdsFailure(linkId: string, err: unknown): Promise<void> {
  const message = (err as Error).message.slice(0, 500);
  const code = err instanceof TiktokAdsApiError ? err.code : 0;
  if (TOKEN_DEAD_CODES.has(code)) {
    const link = await prisma.tiktokAdsStoreLink.findUnique({ where: { id: linkId }, select: { authId: true } });
    if (link) {
      await prisma.tiktokAdsAuth.update({
        where: { id: link.authId },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
    }
  }
  await prisma.tiktokAdsStoreLink
    .update({
      where: { id: linkId },
      data: { lastSyncError: message },
    })
    .catch(() => {});
}

export type TiktokAdsLinkCheck = "ok" | "switched" | "no_access" | "skipped";

/**
 * KIỂM LẠI "AI ĐANG CHẠY GMV MAX CHO GIAN NÀY" (anh Trung 17/09/2026). Khác
 * Shopee — quyền ads gắn chết vào shop — ở TikTok tài khoản quảng cáo là thực
 * thể RỜI: chủ shop đổi người chạy thuê / chuyển quyền độc quyền GMV Max sang
 * tài khoản khác bất cứ lúc nào. Không kiểm thì Hubsell cứ đọc tài khoản cũ, số
 * lặng lẽ về 0. Một call store/list mỗi lượt lịch sử (6h):
 *   · tài khoản độc quyền vẫn là cái đang nối            → ok
 *   · đã đổi sang tài khoản KHÁC mà token này cũng thấy   → tự chuyển link
 *   · đã đổi sang tài khoản token không thấy / mất quyền  → NO_ACCESS kèm lý do
 *     nói thẳng tên tài khoản mới để chủ shop biết phải nhờ ai ủy quyền lại.
 * Lỗi mạng/lỗi sàn tạm thời → skipped, không đổi gì.
 */
export async function verifyTiktokAdsLink(channelId: string): Promise<TiktokAdsLinkCheck> {
  const link = await prisma.tiktokAdsStoreLink.findUnique({
    where: { channelId },
    select: {
      id: true,
      status: true,
      advertiserId: true,
      advertiserName: true,
      storeId: true,
      auth: { select: { accessToken: true, status: true, advertiserIds: true } },
    },
  });
  if (!link || link.status !== "ACTIVE" || link.auth.status !== "ACTIVE") return "skipped";

  let stores: GmvMaxStore[];
  try {
    stores = await getGmvMaxStores(link.auth.accessToken, link.advertiserId);
  } catch (err) {
    await recordTiktokAdsFailure(link.id, err);
    return "skipped";
  }

  const store = stores.find((x) => String(x.store_id ?? "") === link.storeId);
  const ex = store?.exclusive_authorized_advertiser_info;
  const exId = ex?.advertiser_id ? String(ex.advertiser_id) : "";
  if (exId === link.advertiserId) return "ok";

  const noAccess = async (reason: string): Promise<TiktokAdsLinkCheck> => {
    await prisma.tiktokAdsStoreLink.update({
      where: { id: link.id },
      data: { status: "NO_ACCESS", lastSyncError: reason },
    });
    return "no_access";
  };
  if (!store) {
    return noAccess(
      `Tài khoản quảng cáo "${link.advertiserName || link.advertiserId}" không còn quyền quảng cáo cho gian này trên TikTok.`
    );
  }
  if (!exId) {
    return noAccess("Gian hiện không cấp quyền chạy GMV Max cho tài khoản quảng cáo nào trên TikTok.");
  }
  if (link.auth.advertiserIds.split(",").includes(exId)) {
    await prisma.tiktokAdsStoreLink.update({
      where: { id: link.id },
      data: { advertiserId: exId, advertiserName: ex?.advertiser_name ?? "", lastSyncError: "" },
    });
    return "switched";
  }
  return noAccess(
    `Gian đã chuyển quyền chạy GMV Max sang tài khoản quảng cáo "${ex?.advertiser_name || exId}". Hãy kết nối lại bằng tài khoản TikTok quản lý tài khoản quảng cáo đó.`
  );
}

/** Link đã báo "thiếu quyền Campaign" một lần trong tiến trình — khỏi lặp log mỗi xung vài phút. */
const campaignListDenied = new Set<string>();

/**
 * Kéo /gmv_max/campaign/get/ rồi áp luật đối soát (campaign-status.ts) lên AdsCampaign
 * của gian. Trả về số chiến dịch đang chạy sau đối soát, hoặc null khi không đối soát
 * (lỗi sàn, hoặc hai nguồn mâu thuẫn: danh sách rỗng mà báo cáo vẫn có chiến dịch →
 * nhiều khả năng sàn trả thiếu, gán "ended" hàng loạt rồi lượt sau sống lại chỉ gây hoang mang).
 */
async function reconcileTiktokCampaignsWithList(
  channelId: string,
  scope: TiktokAdsScope,
  reported: ReadonlySet<string>
): Promise<number | null> {
  let listed: (GmvMaxCampaignListItem & { adType: string })[];
  try {
    const product = await getGmvMaxCampaigns(scope.accessToken, scope.advertiserId, scope.storeId, "PRODUCT_GMV_MAX");
    listed = product.map((l) => ({ ...l, adType: TIKTOK_AD_TYPE_PRODUCT }));
  } catch (err) {
    const code = err instanceof TiktokAdsApiError ? err.code : 0;
    if (code === 40001) {
      if (!campaignListDenied.has(scope.linkId)) {
        campaignListDenied.add(scope.linkId);
        console.warn(`[TikTok Ads] Token của link ${scope.linkId} chưa có quyền Campaign — chiến dịch đã xóa trên TikTok sẽ không tự về "Đã dừng" cho tới khi ủy quyền lại.`);
      }
    } else {
      console.warn(`[TikTok Ads] Không đọc được danh sách chiến dịch (bỏ qua đối soát): ${(err as Error).message}`);
    }
    return null;
  }
  // LIVE liệt kê riêng; hỏng thì KHÔNG đối soát nhóm LIVE (kẻo gán "ended" oan cả loạt) nhưng Product vẫn đối soát.
  let liveListed = true;
  try {
    const live = await getGmvMaxCampaigns(scope.accessToken, scope.advertiserId, scope.storeId, "LIVE_GMV_MAX");
    listed.push(...live.map((l) => ({ ...l, adType: TIKTOK_AD_TYPE_LIVE })));
  } catch (err) {
    liveListed = false;
    console.warn(`[TikTok Ads] Không đọc được danh sách chiến dịch LIVE GMV Max (bỏ qua đối soát LIVE): ${(err as Error).message}`);
  }
  if (listed.length === 0 && reported.size > 0) {
    console.warn(`[TikTok Ads] Danh sách chiến dịch rỗng trong khi báo cáo có ${reported.size} chiến dịch — bỏ qua đối soát lượt này.`);
    return null;
  }

  const knownAll = await prisma.adsCampaign.findMany({
    where: { channelId },
    select: { id: true, campaignId: true, status: true, name: true, adType: true },
  });
  const known = liveListed ? knownAll : knownAll.filter((k) => k.adType !== TIKTOK_AD_TYPE_LIVE);
  const r = reconcileTiktokCampaignStatuses({
    known,
    listed: listed.map((l) => ({
      campaignId: String(l.campaign_id ?? ""),
      name: l.campaign_name ?? "",
      operationStatus: l.operation_status ?? "",
      secondaryStatus: l.secondary_status,
      adType: l.adType,
    })),
    reported,
  });
  for (const u of r.updates) {
    await prisma.adsCampaign.update({ where: { id: u.id }, data: { status: u.status, ...(u.name != null ? { name: u.name } : {}) } });
  }
  for (const c of r.creates) {
    await prisma.adsCampaign.upsert({
      where: { channelId_campaignId: { channelId, campaignId: c.campaignId } },
      update: { status: c.status, name: c.name, adType: c.adType },
      create: { channelId, campaignId: c.campaignId, name: c.name, status: c.status, adType: c.adType },
    });
  }
  // liveCampaigns trả về = số chiến dịch Product + LIVE đang bật (nhịp xung chỉ cần biết "có gì đang tiêu tiền không").
  return r.liveCampaigns;
}

export interface SyncTiktokAdsResult {
  /** false = gian chưa nối quảng cáo (hoặc link hỏng) → worker giãn nhịp. */
  linked: boolean;
  campaignsUpserted: number;
  perfDaysUpserted: number;
  /** Số ngày ghi AdSpend (Σ cost chiến dịch theo ngày). */
  adSpendDaysUpserted: number;
  liveCampaigns: number;
  /** Có chi tiêu trong 2 ngày gần nhất — quyết nhịp xung. */
  spentRecently: boolean;
}

export async function syncTiktokAdsCampaigns(
  channel: Pick<Channel, "id">,
  opts: { daysBack?: number } = {}
): Promise<SyncTiktokAdsResult> {
  const result: SyncTiktokAdsResult = {
    linked: false,
    campaignsUpserted: 0,
    perfDaysUpserted: 0,
    adSpendDaysUpserted: 0,
    liveCampaigns: 0,
    spentRecently: false,
  };
  const scope = await getTiktokAdsScope(channel.id);
  if (!scope) return result;
  result.linked = true;

  // Gian chưa có dòng AdSpend nào (nối lần đầu / vừa thêm tính năng) → kéo trọn
  // 30 ngày một lần để dòng tiền không thủng lịch sử; các lượt sau theo nhịp thường.
  const firstFill = (await prisma.adSpend.count({ where: { channelId: channel.id } })) === 0;
  const daysBack = firstFill ? 30 : Math.min(30, Math.max(1, opts.daysBack ?? 7));
  const reportScope = {
    accessToken: scope.accessToken,
    advertiserId: scope.advertiserId,
    storeId: scope.storeId,
    startDate: vnDateKey(daysBack - 1),
    endDate: vnDateKey(0),
  };
  let rows: GmvMaxCampaignDay[];
  try {
    rows = await fetchGmvMaxCampaignDaily(reportScope, "PRODUCT");
  } catch (err) {
    await recordTiktokAdsFailure(scope.linkId, err);
    throw err;
  }
  // LIVE GMV Max: cùng call, lọc LIVE. Hỏng thì chỉ thiếu LIVE lượt này (log), Product không bị ảnh hưởng.
  try {
    rows = rows.concat(await fetchGmvMaxCampaignDaily(reportScope, "LIVE"));
  } catch (err) {
    console.warn(`[TikTok Ads] Không đọc được báo cáo LIVE GMV Max của link ${scope.linkId} (chỉ ghi Product lượt này): ${(err as Error).message}`);
  }

  // Thuộc tính campaign lặp lại trên mọi dòng ngày — lấy dòng MỚI NHẤT làm chuẩn.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!r.campaignId) continue;
    const cur = latest.get(r.campaignId);
    if (!cur || r.date > cur.date) latest.set(r.campaignId, r);
  }

  // Mục tiêu ROI đang lưu của từng chiến dịch — để nhận ra lần khách đổi trong Seller Center (Hubsell không sửa
  // được GMV Max qua API) và ghi mốc roasTargetChangedAt: gợi ý hạ mục tiêu khóa 48 giờ sau mỗi lần đổi (cùng luật Shopee).
  const prevTargetOf = new Map<string, number | null>();
  if (latest.size > 0) {
    const prevRows = await prisma.adsCampaign.findMany({
      where: { channelId: channel.id, campaignId: { in: [...latest.keys()] } },
      select: { campaignId: true, roasTarget: true },
    });
    for (const r of prevRows) prevTargetOf.set(r.campaignId, r.roasTarget != null ? Number(r.roasTarget) : null);
  }
  const rowIdByCampaignId = new Map<string, string>();
  for (const [campaignId, c] of latest) {
    const data = {
      name: c.name,
      adType: tiktokAdTypeOf(c.promotionType),
      status: tiktokCampaignStatusOf(c),
      biddingMethod: c.bidType === "NO_BID" ? "max_delivery" : "target_roi",
      budget: c.budget,
      roasTarget: c.roasBid,
    };
    // Chiến dịch thấy lần đầu không tính là "đổi".
    const targetChanged = prevTargetOf.has(campaignId) && prevTargetOf.get(campaignId) !== (c.roasBid ?? null);
    const row = await prisma.adsCampaign.upsert({
      where: { channelId_campaignId: { channelId: channel.id, campaignId } },
      // Giữ cả mục tiêu CŨ (roasTargetPrev) để biết lần đổi là hạ hay nâng (so lãi trước/sau nấc hạ).
      update: targetChanged ? { ...data, roasTargetChangedAt: new Date(), roasTargetPrev: prevTargetOf.get(campaignId) ?? null } : data,
      create: { channelId: channel.id, campaignId, ...data },
    });
    rowIdByCampaignId.set(campaignId, row.id);
    result.campaignsUpserted++;
    if (data.status === "ongoing") result.liveCampaigns++;
  }

  // ĐỐI SOÁT với danh sách chiến dịch còn tồn tại: chiến dịch tắt lâu không tiêu tiền
  // vẫn hiện (tạm dừng), chiến dịch TikTok không còn liệt kê → "ended". Hỏng (thiếu
  // quyền Campaign ở token cũ, lỗi mạng) thì bỏ qua — báo cáo vẫn là xương sống.
  const live = await reconcileTiktokCampaignsWithList(channel.id, scope, new Set(latest.keys()));
  if (live != null) result.liveCampaigns = live;

  // Gom rồi ghi theo lô (ads-perf-batch) — trước đây mỗi (chiến dịch, ngày) một upsert.
  // Chỉ 5 cột TikTok có số: impression/clicks/*OrderAmount không bị đè (như update: data cũ).
  const recentFrom = vnDateKey(1);
  const perfRows: AdsPerfRow[] = [];
  for (const r of rows) {
    const rowId = rowIdByCampaignId.get(r.campaignId);
    if (!rowId || !r.date) continue;
    if (r.cost <= 0 && r.orders <= 0 && r.gmv <= 0) continue; // dòng 0 không mang thông tin
    const orders = Math.trunc(r.orders);
    perfRows.push({
      adsCampaignId: rowId,
      date: dateKeyToDbDate(r.date),
      expense: r.cost,
      broadOrder: orders,
      broadGmv: r.gmv,
      directOrder: orders,
      directGmv: r.gmv,
    });
    if (r.cost > 0 && r.date >= recentFrom) result.spentRecently = true;
  }
  result.perfDaysUpserted += await upsertAdsPerfBatch(perfRows, ["expense", "broadOrder", "broadGmv", "directOrder", "directGmv"]);

  // Chi phí ads cấp gian theo ngày = Σ AdsCampaignDailyPerf của gian trong DB, KHÔNG phải Σ dòng báo cáo lượt này:
  // chiến dịch khách XÓA biến khỏi MỌI tầng báo cáo của sàn (kể cả tổng tài khoản) nhưng tiền vẫn đã tiêu —
  // DB là nơi duy nhất còn giữ. Trước 20/10 lấy Σ dòng lượt này → dòng 0₫ của chiến dịch còn sống đè ngày của
  // chiến dịch đã xóa về 0 (khách 69Minh Đương: 13–18/10 mất 5,3tr, dòng tiền 3,75tr vs màn quảng cáo 9,75tr).
  // Ngày sàn có trả dòng (dù 0₫) hoặc DB có số thì ghi; ngày khác để nguyên.
  const perfByDay = await prisma.adsCampaignDailyPerf.groupBy({
    by: ["date"],
    where: {
      adsCampaign: { channelId: channel.id },
      date: { gte: dateKeyToDbDate(reportScope.startDate), lte: dateKeyToDbDate(reportScope.endDate) },
    },
    _sum: { expense: true },
  });
  const dbTotals = new Map(perfByDay.map((p) => [p.date.toISOString().slice(0, 10), Number(p._sum.expense ?? 0)]));
  for (const [date, amount] of tiktokAdSpendByDay(rows, dbTotals)) {
    await prisma.adSpend.upsert({
      where: { channelId_date: { channelId: channel.id, date: dateKeyToDbDate(date) } },
      update: { amount },
      create: { channelId: channel.id, date: dateKeyToDbDate(date), amount },
    });
    result.adSpendDaysUpserted++;
  }

  await prisma.tiktokAdsStoreLink.update({
    where: { id: scope.linkId },
    data: { lastSyncedAt: new Date(), lastSyncError: "" },
  });
  return result;
}

/**
 * AdSpend cần ghi theo ngày (thuần — có test): ngày = hợp của ngày sàn trả dòng lượt này và ngày DB có số;
 * số tiền = Σ chiến dịch trong DB (dbTotals, gồm cả chiến dịch đã xóa), ngày DB chưa có thì 0. Ngày tăng dần.
 */
export function tiktokAdSpendByDay(rows: { date: string }[], dbTotals: Map<string, number>): Map<string, number> {
  const days = new Set<string>(dbTotals.keys());
  for (const r of rows) if (r.date) days.add(r.date);
  return new Map(
    [...days].sort().map((d) => {
      const v = dbTotals.get(d) ?? 0;
      return [d, Number.isFinite(v) ? v : 0];
    })
  );
}
