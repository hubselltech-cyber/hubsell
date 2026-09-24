// ============================================================
// TEST ĐỢT B — HẠ NGÂN SÁCH TRƯỚC, TẮT SAU (24/09/2026). Thuần, KHÔNG DB, KHÔNG gọi sàn.
//
// planBudgetCut: mức hạ = max(50% ngân sách, 70% chi tiêu TB ngày), làm tròn 1.000;
// không giới hạn → trần = 70% chi tiêu (không có chi tiêu → null); hết chỗ hạ → null.
// planAutoAction: spike → pause; pause_now + cờ cutBudgetFirst + Shopee: chưa hạ →
// cut_budget, hạ hôm nay → không làm gì, hạ hôm trước → pause; Lazada / cờ tắt → pause.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  CUT_KEEP_RATIO,
  CUT_SPEND_RATIO,
  DEFAULT_SHOPEE_ASSISTANT_CONFIG,
  normalizeAssistantConfig,
  planBudgetCut,
  type ShopeeAssistantConfig,
} from "../shopee/ads-assistant-rules";
import { planAutoAction } from "../shopee/ads-auto-execute";
import type { CampaignInsight } from "../shopee/ads-insights";

describe("planBudgetCut — mức hạ có căn cứ", () => {
  it("chi tiêu sát ngân sách → 70% chi tiêu TB (lớn hơn 50% ngân sách)", () => {
    // ngân sách 500k, tiêu TB 480k: max(250k, 336k) = 336k
    const p = planBudgetCut({ budget: 500_000, avgDailySpend7d: 480_000 });
    expect(p?.newBudget).toBe(336_000);
    expect(p?.basis).toContain("70%");
  });

  it("tiêu ít so với ngân sách → giữ 50% ngân sách", () => {
    // ngân sách 500k, tiêu TB 200k: max(250k, 140k) = 250k
    const p = planBudgetCut({ budget: 500_000, avgDailySpend7d: 200_000 });
    expect(p?.newBudget).toBe(250_000);
    expect(p?.basis).toContain("50%");
  });

  it("làm tròn 1.000 và không thấp hơn 1.000", () => {
    expect(planBudgetCut({ budget: 123_456, avgDailySpend7d: 0 })?.newBudget).toBe(62_000);
    expect(planBudgetCut({ budget: 1_500, avgDailySpend7d: 0 })?.newBudget).toBe(1_000);
  });

  it("KHÔNG giới hạn (0) → trần = 70% chi tiêu TB; không có chi tiêu → null (không có căn cứ)", () => {
    const p = planBudgetCut({ budget: 0, avgDailySpend7d: 245_240 });
    expect(p?.newBudget).toBe(172_000); // 171.668 → 172.000
    expect(p?.basis).toContain("KHÔNG giới hạn");
    expect(planBudgetCut({ budget: 0, avgDailySpend7d: 0 })).toBeNull();
  });

  it("hằng số đúng như docs đợt B", () => {
    expect(CUT_KEEP_RATIO).toBe(0.5);
    expect(CUT_SPEND_RATIO).toBe(0.7);
  });
});

function mk(opts: {
  verdict: CampaignInsight["assessment"]["verdict"];
  budget?: number;
  avg?: number;
}): CampaignInsight {
  return {
    row: { id: "r1", status: "ongoing", budget: opts.budget ?? 500_000, hubsellPauseCycle: 0 },
    avgDailySpend7d: opts.avg ?? 480_000,
    assessment: { verdict: opts.verdict, reasons: ["lý do"] },
  } as unknown as CampaignInsight;
}

const CFG_ON: ShopeeAssistantConfig = {
  ...DEFAULT_SHOPEE_ASSISTANT_CONFIG,
  autoExecute: { mode: "live", maxActionsPerDay: 5, cutBudgetFirst: true },
};
const CFG_OFF: ShopeeAssistantConfig = {
  ...DEFAULT_SHOPEE_ASSISTANT_CONFIG,
  autoExecute: { mode: "live", maxActionsPerDay: 5, cutBudgetFirst: false },
};

describe("planAutoAction — nấc hạ ngân sách rồi mới tắt", () => {
  it("vọt chi (spike) → tắt ngay, không nấc trung gian", () => {
    const a = planAutoAction(mk({ verdict: "spike" }), CFG_ON, { budgetWriteSupported: true, cutState: "none" });
    expect(a?.kind).toBe("pause");
  });

  it("pause_now lần đầu trong ván, Shopee → cut_budget kèm mức", () => {
    const a = planAutoAction(mk({ verdict: "pause_now" }), CFG_ON, { budgetWriteSupported: true, cutState: "none" });
    expect(a?.kind).toBe("cut_budget");
    expect(a?.cut?.newBudget).toBe(336_000);
  });

  it("đã hạ HÔM NAY → không làm gì nữa (một nấc mỗi ngày)", () => {
    const a = planAutoAction(mk({ verdict: "pause_now" }), CFG_ON, { budgetWriteSupported: true, cutState: "today" });
    expect(a).toBeNull();
  });

  it("đã hạ hôm trước mà vẫn lỗ → tắt", () => {
    const a = planAutoAction(mk({ verdict: "pause_now" }), CFG_ON, { budgetWriteSupported: true, cutState: "earlier" });
    expect(a?.kind).toBe("pause");
  });

  it("Lazada (không có lệnh đổi ngân sách) → tắt như cũ", () => {
    const a = planAutoAction(mk({ verdict: "pause_now" }), CFG_ON, { budgetWriteSupported: false, cutState: "none" });
    expect(a?.kind).toBe("pause");
  });

  it("cờ cutBudgetFirst tắt → hành vi cũ (tắt ngay)", () => {
    const a = planAutoAction(mk({ verdict: "pause_now" }), CFG_OFF, { budgetWriteSupported: true, cutState: "none" });
    expect(a?.kind).toBe("pause");
  });

  it("không giới hạn ngân sách + không có chi tiêu làm căn cứ → tắt (không đặt trần bừa)", () => {
    const a = planAutoAction(mk({ verdict: "pause_now", budget: 0, avg: 0 }), CFG_ON, {
      budgetWriteSupported: true,
      cutState: "none",
    });
    expect(a?.kind).toBe("pause");
  });
});

describe("normalizeAssistantConfig — cờ cutBudgetFirst", () => {
  it("mặc định BẬT; bản lưu cũ (thiếu cờ) cũng bật; lưu false thì tắt", () => {
    expect(DEFAULT_SHOPEE_ASSISTANT_CONFIG.autoExecute.cutBudgetFirst).toBe(true);
    expect(normalizeAssistantConfig({ autoExecute: { mode: "dry_run", maxActionsPerDay: 3 } }).autoExecute.cutBudgetFirst).toBe(true);
    expect(
      normalizeAssistantConfig({ autoExecute: { mode: "live", maxActionsPerDay: 3, cutBudgetFirst: false } }).autoExecute
        .cutBudgetFirst
    ).toBe(false);
  });
});
