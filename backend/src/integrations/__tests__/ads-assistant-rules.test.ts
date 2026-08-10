// ============================================================
// TEST RULE ENGINE TRỢ LÝ QUẢNG CÁO SHOPEE (GĐ2) — logic thuần, KHÔNG DB.
//
// Mirror tinh thần 13 ca của rule engine TikTok GMV Max: mỗi quy tắc một ca
// dương + một ca âm, kèm các ca ranh giới (bão hòa, công thần, thiếu hòa vốn,
// config tắt từng quy tắc, vá config cũ).
// ============================================================

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHOPEE_ASSISTANT_CONFIG,
  evaluateShopeeCampaign,
  normalizeAssistantConfig,
  type AssistantCampaignInput,
  type AssistantWindowMetrics,
  type ShopeeAssistantConfig,
} from "../shopee/ads-assistant-rules";

const ZERO: AssistantWindowMetrics = { spend: 0, clicks: 0, broadOrder: 0, broadGmv: 0 };

/** Dựng input gọn: chỉ khai cửa sổ cần, còn lại 0 (không đủ sàn dữ liệu). */
function mkInput(
  partial: Partial<Record<"today" | "3d" | "7d" | "30d", Partial<AssistantWindowMetrics>>>,
  opts: { breakeven?: number | null; avgDaily?: number; status?: string } = {}
): AssistantCampaignInput {
  const w = (k: "today" | "3d" | "7d" | "30d"): AssistantWindowMetrics => ({
    ...ZERO,
    ...(partial[k] ?? {}),
  });
  return {
    status: opts.status ?? "ongoing",
    breakevenRoas: opts.breakeven === undefined ? 4 : opts.breakeven,
    avgDailySpend7d: opts.avgDaily ?? 0,
    windows: { today: w("today"), "3d": w("3d"), "7d": w("7d"), "30d": w("30d") },
  };
}

/** Config clone sâu để chỉnh từng quy tắc trong ca test. */
function cfg(mutate?: (c: ShopeeAssistantConfig) => void): ShopeeAssistantConfig {
  const c = normalizeAssistantConfig(
    JSON.parse(JSON.stringify(DEFAULT_SHOPEE_ASSISTANT_CONFIG))
  );
  mutate?.(c);
  return c;
}

describe("Lớp gác cổng", () => {
  it("campaign không chạy (paused) → không đánh giá", () => {
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 500_000, clicks: 100, broadOrder: 0 } }, { status: "paused" })
    );
    expect(out.verdict).toBeNull();
  });

  it("Trợ lý tắt → không đánh giá", () => {
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 500_000, clicks: 100, broadOrder: 0 } }),
      cfg((c) => (c.enabled = false))
    );
    expect(out.verdict).toBeNull();
  });

  it("chưa đủ chi tiêu/click ở mọi cửa sổ → insufficient_data, không phán xét", () => {
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 40_000, clicks: 10, broadOrder: 0 } })
    );
    expect(out.verdict).toBe("insufficient_data");
  });
});

describe("Q1 — loại thẳng", () => {
  it("tiêu lớn 0 đơn → pause_now", () => {
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 300_000, clicks: 120, broadOrder: 0, broadGmv: 0 } })
    );
    expect(out.verdict).toBe("pause_now");
    expect(out.window).toBe("7d");
    expect(out.reasons.join(" ")).toContain("KHÔNG có đơn");
  });

  it("ROAS dưới hòa vốn × hệ số → pause_now kèm số hòa vốn trong reasons", () => {
    // BE 4 → ngưỡng nguy hiểm 3.8; roas 7d = 2
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 300_000, clicks: 120, broadOrder: 5, broadGmv: 600_000 } })
    );
    expect(out.verdict).toBe("pause_now");
    expect(out.reasons.join(" ")).toContain("hòa vốn");
  });

  it("BÃO HÒA: 30 ngày đẹp nhưng lát 3 ngày lỗ → bắt ở cửa sổ 3d", () => {
    const out = evaluateShopeeCampaign(
      mkInput({
        "3d": { spend: 100_000, clicks: 40, broadOrder: 2, broadGmv: 200_000 }, // roas 2 < 3.8
        "30d": { spend: 900_000, clicks: 400, broadOrder: 40, broadGmv: 5_400_000 }, // roas 6 đẹp
      })
    );
    expect(out.verdict).toBe("pause_now");
    expect(out.window).toBe("3d");
  });

  it("Q1 tắt → campaign lỗ nặng không còn bị đề xuất dừng", () => {
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 300_000, clicks: 120, broadOrder: 5, broadGmv: 600_000 } }),
      cfg((c) => (c.hard.enabled = false))
    );
    expect(out.verdict).toBe("healthy");
  });
});

