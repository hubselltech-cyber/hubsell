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
  assessRoasTarget,
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

describe("Q1 — NGƯỠNG TIỀN gác cả nhánh ROAS (sự cố 14/09/2026)", () => {
  it("TÁI HIỆN 07:05 14/09: hôm nay mới tiêu 25k, ROAS 4,96x < hòa vốn 6,63x → KHÔNG pause_now, healthy kèm ghi chú chờ", () => {
    const out = evaluateShopeeCampaign(
      mkInput(
        { today: { spend: 25_000, clicks: 15, broadOrder: 1, broadGmv: 124_000 } },
        { breakeven: 6.63 }
      )
    );
    expect(out.verdict).toBe("healthy");
    expect(out.reasons.join(" ")).toContain("ngưỡng can thiệp");
    expect(out.reasons.join(" ")).toContain("về trễ");
  });

  it("hôm nay tiêu ĐỦ ngưỡng (150k, không nhân 0,2) mà ROAS vẫn dưới hòa vốn → pause_now ở cửa sổ hôm nay", () => {
    const out = evaluateShopeeCampaign(
      mkInput(
        { today: { spend: 160_000, clicks: 60, broadOrder: 3, broadGmv: 400_000 } }, // roas 2.5 < 3.8
        { breakeven: 4 }
      )
    );
    expect(out.verdict).toBe("pause_now");
    expect(out.window).toBe("today");
    expect(out.triggers).toEqual(["below_breakeven"]);
  });

  it("hôm nay tiêu 120k < 150k mà 0 đơn → cũng chưa phán (cùng ngưỡng cho cả hai nhánh)", () => {
    const out = evaluateShopeeCampaign(
      mkInput({ today: { spend: 120_000, clicks: 50, broadOrder: 0, broadGmv: 0 } })
    );
    expect(out.verdict).toBe("healthy");
  });

  it("cửa sổ 7 ngày: tiêu 120k (< 150k) ROAS thấp → chưa phán; 160k → pause_now", () => {
    const low = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 120_000, clicks: 60, broadOrder: 2, broadGmv: 200_000 } })
    );
    expect(low.verdict).toBe("healthy");
    const enough = evaluateShopeeCampaign(
      mkInput({ "7d": { spend: 160_000, clicks: 60, broadOrder: 2, broadGmv: 200_000 } })
    );
    expect(enough.verdict).toBe("pause_now");
  });

  it("seller hạ ngưỡng xuống 20k → campaign nhỏ lại bị xét như trước (quyền của seller)", () => {
    const out = evaluateShopeeCampaign(
      mkInput(
        { today: { spend: 25_000, clicks: 15, broadOrder: 1, broadGmv: 124_000 } },
        { breakeven: 6.63 }
      ),
      cfg((c) => (c.hard.zeroOrderSpend7d = 20_000))
    );
    expect(out.verdict).toBe("pause_now");
  });
});

// ---------- Đợt A (17/09): mục tiêu ROAS trên sàn so với hòa vốn ----------

describe("assessRoasTarget", () => {
  it("mục tiêu dưới hòa vốn → below, mục tiêu an toàn = hòa vốn × factor làm tròn lên 0,1", () => {
    const r = assessRoasTarget({ roasTarget: 4, breakevenRoas: 6.63, dangerFactor: 1.1 });
    expect(r?.status).toBe("below");
    expect(r?.safeTarget).toBe(7.3); // 6,63 × 1,1 = 7,293 → 7,3
  });
  it("giữa hòa vốn và vùng an toàn → tight; từ vùng an toàn → ok", () => {
    expect(assessRoasTarget({ roasTarget: 7, breakevenRoas: 6.63, dangerFactor: 1.1 })?.status).toBe("tight");
    expect(assessRoasTarget({ roasTarget: 7.3, breakevenRoas: 6.63, dangerFactor: 1.1 })?.status).toBe("ok");
  });
  it("không đặt mục tiêu / chưa có hòa vốn → null (không phán)", () => {
    expect(assessRoasTarget({ roasTarget: null, breakevenRoas: 6.63, dangerFactor: 1.1 })).toBeNull();
    expect(assessRoasTarget({ roasTarget: 0, breakevenRoas: 6.63, dangerFactor: 1.1 })).toBeNull();
    expect(assessRoasTarget({ roasTarget: 5, breakevenRoas: null, dangerFactor: 1.1 })).toBeNull();
  });
  it("làm tròn không bị lỗi số thực: 5 × 1,1 = 5,5 đúng 5,5 chứ không 5,6", () => {
    expect(assessRoasTarget({ roasTarget: 5.5, breakevenRoas: 5, dangerFactor: 1.1 })?.safeTarget).toBe(5.5);
  });
});
