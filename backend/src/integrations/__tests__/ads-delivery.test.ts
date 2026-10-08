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
  TARGET_STEP_WAIT_HOURS,
  assessDelivery,
  assessRoasTarget,
  profitFloorRoas,
  stepProfitCheck,
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
    // 08/10: sàn = max(hòa vốn × 1,1 = 7,6; sàn giữ 5đ/100đ = 1/(1/6,9 − 0,05) = 10,54 → 10,6).
    expect(r?.safeTarget).toBe(10.6);
    expect(r?.minKeepPer100).toBe(5);
    expect(r?.nextTarget).toBe(11); // một nấc 10%: 12,2 → 10,98 → 11,0 (không nhảy thẳng về sàn)
    expect(r?.keepAtNextTarget).toBe(5.4); // 1/6,9 − 1/11 = 14,49% − 9,09%
    // Lãi mong muốn 0 → sàn về vùng vàng 7,6 như trước.
    expect(assessDelivery(base({ roasTarget: 12.2, roasTargetCheck: ok, minKeepPer100: 0 }))?.safeTarget).toBe(7.6);
  });

  it("khóa cứng 48 giờ sau khi mục tiêu đổi: trong khóa → null, hết khóa → gợi ý lại", () => {
    const ok = assessRoasTarget({ roasTarget: 12.2, breakevenRoas: BE, dangerFactor: FACTOR });
    const now = new Date("2026-10-04T12:00:00Z");
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const at = (h: number) =>
      assessDelivery(base({ roasTarget: 12.2, roasTargetCheck: ok, roasTargetChangedAt: hoursAgo(h), now }));
    expect(at(1)).toBeNull();
    expect(at(TARGET_STEP_WAIT_HOURS - 1)).toBeNull();
    expect(at(TARGET_STEP_WAIT_HOURS)?.status).toBe("target_binding");
  });

  it("khóa 48 giờ không chặn gợi ý tăng ngân sách", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    const r = assessDelivery(
      base({ budget: 250_000, roasTargetChangedAt: new Date(now.getTime() - 3_600_000), now })
    );
    expect(r?.status).toBe("budget_capped");
  });

  it("mục tiêu đã sát sàn an toàn → không khuyên hạ nữa (null)", () => {
    const ok = assessRoasTarget({ roasTarget: 7.6, breakevenRoas: BE, dangerFactor: FACTOR });
    expect(assessDelivery(base({ roasTarget: 7.6, roasTargetCheck: ok, prev7: { spend: 1_000_000, gmv: 7_595_000, daysWithSpend: 7 } }))).toBeNull();
  });

  it("ROAS thực đã đạt mục tiêu nhưng chưa vượt 10% → vẫn target_binding; vượt quá 10% → null (08/10)", () => {
    const ok9 = assessRoasTarget({ roasTarget: 9, breakevenRoas: BE, dangerFactor: FACTOR });
    // Lãi mong muốn 0 để sàn = 7,6 (mục tiêu 9 còn nấc để hạ); với sàn 10,6 mặc định thì mục tiêu 9 đã dưới sàn → null.
    expect(assessDelivery(base({ roasTarget: 9, roasTargetCheck: ok9, minKeepPer100: 0 }))?.status).toBe("target_binding"); // 9,44 < 9,9
    expect(assessDelivery(base({ roasTarget: 9, roasTargetCheck: ok9 }))).toBeNull();
    const ok8 = assessRoasTarget({ roasTarget: 8, breakevenRoas: BE, dangerFactor: FACTOR });
    expect(assessDelivery(base({ roasTarget: 8, roasTargetCheck: ok8, minKeepPer100: 0 }))).toBeNull(); // 9,44 ≥ 8,8
  });

  it("nấc hạ gần nhất không ra thêm lãi (stepCheck.flat) → target_hold, không đề xuất nấc kế", () => {
    const ok = assessRoasTarget({ roasTarget: 12.2, breakevenRoas: BE, dangerFactor: FACTOR });
    const flat = { changedOn: "2026-10-04", before: 900_000, after: 850_000, days: 2, flat: true };
    const r = assessDelivery(base({ roasTarget: 12.2, roasTargetCheck: ok, stepCheck: flat }));
    expect(r?.status).toBe("target_hold");
    expect(r?.nextTarget).toBeNull();
    expect(r?.stepCheck).toEqual(flat);
  });
});

describe("profitFloorRoas — sàn ROAS giữ lãi mong muốn", () => {
  it("1/(biên − lãi/100), làm tròn lên 0,1; biên không đủ → null", () => {
    expect(profitFloorRoas(0.2, 5)).toBe(6.7);
    expect(profitFloorRoas(0.1793, 5)).toBe(7.8);
    expect(profitFloorRoas(0.2, 0)).toBe(5);
    expect(profitFloorRoas(0.04, 5)).toBeNull();
    expect(profitFloorRoas(0, 5)).toBeNull();
  });
});

describe("stepProfitCheck — so lãi tuyệt đối trước / sau nấc hạ", () => {
  const days = [
    { date: "2026-10-01", expense: 100_000, gmv: 1_000_000 },
    { date: "2026-10-02", expense: 100_000, gmv: 1_100_000 },
    { date: "2026-10-03", expense: 120_000, gmv: 1_200_000 },
    { date: "2026-10-04", expense: 150_000, gmv: 1_300_000 }, // ngày đổi — bỏ
    { date: "2026-10-05", expense: 180_000, gmv: 1_600_000 },
    { date: "2026-10-06", expense: 190_000, gmv: 1_700_000 },
    { date: "2026-10-07", expense: 200_000, gmv: 1_600_000 },
  ];
  const basic = { days, margin: 0.2, roasTarget: 11, roasTargetPrev: 12.2, changedOn: "2026-10-04", today: "2026-10-08" };
  it("lấy 2 ngày trọn sát trước và 2 ngày trọn sát sau ngày đổi, lãi = GMV × biên − chi", () => {
    const r = stepProfitCheck(basic);
    // Trước = 02–03/10: 2,3tr × 0,2 − 220k = 240k. Sau = 05–06/10: 3,3tr × 0,2 − 370k = 290k (07/10 là ngày thứ 3, không lấy).
    expect(r).toEqual({ changedOn: "2026-10-04", before: 240_000, after: 290_000, days: 2, flat: false });
  });
  it("không tăng → flat; chưa đủ 2 ngày trọn sau → null; lần đổi là NÂNG → null", () => {
    const flat = stepProfitCheck({ ...basic, days: days.map((d) => (d.date >= "2026-10-05" ? { ...d, gmv: 1_300_000 } : d)) }); // sau: 2,6tr×0,2−370k = 150k
    expect(flat?.flat).toBe(true);
    expect(stepProfitCheck({ ...basic, today: "2026-10-06" })).toBeNull();
    expect(stepProfitCheck({ ...basic, roasTargetPrev: 10 })).toBeNull();
    expect(stepProfitCheck({ ...basic, roasTargetPrev: null })).toBeNull();
    expect(stepProfitCheck({ ...basic, changedOn: null })).toBeNull();
  });
});
