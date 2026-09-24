// ============================================================
// TRỢ LÝ QUẢNG CÁO SHOPEE — GMS = GMV MAX CẤP SHOP (đợt GMS, 24/09/2026)
//
// Vì sao phải làm: chi tiêu GMS KHÔNG nằm trong campaign sản phẩm (id list /
// setting_info / daily_performance chỉ có auto/manual) mà chỉ hiện trong tổng chi
// cấp shop (AdSpend) → seller thấy "tổng chi lớn hơn tổng campaign" mà không
// biết vì sao. Docs (đọc lại 24/09):
//   - check_create_gms_product_campaign_eligibility: reason "active_campaign" =
//     shop ĐANG có GMS — cách duy nhất biết qua API (không có endpoint đọc
//     cấu hình/trạng thái/ngân sách GMS).
//   - get_gms_campaign_performance / get_gms_item_performance: theo KHOẢNG ngày,
//     start ≠ end (KHÔNG có số theo ngày lẻ), ≤ 1 tháng, lùi ≤ 6 tháng;
//     campaign_id bỏ trống = GMS hiện có.
// Cách lưu (chốt từ docs): KHÔNG ép vào AdsCampaign/DailyPerf (không có số ngày
// → rule engine cửa sổ today/3d không áp được) — bảng riêng theo CỬA SỔ 7d / 30d
// ngày trọn (bỏ hôm nay, bài học 14/09), ghi đè ở lượt lịch sử ads (6h):
//   eligibility (1) → active: campaign 7d (1) + 30d (1) + items 7d (1–2) ≈ 4 call/6h.
// CHỈ ĐỌC: không có hành động tự động nào trên GMS (edit_gms_product_campaign
// có pause/change_budget/change_roas_target nhưng chưa bắn sống, chưa nối).
// Đánh giá lãi/lỗ: ROAS cửa sổ so với hòa vốn CẤP SHOP (GMS phủ mọi SP) và
// từng SP so với hòa vốn của chính SP (bảng hòa vốn SP) — nơi duy nhất tính
// được hòa vốn đúng rổ ads của GMV Max.
// ============================================================

