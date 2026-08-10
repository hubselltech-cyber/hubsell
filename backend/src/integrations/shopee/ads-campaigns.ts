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
// Idempotent toàn tuyến: sàn sửa số trong ngày thì chạy lặp ghi đè. KHÔNG có
// bất kỳ lệnh ghi nào lên sàn. Lỗi permission ném lên caller (try-catch riêng
// trong worker — không được chặn các luồng sync khác, cùng luật với ads-spend).
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  getAdsCampaignDailyPerformance,
  getAdsCampaignIdList,
  getAdsCampaignSettingInfo,
  type ShopeeAdsCampaignPerfEntry,
  type ShopeeAdsCampaignRef,
} from "./client";
import { getValidShopeeAccessToken } from "./service";
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
function chunk<T>(arr: T[], size: number): T[][] {
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

export async function syncShopeeAdsCampaigns(
  channel: Channel,
  opts: SyncShopeeAdsCampaignsOptions = {}
): Promise<SyncShopeeAdsCampaignsResult> {
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  const daysBack = opts.daysBack ?? 30;

  const result: SyncShopeeAdsCampaignsResult = {
    campaignsFound: 0,
    campaignsUpserted: 0,
    perfDaysUpserted: 0,
  };

  // ---- 1. Gom toàn bộ campaign_id (phân trang offset/limit) ----
  const refs: ShopeeAdsCampaignRef[] = [];
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const page = await getAdsCampaignIdList({
      accessToken,
      shopId,
      adType: "all",
      offset,
      limit: PAGE,
    });
    const list = page.response?.campaign_list ?? [];
    refs.push(...list);
    if (!page.response?.has_next_page || list.length === 0) break;
    // Trần an toàn: shop bất thường trả mãi has_next_page → dừng ở 5.000 campaign
    if (refs.length >= 5000) break;
  }
  result.campaignsFound = refs.length;
  if (refs.length === 0) return result;

  const idToAdType = new Map<string, string>();
  for (const r of refs) {
    if (r.campaign_id != null) idToAdType.set(String(r.campaign_id), r.ad_type ?? "");
  }
  const allIds = [...idToAdType.keys()];

  // ---- 2. Cấu hình campaign theo lô → upsert AdsCampaign ----
  // Map id sàn → id dòng DB để bước 3 ghi hiệu suất không phải query lại.
  const rowIdByCampaignId = new Map<string, string>();
  for (const ids of chunk(allIds, 100)) {
    const setting = await getAdsCampaignSettingInfo({
      accessToken,
      shopId,
      campaignIds: ids,
      infoTypeList: "1,3", // 1 = common info, 3 = auto bidding (roas_target)
    });
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
      result.campaignsUpserted++;
    }
  }

  // ---- 3. Hiệu suất theo ngày (cửa sổ daysBack) → upsert AdsCampaignDailyPerf ----
  const end = new Date();
  const start = new Date(end.getTime() - (daysBack - 1) * 24 * 60 * 60 * 1000);
  // Chỉ hỏi hiệu suất những campaign đã upsert được (có dòng DB để treo perf).
  const perfIds = [...rowIdByCampaignId.keys()];
  for (const ids of chunk(perfIds, 100)) {
    const perf = await getAdsCampaignDailyPerformance({
      accessToken,
      shopId,
      campaignIds: ids,
      startDate: toShopeeDate(start),
      endDate: toShopeeDate(end),
    });
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
        result.perfDaysUpserted++;
      }
    }
  }

  return result;
}