describe("Q2 — vùng vàng chờ duyệt", () => {
  it("ROAS trên ngưỡng nguy hiểm nhưng chưa vượt vùng an toàn → review", () => {
    // BE 4 → band [3.8, 4.4); roas = 4.1
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 200_000, clicks: 80, broadOrder: 6, broadGmv: 820_000 } })
    );
    expect(out.verdict).toBe("review");
  });

  it("ROAS vượt hẳn vùng an toàn → healthy", () => {
    const out = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 200_000, clicks: 80, broadOrder: 10, broadGmv: 1_200_000 } })
    );
    expect(out.verdict).toBe("healthy");
  });

  it("không có hòa vốn (breakeven null) → Q2 im lặng, chỉ zero-order còn bắt được", () => {
    const out = evaluateShopeeCampaign(
      mkInput(
        { "7d": { spend: 200_000, clicks: 80, broadOrder: 6, broadGmv: 300_000 } },
        { breakeven: null }
      )
    );
    expect(out.verdict).toBe("healthy");
  });
});

describe("Q3 — spend spike (chạy trước sàn dữ liệu)", () => {
  it("hôm nay vọt chi + ROAS dưới hòa vốn → spike, dù chưa đủ mẫu 7 ngày", () => {
    const out = evaluateShopeeCampaign(
      mkInput(
        { today: { spend: 300_000, clicks: 30, broadOrder: 1, broadGmv: 300_000 } }, // roas 1
        { avgDaily: 100_000 }
      )
    );
    expect(out.verdict).toBe("spike");
    expect(out.window).toBe("today");
  });

  it("vọt chi nhưng ROAS hôm nay vẫn thắng hòa vốn (scale tốt) → KHÔNG spike", () => {
    const out = evaluateShopeeCampaign(
      mkInput(
        { today: { spend: 300_000, clicks: 30, broadOrder: 10, broadGmv: 2_400_000 } }, // roas 8
        { avgDaily: 100_000 }
      )
    );
    expect(out.verdict).not.toBe("spike");
  });

  it("chi tiêu hôm nay dưới ngưỡng tối thiểu → không spike dù gấp nhiều lần trung bình", () => {
    const out = evaluateShopeeCampaign(
      mkInput(
        { today: { spend: 80_000, clicks: 10, broadOrder: 0, broadGmv: 0 } },
        { avgDaily: 10_000 }
      )
    );
    expect(out.verdict).not.toBe("spike");
  });
});

describe("Q4 — bảo vệ công thần", () => {
  it("vi phạm Q1 nhưng ≥30 đơn/7 ngày → grace (không đề xuất dừng ngay)", () => {
    const out = evaluateShopeeCampaign(
      mkInput({
        "3d": { spend: 150_000, clicks: 60, broadOrder: 10, broadGmv: 300_000 }, // roas 2 → Q1
        "7d": { spend: 400_000, clicks: 160, broadOrder: 35, broadGmv: 2_000_000 },
      })
    );
    expect(out.verdict).toBe("grace");
    expect(out.reasons.join(" ")).toContain("công thần");
  });

  it("Q4 tắt → cùng dữ liệu trả pause_now", () => {
    const out = evaluateShopeeCampaign(
      mkInput({
        "3d": { spend: 150_000, clicks: 60, broadOrder: 10, broadGmv: 300_000 },
        "7d": { spend: 400_000, clicks: 160, broadOrder: 35, broadGmv: 2_000_000 },
      }),
      cfg((c) => (c.grace.enabled = false))
    );
    expect(out.verdict).toBe("pause_now");
  });
});

describe("normalizeAssistantConfig — vá bản lưu cũ", () => {
  it("raw rỗng/thiếu trường → về default", () => {
    expect(normalizeAssistantConfig(null)).toEqual(DEFAULT_SHOPEE_ASSISTANT_CONFIG);
    expect(normalizeAssistantConfig({ hard: { enabled: false } }).hard.enabled).toBe(false);
    expect(
      normalizeAssistantConfig({ hard: { enabled: false } }).floor.minSpend7d
    ).toBe(DEFAULT_SHOPEE_ASSISTANT_CONFIG.floor.minSpend7d);
  });

  it("giá trị âm/không phải số → về default từng trường", () => {
    const out = normalizeAssistantConfig({
      floor: { minSpend7d: -5, minClicks7d: "abc" },
      spike: { dayMultiple: 3 },
    });
    expect(out.floor.minSpend7d).toBe(DEFAULT_SHOPEE_ASSISTANT_CONFIG.floor.minSpend7d);
    expect(out.floor.minClicks7d).toBe(DEFAULT_SHOPEE_ASSISTANT_CONFIG.floor.minClicks7d);
    expect(out.spike.dayMultiple).toBe(3);
  });
});
