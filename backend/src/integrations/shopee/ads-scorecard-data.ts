// ============================================================
// BẢNG ĐIỂM TRỢ LÝ QUẢNG CÁO — phần NẠP từ database (luật chấm ở ./ads-scorecard.ts).
//
// Tách khỏi routes/ads.ts ngày 01/10/2026 để test được trên DB: bảng điểm xem
// tới 90 ngày (ADS_RANGE_MAX_DAYS) nhưng lõi insights mặc định chỉ nạp 30 ngày
// hiệu suất → lần diễn tập cũ hơn 30 ngày bị thiếu "tiền tiêu tiếp sau ngày
// phán" (prod 30/09: một gian có 2 dòng diễn tập từ 15/08). Hiệu suất phải nạp
// từ đúng ngày đầu của khoảng đang xem.
// ============================================================

import { vnDayEnd, vnDayStart, type AdsDateRange } from "../../lib/ads-dates";
import type { AdsInsightChannel } from "../../lib/ads-margin";
import { prisma } from "../../lib/prisma";
import type { ShopeeAssistantConfig } from "./ads-assistant-rules";
import { computeChannelAdsInsights } from "./ads-insights";
import { buildAssistantScorecard, type AssistantScorecard } from "./ads-scorecard";

export async function loadAssistantScorecard(
  channel: AdsInsightChannel,
  range: Pick<AdsDateRange, "fromKey" | "toKey" | "days">
): Promise<AssistantScorecard & { mode: ShopeeAssistantConfig["autoExecute"]["mode"] }> {
  const { fromKey, toKey, days } = range;
  const insights = await computeChannelAdsInsights(channel, { perfFromKey: fromKey });
  // Lệnh ghi sổ là timestamp nên cắt từ 00:00 ngày đầu tới 23:59:59 ngày cuối giờ VN.
  const logs = await prisma.adsActionLog.findMany({
    where: {
      channelId: channel.id,
      createdAt: {
        gte: vnDayStart(fromKey),
        lte: vnDayEnd(toKey),
      },
    },
    select: {
      id: true,
      adsCampaignId: true,
      action: true,
      mode: true,
      status: true,
      reasons: true,
      createdAt: true,
    },
  });
  return {
    mode: insights.config.autoExecute.mode,
    ...buildAssistantScorecard(logs, insights.items, insights.config, days),
  };
}
