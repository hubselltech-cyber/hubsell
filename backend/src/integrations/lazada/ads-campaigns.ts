// ============================================================
// LAZADA — ĐỒNG BỘ CHIẾN DỊCH QUẢNG CÁO + HIỆU SUẤT NGÀY (Sponsored Solutions,
// READ-ONLY — không có bất kỳ lệnh ghi nào lên sàn)
//
// Trục dữ liệu của Trợ lý quảng cáo Lazada (GĐ1), đổ vào ĐÚNG hai bảng trung
// lập sàn AdsCampaign/AdsCampaignDailyPerf mà Shopee đang dùng:
//   1. searchCampaignList (phân trang)  → upsert AdsCampaign
//   2. searchAdgroupList từng campaign  → itemIds (mỗi adgroup = 1 sản phẩm,
//      itemId khớp ChannelProduct.externalId "itemId-skuId" → biên lãi SKU)
//   3. getDiscoveryReportCampaign TỪNG NGÀY (report là aggregate theo khoảng,
//      muốn số theo ngày phải gọi startDate=endDate=D) → AdsCampaignDailyPerf
//      Map rổ: store* → broad (mọi đơn của gian sau click), product* → direct.
//
// Attribution Lazada (chuẩn hóa 11/2025): 30 ngày last-click GHI VỀ NGÀY CLICK
// → số của một ngày "nở" dần suốt 30 ngày sau. Vì vậy MỖI lượt sync refresh
// trọn cửa sổ daysBack chứ không sync kiểu "chỉ ngày mới" (idempotent, ghi đè).
//
// Ngân sách API: ~10.000 call/ngày/app. Mỗi sweep ≈ 1 (campaign list) + ≤50
// (adgroup, có chọn lọc) + 30×trang (report ngày) — 2 shop chạy mỗi giờ vẫn
// dưới 1/4 ngân sách. Lỗi ném lên caller (worker try-catch riêng từng gian).
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  getAdsAdgroupList,
  getAdsCampaignList,
  getAdsCampaignReport,
  lazAdsNum,
  type LazadaAdsCampaign,
} from "./client";
import { getValidLazadaAccessToken } from "./service";

export interface SyncLazadaAdsCampaignsOptions {
  /** Lấy hiệu suất N ngày gần nhất. Mặc định 30 (bằng cửa sổ attribution). */
  daysBack?: number;
}

export interface SyncLazadaAdsCampaignsResult {
  campaignsFound: number;
  campaignsUpserted: number;
  adgroupCampaigns: number; // số campaign được quét itemIds lượt này
  perfDaysUpserted: number;
}

