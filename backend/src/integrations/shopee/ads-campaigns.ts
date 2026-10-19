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

import { Prisma, type Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  getAdsCampaignDailyPerformance,
  getAdsCampaignIdList,
  getAdsCampaignSettingInfo,
  type ShopeeAdsCampaignPerfData,
  type ShopeeAdsCampaignPerfEntry,
  type ShopeeAdsCampaignRef,
} from "./client";
import { resolveShopeeAdsAccess, type ShopeeAdsAccess } from "../hubsell-ads";
import { isApiBudgetError } from "../../services/api-budget";
import { fromShopeeDate } from "./ads-spend";
import { shopeeDateParam, vnDayWindow } from "../../lib/ads-dates";
import { reconcileHubsellPauseFlags, recordMarketplaceStatusChange } from "./ads-pause-flag";

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

/**
 * CHIẾN DỊCH NHÓM NHIỀU SẢN PHẨM (Seller Center `manual-mpd`, docs ADS-SHOPEE-KHAI-THAC-API mục 15.7, soi
 * thật ANO 19/10/2026): `get_product_level_campaign_id_list` KHÔNG liệt kê, `setting_info` từ chối
 * (error_param "auto & manual product ad types only"), nhưng `get_product_campaign_daily_performance`
 * TRẢ ĐƯỢC theo id. → Chủ shop nhập id một lần, Hubsell lưu `adType = "group"` và chỉ kéo số theo ngày;
 * không có ngân sách / ROAS mục tiêu / trạng thái / item list (sàn không cho đọc), không lệnh ghi.
 */
export const ADS_AD_TYPE_GROUP = "group";

/**
 * Chia id thành các lô gọi perf: id thường gom ≤100/lô như cũ; MỖI id nhóm một lô riêng — sàn từ chối
 * CẢ LÔ khi có một id không hợp lệ (probe 19/10: "has invalid product ads campaign ids"), nên chiến dịch
 * Nhóm bị xóa trên sàn không được kéo theo số của mọi campaign khác.
 */
