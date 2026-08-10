// ============================================================
// TEST TRỢ LÝ QUẢNG CÁO SHOPEE → TRUNG TÂM ĐIỀU HÀNH — logic thuần, KHÔNG DB.
//
// Ba lớp: (1) triggers có cấu trúc của rule engine (phân biệt Zero Order Drain
// với ROAS Risk mà không parse chuỗi), (2) gom campaign vào 3 kịch bản báo
// động đỏ, (3) ước giờ cạn ví + dựng thẻ cảnh báo (deep-link, severity).
// ============================================================

import { describe, expect, it } from "vitest";
import {
  evaluateShopeeCampaign,
  type AssistantCampaignInput,
  type AssistantWindowMetrics,
} from "../shopee/ads-assistant-rules";
import {
  buildShopeeAdsAssistantAlerts,
  estimateAdsWalletHoursLeft,
  groupShopeeAdsScenarios,
  type ShopeeAdsCampaignSignal,
} from "../../ops-alerts";

const ZERO: AssistantWindowMetrics = { spend: 0, clicks: 0, broadOrder: 0, broadGmv: 0 };

function mkInput(
  partial: Partial<Record<"today" | "3d" | "7d" | "30d", Partial<AssistantWindowMetrics>>>,
  opts: { breakeven?: number | null; avgDaily?: number } = {}
): AssistantCampaignInput {
  const w = (k: "today" | "3d" | "7d" | "30d"): AssistantWindowMetrics => ({
    ...ZERO,
    ...(partial[k] ?? {}),
  });
  return {
    status: "ongoing",
    breakevenRoas: opts.breakeven === undefined ? 4 : opts.breakeven,
    avgDailySpend7d: opts.avgDaily ?? 0,
    windows: { today: w("today"), "3d": w("3d"), "7d": w("7d"), "30d": w("30d") },
  };
}

function signal(p: Partial<ShopeeAdsCampaignSignal>): ShopeeAdsCampaignSignal {
  return {
    campaignId: "111",
    name: "Áo thun",
    verdict: null,
    triggers: [],
    decisionActive: false,
    spendToday: 0,
    spend7d: 0,
    ...p,
  };
}

// ---------- (1) triggers có cấu trúc từ rule engine ----------

describe("AssistantAssessment.triggers", () => {
  it("tiêu lớn 0 đơn (chưa rõ hòa vốn) → pause_now kèm trigger zero_order", () => {
    // breakeven null để cô lập nhánh zero_order (GMV 0 mà biết hòa vốn thì
    // nhánh below_breakeven cũng nổ — ca "đủ cả hai" ở dưới).
    const out = evaluateShopeeCampaign(
      mkInput(
        { "7d": { spend: 300_000, clicks: 120, broadOrder: 0, broadGmv: 0 } },
        { breakeven: null }
      )
    );
    expect(out.verdict).toBe("pause_now");
    expect(out.triggers).toEqual(["zero_order"]);
  });

  it("ROAS dưới ngưỡng nguy hiểm (có đơn) → pause_now kèm trigger below_breakeven", () => {
    // hòa vốn 4, ROAS = 300k GMV / 300k spend = 1 < 4×0.95
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 300_000, clicks: 120, broadOrder: 5, broadGmv: 300_000 } })
    );
    expect(out.verdict).toBe("pause_now");
    expect(out.triggers).toEqual(["below_breakeven"]);
  });

  it("vừa 0 đơn vừa dưới hòa vốn → đủ cả hai trigger", () => {
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 300_000, clicks: 120, broadOrder: 0, broadGmv: 100_000 } })
    );
    expect(out.verdict).toBe("pause_now");
    expect(out.triggers).toEqual(["zero_order", "below_breakeven"]);
  });

  it("grace (công thần) kế thừa triggers của Q1", () => {
    // Q1 below_breakeven nhưng 40 đơn/7 ngày ≥ ngưỡng grace 30 → grace
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 400_000, clicks: 200, broadOrder: 40, broadGmv: 400_000 } })
    );
    expect(out.verdict).toBe("grace");
    expect(out.triggers).toEqual(["below_breakeven"]);
  });

  it("spike/healthy không mang triggers", () => {
    const spike = evaluateShopeeCampaign(
      mkInput(
        { today: { spend: 400_000, broadGmv: 0 } },
        { avgDaily: 100_000 }
      )
    );
    expect(spike.verdict).toBe("spike");
    expect(spike.triggers).toBeUndefined();

    const healthy = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 300_000, clicks: 120, broadOrder: 20, broadGmv: 2_000_000 } })
    );
    expect(healthy.verdict).toBe("healthy");
    expect(healthy.triggers).toBeUndefined();
  });
});