import { ChannelName, type Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { isApiBudgetError } from "../../services/api-budget";
import { resolveShopeeAdsAccess, type ShopeeAdsAccess } from "../hubsell-ads";
import {
  checkGmsEligibility,
  getGmsCampaignPerformance,
  getGmsItemPerformance,
  type ShopeeGmsReport,
} from "./client";
import { toShopeeDate } from "./ads-spend";
import { computeChannelProductBreakeven, dateKeyToDbDate, shiftDateKey, vnDateKey } from "./ads-insights";

export type GmsWindowKey = "7d" | "30d";
export const GMS_WINDOWS: Array<{ key: GmsWindowKey; days: number }> = [
  { key: "7d", days: 7 },
  { key: "30d", days: 30 },
];
export const GMS_STATUS_ACTIVE = "active";

/** "YYYY-MM-DD" (ngày VN) → "DD-MM-YYYY" của sàn. */
function toShopeeDay(key: string): string {
  return toShopeeDate(new Date(`${key}T00:00:00Z`));
}

/** Probe prod ANO 24/09: 4 call GMS liên tiếp → cú thứ 4 dính ads_rate_limit_shop_api → giãn giữa các call. */
const GMS_CALL_GAP_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cửa sổ N ngày TRỌN kết thúc hôm qua (bỏ hôm nay). */
export function gmsWindowKeys(days: number, todayKey: string = vnDateKey(0)): { startKey: string; endKey: string } {
  const endKey = shiftDateKey(todayKey, -1);
  return { startKey: shiftDateKey(endKey, -(days - 1)), endKey };
}

export interface GmsReportNumbers {
  expense: number;
  impression: number;
  clicks: number;
  broadOrder: number;
  broadGmv: number;
  directOrder: number;
  directGmv: number;
  roasBroad: number | null;
}

/** Báo cáo sàn → số sạch (thiếu trường = 0) — THUẦN. */
export function gmsReportNumbers(r: ShopeeGmsReport | undefined | null): GmsReportNumbers {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const expense = n(r?.expense);
  const broadGmv = n(r?.broad_gmv);
  return {
    expense,
    impression: Math.trunc(n(r?.impression)),
    clicks: Math.trunc(n(r?.clicks)),
    broadOrder: Math.trunc(n(r?.broad_order)),
    broadGmv,
    directOrder: Math.trunc(n(r?.direct_order)),
    directGmv: n(r?.direct_gmv),
    roasBroad: expense > 0 ? broadGmv / expense : null,
  };
}

/** Trạng thái GMS từ eligibility — THUẦN. */
export function gmsStatusFrom(resp: { is_eligible?: boolean; reason?: string } | undefined): string {
  if (!resp) return "error:empty";
  if (resp.reason === "active_campaign") return GMS_STATUS_ACTIVE;
  if (resp.is_eligible) return "eligible";
  return resp.reason || "unknown";
}

export interface SyncGmsResult {
  status: string;
  reports: number;
  items: number;
}

/**
 * Lượt lịch sử (6h): hỏi eligibility → shop đang chạy GMS thì kéo 2 cửa sổ + từng SP 7d.
 * Lỗi eligibility (chưa whitelist…) ghi status "error:<mã>" và dừng — không chặn lượt ads.
 */
export async function syncShopeeGms(channel: Channel, access?: ShopeeAdsAccess): Promise<SyncGmsResult> {
  if (channel.channelName !== ChannelName.SHOPEE) return { status: "n/a", reports: 0, items: 0 };
  const a = access ?? (await resolveShopeeAdsAccess(channel));
  const base = { accessToken: a.accessToken, shopId: a.shopId };
  const now = new Date();

  let status: string;
  try {
    const e = await checkGmsEligibility(base, a.cfg);
    status = gmsStatusFrom(e.response);
  } catch (err) {
    if (isApiBudgetError(err)) throw err;
    status = `error:${String((err as Error).message).slice(0, 80)}`;
  }
  await prisma.channel.update({
    where: { id: channel.id },
    data: { adsGmsStatus: status, adsGmsCheckedAt: now },
  });
  const result: SyncGmsResult = { status, reports: 0, items: 0 };
  if (status !== GMS_STATUS_ACTIVE) {
    // Không còn GMS → dọn báo cáo cũ để UI không hiện số chết.
    await prisma.adsGmsReport.deleteMany({ where: { channelId: channel.id } });
    await prisma.adsGmsItemReport.deleteMany({ where: { channelId: channel.id } });
    return result;
  }

  const todayKey = vnDateKey(0);
  for (const w of GMS_WINDOWS) {
    await sleep(GMS_CALL_GAP_MS);
    const { startKey, endKey } = gmsWindowKeys(w.days, todayKey);
    const r = await getGmsCampaignPerformance(
      { ...base, startDate: toShopeeDay(startKey), endDate: toShopeeDay(endKey) },
      a.cfg
    );
    const nums = gmsReportNumbers(r.response?.report);
    const campaignId = r.response?.campaign_id != null ? String(r.response.campaign_id) : null;
    const data = { campaignId, startKey, endKey, ...nums, roasBroad: undefined, syncedAt: now };
    delete (data as { roasBroad?: unknown }).roasBroad;
    await prisma.adsGmsReport.upsert({
      where: { channelId_windowKey: { channelId: channel.id, windowKey: w.key } },
      update: data,
      create: { channelId: channel.id, windowKey: w.key, ...data },
    });
    result.reports++;
  }

  // Từng SP cửa sổ 7d — phân trang ≤100, tối đa 3 trang (gian nhiều SP thì 300 SP có số là đủ soi).
  const { startKey, endKey } = gmsWindowKeys(7, todayKey);
  const seen = new Set<string>();
  for (let page = 0; page < 3; page++) {
    await sleep(GMS_CALL_GAP_MS);
    const r = await getGmsItemPerformance(
      { ...base, startDate: toShopeeDay(startKey), endDate: toShopeeDay(endKey), offset: page * 100, limit: 100 },
      a.cfg
    );
    for (const it of r.response?.result_list ?? []) {
      if (it.item_id == null) continue;
      const itemId = String(it.item_id);
      seen.add(itemId);
      const nums = gmsReportNumbers(it.report);
      const data = { ...nums, roasBroad: undefined, syncedAt: now };
      delete (data as { roasBroad?: unknown }).roasBroad;
      await prisma.adsGmsItemReport.upsert({
        where: { channelId_windowKey_itemId: { channelId: channel.id, windowKey: "7d", itemId } },
        update: data,
        create: { channelId: channel.id, windowKey: "7d", itemId, ...data },
      });
      result.items++;
    }
    if (!r.response?.has_next_page) break;
  }
  // SP không còn số ở cửa sổ mới → xóa dòng cũ.
  await prisma.adsGmsItemReport.deleteMany({
    where: { channelId: channel.id, windowKey: "7d", ...(seen.size ? { itemId: { notIn: [...seen] } } : {}) },
  });
  return result;
}

export interface GmsOverview {
  status: string;
  checkedAt: Date | null;
  reports: Array<{
    windowKey: string;
    startKey: string;
    endKey: string;
    campaignId: string | null;
    syncedAt: Date;
  } & GmsReportNumbers>;
  shopBreakevenRoas: number | null;
}

/** Khối GMS cho dashboard — ĐỌC DB, không gọi sàn. null khi chưa hỏi sàn. */
export async function getShopeeGmsOverview(
  channel: Pick<Channel, "id" | "adsGmsStatus" | "adsGmsCheckedAt">,
  shopBreakevenRoas: number | null
): Promise<GmsOverview | null> {
  if (!channel.adsGmsStatus) return null;
  const rows = (await prisma.adsGmsReport.findMany({ where: { channelId: channel.id } })).sort(
    (a, b) => (GMS_WINDOWS.findIndex((w) => w.key === a.windowKey) - GMS_WINDOWS.findIndex((w) => w.key === b.windowKey))
  );
  return {
    status: channel.adsGmsStatus,
    checkedAt: channel.adsGmsCheckedAt ?? null,
    shopBreakevenRoas,
    reports: rows.map((r) => {
      const expense = Number(r.expense);
      const broadGmv = Number(r.broadGmv);
      return {
        windowKey: r.windowKey,
        startKey: r.startKey,
        endKey: r.endKey,
        campaignId: r.campaignId,
        syncedAt: r.syncedAt,
        expense,
        impression: r.impression,
        clicks: r.clicks,
        broadOrder: r.broadOrder,
        broadGmv,
        directOrder: r.directOrder,
        directGmv: Number(r.directGmv),
        roasBroad: expense > 0 ? broadGmv / expense : null,
      };
    }),
  };
}

/** Từng SP trong GMS 7d kèm hòa vốn của chính SP — ĐỌC DB (P&L + bảng SP), không gọi sàn. */
export async function getShopeeGmsItems(channel: Channel) {
  const rows = await prisma.adsGmsItemReport.findMany({
    where: { channelId: channel.id, windowKey: "7d" },
    orderBy: { expense: "desc" },
  });
  const report = await prisma.adsGmsReport.findUnique({
    where: { channelId_windowKey: { channelId: channel.id, windowKey: "7d" } },
    select: { startKey: true, endKey: true, syncedAt: true },
  });
  if (rows.length === 0) {
    return { windowKey: "7d" as const, startKey: report?.startKey ?? null, endKey: report?.endKey ?? null, syncedAt: report?.syncedAt ?? null, rows: [] };
  }
  const breakeven = await computeChannelProductBreakeven({
    id: channel.id,
    userId: channel.userId,
    channelName: channel.channelName,
  });
  const beByItem = new Map(breakeven.rows.map((r) => [r.itemId, r] as const));
  const itemIds = rows.map((r) => r.itemId);
  const products = await prisma.channelProduct.findMany({
    where: { channelId: channel.id, OR: itemIds.flatMap((id) => [{ externalId: id }, { externalId: { startsWith: `${id}-` } }]) },
    select: { externalId: true, productName: true },
  });
  const nameByItem = new Map<string, string>();
  for (const p of products) {
    const id = (p.externalId ?? "").split("-")[0];
    if (id && !nameByItem.has(id)) nameByItem.set(id, p.productName);
  }
  return {
    windowKey: "7d" as const,
    startKey: report?.startKey ?? null,
    endKey: report?.endKey ?? null,
    syncedAt: report?.syncedAt ?? null,
    rows: rows.map((r) => {
      const expense = Number(r.expense);
      const broadGmv = Number(r.broadGmv);
      const be = beByItem.get(r.itemId);
      return {
        itemId: r.itemId,
        name: be?.productName || nameByItem.get(r.itemId) || "",
        expense,
        clicks: r.clicks,
        broadOrder: r.broadOrder,
        broadGmv,
        roasBroad: expense > 0 ? broadGmv / expense : null,
        breakevenRoas: be?.breakevenRoas ?? null,
        lossBeforeAds: be?.lossBeforeAds ?? false,
      };
    }),
  };
}

/**
 * PROBE đọc thuần (bước 0): eligibility + báo cáo GMS 7 ngày trọn + từng SP + khoảng 2 ngày
 * sát nhất + so với tổng chi cấp shop (AdSpend) và tổng chi campaign sản phẩm cùng khoảng.
 */
export async function probeShopeeGms(channel: Channel): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
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
  const startDate = toShopeeDay(startKey);
  const endDate = toShopeeDay(endKey);
  out.window = { startKey, endKey, startDate, endDate };

  await safe("eligibility", () => checkGmsEligibility(base, a.cfg));
  await sleep(GMS_CALL_GAP_MS);
  await safe("campaign_perf_7d", () => getGmsCampaignPerformance({ ...base, startDate, endDate }, a.cfg));
  await sleep(GMS_CALL_GAP_MS);
  await safe("item_perf_7d", async () => {
    const r = await getGmsItemPerformance({ ...base, startDate, endDate, limit: 20 }, a.cfg);
    return {
      campaign_id: r.response?.campaign_id,
      total: r.response?.total,
      has_next_page: r.response?.has_next_page,
      sample: (r.response?.result_list ?? []).slice(0, 10),
    };
  });
  await sleep(GMS_CALL_GAP_MS);
  await safe("campaign_perf_2d", () =>
    getGmsCampaignPerformance({ ...base, startDate: toShopeeDay(vnDateKey(1)), endDate: toShopeeDay(vnDateKey(0)) }, a.cfg)
  );
  await safe("compare_7d", async () => {
    const gte = dateKeyToDbDate(startKey);
    const lte = dateKeyToDbDate(endKey);
    const shop = await prisma.adSpend.aggregate({ where: { channelId: channel.id, date: { gte, lte } }, _sum: { amount: true } });
    const camp = await prisma.adsCampaignDailyPerf.aggregate({
      where: { adsCampaign: { channelId: channel.id }, date: { gte, lte } },
      _sum: { expense: true },
    });
    const shopSpend = Number(shop._sum.amount ?? 0);
    const campSpend = Number(camp._sum.expense ?? 0);
    return { shopSpend, campaignSpend: campSpend, gap: shopSpend - campSpend };
  });
  return out;
}
