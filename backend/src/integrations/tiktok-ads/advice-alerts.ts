// ============================================================
// TIKTOK ADS — CHUÔNG KHI KẾT LUẬN CHIẾN DỊCH ĐỔI (15/10/2026 — anh Trung: "làm chuông em nhé")
//
// Trước đó các kết luận của campaign-advice.ts (Quảng cáo đang lỗ / Mục tiêu dưới hòa vốn / Ngân sách đang chặn / Mục tiêu đang
// ghìm phân phối…) chỉ hiện khi khách MỞ trang. Nay lượt ngày (ngay sau runTiktokAdsDaily của gian, một lần mỗi ngày) chấm lại
// kết luận cho mọi chiến dịch đang chạy trên 7 ngày trọn gần nhất (bỏ hôm nay — cùng cửa sổ assessDelivery của Shopee), ghi loại
// kết luận vào AdsCampaign.adviceKind và CHUÔNG khi:
//   · loại kết luận ĐỔI so với lần chấm trước (luật B8 của tự loại video: kết quả y hệt thì không chuông lại), VÀ
//   · loại mới là loại CÓ VIỆC PHẢI LÀM trong Seller Center (ADVICE_ALERT_KINDS): đang lỗ, mục tiêu dưới hòa vốn, ngân sách đang
//     chặn (tăng ngân sách), mục tiêu đang ghìm (hạ ROI). Các loại "giữ nguyên / theo dõi / đang lãi / chưa kết luận" chỉ ghi, không chuông.
// Kết luận quay về healthy rồi lại ghìm → chuông lại (vì đã đổi). Tắt bằng env ADS_TIKTOK_ADVICE_ALERTS_OFF=1.
// Không gọi sàn: số quảng cáo theo ngày đã có trong DB (xung đồng bộ), hòa vốn đọc DB (có nhớ đệm), cấu hình lãi mong muốn của gian.
// ============================================================

import { dateKey, vnDateKey } from "../../lib/ads-dates";
import { prisma } from "../../lib/prisma";
import { notify } from "../../services/notifications";
import { loadCampaignFullDays, loadMinKeepPer100, loadStepChecks } from "./advice-inputs";
import { computeTiktokAdsBreakeven } from "./breakeven";
import { avgDailySpendOf, campaignAdvice, type CampaignAdviceKind } from "./campaign-advice";
import { TIKTOK_AD_TYPE_LIVE } from "./campaign-status";

/** Cửa sổ chấm: 7 ngày trọn gần nhất, bỏ hôm nay (cùng Shopee assessDelivery). */
export const ADVICE_ALERT_DAYS = 7;

/** Loại kết luận có việc phải làm trong Seller Center → chuông khi vừa đổi sang. */
export const ADVICE_ALERT_KINDS: ReadonlySet<CampaignAdviceKind> = new Set<CampaignAdviceKind>([
  "losing",
  "target_below",
  "budget_capped",
  "target_binding",
  // 15/10 đêm — ca không ra đơn: hạ ROI (không phân phối) / tạm dừng (tiêu tiền không ra đơn).
  "no_delivery",
  "no_orders",
]);

export const NOTIFY_TYPE_TIKTOK_ADVICE = "tiktok-ads-advice";

export const adviceAlertsOff = (): boolean => process.env.ADS_TIKTOK_ADVICE_ALERTS_OFF === "1";

export interface AdviceAlertPlan {
  /** Loại kết luận khác lần chấm trước → ghi lại adviceKind. */
  changed: boolean;
  /** Đổi sang loại có việc phải làm → chuông. */
  alert: boolean;
}

/** Thuần: có ghi / có chuông không. prevKind "" = chưa chấm lần nào. */
export function adviceAlertPlan(prevKind: string, kind: CampaignAdviceKind): AdviceAlertPlan {
  const changed = prevKind !== kind;
  return { changed, alert: changed && ADVICE_ALERT_KINDS.has(kind) };
}

