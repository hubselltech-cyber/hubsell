// ============================================================
// BẢNG ĐIỂM TRỢ LÝ QUẢNG CÁO xem 90 ngày — lần diễn tập CŨ HƠN 30 NGÀY vẫn phải
// thấy tiền tiêu tiếp sau ngày phán (01/10/2026). Trước đó route chỉ nạp 30 ngày
// hiệu suất nên dòng cũ luôn ra "chưa đủ số". Chạy trên DB dev, gian tự dựng.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { dateKeyToDbDate, resolveAdsDateRange, vnDateKey } from "../../lib/ads-dates";
import { loadAssistantScorecard } from "../shopee/ads-scorecard-data";
import { createStockFixture, type StockFixture } from "./fixtures";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_line_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();

describe.skipIf(!ledgerReady)("Bảng điểm Trợ lý quảng cáo — nạp hiệu suất theo khoảng ngày đang xem", () => {
  let fx: StockFixture;
  const channel = () => ({ id: fx.channelId, userId: fx.userId, channelName: ChannelName.SHOPEE });

  beforeAll(async () => {
    fx = await createStockFixture("adsscore");
    const campaign = await prisma.adsCampaign.create({
      data: { channelId: fx.channelId, campaignId: `TEST-${fx.suffix}`, name: "Chiến dịch cũ", status: "ongoing" },
    });
    // Máy định dừng 45 ngày trước; 40 ngày trước chiến dịch tiêu tiếp 50k mà 0 đơn.
    await prisma.adsActionLog.create({
      data: {
        channelId: fx.channelId,
        adsCampaignId: campaign.id,
        action: "pause",
        mode: "dry_run",
        verdict: "pause_now",
        reasons: "Lý do test",
        referenceId: `pause-${campaign.id}-${vnDateKey(45)}-c0`,
        status: "PLANNED",
        createdAt: new Date(`${vnDateKey(45)}T10:00:00+07:00`),
      },
    });
    await prisma.adsCampaignDailyPerf.create({
      data: { adsCampaignId: campaign.id, date: dateKeyToDbDate(vnDateKey(40)), expense: 50_000 },
    });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("xem 90 ngày: lần diễn tập 45 ngày trước tính đủ tiền tiêu 40 ngày trước → máy ĐÚNG", async () => {
    const sc = await loadAssistantScorecard(channel(), resolveAdsDateRange({ days: 90 }));
    expect(sc.days).toBe(90);
    expect(sc.planned.count).toBe(1);
    expect(sc.planned.rows[0].spendAfter).toBe(50_000);
    expect(sc.planned.right).toBe(1);
    expect(sc.planned.savingsIfLive).toBe(50_000);
  });

  it("xem 30 ngày: lần diễn tập đó nằm ngoài khoảng → không có dòng nào", async () => {
    const sc = await loadAssistantScorecard(channel(), resolveAdsDateRange({ days: 30 }));
    expect(sc.planned.count).toBe(0);
  });
});
