// ============================================================
// TRỢ LÝ QUẢNG CÁO — TỰ TRẢ NGÂN SÁCH GỐC (anh Trung duyệt 01/10/2026).
//
// Trước: máy chỉ trả ngân sách gốc khi có lệnh bật lại. Chiến dịch bị hạ rồi tự
// hồi (không bị dừng) nằm mãi ở mức đã hạ; lệnh trả ngay sau khi máy bật lại mà
// bị sàn báo quá nhịp cũng không ai gửi lại. Nay: chiến dịch đang chạy còn cờ hạ
// mà luật chấm Ổn → máy trả ở lượt kế; lệnh trả bị quá nhịp → DEFERRED, xung kế
// gửi lại dù lúc đó luật chấm gì.
// DB dev + gian tự dựng; tầng gọi sàn, cấp quyền và lõi insights được MOCK.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { shiftDateKey, vnDateKey } from "../../lib/ads-dates";
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

const LIVE_CONFIG = { enabled: true, autoExecute: { mode: "live", cutBudgetFirst: true } };
const edit = vi.mocked(editManualProductAdsRaw);
const TODAY = vnDateKey(0);
const YESTERDAY = shiftDateKey(TODAY, -1);
const RATE_LIMITED = { error: "ads.rate_limit.campaign_level", message: "Too many requests at the moment" };

