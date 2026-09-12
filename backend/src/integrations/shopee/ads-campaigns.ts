// ============================================================
// SHOPEE — ĐỒNG BỘ CHIẾN DỊCH QUẢNG CÁO + HIỆU SUẤT NGÀY (Ads API, READ-ONLY)
//
// Trục dữ liệu của Trợ lý quảng cáo Shopee (GĐ1):
//   1. get_product_level_campaign_id_list  → toàn bộ campaign_id (phân trang)
//   2. get_product_level_campaign_setting_info (lô ≤100, info_type 1+3)
//      → tên/trạng thái/ngân sách/ROAS target/item_id_list → upsert AdsCampaign
//   3. get_product_campaign_daily_performance (lô ≤100, cửa sổ daysBack)
//      → upsert AdsCampaignDailyPerf theo (campaign, ngày)
//
// 12/09/2026 — tách 3 bước thành hàm dùng lại cho XUNG (ads-pulse.ts: bước
// 1+2 mỗi 30' cho campaign còn sống + bước 3 chỉ ngày hôm nay) và cho tầng
// LỊCH SỬ (syncShopeeAdsPerfWindow: chỉ bước 3 cửa sổ 7 ngày). Hàm cũ
// syncShopeeAdsCampaigns = trọn 3 bước (lần đầu / backfill 30 ngày / nút cũ).
//
// Idempotent toàn tuyến: sàn sửa số trong ngày thì chạy lặp ghi đè. KHÔNG có
// bất kỳ lệnh ghi nào lên sàn. Lỗi permission ném lên caller (try-catch riêng
// trong worker — không được chặn các luồng sync khác, cùng luật với ads-spend).
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  getAdsCampaignDailyPerformance,
  getAdsCampaignIdList,
  getAdsCampaignSettingInfo,
  type ShopeeAdsCampaignPerfEntry,
  type ShopeeAdsCampaignRef,
} from "./client";
import { resolveShopeeAdsAccess, type ShopeeAdsAccess } from "../hubsell-ads";
import { fromShopeeDate, toShopeeDate } from "./ads-spend";

export interface SyncShopeeAdsCampaignsOptions {
  /** Lấy hiệu suất N ngày gần nhất. Mặc định 30. */
  daysBack?: number;
}

export interface SyncShopeeAdsCampaignsResult {
  campaignsFound: number; // số campaign sàn trả về
  campaignsUpserted: number; // số campaign ghi được vào DB
  perfDaysUpserted: number; // tổng số dòng (campaign, ngày) hiệu suất đã ghi
}

/** Chia mảng thành lô ≤size — giới hạn 100 id/lượt của setting_info + perf. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Bóc campaign_list từ response hiệu suất — docs mô tả cả dạng object lẫn mảng bọc shop. */
function unwrapPerfCampaignList(
  raw:
    | Array<{ campaign_list?: ShopeeAdsCampaignPerfEntry[] }>
    | { campaign_list?: ShopeeAdsCampaignPerfEntry[] }
    | undefined
): ShopeeAdsCampaignPerfEntry[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.flatMap((s) => s.campaign_list ?? []);
  return raw.campaign_list ?? [];
}

/** Trần an toàn: shop bất thường trả mãi has_next_page → dừng ở 5.000 campaign. */
const MAX_CAMPAIGNS = 5000;

// ---------- Bước 1: toàn bộ campaign_id (1 call / 100 campaign) ----------

export async function fetchShopeeCampaignRefs(
  access: ShopeeAdsAccess
): Promise<Map<string, string>> {
  const { accessToken, shopId, cfg } = access;
  const idToAdType = new Map<string, string>();
  const PAGE = 100;
  let count = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await getAdsCampaignIdList(
      { accessToken, shopId, adType: "all", offset, limit: PAGE },
      cfg
    );
    const list: ShopeeAdsCampaignRef[] = page.response?.campaign_list ?? [];
    for (const r of list) {
      if (r.campaign_id != null) idToAdType.set(String(r.campaign_id), r.ad_type ?? "");
    }
    count += list.length;
    if (!page.response?.has_next_page || list.length === 0) break;
    if (count >= MAX_CAMPAIGNS) break;
  }
  return idToAdType;
}

// ---------- Bước 2: cấu hình theo lô → upsert AdsCampaign (1 call / 100) ----------

/** Trả map campaign_id sàn → id dòng DB của các campaign upsert được. */
export async function upsertShopeeCampaignSettings(
  channel: Channel,
  access: ShopeeAdsAccess,
  idToAdType: Map<string, string>,
  ids: string[] = [...idToAdType.keys()]
): Promise<Map<string, string>> {
  const { accessToken, shopId, cfg } = access;
  const rowIdByCampaignId = new Map<string, string>();
  for (const batch of chunk(ids, 100)) {
    const setting = await getAdsCampaignSettingInfo(
      {
        accessToken,
        shopId,
        campaignIds: batch,
        infoTypeList: "1,3", // 1 = common info, 3 = auto bidding (roas_target)
      },
      cfg
    );
    for (const entry of setting.response?.campaign_list ?? []) {
      if (entry.campaign_id == null) continue;
      const campaignId = String(entry.campaign_id);
      const common = entry.common_info;
      const startTime = common?.campaign_duration?.start_time;
      const endTime = common?.campaign_duration?.end_time;
      const roas = entry.auto_bidding_info?.roas_target;
      const data = {
        adType: common?.ad_type ?? idToAdType.get(campaignId) ?? "",
        name: common?.ad_name ?? "",
        status: common?.campaign_status ?? "",
        placement: common?.campaign_placement ?? "",
        biddingMethod: common?.bidding_method ?? "",
        budget: Number(common?.campaign_budget ?? 0) || 0,
        roasTarget: roas != null && roas > 0 ? roas : null,
        startTime: startTime ? new Date(startTime * 1000) : null,
        endTime: endTime ? new Date(endTime * 1000) : null,
        itemIds: (common?.item_id_list ?? []).join(","),
      };
      const row = await prisma.adsCampaign.upsert({
        where: {
          channelId_campaignId: { channelId: channel.id, campaignId },
        },
        update: data,
        create: { channelId: channel.id, campaignId, ...data },
      });
      rowIdByCampaignId.set(campaignId, row.id);
    }
  }
  return rowIdByCampaignId;
}

