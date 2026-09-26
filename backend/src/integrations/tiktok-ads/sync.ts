// ============================================================
// TIKTOK ADS — ĐỒNG BỘ CAMPAIGN GMV MAX VÀO BẢNG ADS DÙNG CHUNG (chỉ đọc)
//
// Ghi vào AdsCampaign + AdsCampaignDailyPerf — cùng bảng với Shopee/Lazada, sàn
// suy từ Channel.channelName. Ánh xạ từ vựng:
//   operation_status ENABLE/DISABLE → status ongoing/paused
//   roas_bid (ROI mục tiêu)         → roasTarget (NO_BID = phân phối tối đa → NULL)
//   cost / orders / gross_revenue   → expense / broad* VÀ direct* (GMV Max chỉ
//     có MỘT bộ số: đơn của chính SP trong campaign, gộp cả đơn tự nhiên —
//     không tách direct/broad như Shopee nên ghi trùng hai cặp).
//   impression / clicks             → 0 (tầng campaign của GMV Max không có).
//
// AdSpend (chi phí ads cấp gian theo NGÀY, cùng bảng với Shopee/Lazada) = Σ cost
// của mọi chiến dịch GMV Max trong ngày. Kiểm số thật 26/09/2026 (gian ANO, 692
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
import { dateFromStr, vnDateStr } from "../lazada/ads-campaigns";
import { TiktokAdsApiError, getGmvMaxStores, type GmvMaxStore } from "./client";
import { fetchGmvMaxCampaignDaily } from "./report";

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
  let rows;
  try {
    rows = await fetchGmvMaxCampaignDaily({
      accessToken: scope.accessToken,
      advertiserId: scope.advertiserId,
      storeId: scope.storeId,
      startDate: vnDateStr(daysBack - 1),
      endDate: vnDateStr(0),
    });
  } catch (err) {
    await recordTiktokAdsFailure(scope.linkId, err);
    throw err;
  }

  // Thuộc tính campaign lặp lại trên mọi dòng ngày — lấy dòng MỚI NHẤT làm chuẩn.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!r.campaignId) continue;
    const cur = latest.get(r.campaignId);
    if (!cur || r.date > cur.date) latest.set(r.campaignId, r);
  }

  const rowIdByCampaignId = new Map<string, string>();
  for (const [campaignId, c] of latest) {
    const data = {
      name: c.name,
      adType: "gmv_max",
      status: c.operationStatus === "ENABLE" ? "ongoing" : "paused",
      biddingMethod: c.bidType === "NO_BID" ? "max_delivery" : "target_roi",
      budget: c.budget,
      roasTarget: c.roasBid,
    };
    const row = await prisma.adsCampaign.upsert({
      where: { channelId_campaignId: { channelId: channel.id, campaignId } },
      update: data,
      create: { channelId: channel.id, campaignId, ...data },
    });
    rowIdByCampaignId.set(campaignId, row.id);
    result.campaignsUpserted++;
    if (data.status === "ongoing") result.liveCampaigns++;
  }

  const recentFrom = vnDateStr(1);
  for (const r of rows) {
    const rowId = rowIdByCampaignId.get(r.campaignId);
    if (!rowId || !r.date) continue;
    if (r.cost <= 0 && r.orders <= 0 && r.gmv <= 0) continue; // dòng 0 không mang thông tin
    const orders = Math.trunc(r.orders);
    const data = {
      expense: r.cost,
      broadOrder: orders,
      broadGmv: r.gmv,
      directOrder: orders,
      directGmv: r.gmv,
    };
    await prisma.adsCampaignDailyPerf.upsert({
      where: { adsCampaignId_date: { adsCampaignId: rowId, date: dateFromStr(r.date) } },
      update: data,
      create: { adsCampaignId: rowId, date: dateFromStr(r.date), ...data },
    });
    result.perfDaysUpserted++;
    if (r.cost > 0 && r.date >= recentFrom) result.spentRecently = true;
  }

  // Chi phí ads cấp gian theo ngày — ghi đè cùng bộ số mỗi lượt (sàn cập nhật
  // lại cost trong ngày), ngày không có dòng nào thì để nguyên.
  for (const [date, amount] of gmvMaxDailyTotals(rows)) {
    await prisma.adSpend.upsert({
      where: { channelId_date: { channelId: channel.id, date: dateFromStr(date) } },
      update: { amount },
      create: { channelId: channel.id, date: dateFromStr(date), amount },
    });
    result.adSpendDaysUpserted++;
  }

  await prisma.tiktokAdsStoreLink.update({
    where: { id: scope.linkId },
    data: { lastSyncedAt: new Date(), lastSyncError: "" },
  });
  return result;
}

/** Σ cost theo ngày của mọi chiến dịch (thuần — có test). Ngày tăng dần, bỏ dòng thiếu ngày. */
export function gmvMaxDailyTotals(rows: { date: string; cost: number }[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (!r.date) continue;
    byDay.set(r.date, (byDay.get(r.date) ?? 0) + (Number.isFinite(r.cost) ? r.cost : 0));
  }
  return new Map([...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