describe("runAdsAutoExecute — tự trả ngân sách gốc", () => {
  let fx: StockFixture;
  const channel = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });
  /** Luật chấm giả cho từng chiến dịch (theo tên) — đổi giữa các lượt để dựng tình huống. */
  const verdicts = new Map<string, { verdict: string | null; reasons: string[] }>();
  const rowOf = (name: string) => prisma.adsCampaign.findFirstOrThrow({ where: { channelId: fx.channelId, name } });
  const restoreLogs = async (name: string) =>
    prisma.adsActionLog.findMany({
      where: { adsCampaignId: (await rowOf(name)).id, action: "restore_budget" },
      orderBy: { createdAt: "asc" },
    });

  /** Chiến dịch máy đã hạ 500.000 → 336.000 ₫ vào ngày `cutOn`. */
  async function addCutCampaign(name: string, cutOn: string, extra: Record<string, unknown> = {}) {
    await prisma.adsCampaign.create({
      data: {
        channelId: fx.channelId,
        campaignId: `${Date.now()}${verdicts.size}`,
        name,
        status: "ongoing",
        budget: 336_000,
        hubsellBudgetCutAt: new Date(`${cutOn}T03:00:00Z`),
        hubsellBudgetBefore: 500_000,
        hubsellBudgetCut: 336_000,
        hubsellBudgetCutOn: cutOn,
        ...extra,
      },
    });
    verdicts.set(name, { verdict: "healthy", reasons: [] });
  }

  beforeAll(async () => {
    fx = await createStockFixture("adsrestore");
    await prisma.adsAssistantConfig.create({ data: { channelId: fx.channelId, config: LIVE_CONFIG } });
    vi.mocked(computeChannelAdsInsights).mockImplementation(async () => {
      const rows = await prisma.adsCampaign.findMany({ where: { channelId: fx.channelId }, orderBy: { name: "asc" } });
      const zero = { spend: 0, clicks: 0, broadOrder: 0, broadGmv: 0 };
      const good = { spend: 100_000, clicks: 100, broadOrder: 5, broadGmv: 1_000_000 }; // ROAS 10x
      const items = rows.map((row) => {
        const v = verdicts.get(row.name) ?? { verdict: "healthy", reasons: [] };
        return {
          row: { ...row, dailyPerf: [] },
          itemIds: [],
          windows: { today: zero, "3d": zero, "7d": good, "30d": good },
          avgDailySpend7d: 100_000,
          breakevenRoas: 5,
          // Chiến dịch không chạy thì luật không chấm (giống lõi thật).
          assessment: row.status === "ongoing" ? { ...v, window: "7d" } : { verdict: null, reasons: [] },
        } as unknown as CampaignInsight;
      });
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

  it("hạ hôm qua, hôm nay luật chấm Ổn → máy tự trả 336.000 → 500.000 ₫, xóa cờ, ghi sổ + nhật ký", async () => {
    await addCutCampaign("a-hoi", YESTERDAY);
    edit.mockResolvedValue({ error: "" });

    const r = await runAdsAutoExecute(await channel());
    expect(r).toMatchObject({ mode: "live", budgetRestored: 1, budgetRestoreFailed: 0, deferred: 0 });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0][0]).toMatchObject({ editAction: "change_budget", budget: 500_000 });

    const row = await rowOf("a-hoi");
    expect(Number(row.budget)).toBe(500_000);
    expect(row.hubsellBudgetCutAt).toBeNull();
    expect(row.hubsellBudgetBefore).toBeNull();
    const logs = await restoreLogs("a-hoi");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "SUCCESS", mode: "live", referenceId: `restore-${row.id}-${TODAY}` });
    expect(logs[0].reasons).toContain("đã hết lỗ");
    const activity = await prisma.opsActivity.findFirst({
      where: { ownerId: fx.userId, message: { contains: "Trợ lý trả ngân sách ngày" } },
    });
    expect(activity?.message).toContain("a-hoi");

    // Lượt sau: cờ đã xóa → không còn gì để trả, không gọi sàn.
    edit.mockReset();
    const r2 = await runAdsAutoExecute(await channel());
    expect(edit).not.toHaveBeenCalled();
    expect(r2.budgetRestored).toBe(0);
  });

  it("chưa đủ điều kiện thì giữ mức đã hạ: vừa hạ hôm nay / còn sát hòa vốn / Ổn nhưng kèm ghi chú dưới hòa vốn", async () => {
    await addCutCampaign("b-hom-nay", TODAY);
    await addCutCampaign("b-vang", YESTERDAY);
    verdicts.set("b-vang", { verdict: "review", reasons: ["ROAS sát hòa vốn"] });
    await addCutCampaign("b-ghi-chu", YESTERDAY);
    verdicts.set("b-ghi-chu", { verdict: "healthy", reasons: ["ROAS dưới hòa vốn nhưng mới tiêu 20.000₫"] });

    const r = await runAdsAutoExecute(await channel());
    expect(edit).not.toHaveBeenCalled();
    expect(r.budgetRestored).toBe(0);
    for (const name of ["b-hom-nay", "b-vang", "b-ghi-chu"]) {
      expect(Number((await rowOf(name)).budget)).toBe(336_000);
      expect(await restoreLogs(name)).toHaveLength(0);
    }
    // Dọn để không lẫn vào test sau.
    await prisma.adsCampaign.deleteMany({ where: { channelId: fx.channelId, name: { startsWith: "b-" } } });
  });

  it("lệnh trả bị sàn báo quá nhịp → DEFERRED; xung kế gửi lại dù lúc đó luật không còn chấm Ổn", async () => {
    await addCutCampaign("c-ban", YESTERDAY);
    edit.mockResolvedValueOnce(RATE_LIMITED);
    const r1 = await runAdsAutoExecute(await channel());
    expect(r1).toMatchObject({ budgetRestored: 0, budgetRestoreFailed: 0, deferred: 1 });
    expect((await restoreLogs("c-ban")).map((l) => l.status)).toEqual([DEFERRED_STATUS]);
    expect(Number((await rowOf("c-ban")).budget)).toBe(336_000);

    verdicts.set("c-ban", { verdict: "review", reasons: ["ROAS sát hòa vốn"] });
    edit.mockReset();
    edit.mockResolvedValue({ error: "" });
    const r2 = await runAdsAutoExecute(await channel());
    expect(r2).toMatchObject({ budgetRestored: 1, deferred: 0 });
    const logs = await restoreLogs("c-ban");
    expect(logs.map((l) => l.status)).toEqual(["SUCCESS"]); // vẫn một dòng sổ
    expect(edit.mock.calls[0][0].referenceId.startsWith(`${logs[0].referenceId}-r`)).toBe(true);
    const row = await rowOf("c-ban");
    expect(Number(row.budget)).toBe(500_000);
    expect(row.hubsellBudgetBefore).toBeNull();
  });

  it("máy bật lại xong, lệnh trả ngân sách bị quá nhịp → chiến dịch vẫn chạy lại; xung kế trả nốt", async () => {
    await addCutCampaign("d-bat-lai", YESTERDAY, {
      status: "paused",
      hubsellPausedAt: new Date(),
      hubsellPauseWindow: "7d",
    });
    edit.mockResolvedValueOnce({ error: "" }).mockResolvedValueOnce(RATE_LIMITED);
    const r1 = await runAdsAutoExecute(await channel());
    expect(edit.mock.calls.map((c) => c[0].editAction)).toEqual(["resume", "change_budget"]);
    expect(r1).toMatchObject({ resumed: 1, budgetRestored: 0, deferred: 1 });
    const mid = await rowOf("d-bat-lai");
    expect(mid).toMatchObject({ status: "ongoing", hubsellPausedAt: null, hubsellPauseCycle: 1, hubsellResumedOn: TODAY });
    expect(Number(mid.budget)).toBe(336_000);
    expect(Number(mid.hubsellBudgetBefore)).toBe(500_000);
    expect((await restoreLogs("d-bat-lai")).map((l) => l.status)).toEqual([DEFERRED_STATUS]);

    // Xung kế: ván đã sang c1 nhưng khóa trả ngân sách theo NGÀY nên vẫn tìm thấy dòng nợ.
    verdicts.set("d-bat-lai", { verdict: "review", reasons: ["ROAS sát hòa vốn"] });
    edit.mockReset();
    edit.mockResolvedValue({ error: "" });
    const r2 = await runAdsAutoExecute(await channel());
    expect(edit.mock.calls.map((c) => c[0].editAction)).toEqual(["change_budget"]);
    expect(r2).toMatchObject({ budgetRestored: 1, deferred: 0 });
    const done = await rowOf("d-bat-lai");
    expect(Number(done.budget)).toBe(500_000);
    expect(done.hubsellBudgetCutAt).toBeNull();
    expect((await restoreLogs("d-bat-lai")).map((l) => l.status)).toEqual(["SUCCESS"]);
  });

  it("sàn từ chối nghiệp vụ → FAILED, cờ giữ nguyên, trong ngày không gửi lại", async () => {
    await addCutCampaign("e-tu-choi", YESTERDAY);
    edit.mockResolvedValueOnce({ error: "ads.campaign.error_daily_budget_range", message: "The budget set is invalid." });
    const r1 = await runAdsAutoExecute(await channel());
    expect(r1).toMatchObject({ budgetRestored: 0, budgetRestoreFailed: 1, deferred: 0 });
    expect((await restoreLogs("e-tu-choi")).map((l) => l.status)).toEqual(["FAILED"]);
    expect(Number((await rowOf("e-tu-choi")).hubsellBudgetBefore)).toBe(500_000);

    edit.mockReset();
    await runAdsAutoExecute(await channel());
    expect(edit).not.toHaveBeenCalled();
  });
});
