// ============================================================
// TEST BẢNG ĐIỂM TRỢ LÝ QUẢNG CÁO + TÓM TẮT CUỐI NGÀY — logic thuần, KHÔNG DB.
// (bước 6 sự cố 14/09/2026: seller thấy máy phán đúng/sai trên số của mình)
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildAssistantScorecard,
  buildDailyDigest,
  formatDailyDigest,
  type ScorecardLog,
} from "../shopee/ads-scorecard";
import type { CampaignInsight } from "../shopee/ads-insights";
import { normalizeAssistantConfig } from "../shopee/ads-assistant-rules";

const cfg = normalizeAssistantConfig(null); // breakevenFactor 0.95
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function insight(id: string, breakeven: number | null, perf: { day: string; spend: number; gmv: number; orders: number }[]): CampaignInsight {
  return {
    row: {
      id,
      campaignId: `c-${id}`,
      name: `Campaign ${id}`,
      dailyPerf: perf.map((p) => ({ date: d(p.day), expense: p.spend, broadGmv: p.gmv, broadOrder: p.orders })),
    },
    breakevenRoas: breakeven,
  } as unknown as CampaignInsight;
}
function log(p: Partial<ScorecardLog> & { adsCampaignId: string; createdAt: Date }): ScorecardLog {
  return { id: `l-${Math.random()}`, action: "pause", mode: "dry_run", status: "PLANNED", reasons: "Lý do", ...p };
}

describe("buildAssistantScorecard — máy phán đúng/sai nhìn từ những ngày SAU", () => {
  // Máy định dừng lúc 07:05 VN ngày 10/09 (= 00:05Z) → chỉ tính ngày 11/09 trở đi.
  const at = new Date("2026-09-10T00:05:00Z");

  it("sau đó vẫn lỗ (ROAS < hòa vốn×0,95) → ĐÚNG, tiền tiêu tiếp = lẽ ra tiết kiệm", () => {
    const items = [insight("a", 4, [
      { day: "2026-09-10", spend: 50_000, gmv: 100_000, orders: 1 }, // ngày phán — bỏ
      { day: "2026-09-11", spend: 60_000, gmv: 120_000, orders: 1 }, // 2x
      { day: "2026-09-12", spend: 40_000, gmv: 40_000, orders: 1 }, // 1x
    ])];
    const sc = buildAssistantScorecard([log({ adsCampaignId: "a", createdAt: at })], items, cfg, 7);
    expect(sc.planned.count).toBe(1);
    expect(sc.planned.right).toBe(1);
    expect(sc.planned.savingsIfLive).toBe(100_000);
    expect(sc.planned.rows[0].roasAfter).toBeCloseTo(1.6);
  });

  it("sau đó ROAS đạt (đơn về trễ) → SAI, không tính tiết kiệm", () => {
    const items = [insight("a", 4, [
      { day: "2026-09-11", spend: 30_000, gmv: 300_000, orders: 3 }, // 10x
    ])];
    const sc = buildAssistantScorecard([log({ adsCampaignId: "a", createdAt: at })], items, cfg, 7);
    expect(sc.planned.wrong).toBe(1);
    expect(sc.planned.savingsIfLive).toBe(0);
  });

  it("chưa tiêu đủ 20k sau đó → chưa kết luận", () => {
    const items = [insight("a", 4, [{ day: "2026-09-11", spend: 5_000, gmv: 0, orders: 0 }])];
    const sc = buildAssistantScorecard([log({ adsCampaignId: "a", createdAt: at })], items, cfg, 7);
    expect(sc.planned.pending).toBe(1);
  });

  it("tiêu tiếp mà 0 đơn → ĐÚNG kể cả khi chưa có hòa vốn", () => {
    const items = [insight("a", null, [{ day: "2026-09-11", spend: 50_000, gmv: 0, orders: 0 }])];
    const sc = buildAssistantScorecard([log({ adsCampaignId: "a", createdAt: at })], items, cfg, 7);
    expect(sc.planned.right).toBe(1);
  });

  it("một campaign định dừng nhiều lần → chỉ tính lần sớm nhất; đếm hành động thật riêng", () => {
    const items = [insight("a", 4, [{ day: "2026-09-11", spend: 50_000, gmv: 0, orders: 0 }])];
    const logs = [
      log({ adsCampaignId: "a", createdAt: new Date("2026-09-10T05:00:00Z") }),
      log({ adsCampaignId: "a", createdAt: at }),
      log({ adsCampaignId: "b", createdAt: at, mode: "live", status: "SUCCESS" }),
      log({ adsCampaignId: "c", createdAt: at, mode: "live", status: "OVERRIDDEN" }),
      log({ adsCampaignId: "d", createdAt: at, mode: "live", status: "SUCCESS", action: "resume" }),
      log({ adsCampaignId: "e", createdAt: at, mode: "manual", status: "SUCCESS", action: "resume" }),
      log({ adsCampaignId: "f", createdAt: at, mode: "live", status: "FAILED" }),
    ];
    const sc = buildAssistantScorecard(logs, items, cfg, 7);
    expect(sc.planned.count).toBe(1);
    expect(sc.live).toEqual({ paused: 2, resumed: 1, resumedByOwner: 1, failed: 1, overridden: 1 });
  });
});

describe("tóm tắt cuối ngày", () => {
  it("gom theo loại, không trùng tên, ngày không có gì → null", () => {
    const at = new Date();
    const digest = buildDailyDigest([
      { ...log({ adsCampaignId: "a", createdAt: at, mode: "live", status: "SUCCESS" }), campaignName: "A" },
      { ...log({ adsCampaignId: "a", createdAt: at, mode: "live", status: "SUCCESS" }), campaignName: "A" },
      { ...log({ adsCampaignId: "b", createdAt: at, mode: "live", status: "SUCCESS", action: "resume" }), campaignName: "B" },
      { ...log({ adsCampaignId: "c", createdAt: at }), campaignName: "C" },
      { ...log({ adsCampaignId: "d", createdAt: at, mode: "manual", status: "FAILED", action: "resume" }), campaignName: "D" },
    ]);
    expect(digest).toEqual({ paused: ["A"], resumed: ["B"], planned: ["C"], failed: [] });
    const msg = formatDailyDigest(digest);
    expect(msg?.title).toBe("🤖 Trợ lý quảng cáo hôm nay: dừng 1, bật lại 1, diễn tập 1");
    expect(msg?.body).toContain('"A"');
    expect(formatDailyDigest({ paused: [], resumed: [], planned: [], failed: [] })).toBeNull();
  });
});
