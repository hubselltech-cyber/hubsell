// ============================================================
// TEST ĐỢT E — RỔ "ĐANG LÃI NHƯNG BỊ CHẶN PHÂN PHỐI" (24/09/2026). Thuần, KHÔNG DB.
//
// assessDelivery chỉ phán khi: campaign ongoing, verdict healthy, có hòa vốn,
// ≥ 3 ngày trọn có tiêu tiền, ROAS 7 ngày ≥ hòa vốn × dangerFactor, mục tiêu
// (nếu có) đã ở vùng ok. Hai kết luận: budget_capped (tiêu ≥ 90% ngân sách
// ngày) hoặc target_binding (ROAS thực < mục tiêu đang đặt). Không thì null.
// Ca thật: ANO "Túi Đeo Chéo Nam" 24/09 — auto bidding, ngân sách không giới
// hạn, ROAS 7d 9,44x, hòa vốn 6,9x, mục tiêu 12,2x → target_binding.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  BUDGET_CAP_PCT,
  DELIVERY_MIN_FULL_DAYS,
  assessDelivery,
  assessRoasTarget,
} from "../shopee/ads-assistant-rules";

const BE = 6.9;
const FACTOR = 1.1;

function base(over: Partial<Parameters<typeof assessDelivery>[0]> = {}) {
  return {
    status: "ongoing",
    verdict: "healthy" as const,
    roasTargetCheck: null,
    breakevenRoas: BE,
    budget: 0,
    roasTarget: null,
    prev7: { spend: 1_716_678, gmv: 16_205_000, daysWithSpend: 7 },
    dangerFactor: FACTOR,
    ...over,
  };
}

describe("assessDelivery — không phán khi chưa đủ điều kiện", () => {
  it("campaign tắt / verdict không healthy → null", () => {
    expect(assessDelivery(base({ status: "paused" }))).toBeNull();
    expect(assessDelivery(base({ verdict: "review" }))).toBeNull();
    expect(assessDelivery(base({ verdict: "insufficient_data" }))).toBeNull();
    expect(assessDelivery(base({ verdict: null }))).toBeNull();
  });

  it("chưa có hòa vốn → null", () => {
    expect(assessDelivery(base({ breakevenRoas: null }))).toBeNull();
    expect(assessDelivery(base({ breakevenRoas: 0 }))).toBeNull();
  });

  it(`ít hơn ${DELIVERY_MIN_FULL_DAYS} ngày trọn có tiêu tiền → null (bài học 14/09: không phán trên mẫu mỏng)`, () => {
    expect(
      assessDelivery(base({ prev7: { spend: 500_000, gmv: 5_000_000, daysWithSpend: DELIVERY_MIN_FULL_DAYS - 1 } }))
    ).toBeNull();
    expect(assessDelivery(base({ prev7: { spend: 0, gmv: 0, daysWithSpend: 0 } }))).toBeNull();
  });

  it("ROAS 7 ngày dưới vùng an toàn (hòa vốn × factor) → null, việc đó của Q1/Q2", () => {
    // 7,2x < 6,9 × 1,1 = 7,59
    expect(assessDelivery(base({ prev7: { spend: 1_000_000, gmv: 7_200_000, daysWithSpend: 7 } }))).toBeNull();
  });

  it("mục tiêu đang đặt dưới hòa vốn / vùng vàng → null (đợt A lo)", () => {
    const below = assessRoasTarget({ roasTarget: 5, breakevenRoas: BE, dangerFactor: FACTOR });
    expect(assessDelivery(base({ roasTarget: 5, roasTargetCheck: below }))).toBeNull();
    const tight = assessRoasTarget({ roasTarget: 7, breakevenRoas: BE, dangerFactor: FACTOR });
    expect(assessDelivery(base({ roasTarget: 7, roasTargetCheck: tight }))).toBeNull();
  });

  it("đang lãi, ngân sách còn dư, mục tiêu đã đạt hoặc không đặt → null (không có gì để nới)", () => {
    expect(assessDelivery(base({ budget: 1_000_000 }))).toBeNull();
    const ok = assessRoasTarget({ roasTarget: 8, breakevenRoas: BE, dangerFactor: FACTOR });
    expect(assessDelivery(base({ budget: 1_000_000, roasTarget: 8, roasTargetCheck: ok }))).toBeNull();
  });
});

describe("assessDelivery — budget_capped", () => {
  it(`tiêu trung bình ≥ ${BUDGET_CAP_PCT}% ngân sách ngày → budget_capped, % tính trên ngày CÓ tiêu tiền`, () => {
    // 1.716.678 / 7 = 245.240/ngày; ngân sách 250.000 → 98%
    const r = assessDelivery(base({ budget: 250_000 }));
    expect(r?.status).toBe("budget_capped");
    expect(r?.budgetUsedPct).toBe(98);
    expect(r?.avgDailySpend).toBeCloseTo(245_239.7, 0);
    expect(r?.fullDays).toBe(7);
    expect(r?.roas).toBeCloseTo(9.44, 2);
  });

  it("ngân sách chặn ưu tiên hơn mục tiêu bó khi cả hai cùng xảy ra", () => {
    const ok = assessRoasTarget({ roasTarget: 12.2, breakevenRoas: BE, dangerFactor: FACTOR });
    const r = assessDelivery(base({ budget: 250_000, roasTarget: 12.2, roasTargetCheck: ok }));
    expect(r?.status).toBe("budget_capped");
  });

  it("dưới mốc 90% → không phải ngân sách chặn", () => {
    // 245.240 / 300.000 = 82%
    expect(assessDelivery(base({ budget: 300_000 }))).toBeNull();
  });
});

describe("assessDelivery — target_binding (ca thật ANO 24/09)", () => {
  it("ngân sách không giới hạn, ROAS thực 9,44x < mục tiêu 12,2x, trên hòa vốn → target_binding, safeTarget = 7,6", () => {
    const ok = assessRoasTarget({ roasTarget: 12.2, breakevenRoas: BE, dangerFactor: FACTOR });
    const r = assessDelivery(base({ roasTarget: 12.2, roasTargetCheck: ok }));
    expect(r?.status).toBe("target_binding");
    expect(r?.roasTarget).toBe(12.2);
    expect(r?.budgetUsedPct).toBeNull();
    expect(r?.safeTarget).toBe(7.6); // 6,9 × 1,1 = 7,59 → 7,6
  });

  it("ROAS thực đã đạt mục tiêu → null", () => {
    const ok = assessRoasTarget({ roasTarget: 9, breakevenRoas: BE, dangerFactor: FACTOR });
    expect(assessDelivery(base({ roasTarget: 9, roasTargetCheck: ok }))).toBeNull();
  });
});