// ---------- (2) gom kịch bản ----------

describe("groupShopeeAdsScenarios", () => {
  it("chia đúng spike / zero-order / roas-risk, bỏ verdict khác", () => {
    const groups = groupShopeeAdsScenarios([
      signal({ campaignId: "1", verdict: "spike" }),
      signal({ campaignId: "2", verdict: "pause_now", triggers: ["zero_order"] }),
      signal({ campaignId: "3", verdict: "pause_now", triggers: ["below_breakeven"] }),
      signal({ campaignId: "4", verdict: "review" }),
      signal({ campaignId: "5", verdict: "grace", triggers: ["below_breakeven"] }),
      signal({ campaignId: "6", verdict: "healthy" }),
      signal({ campaignId: "7", verdict: "insufficient_data" }),
    ]);
    expect(groups.spendSpike.map((c) => c.campaignId)).toEqual(["1"]);
    expect(groups.zeroOrderDrain.map((c) => c.campaignId)).toEqual(["2"]);
    expect(groups.roasRisk.map((c) => c.campaignId)).toEqual(["3"]);
  });

  it("dính cả hai trigger → xếp zero-order-drain (một campaign một nhóm)", () => {
    const groups = groupShopeeAdsScenarios([
      signal({
        verdict: "pause_now",
        triggers: ["zero_order", "below_breakeven"],
      }),
    ]);
    expect(groups.zeroOrderDrain).toHaveLength(1);
    expect(groups.roasRisk).toHaveLength(0);
  });

  it("chủ shop đã quyết (decisionActive) → loại khỏi mọi nhóm", () => {
    const groups = groupShopeeAdsScenarios([
      signal({ verdict: "spike", decisionActive: true }),
      signal({ verdict: "pause_now", triggers: ["zero_order"], decisionActive: true }),
    ]);
    expect(groups.spendSpike).toHaveLength(0);
    expect(groups.zeroOrderDrain).toHaveLength(0);
  });
});

// ---------- (3) ước giờ cạn ví ----------

describe("estimateAdsWalletHoursLeft", () => {
  it("không có nhịp đốt nào → null (shop không chạy ads thì không báo)", () => {
    expect(
      estimateAdsWalletHoursLeft({
        balance: 500_000,
        spendToday: 0,
        hoursElapsedToday: 10,
        avgDailySpend7d: 0,
      })
    ).toBeNull();
  });

  it("nhịp hôm nay thắng khi đang vọt chi: 100k/2h đốt 50k/h → 200k còn 4h", () => {
    expect(
      estimateAdsWalletHoursLeft({
        balance: 200_000,
        spendToday: 100_000,
        hoursElapsedToday: 2,
        avgDailySpend7d: 240_000, // 10k/h — thua nhịp hôm nay
      })
    ).toBeCloseTo(4);
  });

  it("sáng sớm chưa tiêu gì → nhịp 7 ngày giữ mẫu (240k/ngày = 10k/h)", () => {
    expect(
      estimateAdsWalletHoursLeft({
        balance: 100_000,
        spendToday: 0,
        hoursElapsedToday: 0.5, // kẹp thành 1h — không chia 0
        avgDailySpend7d: 240_000,
      })
    ).toBeCloseTo(10);
  });
});

// ---------- (4) dựng thẻ cảnh báo ----------

const SHOP = { channelId: "ch-1", shopName: "DarkMan Store" };
const NO_GROUPS = { spendSpike: [], zeroOrderDrain: [], roasRisk: [] };

