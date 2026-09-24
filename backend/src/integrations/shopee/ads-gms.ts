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
//     start ≠ end (không có số theo ngày lẻ), ≤ 1 tháng, lùi ≤ 6 tháng;
//     campaign_id bỏ trống = GMS hiện có.
// BƯỚC 0 (mục này): probe đọc thuần trên shop nhà — in nguyên văn + so với
// AdSpend để chốt cách lưu. Chưa lưu gì, chưa có UI.
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { resolveShopeeAdsAccess, type ShopeeAdsAccess } from "../hubsell-ads";
import { checkGmsEligibility, getGmsCampaignPerformance, getGmsItemPerformance } from "./client";
import { toShopeeDate } from "./ads-spend";
import { dateKeyToDbDate, vnDateKey } from "./ads-insights";

/** "YYYY-MM-DD" (ngày VN) → "DD-MM-YYYY" của sàn. */
function toShopeeDay(key: string): string {
  return toShopeeDate(new Date(`${key}T00:00:00Z`));
}

/**
 * PROBE đọc thuần: eligibility + báo cáo GMS 7 ngày trọn (hôm qua lùi 7) + từng SP +
 * so với tổng chi cấp shop (AdSpend) và tổng chi campaign sản phẩm cùng khoảng.
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

  const endKey = vnDateKey(1); // hôm qua (ngày trọn)
  const startKey = vnDateKey(7); // 7 ngày trọn
  const startDate = toShopeeDay(startKey);
  const endDate = toShopeeDay(endKey);
  out.window = { startKey, endKey, startDate, endDate };

  await safe("eligibility", () => checkGmsEligibility(base, a.cfg));
  await safe("campaign_perf_7d", () => getGmsCampaignPerformance({ ...base, startDate, endDate }, a.cfg));
  await safe("item_perf_7d", async () => {
    const r = await getGmsItemPerformance({ ...base, startDate, endDate, limit: 20 }, a.cfg);
    return { campaign_id: r.response?.campaign_id, total: r.response?.total, has_next_page: r.response?.has_next_page, sample: (r.response?.result_list ?? []).slice(0, 10) };
  });
  // Thử khoảng 2 ngày sát nhất để biết số tươi tới đâu (start ≠ end).
  await safe("campaign_perf_2d", () =>
    getGmsCampaignPerformance({ ...base, startDate: toShopeeDay(vnDateKey(1)), endDate: toShopeeDay(vnDateKey(0)) }, a.cfg)
  );

  // Đối chiếu: tổng chi cấp shop vs tổng chi campaign sản phẩm cùng 7 ngày trọn.
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
