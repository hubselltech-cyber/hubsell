// ============================================================
// SHOPEE ADS — ngày gửi lên sàn ở KHUNG 0h–7h SÁNG VN (01/10/2026).
//
// Máy chủ Render chạy UTC. Trước đây xung và lượt lịch sử tính ngày bằng getDate()
// của máy chủ nên từ 0h tới 7h sáng VN vẫn hỏi sàn "hôm qua": bảng không có dòng
// hôm nay, luật vọt chi và cửa sổ Hôm nay mù 7 tiếng — đúng khung 0h–2h ngày sale.
// Test đặt đồng hồ 0h30 sáng 10/10 giờ VN rồi đọc tham số ngày của từng call.
// Tầng gọi sàn + cấp quyền được MOCK; sàn trả rỗng nên không chạm database.
// ============================================================
import "./load-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@prisma/client";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return {
    ...mod,
    getAdsDailyPerformance: vi.fn().mockResolvedValue({ response: [] }),
    getAdsCampaignDailyPerformance: vi.fn().mockResolvedValue({ response: [] }),
  };
});
vi.mock("../hubsell-ads", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../hubsell-ads")>();
  return {
    ...mod,
    resolveShopeeAdsAccess: vi.fn().mockResolvedValue({ accessToken: "t", shopId: "1", cfg: {} }),
  };
});

import { getAdsCampaignDailyPerformance, getAdsDailyPerformance } from "../shopee/client";
import { upsertShopeeCampaignPerf } from "../shopee/ads-campaigns";
import { syncShopeeAdsSpend } from "../shopee/ads-spend";
import { vnDayWindow } from "../../lib/ads-dates";

const channel = { id: "ch-test", shopName: "TEST" } as Channel;
const access = { accessToken: "t", shopId: "1", cfg: {} } as never;

describe("Shopee Ads — 0h30 sáng VN hỏi sàn đúng ngày VN mới", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T17:30:00Z")); // 00:30 ngày 10/10 giờ VN
    vi.mocked(getAdsDailyPerformance).mockClear();
    vi.mocked(getAdsCampaignDailyPerformance).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("xung — chi tiêu cấp gian (daysBack 1): start = end = 10-10-2026", async () => {
    await syncShopeeAdsSpend(channel, { daysBack: 1 });
    expect(vi.mocked(getAdsDailyPerformance).mock.calls[0][0]).toMatchObject({
      startDate: "10-10-2026",
      endDate: "10-10-2026",
    });
  });

  it("xung — hiệu suất chiến dịch hôm nay: start = end = 10-10-2026", async () => {
    await upsertShopeeCampaignPerf(access, new Map([["111", "row-1"]]), vnDayWindow(1));
    expect(vi.mocked(getAdsCampaignDailyPerformance).mock.calls[0][0]).toMatchObject({
      campaignIds: ["111"],
      startDate: "10-10-2026",
      endDate: "10-10-2026",
    });
  });

  it("lượt lịch sử 7 ngày: 04-10 → 10-10 (kết thúc ở ngày VN mới, không lùi một ngày)", async () => {
    await syncShopeeAdsSpend(channel, { daysBack: 7 });
    expect(vi.mocked(getAdsDailyPerformance).mock.calls[0][0]).toMatchObject({
      startDate: "04-10-2026",
      endDate: "10-10-2026",
    });
  });
});