export interface AdviceAlertsResult {
  campaigns: number;
  changed: number;
  alerted: number;
}

/** Chấm kết luận mọi chiến dịch đang chạy của một gian, ghi loại, chuông khi đổi sang loại có việc. Gọi sau lượt ngày của gian. */
export async function runTiktokAdviceAlerts(
  channel: { id: string; shopName: string; userId: string },
  today: string = vnDateKey(0)
): Promise<AdviceAlertsResult> {
  const result: AdviceAlertsResult = { campaigns: 0, changed: 0, alerted: 0 };
  if (adviceAlertsOff()) return result;
  const from = vnDateKey(ADVICE_ALERT_DAYS);
  const yesterday = vnDateKey(1);
  // Nhận định viết cho Product GMV Max (video, sản phẩm, hòa vốn SP) → chiến dịch LIVE không chấm, không chuông.
  const rows = await prisma.adsCampaign.findMany({
    where: { channelId: channel.id, status: "ongoing", adType: { not: TIKTOK_AD_TYPE_LIVE } },
    select: {
      id: true,
      name: true,
      roasTarget: true,
      budget: true,
      roasTargetChangedAt: true,
      roasTargetPrev: true,
      adviceKind: true,
      dailyPerf: {
        where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${yesterday}T00:00:00Z`) } },
        select: { date: true, expense: true, broadGmv: true, broadOrder: true },
      },
    },
  });
  result.campaigns = rows.length;
  if (rows.length === 0) return result;
  const fullDays = await loadCampaignFullDays(rows.map((c) => c.id), today);

  const breakeven = await computeTiktokAdsBreakeven({ id: channel.id, userId: channel.userId }).catch((err) => {
    console.error(`[TikTok Ads] Chuông kết luận — tính hòa vốn lỗi "${channel.shopName}":`, (err as Error).message);
    return null;
  });
  const minKeepPer100 = await loadMinKeepPer100(channel.id);
  const stepChecks = await loadStepChecks(
    rows.map((c) => ({
      id: c.id,
      roasTarget: c.roasTarget != null ? Number(c.roasTarget) : null,
      roasTargetChangedAt: c.roasTargetChangedAt,
      roasTargetPrev: c.roasTargetPrev != null ? Number(c.roasTargetPrev) : null,
    })),
    (id) => breakeven?.byCampaignRowId.get(id)?.margin
  );

  for (const c of rows) {
    let spend = 0;
    let gmv = 0;
    let orders = 0;
    for (const p of c.dailyPerf) {
      spend += Number(p.expense);
      gmv += Number(p.broadGmv);
      orders += p.broadOrder;
    }
    const advice = campaignAdvice({
      status: "ongoing",
      roasTarget: c.roasTarget != null ? Number(c.roasTarget) : null,
      budget: Number(c.budget),
      breakeven: breakeven?.byCampaignRowId.get(c.id) ?? null,
      spend,
      gmv,
      orders,
      fullDaysRunning: fullDays.get(c.id) ?? 0,
      avgDailySpend: avgDailySpendOf(
        c.dailyPerf.map((p) => ({ date: dateKey(p.date), expense: Number(p.expense) })),
        today
      ),
      roasTargetChangedAt: c.roasTargetChangedAt,
      minKeepPer100,
      stepCheck: stepChecks.get(c.id) ?? null,
    });
    const plan = adviceAlertPlan(c.adviceKind, advice.kind);
    if (!plan.changed) continue;
    result.changed++;
    await prisma.adsCampaign.update({ where: { id: c.id }, data: { adviceKind: advice.kind, adviceKindAt: new Date() } });
    if (!plan.alert) continue;
    await notify(channel.userId, {
      type: NOTIFY_TYPE_TIKTOK_ADVICE,
      title: `${c.name || "Chiến dịch GMV Max"}: ${advice.label}`,
      body: advice.conclusion,
      link: `/ads/tiktok/campaign?id=${c.id}`,
    });
    result.alerted++;
  }
  return result;
}
