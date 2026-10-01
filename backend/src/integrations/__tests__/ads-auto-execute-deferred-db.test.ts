// ============================================================
// TRỢ LÝ QUẢNG CÁO — sàn báo GỌI QUÁ NHỊP giữa lượt (anh Trung duyệt 01/10/2026).
//
// Trước: lệnh thật bị trả ads.rate_limit.* ghi FAILED và giữ khóa ngày → chiến
// dịch vi phạm chạy tiếp tới hôm sau. Nay: dòng sổ DEFERRED, máy dừng lượt (không
// gọi dồn), xung kế thử lại ĐÚNG dòng đó với mã gửi sàn mới; từ chối nghiệp vụ
// (ads.edit.invalid_action…) vẫn là FAILED và không thử lại trong ngày.
// DB dev + gian tự dựng; tầng gọi sàn, cấp quyền và lõi insights được MOCK.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return { ...mod, editManualProductAdsRaw: vi.fn() };
});
vi.mock("../hubsell-ads", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../hubsell-ads")>();
  return {
    ...mod,
    resolveShopeeAdsAccess: vi.fn().mockResolvedValue({ accessToken: "t", shopId: "1", cfg: {} }),
  };
});
vi.mock("../shopee/ads-insights", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/ads-insights")>();
  return { ...mod, computeChannelAdsInsights: vi.fn() };
});

import { editManualProductAdsRaw } from "../shopee/client";
import { computeChannelAdsInsights, type CampaignInsight } from "../shopee/ads-insights";
import { normalizeAssistantConfig } from "../shopee/ads-assistant-rules";
import { DEFERRED_STATUS, runAdsAutoExecute } from "../shopee/ads-auto-execute";

const LIVE_CONFIG = { enabled: true, autoExecute: { mode: "live", cutBudgetFirst: false } };
const edit = vi.mocked(editManualProductAdsRaw);

describe("runAdsAutoExecute — sàn báo gọi quá nhịp thì dừng lượt, xung kế thử lại", () => {
  let fx: StockFixture;
  const channel = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });
  const rowIds: Record<string, string> = {};
  const logsOf = (name: string) =>
    prisma.adsActionLog.findMany({ where: { adsCampaignId: rowIds[name] }, orderBy: { createdAt: "asc" } });

  /** Tạo chiến dịch đang chạy; số trong tên càng nhỏ thì chi 7 ngày càng lớn (xử lý trước). */
  async function addCampaign(name: string) {
    const row = await prisma.adsCampaign.create({
      data: { channelId: fx.channelId, campaignId: `${Date.now()}${Object.keys(rowIds).length}`, name, status: "ongoing" },
    });
    rowIds[name] = row.id;
  }

  beforeAll(async () => {
    fx = await createStockFixture("adsdefer");
    await prisma.adsAssistantConfig.create({ data: { channelId: fx.channelId, config: LIVE_CONFIG } });
    // Lõi insights giả: mọi chiến dịch đang chạy của gian đều "lỗ, đề xuất tạm dừng".
    vi.mocked(computeChannelAdsInsights).mockImplementation(async () => {
      const rows = await prisma.adsCampaign.findMany({ where: { channelId: fx.channelId }, orderBy: { name: "asc" } });
      const zero = { spend: 0, clicks: 0, broadOrder: 0, broadGmv: 0 };
      const items = rows.map(
        (row, i) =>
          ({
            row: { ...row, dailyPerf: [] },
            itemIds: [],
            windows: { today: zero, "3d": zero, "7d": { ...zero, spend: 1_000_000 - i }, "30d": zero },
            avgDailySpend7d: 100_000,
            breakevenRoas: 5,
            assessment: { verdict: "pause_now", reasons: ["Lý do test"], window: "7d" },
          }) as unknown as CampaignInsight
      );
      return {
        config: normalizeAssistantConfig(LIVE_CONFIG),
        items,
        shop: { margin: 0.2, breakevenRoas: 5, pnlOrders: 0, missingCostOrders: 0, costCoveragePct: null },
      };
    });
  });
  beforeEach(() => {
    edit.mockReset();
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("lệnh thứ 2 bị quá nhịp → dòng DEFERRED, dừng lượt (chiến dịch thứ 3 chưa gọi); lượt sau thử lại đúng dòng đó", async () => {
    await addCampaign("c1");
    await addCampaign("c2");
    await addCampaign("c3");

    edit
      .mockResolvedValueOnce({ error: "" })
      .mockResolvedValueOnce({ error: "ads.rate_limit.exceed_shop_api", message: "Too many requests for the shop" });
    const r1 = await runAdsAutoExecute(await channel());
    expect(edit).toHaveBeenCalledTimes(2); // c3 không được gọi — không gọi dồn khi sàn đã báo quá nhịp
    expect(r1).toMatchObject({ mode: "live", executed: 1, failed: 0, deferred: 1 });
    expect((await logsOf("c1")).map((l) => l.status)).toEqual(["SUCCESS"]);
    const c2First = await logsOf("c2");
    expect(c2First.map((l) => l.status)).toEqual([DEFERRED_STATUS]);
    expect(c2First[0].error).toContain("ads.rate_limit.exceed_shop_api");
    expect(await logsOf("c3")).toHaveLength(0);
    const firstRef = edit.mock.calls[1][0].referenceId;
    expect(firstRef).toBe(c2First[0].referenceId);

    // Xung kế: sàn hết bận → c2 gửi lại trên CHÍNH dòng sổ đó (mã gửi sàn mới), c3 được xử lý.
    edit.mockReset();
    edit.mockResolvedValue({ error: "" });
    const r2 = await runAdsAutoExecute(await channel());
    expect(r2).toMatchObject({ executed: 2, failed: 0, deferred: 0, skippedDone: 0 });
    expect(edit).toHaveBeenCalledTimes(2);
    const retryRef = edit.mock.calls[0][0].referenceId;
    expect(retryRef.startsWith(`${firstRef}-r`)).toBe(true);
    const c2After = await logsOf("c2");
    expect(c2After).toHaveLength(1);
    expect(c2After[0]).toMatchObject({ id: c2First[0].id, status: "SUCCESS", error: null, referenceId: firstRef });
    expect((await logsOf("c3")).map((l) => l.status)).toEqual(["SUCCESS"]);
    const rows = await prisma.adsCampaign.findMany({ where: { channelId: fx.channelId } });
    expect(rows.every((c) => c.status === "paused" && c.hubsellPausedAt != null)).toBe(true);
  });

  it("từ chối nghiệp vụ vẫn là FAILED: không dừng lượt, không thử lại trong ngày", async () => {
    await addCampaign("c4");
    await addCampaign("c5");

    edit
      .mockResolvedValueOnce({ error: "ads.edit.invalid_action", message: "Edit Action is invalid" })
      .mockResolvedValueOnce({ error: "" });
    const r1 = await runAdsAutoExecute(await channel());
    expect(edit).toHaveBeenCalledTimes(2);
    expect(r1).toMatchObject({ executed: 1, failed: 1, deferred: 0 });
    expect((await logsOf("c4")).map((l) => l.status)).toEqual(["FAILED"]);

    edit.mockReset();
    const r2 = await runAdsAutoExecute(await channel());
    expect(edit).not.toHaveBeenCalled();
    expect(r2).toMatchObject({ executed: 0, failed: 0, deferred: 0, skippedDone: 1 });
  });
});