describe("buildShopeeAdsAssistantAlerts", () => {
  it("không kịch bản nào + ví khỏe → không thẻ nào", () => {
    expect(
      buildShopeeAdsAssistantAlerts(SHOP, NO_GROUPS, {
        balance: 5_000_000,
        hoursLeft: 100,
      })
    ).toEqual([]);
  });

  it("1 campaign lẻ → deep-link kèm campaign_id; badge nguồn Shopee", () => {
    const [alert] = buildShopeeAdsAssistantAlerts(
      SHOP,
      {
        ...NO_GROUPS,
        zeroOrderDrain: [
          signal({ campaignId: "987", verdict: "pause_now", triggers: ["zero_order"], spend7d: 200_000 }),
        ],
      },
      null
    );
    expect(alert.type).toBe("ads-zero-order-drain");
    expect(alert.severity).toBe("high");
    expect(alert.payload.href).toBe("/ads/shopee?channelId=ch-1&campaign_id=987");
    expect(alert.payload.label).toBe("Xử lý chiến dịch");
    expect(alert.payload.source).toBe("Shopee");
  });

  it("nhiều campaign → deep-link needs_action=1, tiêu đề nêu số lượng", () => {
    const [alert] = buildShopeeAdsAssistantAlerts(
      SHOP,
      {
        ...NO_GROUPS,
        spendSpike: [
          signal({ campaignId: "1", verdict: "spike", spendToday: 300_000 }),
          signal({ campaignId: "2", verdict: "spike", spendToday: 200_000 }),
        ],
      },
      null
    );
    expect(alert.type).toBe("ads-spend-spike");
    expect(alert.payload.href).toBe("/ads/shopee?channelId=ch-1&needs_action=1");
    expect(alert.title).toContain("2 chiến dịch");
    expect(alert.summary).toContain("500.000");
  });

  it("roas-risk: severity theo tổng chi 7 ngày (≥500k → high, dưới → medium)", () => {
    const mk = (spend7d: number) =>
      buildShopeeAdsAssistantAlerts(
        SHOP,
        {
          ...NO_GROUPS,
          roasRisk: [
            signal({ verdict: "pause_now", triggers: ["below_breakeven"], spend7d }),
          ],
        },
        null
      )[0];
    expect(mk(600_000).severity).toBe("high");
    expect(mk(200_000).severity).toBe("medium");
  });

  it("ví dưới 24h → thẻ ads-low-balance; đủ tiền hoặc không ước được → im lặng", () => {
    const low = buildShopeeAdsAssistantAlerts(SHOP, NO_GROUPS, {
      balance: 120_000,
      hoursLeft: 6,
    });
    expect(low).toHaveLength(1);
    expect(low[0].type).toBe("ads-low-balance");
    expect(low[0].summary).toContain("6 giờ");
    expect(low[0].payload.href).toBe("/ads/shopee?channelId=ch-1");

    expect(
      buildShopeeAdsAssistantAlerts(SHOP, NO_GROUPS, { balance: 9_000_000, hoursLeft: 80 })
    ).toEqual([]);
    expect(
      buildShopeeAdsAssistantAlerts(SHOP, NO_GROUPS, { balance: 0, hoursLeft: null })
    ).toEqual([]);
  });

  it("mỗi kịch bản một thẻ — 3 nhóm cùng nổ vẫn chỉ 3 thẻ + ví = 4", () => {
    const alerts = buildShopeeAdsAssistantAlerts(
      SHOP,
      {
        spendSpike: [signal({ campaignId: "1", verdict: "spike" })],
        zeroOrderDrain: [
          signal({ campaignId: "2", verdict: "pause_now", triggers: ["zero_order"] }),
        ],
        roasRisk: [
          signal({ campaignId: "3", verdict: "pause_now", triggers: ["below_breakeven"] }),
        ],
      },
      { balance: 50_000, hoursLeft: 2 }
    );
    expect(alerts.map((a) => a.type)).toEqual([
      "ads-spend-spike",
      "ads-zero-order-drain",
      "ads-roas-risk",
      "ads-low-balance",
    ]);
  });
});