// ---------- Bước 3: hiệu suất theo ngày → upsert AdsCampaignDailyPerf (1 call / 100) ----------

export async function upsertShopeeCampaignPerf(
  access: ShopeeAdsAccess,
  rowIdByCampaignId: Map<string, string>,
  start: Date,
  end: Date
): Promise<number> {
  const { accessToken, shopId, cfg } = access;
  let upserted = 0;
  for (const ids of chunk([...rowIdByCampaignId.keys()], 100)) {
    const perf = await getAdsCampaignDailyPerformance(
      {
        accessToken,
        shopId,
        campaignIds: ids,
        startDate: toShopeeDate(start),
        endDate: toShopeeDate(end),
      },
      cfg
    );
    for (const entry of unwrapPerfCampaignList(perf.response)) {
      if (entry.campaign_id == null) continue;
      const rowId = rowIdByCampaignId.get(String(entry.campaign_id));
      if (!rowId) continue;
      for (const point of entry.metrics_list ?? []) {
        const date = point.date ? fromShopeeDate(point.date) : null;
        if (!date) continue;
        const data = {
          impression: Math.trunc(Number(point.impression ?? 0)) || 0,
          clicks: Math.trunc(Number(point.clicks ?? 0)) || 0,
          expense: Number(point.expense ?? 0) || 0,
          broadOrder: Math.trunc(Number(point.broad_order ?? 0)) || 0,
          broadGmv: Number(point.broad_gmv ?? 0) || 0,
          directOrder: Math.trunc(Number(point.direct_order ?? 0)) || 0,
          directGmv: Number(point.direct_gmv ?? 0) || 0,
        };
        await prisma.adsCampaignDailyPerf.upsert({
          where: { adsCampaignId_date: { adsCampaignId: rowId, date } },
          update: data,
          create: { adsCampaignId: rowId, date, ...data },
        });
        upserted++;
      }
    }
  }
  return upserted;
}

/** Cửa sổ [hôm nay − (daysBack−1), hôm nay]. */
export function perfWindow(daysBack: number): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end.getTime() - (daysBack - 1) * 24 * 60 * 60 * 1000);
  return { start, end };
}

// ---------- Trọn 3 bước (lần đầu / backfill / nút cũ) ----------

export async function syncShopeeAdsCampaigns(
  channel: Channel,
  opts: SyncShopeeAdsCampaignsOptions = {}
): Promise<SyncShopeeAdsCampaignsResult> {
  // Quyền Ads API đi qua điểm chốt Hubsell Ads (app Ads riêng; fallback app
  // chính khi chưa cấu hình) — cfg quyết định partner nào ký chữ ký.
  const access = await resolveShopeeAdsAccess(channel);
  const daysBack = opts.daysBack ?? 30;

  const idToAdType = await fetchShopeeCampaignRefs(access);
  const result: SyncShopeeAdsCampaignsResult = {
    campaignsFound: idToAdType.size,
    campaignsUpserted: 0,
    perfDaysUpserted: 0,
  };
  if (idToAdType.size === 0) return result;

  const rowIdByCampaignId = await upsertShopeeCampaignSettings(channel, access, idToAdType);
  result.campaignsUpserted = rowIdByCampaignId.size;

  const { start, end } = perfWindow(daysBack);
  result.perfDaysUpserted = await upsertShopeeCampaignPerf(access, rowIdByCampaignId, start, end);
  return result;
}

// ---------- Tầng LỊCH SỬ: chỉ bước 3 cho campaign đã có trong DB ----------

/**
 * Kéo lại hiệu suất `daysBack` ngày của các campaign đã biết (sàn chỉnh số
 * muộn: đơn hủy sau click...). Không gọi id list / setting — xung đã lo phần
 * "hiện tại". 1 call / 100 campaign.
 */
export async function syncShopeeAdsPerfWindow(
  channel: Channel,
  daysBack: number
): Promise<{ campaigns: number; perfDaysUpserted: number }> {
  const rows = await prisma.adsCampaign.findMany({
    where: { channelId: channel.id, status: { notIn: ["deleted", "closed"] } },
    select: { id: true, campaignId: true },
  });
  if (rows.length === 0) return { campaigns: 0, perfDaysUpserted: 0 };
  const access = await resolveShopeeAdsAccess(channel);
  const rowIdByCampaignId = new Map(rows.map((r) => [r.campaignId, r.id] as const));
  const { start, end } = perfWindow(daysBack);
  const perfDaysUpserted = await upsertShopeeCampaignPerf(access, rowIdByCampaignId, start, end);
  return { campaigns: rows.length, perfDaysUpserted };
}