export function splitPerfBatches(ids: string[], groupIds: ReadonlySet<string>): Array<{ ids: string[]; group: boolean }> {
  const normal = ids.filter((id) => !groupIds.has(id));
  const out: Array<{ ids: string[]; group: boolean }> = chunk(normal, 100).map((b) => ({ ids: b, group: false }));
  for (const id of ids) if (groupIds.has(id)) out.push({ ids: [id], group: true });
  return out;
}

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
  // Trạng thái TRƯỚC khi đồng bộ — để ghi sổ "Tắt/Bật trên sàn" (thao tác ngoài Hubsell).
  const prevRows = await prisma.adsCampaign.findMany({
    where: { channelId: channel.id, campaignId: { in: ids } },
    select: { campaignId: true, status: true, hubsellPausedAt: true, roasTarget: true },
  });
  const prevByCampaignId = new Map(prevRows.map((r) => [r.campaignId, r] as const));
  for (const batch of chunk(ids, 100)) {
    const setting = await getAdsCampaignSettingInfo(
      {
        accessToken,
        shopId,
        campaignIds: batch,
        // 1 = common info, 2 = manual bidding (từ khóa đã chọn + vị trí Khám phá — đợt C 24/09,
        // cùng call nên 0 call thêm), 3 = auto bidding (roas_target)
        infoTypeList: "1,2,3",
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
      // Đợt C: giữ nguyên văn khối manual_bidding_info (JSON) — chỉ campaign thủ công có; trống → null.
      const mb = entry.manual_bidding_info;
      const manualBidding =
        mb && ((mb.selected_keywords?.length ?? 0) > 0 || (mb.discovery_ads_locations?.length ?? 0) > 0)
          ? (mb as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      const data = {
        manualBidding,
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
      const prev = prevByCampaignId.get(campaignId);
      // Mục tiêu ROAS trên sàn khác số đang lưu = có người vừa đổi (Seller Center hoặc
      // Hubsell) → ghi mốc để gợi ý hạ mục tiêu khóa 48 giờ. Campaign mới thấy lần đầu
      // thì không tính là "đổi".
      const prevTarget = prev?.roasTarget != null ? Number(prev.roasTarget) : null;
      const targetChanged = prev != null && prevTarget !== data.roasTarget;
      const row = await prisma.adsCampaign.upsert({
        where: {
          channelId_campaignId: { channelId: channel.id, campaignId },
        },
        update: targetChanged ? { ...data, roasTargetChangedAt: new Date(), roasTargetPrev: prevTarget } : data,
        create: { channelId: channel.id, campaignId, ...data },
      });
      rowIdByCampaignId.set(campaignId, row.id);
      await recordMarketplaceStatusChange({
        channelId: channel.id,
        rowId: row.id,
        prevStatus: prev?.status,
        nextStatus: data.status,
        hubsellPaused: prev?.hubsellPausedAt != null,
      });
    }
  }
  // Campaign Hubsell đã dừng mà sàn báo đang chạy = người bật lại → xóa cờ,
  // ván mới (máy trạng thái 14/09, ads-pause-flag.ts).
  await reconcileHubsellPauseFlags(channel.id);
  return rowIdByCampaignId;
}

// ---------- Bước 3: hiệu suất theo ngày → upsert AdsCampaignDailyPerf (1 call / 100) ----------

/** `window`: khoảng NGÀY SÀN "YYYY-MM-DD" (giờ VN) — lấy từ vnDayWindow, không tự tính bằng giờ máy chủ. */
export async function upsertShopeeCampaignPerf(
  access: ShopeeAdsAccess,
  rowIdByCampaignId: Map<string, string>,
  window: { startKey: string; endKey: string },
  opts: { groupIds?: ReadonlySet<string> } = {}
): Promise<number> {
  const { accessToken, shopId, cfg } = access;
  let upserted = 0;
  const groupIds = opts.groupIds ?? new Set<string>();
  for (const batch of splitPerfBatches([...rowIdByCampaignId.keys()], groupIds)) {
    const ids = batch.ids;
    let perf: ShopeeAdsCampaignPerfData;
    try {
      perf = await getAdsCampaignDailyPerformance(
        {
          accessToken,
          shopId,
          campaignIds: ids,
          startDate: shopeeDateParam(window.startKey),
          endDate: shopeeDateParam(window.endKey),
        },
        cfg
      );
    } catch (err) {
      // Lô nhóm bị sàn từ chối id (đã xóa trên Seller Center) → đóng dòng, không chặn lô khác.
      // Lỗi ngân sách/429 vẫn ném lên để làn Ads lùi đúng luật.
      if (batch.group && !isApiBudgetError(err) && /error_param|invalid/i.test((err as Error).message)) {
        const rowId = rowIdByCampaignId.get(ids[0]);
        if (rowId) {
          await prisma.adsCampaign.update({ where: { id: rowId }, data: { status: "closed" } });
          console.warn(`[Ads] Chiến dịch Nhóm ${ids[0]} bị sàn từ chối → đóng dòng:`, (err as Error).message);
        }
        continue;
      }
      throw err;
    }
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

  result.perfDaysUpserted = await upsertShopeeCampaignPerf(access, rowIdByCampaignId, vnDayWindow(daysBack));
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
    select: { id: true, campaignId: true, adType: true },
  });
  if (rows.length === 0) return { campaigns: 0, perfDaysUpserted: 0 };
  const access = await resolveShopeeAdsAccess(channel);
  const rowIdByCampaignId = new Map(rows.map((r) => [r.campaignId, r.id] as const));
  const groupIds = new Set(rows.filter((r) => r.adType === ADS_AD_TYPE_GROUP).map((r) => r.campaignId));
  const perfDaysUpserted = await upsertShopeeCampaignPerf(access, rowIdByCampaignId, vnDayWindow(daysBack), { groupIds });
  return { campaigns: rows.length, perfDaysUpserted };
}

// ---------- Chiến dịch Nhóm nhiều SP: chủ shop nhập id (mục 15.7) ----------

/** Dòng Nhóm còn sống của gian → map campaignId → rowId (xung kéo số hôm nay, lịch sử kéo cửa sổ). */
export async function liveShopeeGroupCampaigns(channelId: string): Promise<Map<string, string>> {
  const rows = await prisma.adsCampaign.findMany({
    where: { channelId, adType: ADS_AD_TYPE_GROUP, status: { notIn: ["deleted", "closed", "ended"] } },
    select: { id: true, campaignId: true },
  });
  return new Map(rows.map((r) => [r.campaignId, r.id] as const));
}

/**
 * Thêm chiến dịch Nhóm theo id Seller Center: hỏi sàn số HÔM NAY (1 call) để xác nhận id thuộc gian +
 * lấy ad_name; ghi dòng `adType = "group"`, rồi kéo 30 ngày (1 call) để bảng có số ngay. Id đã là
 * campaign thường trong DB → từ chối (nó đã được đồng bộ bình thường).
 */
export async function addShopeeGroupCampaign(
  channel: Channel,
  campaignId: string
): Promise<{ id: string; campaignId: string; name: string; perfDaysUpserted: number }> {
  const existing = await prisma.adsCampaign.findUnique({
    where: { channelId_campaignId: { channelId: channel.id, campaignId } },
    select: { id: true, adType: true, name: true },
  });
  if (existing && existing.adType !== ADS_AD_TYPE_GROUP) {
    throw new Error(`Chiến dịch ${campaignId} đã có trong bảng (loại ${existing.adType || "thường"}) — không phải chiến dịch Nhóm.`);
  }
  const access = await resolveShopeeAdsAccess(channel);
  const today = vnDayWindow(1);
  let perf: ShopeeAdsCampaignPerfData;
  try {
    perf = await getAdsCampaignDailyPerformance(
      {
        accessToken: access.accessToken,
        shopId: access.shopId,
        campaignIds: [campaignId],
        startDate: shopeeDateParam(today.startKey),
        endDate: shopeeDateParam(today.endKey),
      },
      access.cfg
    );
  } catch (err) {
    if (isApiBudgetError(err)) throw err;
    throw new Error(`Shopee không nhận id ${campaignId} cho gian này: ${(err as Error).message}`);
  }
  const entry = unwrapPerfCampaignList(perf.response).find((e) => String(e.campaign_id) === campaignId);
  if (!entry) throw new Error(`Shopee không trả chiến dịch ${campaignId} — kiểm lại id trong URL Seller Center.`);
  const data = {
    adType: ADS_AD_TYPE_GROUP,
    name: entry.ad_name ?? "",
    // Sàn không cho đọc trạng thái: coi là đang chạy; lô perf bị từ chối id → "closed" (xem upsertShopeeCampaignPerf).
    status: "ongoing",
    placement: entry.campaign_placement ?? "all",
    biddingMethod: "",
    budget: 0,
    roasTarget: null,
    startTime: null,
    endTime: null,
    itemIds: "",
  };
  const row = await prisma.adsCampaign.upsert({
    where: { channelId_campaignId: { channelId: channel.id, campaignId } },
    update: { name: data.name, placement: data.placement, status: "ongoing" },
    create: { channelId: channel.id, campaignId, ...data },
  });
  const map = new Map([[campaignId, row.id]]);
  const perfDaysUpserted = await upsertShopeeCampaignPerf(access, map, vnDayWindow(30), { groupIds: new Set([campaignId]) });
  return { id: row.id, campaignId, name: data.name, perfDaysUpserted };
}

/** Bỏ theo dõi chiến dịch Nhóm (xóa dòng + số theo ngày — cascade). Chỉ dòng adType "group". */
export async function removeShopeeGroupCampaign(channel: Channel, rowId: string): Promise<boolean> {
  const r = await prisma.adsCampaign.deleteMany({ where: { id: rowId, channelId: channel.id, adType: ADS_AD_TYPE_GROUP } });
  return r.count > 0;
}
