// ============================================================
// TEST GỢI Ý CHẠY ADS (đợt D, 17/09/2026) — bộ chấm thuần, KHÔNG DB.
// Ba tầng: cổng loại → điểm → đề xuất (mục tiêu 3 mức + ngân sách chặn trần).
// ============================================================

import { describe, expect, it } from "vitest";
import {
  medianOrganicCvr,
  recommendAdsForItem,
  type RecommendInput,
  type RecommendSignal,
} from "../shopee/ads-recommend";
import { isAdBlockedStatus, summarizeKeywords } from "../shopee/ads-item-signals";

const SIGNAL: RecommendSignal = {
  sale: 900,
  views: 2_000, // 40 đơn 30 ngày ÷ 2.000 lượt xem = 2%
  ratingStar: 4.8,
  commentCount: 240,
  tags: ["best selling", "top search"],
  adBlocked: false,
  roiLower: 5,
  roiExact: 8,
  roiUpper: 12,
  budgetMin: 30_000,
  budgetRecommended: 150_000,
  budgetMax: 400_000,
  kwSearchVolume: 60_000,
  kwAvgBid: 900,
};

function mk(partial: Partial<RecommendInput> = {}, signal: Partial<RecommendSignal> | null = {}): RecommendInput {
  return {
    itemId: "1",
    price: 210_000,
    margin: 0.25, // hòa vốn 4x, an toàn 4,4x
    marginOrders: 40,
    missingCost: false,
    revenue30d: 40 * 210_000,
    units30d: 40,
    units7d: 12,
    stockAvailable: 200,
    runningAds: false,
    history: null,
    signal: signal === null ? null : { ...SIGNAL, ...signal },
    shopMedianCvr: 0.02,
    dangerFactor: 1.1,
    ...partial,
  };
}

describe("recommendAdsForItem — cổng loại", () => {
  it("SP khỏe qua mọi cổng → Nên chạy ngay, có đề xuất 3 mức mục tiêu", () => {
    const r = recommendAdsForItem(mk());
    expect(r.tier).toBe("run_now");
    expect(r.gates.every((g) => g.ok)).toBe(true);
    expect(r.breakevenRoas).toBeCloseTo(4);
    expect(r.safeRoas).toBe(4.4);
    expect(r.headroom).toBeCloseTo(2);
    expect(r.proposal?.targets).toEqual({ push: 4.4, balanced: 6.2, keep: 8 });
    expect(r.proposal?.recommended).toBe("balanced");
  });

  it("mức an toàn cao hơn cả nhóm khắt khe nhất của sàn → Chưa nên, việc làm trước là hạ hòa vốn", () => {
    const r = recommendAdsForItem(mk({ margin: 0.05 })); // hòa vốn 20x > upper 12x
    expect(r.tier).toBe("not_yet");
    expect(r.gates.find((g) => g.key === "feasible")?.ok).toBe(false);
    expect(r.headline).toContain("hạ hòa vốn");
    expect(r.proposal).toBeNull();
  });

  it("lỗ trước ads / thiếu giá vốn / chưa có đơn → trượt cổng biên lãi", () => {
    expect(recommendAdsForItem(mk({ margin: -0.02 })).tier).toBe("not_yet");
    expect(recommendAdsForItem(mk({ missingCost: true })).gates[0].ok).toBe(false);
    expect(recommendAdsForItem(mk({ margin: null })).headline).toContain("bán tự nhiên");
  });

  it("tồn không đủ 14 ngày khi ads đẩy lượng gấp rưỡi → Chưa nên", () => {
    const r = recommendAdsForItem(mk({ stockAvailable: 20 })); // 20 / (40/30 × 1,5) = 10 ngày
    expect(r.tier).toBe("not_yet");
    expect(r.gates.find((g) => g.key === "stock")?.ok).toBe(false);
    expect(Math.floor(r.daysOfCover!)).toBe(10);
  });

  it("ít đánh giá → gom đánh giá trước; sàn khóa ads → Chưa nên", () => {
    const few = recommendAdsForItem(mk({}, { commentCount: 3 }));
    expect(few.tier).toBe("not_yet");
    expect(few.headline).toContain("đánh giá");
    expect(recommendAdsForItem(mk({}, { adBlocked: true })).tier).toBe("not_yet");
  });

  it("đang chạy ads → mức running, không đề xuất tạo mới", () => {
    const r = recommendAdsForItem(mk({ runningAds: true }));
    expect(r.tier).toBe("running");
    expect(r.proposal).toBeNull();
  });
});