/** "YYYY-MM-DD" của N ngày trước theo GIỜ VN (ngày của sàn; server chạy UTC). */
function vnDateStr(daysAgo: number): string {
  return new Date(Date.now() + 7 * 3600_000 - daysAgo * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** "YYYY-MM-DD" → Date 00:00 UTC — cùng quy ước cột @db.Date với Shopee. */
function dateFromStr(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/**
 * Trạng thái tổng hợp theo bộ từ vựng chung của AdsCampaign (Shopee đặt nền:
 * ongoing | scheduled | ended | paused | deleted) — FE hai sàn đọc chung.
 * EXPORT cho vitest — logic thuần, không chạm DB/sàn.
 */
export function deriveStatus(c: LazadaAdsCampaign, todayVn: string): string {
  if (lazAdsNum(c.status) === 9) return "deleted";
  if (lazAdsNum(c.campaignSwitchStatus) === 0) return "paused";
  // endDate "3020-12-30" = không hẹn tắt; ngày thật đã qua → ended.
  const end = (c.endDate ?? "").trim();
  if (end && end < todayVn) return "ended";
  const start = (c.startDate ?? "").trim();
  if (start && start > todayVn) return "scheduled";
  return "ongoing";
}

export async function syncLazadaAdsCampaigns(
  channel: Channel,
  opts: SyncLazadaAdsCampaignsOptions = {}
): Promise<SyncLazadaAdsCampaignsResult> {
  const accessToken = await getValidLazadaAccessToken(channel);
  const daysBack = Math.min(30, Math.max(1, opts.daysBack ?? 30));
  const todayVn = vnDateStr(0);

  const result: SyncLazadaAdsCampaignsResult = {
    campaignsFound: 0,
    campaignsUpserted: 0,
    adgroupCampaigns: 0,
    perfDaysUpserted: 0,
  };

  // ---- 1. Toàn bộ campaign (kể cả đã tắt từ lâu — filter ngày của sàn rất
  // lỏng, cứ hỏi cửa sổ 10 năm cho khỏi sót) → upsert AdsCampaign ----
  const campaigns: LazadaAdsCampaign[] = [];
  const startWide = vnDateStr(3650);
  for (let pageNo = 1; pageNo <= 30; pageNo++) {
    const page = await getAdsCampaignList({
      accessToken,
      startDate: startWide,
      endDate: todayVn,
      pageNo,
      pageSize: 100,
    });
    campaigns.push(...page.campaigns);
    if (page.campaigns.length < 100 || campaigns.length >= page.totalCount)
      break;
  }
  result.campaignsFound = campaigns.length;
  if (campaigns.length === 0) return result;

  const rowIdByCampaignId = new Map<string, string>();
  const statusByCampaignId = new Map<string, string>();
  for (const c of campaigns) {
    if (c.campaignId == null) continue;
    const campaignId = String(c.campaignId);
    const status = deriveStatus(c, todayVn);
    const dailyBudget = lazAdsNum(c.dailyBudget);
    const end = (c.endDate ?? "").trim();
    const start = (c.startDate ?? "").trim();
    const data = {
      name: c.campaignName ?? "",
      status,
      // -1 = không giới hạn → 0 theo quy ước cột budget (0 = không giới hạn).
      budget: dailyBudget > 0 ? dailyBudget : 0,
      startTime: /^\d{4}-\d{2}-\d{2}$/.test(start) ? dateFromStr(start) : null,
      // Năm ≥ 3000 là "không hẹn ngày tắt" của Lazada → NULL cùng nghĩa Shopee.
      endTime:
        /^\d{4}-\d{2}-\d{2}$/.test(end) && end < "3000-01-01"
          ? dateFromStr(end)
          : null,
    };
    const row = await prisma.adsCampaign.upsert({
      where: { channelId_campaignId: { channelId: channel.id, campaignId } },
      update: data,
      create: { channelId: channel.id, campaignId, ...data },
    });
    rowIdByCampaignId.set(campaignId, row.id);
    statusByCampaignId.set(campaignId, status);
    result.campaignsUpserted++;
  }

  // ---- 3 (chạy trước 2 để biết campaign nào có chi tiêu). Hiệu suất theo
  // ngày: report từng ngày của cửa sổ daysBack, chỉ ghi dòng có số liệu ----
  const activeSpendCampaigns = new Set<string>();
  // adType/placement không có trong searchCampaignList — lấy từ dòng report.
  const metaByCampaignId = new Map<string, { adType: string; placement: string }>();
  for (let ago = daysBack - 1; ago >= 0; ago--) {
    const dayStr = vnDateStr(ago);
    const date = dateFromStr(dayStr);
    for (let pageNo = 1; pageNo <= 10; pageNo++) {
      const page = await getAdsCampaignReport({
        accessToken,
        startDate: dayStr,
        endDate: dayStr,
        pageNo,
        pageSize: 100,
        useRtTable: ago === 0, // hôm nay cần bảng realtime mới có số
      });
      for (const r of page.rows) {
        if (r.campaignId == null) continue;
        const campaignId = String(r.campaignId);
        const rowId = rowIdByCampaignId.get(campaignId);
        if (!rowId) continue;
        const data = {
          impression: Math.trunc(lazAdsNum(r.impressions)),
          clicks: Math.trunc(lazAdsNum(r.clicks)),
          expense: lazAdsNum(r.spend),
          broadOrder: Math.trunc(lazAdsNum(r.storeOrders)),
          broadGmv: lazAdsNum(r.storeRevenue),
          directOrder: Math.trunc(lazAdsNum(r.productOrders)),
          directGmv: lazAdsNum(r.productRevenue),
        };
        // Report chỉ trả campaign có hoạt động, nhưng vẫn chặn dòng 0 tuyệt
        // đối cho chắc — dòng 0 không mang thông tin, đỡ rác bảng perf.
        const hasAny =
          data.impression > 0 ||
          data.clicks > 0 ||
          data.expense > 0 ||
          data.broadOrder > 0 ||
          data.directOrder > 0 ||
          data.broadGmv > 0 ||
          data.directGmv > 0;
        if (!hasAny) continue;
        await prisma.adsCampaignDailyPerf.upsert({
          where: { adsCampaignId_date: { adsCampaignId: rowId, date } },
          update: data,
          create: { adsCampaignId: rowId, date, ...data },
        });
        result.perfDaysUpserted++;
        if (data.expense > 0) activeSpendCampaigns.add(campaignId);
        if (!metaByCampaignId.has(campaignId)) {
          const type = lazAdsNum(r.campaignType);
          metaByCampaignId.set(campaignId, {
            adType: type === 2 ? "auto" : type === 1 ? "manual" : "",
            // N = Sponsored Search, J = Sponsored Product (docs LSS).
            placement:
              r.productType === "N"
                ? "search"
                : r.productType === "J"
                  ? "product"
                  : "",
          });
        }
      }
      if (page.rows.length < 100) break;
    }
  }

  // Vá adType/placement học được từ report (searchCampaignList không có).
  for (const [campaignId, meta] of metaByCampaignId) {
    const rowId = rowIdByCampaignId.get(campaignId);
    if (!rowId || (meta.adType === "" && meta.placement === "")) continue;
    await prisma.adsCampaign.update({
      where: { id: rowId },
      data: {
        ...(meta.adType ? { adType: meta.adType } : {}),
        ...(meta.placement ? { placement: meta.placement } : {}),
      },
    });
  }

  // ---- 2. itemIds qua adgroup — CÓ CHỌN LỌC để giữ ngân sách API: campaign
  // đang chạy/hẹn giờ, campaign có chi tiêu trong cửa sổ, và backfill dần
  // những campaign chưa từng có itemIds; trần 50 campaign/lượt sweep ----
  const dbRows = await prisma.adsCampaign.findMany({
    where: { channelId: channel.id, campaignId: { in: [...rowIdByCampaignId.keys()] } },
    select: { id: true, campaignId: true, itemIds: true },
  });
  const needItemIds = dbRows
    .filter((r) => {
      const status = statusByCampaignId.get(r.campaignId) ?? "";
      if (status === "deleted") return false;
      if (status === "ongoing" || status === "scheduled") return true;
      if (activeSpendCampaigns.has(r.campaignId)) return true;
      return r.itemIds === ""; // backfill dần campaign cũ chưa quét
    })
    .slice(0, 50);
  for (const row of needItemIds) {
    const itemIds: string[] = [];
    for (let pageNo = 1; pageNo <= 5; pageNo++) {
      const page = await getAdsAdgroupList({
        accessToken,
        campaignId: row.campaignId,
        startDate: vnDateStr(daysBack - 1),
        endDate: todayVn,
        pageNo,
        pageSize: 100,
      });
      for (const g of page.adgroups) {
        const itemId = g.itemId != null ? String(g.itemId) : "";
        if (itemId && itemId !== "0") itemIds.push(itemId);
      }
      if (page.adgroups.length < 100) break;
    }
    result.adgroupCampaigns++;
    const joined = [...new Set(itemIds)].join(",");
    // Không ghi đè danh sách đã có bằng rỗng — adgroup của campaign tắt lâu
    // có thể không trả dòng nào dù campaign từng gắn sản phẩm.
    if (joined || row.itemIds === "") {
      await prisma.adsCampaign.update({
        where: { id: row.id },
        data: { itemIds: joined },
      });
    }
  }

  return result;
}
