// ============================================================
// TIKTOK ADS — NẠP HAI ĐẦU VÀO PHỤ CHO CHẨN ĐOÁN CHIẾN DỊCH (08/10/2026), dùng chung cho 3 route gọi campaignAdvice
// (bảng Tổng quan, trang chiến dịch, tab Hòa vốn sản phẩm) để ba nơi không bao giờ lệch nhau:
//   1. minKeepPer100 — lãi tối thiểu khách muốn giữ sau quảng cáo (đ/100đ doanh thu): đọc AdsAssistantConfig.config.profit
//      của gian (cùng bảng cấu hình với Trợ lý Shopee; gian TikTok chưa có dòng = mặc định DEFAULT_MIN_KEEP_PER_100).
//   2. stepCheck — so lãi tuyệt đối 2 ngày trọn trước / sau nấc HẠ mục tiêu gần nhất (stepProfitCheck): số theo ngày lấy
//      QUANH mốc đổi (không theo bộ lọc ngày của trang), một câu findMany cho mọi chiến dịch có mốc đổi trong 14 ngày.
// ============================================================

import { prisma } from "../../lib/prisma";
import { dateKey, vnDateKey, vnDateKeyOf } from "../../lib/ads-dates";
import {
  DEFAULT_MIN_KEEP_PER_100,
  STEP_CHECK_DAYS,
  normalizeAssistantConfig,
  stepProfitCheck,
  type StepProfitCheck,
} from "../shopee/ads-assistant-rules";

/** Lãi tối thiểu muốn giữ (đ/100đ) của gian — cấu hình Trợ lý; chưa cấu hình = mặc định. */
export async function loadMinKeepPer100(channelId: string): Promise<number> {
  const row = await prisma.adsAssistantConfig.findUnique({ where: { channelId }, select: { config: true } });
  return row ? normalizeAssistantConfig(row.config).profit.minKeepPer100 : DEFAULT_MIN_KEEP_PER_100;
}

/** Lưu lãi tối thiểu muốn giữ — giữ nguyên các luật khác trong config (gian TikTok chỉ dùng mục profit). */
export async function saveMinKeepPer100(channelId: string, minKeepPer100: number): Promise<number> {
  const row = await prisma.adsAssistantConfig.findUnique({ where: { channelId }, select: { config: true } });
  const next = normalizeAssistantConfig({ ...normalizeAssistantConfig(row?.config), profit: { minKeepPer100 } });
  const jsonConfig = JSON.parse(JSON.stringify(next)) as object;
  await prisma.adsAssistantConfig.upsert({
    where: { channelId },
    update: { config: jsonConfig },
    create: { channelId, config: jsonConfig },
  });
  return next.profit.minKeepPer100;
}

export interface StepCheckCampaign {
  id: string;
  roasTarget: number | null;
  roasTargetChangedAt: Date | null;
  roasTargetPrev: number | null;
}

/** Mốc đổi cũ hơn mức này thì thôi so (nấc hạ đã quá xa để nói gì về nấc kế). */
const STEP_CHECK_LOOKBACK_DAYS = 14;

/**
 * stepCheck cho từng chiến dịch (Map theo id). `marginOf(id)` = biên lãi dùng cho chiến dịch đó (null = chưa có hòa vốn → bỏ).
 * Chỉ nạp số của chiến dịch có lần HẠ mục tiêu trong STEP_CHECK_LOOKBACK_DAYS ngày; không có thì không chạm DB.
 */
export async function loadStepChecks(
  campaigns: StepCheckCampaign[],
  marginOf: (campaignId: string) => number | null | undefined
): Promise<Map<string, StepProfitCheck | null>> {
  const out = new Map<string, StepProfitCheck | null>();
  const today = vnDateKey(0);
  const lookbackKey = vnDateKey(STEP_CHECK_LOOKBACK_DAYS);
  const wanted = campaigns.filter((c) => {
    if (c.roasTarget == null || c.roasTargetPrev == null || !c.roasTargetChangedAt) return false;
    if (!(c.roasTargetPrev > c.roasTarget)) return false;
    if (marginOf(c.id) == null) return false;
    return vnDateKeyOf(c.roasTargetChangedAt) >= lookbackKey;
  });
  if (wanted.length === 0) return out;
  // Khoảng ngày cần: từ (mốc đổi sớm nhất − N ngày) tới hôm qua.
  const earliest = wanted.reduce((m, c) => (c.roasTargetChangedAt! < m ? c.roasTargetChangedAt! : m), wanted[0].roasTargetChangedAt!);
  const fromKey = dateKey(new Date(earliest.getTime() - (STEP_CHECK_DAYS + 2) * 86_400_000));
  const perf = await prisma.adsCampaignDailyPerf.findMany({
    where: { adsCampaignId: { in: wanted.map((c) => c.id) }, date: { gte: new Date(`${fromKey}T00:00:00Z`) } },
    select: { adsCampaignId: true, date: true, expense: true, broadGmv: true },
  });
  const daysOf = new Map<string, { date: string; expense: number; gmv: number }[]>();
  for (const p of perf) {
    const list = daysOf.get(p.adsCampaignId) ?? [];
    list.push({ date: dateKey(p.date), expense: Number(p.expense), gmv: Number(p.broadGmv) });
    daysOf.set(p.adsCampaignId, list);
  }
  for (const c of wanted) {
    out.set(
      c.id,
      stepProfitCheck({
        days: daysOf.get(c.id) ?? [],
        margin: marginOf(c.id) as number,
        roasTarget: c.roasTarget,
        roasTargetPrev: c.roasTargetPrev,
        changedOn: vnDateKeyOf(c.roasTargetChangedAt!),
        today,
      })
    );
  }
  return out;
}
