// ============================================================
// SHOPEE — CHIẾN DỊCH NHÓM NHIỀU SẢN PHẨM (Seller Center `manual-mpd`), docs ADS-SHOPEE-KHAI-THAC-API mục 15
//
// Shopee xác nhận 19/10/2026: KHÔNG có endpoint liệt kê / đọc cấu hình loại này; `get_product_level_campaign_id_list`
// bỏ qua, `setting_info` từ chối id, chỉ `get_product_campaign_daily_performance` trả số theo ngày khi biết id.
// → Chủ shop nhập id một lần (popup "Thêm chiến dịch nhiều sản phẩm vào bảng"), Hubsell lưu `adType = "group"`
//   và chỉ kéo số theo ngày; không ngân sách / ROAS mục tiêu / trạng thái / item list, không lệnh ghi
//   (ads-auto-execute từ chối), Trợ lý chỉ cảnh báo.
//
// File này gom NGHIỆP VỤ riêng của loại Nhóm: dòng còn sống (xung + lịch sử gom vào lô perf riêng), thêm / bỏ theo
// id, và probe chẩn đoán theo id. Phần dùng chung với campaign thường (ADS_AD_TYPE_GROUP, splitPerfBatches,
// upsertShopeeCampaignPerf) ở ads-campaigns.ts — import một chiều từ đó, không vòng.
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { isApiBudgetError } from "../../services/api-budget";
import { resolveShopeeAdsAccess, type ShopeeAdsAccess } from "../hubsell-ads";
import {
  getAdsCampaignDailyPerformance,
  getAdsCampaignIdList,
  getAdsCampaignSettingInfo,
  getGmsCampaignPerformance,
  getGmsItemPerformance,
  type ShopeeAdsCampaignPerfData,
} from "./client";
import { dateKeyToDbDate, shopeeDateParam, vnDateKey, vnDayWindow } from "../../lib/ads-dates";
import { ADS_AD_TYPE_GROUP, unwrapPerfCampaignList, upsertShopeeCampaignPerf } from "./ads-campaigns";
import { gmsWindowKeys } from "./ads-gms";

/** Giãn giữa các lệnh sàn trong probe (cùng mức van GMS 1,5 s — ads_rate_limit_shop_api). */
const CALL_GAP_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Dòng Nhóm còn sống / thêm / bỏ ----------

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

// ============================================================
// PROBE: SOI MỘT CHIẾN DỊCH THEO ID (19/10/2026, mục 15.3 / 15.7) — ĐỌC THUẦN, in nguyên văn cho hỗ trợ.
//
// Bài toán: seller thấy "chiến dịch đang chạy" trên Seller Center (Chiến dịch Nhóm
// nhiều sản phẩm = GMV Max gom ≤30 SP một chiến dịch, Shopee mở 05/2025) nhưng Hubsell
// không kéo về. Hubsell chỉ đọc qua 3 endpoint "product_level" (id list → setting →
// daily perf). Hàm này hỏi TỪNG nhóm endpoint xem id ấy (lấy từ URL Seller Center) có
// được trả không, để chốt bằng số thật chứ không đoán:
//   · id list theo 3 ad_type (all/auto/manual) — id có nằm trong danh sách không
//   · setting_info + daily perf 7 ngày với đúng id — nhóm product_level có đọc được không
//   · gms campaign perf + item perf với campaign_id = id — nhóm GMS có đọc được không
//   · DB: AdsCampaign đã có dòng này chưa; tổng chi cấp shop − tổng chi campaign 7 ngày
// Không ghi gì lên sàn, không ghi DB. Giãn CALL_GAP_MS giữa các call (van 429).
// ============================================================