describe("recommendAdsForItem — điểm và đề xuất", () => {
  it("dư địa mỏng + chuyển đổi kém + cầu thấp → Thử nhỏ, ngân sách lấy một nửa, mục tiêu Giữ lãi", () => {
    const r = recommendAdsForItem(
      mk({ units7d: 9 }, { roiExact: 5.4, sale: 500, views: 30_000, kwSearchVolume: 12_000, tags: [] })
    );
    expect(r.tier).toBe("test_small");
    expect(r.proposal?.recommended).toBe("keep");
    expect(r.proposal?.budgetNote).toContain("một nửa");
  });

  it("ngân sách bị chặn bởi 10% lãi tháng ÷ 7 ngày, làm tròn nghìn, không dưới mức tối thiểu của sàn", () => {
    // lãi tháng = 40 × 210k × 25% = 2,1tr → 10% / 7 = 30k/ngày < gợi ý 150k
    const r = recommendAdsForItem(mk());
    expect(r.proposal?.dailyBudget).toBe(30_000);
    expect(r.proposal?.maxTestSpend7d).toBe(210_000);
    expect(r.proposal?.budgetNote).toContain("lãi tháng");
  });

  it("lịch sử ads của chính SP đè ước tính: từng chạy lỗ → tụt mức", () => {
    const good = recommendAdsForItem(mk());
    const bad = recommendAdsForItem(mk({ history: { spend30d: 500_000, roas30d: 2.5 } }));
    expect(bad.score).toBe(good.score - 25);
    expect(bad.factors.find((f) => f.key === "history")?.points).toBe(-25);
  });

  it("chưa đồng bộ tín hiệu sàn → cổng cho qua kèm ghi chú, điểm trung tính, không bịa số", () => {
    const r = recommendAdsForItem(mk({}, null));
    expect(r.gates.every((g) => g.ok)).toBe(true);
    expect(r.headroom).toBeNull();
    expect(r.factors.find((f) => f.key === "headroom")?.points).toBe(20);
    // mục tiêu chỉ còn một mức an toàn
    expect(r.proposal?.targets ?? { push: 4.4, balanced: 4.4, keep: 4.4 }).toEqual({ push: 4.4, balanced: 4.4, keep: 4.4 });
  });
});

describe("medianOrganicCvr", () => {
  it("số bán 30 ngày ÷ lượt xem; bỏ SP dưới 100 lượt xem và SP không bán, lấy trung vị", () => {
    expect(
      medianOrganicCvr([
        { units30d: 1, views: 10 }, // bỏ — quá ít lượt xem
        { units30d: 0, views: 5000 }, // bỏ — không bán
        { units30d: 10, views: 1000 },
        { units30d: 30, views: 1000 },
        { units30d: 20, views: 1000 },
      ])
    ).toBeCloseTo(0.02);
    expect(medianOrganicCvr([])).toBeNull();
  });
});

describe("tín hiệu sàn — hàm gộp thuần", () => {
  it("giá thầu trung bình có trọng số lượt tìm; tổng lượt tìm cộng dồn", () => {
    const r = summarizeKeywords([
      { search_volume: 9000, suggested_bid: 1000 },
      { search_volume: 1000, suggested_bid: 3000 },
      { search_volume: 500 }, // không có giá thầu — vẫn tính lượt tìm
    ]);
    expect(r.volume).toBe(10_500);
    expect(r.avgBid).toBeCloseTo(1200); // (9000×1000 + 1000×3000) / 10000
    expect(r.count).toBe(3);
    expect(summarizeKeywords([]).avgBid).toBeNull();
  });
  it("trạng thái SP bị khóa/hết hàng → không đủ điều kiện ads; rỗng hoặc bình thường → đủ", () => {
    expect(isAdBlockedStatus(["blocked"])).toBe(true);
    expect(isAdBlockedStatus(["Sold Out"])).toBe(true);
    expect(isAdBlockedStatus([])).toBe(false);
    expect(isAdBlockedStatus(undefined)).toBe(false);
    expect(isAdBlockedStatus(["normal"])).toBe(false);
  });
});
