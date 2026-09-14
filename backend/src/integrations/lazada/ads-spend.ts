// ============================================================
// LAZADA — CHI PHÍ QUẢNG CÁO THEO NGÀY → bảng AdSpend (tổng chi toàn gian/ngày)
//
// Shopee ghi AdSpend từ get_all_cpc_ads_daily_performance (số cấp shop). Lazada
// KHÔNG có API cấp shop đã probe (getReportOverviewMetric có trong docs LSS
// nhưng chưa xác minh — không đoán endpoint, bài học MISA) → tổng theo ngày =
// SUM(expense) của AdsCampaignDailyPerf mà ads-campaigns.ts / ads-pulse.ts đã
// kéo từ getDiscoveryReportCampaign (bizCode sponsoredSearch = Sponsored
// Search + Sponsored Product). Sponsored Affiliate KHÔNG cộng ở đây vì đã nằm
// trong sao kê từng đơn (feeAffiliate).
//
// CHỐNG TÍNH ĐÚP (14/09/2026): Lazada cho seller chọn trả tiền ads bằng cách
// TRỪ VÀO DOANH THU thay vì nạp ví — khi đó sao kê đơn có dòng "Phí Discovery
// tài trợ" (LazadaOrderSettlement.feeSponsoredDiscovery) và P&L từng đơn ĐÃ
// gánh tiền ads. Gian có dòng đó trong POSTPAID_LOOKBACK_DAYS → coi là trả
// sau, AdSpend ghi 0 để Báo cáo dòng tiền không trừ lần hai. Gian nạp ví (trả
// trước) → AdSpend = tổng chiến dịch. Chạy lặp tự chữa: gian đổi cách trả
// tiền thì lượt sau ghi đè đúng số.
//
// Người dùng của AdSpend: Báo cáo dòng tiền (cột Chi phí + "Ads theo sàn"),
// Trợ lý hỏi đáp, detector ads-spike (lưới an toàn — gian có campaign thì
// detectShopeeAdsAssistant lo, không báo đúp).
// ============================================================

import { prisma } from "../../lib/prisma";

/** Nhìn lại bao nhiêu ngày sao kê để kết luận gian trả tiền ads qua doanh thu. */
export const LAZADA_ADS_POSTPAID_LOOKBACK_DAYS = 90;

/** "YYYY-MM-DD" của N ngày trước theo GIỜ VN (bản sao nhỏ của ads-campaigns.ts
 *  để tránh import vòng — hai file gọi nhau). */
function vnDateStr(daysAgo: number): string {
  return new Date(Date.now() + 7 * 3600_000 - daysAgo * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function dateFromStr(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export interface LazadaAdSpendDay {
  /** 00:00 UTC — cùng quy ước cột @db.Date với AdsCampaignDailyPerf. */
  date: Date;
  amount: number;
}

/**
 * Gộp dòng perf theo NGÀY thành số AdSpend cho từng ngày trong `dayKeys`
 * ("YYYY-MM-DD"). Ngày không có dòng → 0 (ghi 0 để sàn chỉnh số về 0 vẫn
 * được phản ánh). `postpaid` = gian trả tiền ads qua doanh thu → toàn 0.
 * THUẦN — vitest đánh thẳng.
 */
export function lazadaAdSpendByDay(
  rows: { date: Date; expense: number | { toString(): string } }[],
  dayKeys: string[],
  postpaid: boolean
): LazadaAdSpendDay[] {
  const sum = new Map<string, number>();
  if (!postpaid) {
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 10);
      const v = Number(r.expense);
      if (!Number.isFinite(v) || v <= 0) continue;
      sum.set(key, (sum.get(key) ?? 0) + v);
    }
  }
  return dayKeys.map((key) => ({
    date: dateFromStr(key),
    amount: Math.round((sum.get(key) ?? 0) * 100) / 100,
  }));
}

export interface SyncLazadaAdsSpendResult {
  daysUpserted: number;
  /** true = gian trả tiền ads bằng cách trừ vào doanh thu (AdSpend ghi 0). */
  postpaid: boolean;
}

/**
 * Ghi AdSpend cho `daysBack` ngày gần nhất của một gian Lazada từ bảng perf đã
 * sync. KHÔNG gọi sàn — chỉ DB. Gọi ngay sau khi perf được cập nhật (xung: 1
 * ngày; lịch sử: cửa sổ 7/30 ngày). Gian chưa có campaign nào → không ghi gì.
 */
export async function syncLazadaAdsSpendFromPerf(
  channelId: string,
  opts: { daysBack?: number } = {}
): Promise<SyncLazadaAdsSpendResult> {
  const daysBack = Math.min(30, Math.max(1, opts.daysBack ?? 30));
  const hasCampaign = await prisma.adsCampaign.findFirst({
    where: { channelId },
    select: { id: true },
  });
  if (!hasCampaign) return { daysUpserted: 0, postpaid: false };

  const lookback = new Date(Date.now() - LAZADA_ADS_POSTPAID_LOOKBACK_DAYS * 86_400_000);
  const postpaidRow = await prisma.lazadaOrderSettlement.findFirst({
    where: {
      order: { channelId },
      feeSponsoredDiscovery: { not: 0 },
      OR: [{ settledAt: { gte: lookback } }, { createdAt: { gte: lookback } }],
    },
    select: { id: true },
  });
  const postpaid = postpaidRow != null;

  const dayKeys: string[] = [];
  for (let ago = daysBack - 1; ago >= 0; ago--) dayKeys.push(vnDateStr(ago));
  const rows = postpaid
    ? []
    : await prisma.adsCampaignDailyPerf.findMany({
        where: {
          adsCampaign: { channelId },
          date: { gte: dateFromStr(dayKeys[0]) },
        },
        select: { date: true, expense: true },
      });

  let daysUpserted = 0;
  for (const day of lazadaAdSpendByDay(rows, dayKeys, postpaid)) {
    await prisma.adSpend.upsert({
      where: { channelId_date: { channelId, date: day.date } },
      update: { amount: day.amount },
      create: { channelId, date: day.date, amount: day.amount },
    });
    daysUpserted++;
  }
  return { daysUpserted, postpaid };
}