export async function probeShopeeCampaignById(
  channel: Channel,
  campaignId: string
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { campaignId };
  const safe = async (key: string, fn: () => Promise<unknown>) => {
    try {
      out[key] = await fn();
    } catch (err) {
      out[key] = { error: (err as Error).message };
    }
  };
  let access: ShopeeAdsAccess | null = null;
  await safe("ads_access", async () => {
    access = await resolveShopeeAdsAccess(channel);
    return { source: access.source };
  });
  if (!access) return out;
  const a = access as ShopeeAdsAccess;
  const base = { accessToken: a.accessToken, shopId: a.shopId };
  const { startKey, endKey } = gmsWindowKeys(7);
  const startDate = shopeeDateParam(startKey);
  const endDate = shopeeDateParam(endKey);
  out.window = { startKey, endKey, startDate, endDate };

  // 1. Danh sách id theo từng ad_type — id có xuất hiện không, sàn gắn ad_type gì.
  for (const adType of ["all", "auto", "manual"] as const) {
    await safe(`id_list_${adType}`, async () => {
      const seen: Array<{ campaign_id?: number; ad_type?: string }> = [];
      let total = 0;
      let lastError: string | null = null;
      for (let offset = 0; offset < 2000; offset += 100) {
        const page = await getAdsCampaignIdList({ ...base, adType, offset, limit: 100 }, a.cfg);
        lastError = page.error ? `${page.error}${page.message ? `: ${page.message}` : ""}` : null;
        const list = page.response?.campaign_list ?? [];
        total += list.length;
        for (const r of list) if (String(r.campaign_id) === campaignId) seen.push(r);
        if (!page.response?.has_next_page || list.length === 0) break;
        await sleep(CALL_GAP_MS);
      }
      return { total, found: seen.length > 0, entry: seen[0] ?? null, error: lastError };
    });
    await sleep(CALL_GAP_MS);
  }

  // 2. Nhóm product_level với đúng id.
  await safe("setting_info", async () => {
    const r = await getAdsCampaignSettingInfo({ ...base, campaignIds: [campaignId], infoTypeList: "1,2,3" }, a.cfg);
    return { error: r.error || null, message: r.message || null, campaign_list: r.response?.campaign_list ?? [] };
  });
  await sleep(CALL_GAP_MS);
  await safe("daily_perf_7d", async () => {
    const r = await getAdsCampaignDailyPerformance({ ...base, campaignIds: [campaignId], startDate, endDate }, a.cfg);
    return { error: r.error || null, message: r.message || null, response: r.response ?? null };
  });
  await sleep(CALL_GAP_MS);
  // Chiến dịch mới tạo trong ngày: cửa sổ 7 ngày trọn toàn 0 → hỏi thêm hôm nay (lượt soi ANO 19/10 nhờ khối này
  // mới thấy 124 lượt xem / 1.475₫ trong khi Seller Center còn 0 vì bộ lọc ngày).
  await safe("daily_perf_today", async () => {
    const today = shopeeDateParam(vnDateKey(0));
    const r = await getAdsCampaignDailyPerformance({ ...base, campaignIds: [campaignId], startDate: today, endDate: today }, a.cfg);
    return { error: r.error || null, message: r.message || null, response: r.response ?? null };
  });
  await sleep(CALL_GAP_MS);

  // 3. Nhóm GMS với campaign_id = id (docs: "provide if available").
  await safe("gms_campaign_perf_7d", async () => {
    const r = await getGmsCampaignPerformance({ ...base, startDate, endDate, campaignId }, a.cfg);
    return { error: r.error || null, message: r.message || null, response: r.response ?? null };
  });
  await sleep(CALL_GAP_MS);
  await safe("gms_item_perf_7d", async () => {
    const r = await getGmsItemPerformance({ ...base, startDate, endDate, campaignId, limit: 20 }, a.cfg);
    return {
      error: r.error || null,
      message: r.message || null,
      campaign_id: r.response?.campaign_id ?? null,
      total: r.response?.total ?? null,
      sample: (r.response?.result_list ?? []).slice(0, 10),
    };
  });

  // 4. Phía Hubsell: DB đã có chưa + khoảng chi ngoài bảng chiến dịch 7 ngày trọn.
  await safe("db", async () => {
    const row = await prisma.adsCampaign.findUnique({
      where: { channelId_campaignId: { channelId: channel.id, campaignId } },
      select: { id: true, name: true, status: true, adType: true, itemIds: true },
    });
    const gte = dateKeyToDbDate(startKey);
    const lte = dateKeyToDbDate(endKey);
    const shop = await prisma.adSpend.aggregate({ where: { channelId: channel.id, date: { gte, lte } }, _sum: { amount: true } });
    const camp = await prisma.adsCampaignDailyPerf.aggregate({
      where: { adsCampaign: { channelId: channel.id }, date: { gte, lte } },
      _sum: { expense: true },
    });
    const shopSpend = Number(shop._sum.amount ?? 0);
    const campaignSpend = Number(camp._sum.expense ?? 0);
    return { row, shopSpend7d: shopSpend, campaignSpend7d: campaignSpend, gap7d: shopSpend - campaignSpend };
  });
  return out;
}
