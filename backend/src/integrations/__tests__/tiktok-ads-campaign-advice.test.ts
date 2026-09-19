import { describe, expect, it } from "vitest";
import { avgDailySpendOf, campaignAdvice, type CampaignAdviceInput } from "../tiktok-ads/campaign-advice";
import type { TiktokBreakeven } from "../tiktok-ads/breakeven";

// CHẨN ĐOÁN CHIẾN DỊCH GMV MAX — mọi kết luận ghép từ số đã có; hai mốc 80% ngân sách / 90% mục tiêu là số của TikTok.
const be = (over: Partial<TiktokBreakeven> = {}): TiktokBreakeven => ({
  breakevenRoi: 5,
  margin: 0.2,
  negativeMargin: false,
  source: "campaign",
  orders: 120,
  cancelledOrders: 0,
  pendingOrders: 0,
  costCoveragePct: 100,
  check: null,
  ...over,
});
const input = (over: Partial<CampaignAdviceInput> = {}): CampaignAdviceInput => ({
  status: "ongoing",
  roasTarget: 15,
  budget: 1_500_000,
  breakeven: be(),
  spend: 6_000_000,
  gmv: 69_000_000, // ROI thực 11,5
  avgDailySpend: 210_000, // 14% ngân sách
  ...over,
});

describe("campaignAdvice", () => {
  it("TC054 thật: lãi, chưa đạt mục tiêu 15, mới tiêu 14% ngân sách → mục tiêu đang bó phân phối, không được hạ dưới hòa vốn", () => {
    const a = campaignAdvice(input());
    expect(a.kind).toBe("target_binding");
    expect(a.budgetUsedPct).toBe(14);
    expect(a.keepPer100).toBe(11.3); // 20% − 1/11,5
    expect(a.text).toContain("đừng đặt dưới 5");
    expect(a.editInSellerCenter).toBe(true);
  });

  it("ROI thực dưới hòa vốn → đang lỗ; mục tiêu cũng dưới hòa vốn thì nói luôn mức phải nâng", () => {
    const a = campaignAdvice(input({ gmv: 24_000_000, roasTarget: 4 })); // ROI 4
    expect(a.kind).toBe("losing");
    expect(a.tone).toBe("warn");
    expect(a.keepPer100).toBe(-5);
    expect(a.conclusion).toContain("Nâng ROI mục tiêu lên ít nhất 5");
    expect(a.points).toContain("ROI mục tiêu đang đặt 4 — thấp hơn hòa vốn.");
  });

  it("ô lý do đọc được: DỮ KIỆN mỗi ý một dòng, KẾT LUẬN để riêng (anh Trung 19/09)", () => {
    const a = campaignAdvice(input());
    expect(a.points).toEqual([
      "ROI thực 11,5 · hòa vốn 5.",
      "Mỗi 100đ doanh thu còn lãi khoảng 11,3đ sau quảng cáo.",
      "ROI mục tiêu đang đặt 15 — chưa đạt.",
      "Mỗi ngày tiêu khoảng 14% ngân sách (1.500.000đ).",
    ]);
    expect(a.conclusion).toContain("đừng đặt dưới 5");
    expect(a.text).toBe([...a.points, a.conclusion].join(" "));
  });

  it("đang lãi nhưng mục tiêu đặt dưới hòa vốn → cảnh báo trước khi TikTok kéo ROI xuống", () => {
    expect(campaignAdvice(input({ roasTarget: 4 })).kind).toBe("target_below");
  });

  it("đạt từ 90% mục tiêu VÀ tiêu từ 80% ngân sách → ngân sách đang chặn (hai mốc của TikTok)", () => {
    expect(campaignAdvice(input({ roasTarget: 12, avgDailySpend: 1_200_000 })).kind).toBe("budget_capped"); // 11,5 ≥ 10,8 · 80%
    expect(campaignAdvice(input({ roasTarget: 12, avgDailySpend: 1_190_000 })).kind).toBe("healthy"); // 79% → chưa chặn
    expect(campaignAdvice(input({ roasTarget: 13, avgDailySpend: 1_200_000 })).kind).toBe("healthy"); // 11,5 < 11,7 → chưa đạt mục tiêu
  });

  it("phân phối tối đa (không có ROI mục tiêu) + tiêu gần hết ngân sách → vẫn là ngân sách đang chặn", () => {
    expect(campaignAdvice(input({ roasTarget: null, avgDailySpend: 1_400_000 })).kind).toBe("budget_capped");
  });

  it("chưa có hòa vốn tin được (mượn biên lãi toàn gian / thiếu giá vốn) → KHÔNG kết luận lãi lỗ, chỉ nói việc cần làm", () => {
    const a = campaignAdvice(input({ breakeven: be({ source: "shop" }) }));
    expect(a.kind).toBe("no_breakeven");
    expect(a.keepPer100).toBeNull();
    expect(a.text).toContain("mượn biên lãi toàn gian");
    expect(campaignAdvice(input({ breakeven: be({ costCoveragePct: 40 }) })).kind).toBe("no_breakeven");
    expect(campaignAdvice(input({ breakeven: null })).kind).toBe("no_breakeven");
  });

  it("tab Hòa vốn sản phẩm: hòa vốn nguồn 'product' + breakevenProblem do dòng sản phẩm quyết → cùng kết luận với trang chiến dịch", () => {
    // Rỗng = dòng sản phẩm đã tin được (đủ đơn, đủ giá vốn) → không bị luật 'phải là nguồn campaign' chặn.
    expect(campaignAdvice(input({ breakeven: be({ source: "product" }), breakevenProblem: "" })).kind).toBe("target_binding");
    // Dòng sản phẩm chưa tin được → đem đúng lý do của dòng đó ra, không kết luận lãi lỗ.
    const a = campaignAdvice(input({ breakeven: be({ source: "product" }), breakevenProblem: "Mới 3 đơn đã đối soát" }));
    expect(a.kind).toBe("no_breakeven");
    expect(a.text).toContain("Mới 3 đơn đã đối soát");
  });

  it("chiến dịch tắt / chưa tiêu tiền → không chẩn đoán; không có ngày trọn nào thì không có % ngân sách", () => {
    expect(campaignAdvice(input({ status: "paused" })).kind).toBe("paused");
    expect(campaignAdvice(input({ spend: 0, gmv: 0 })).kind).toBe("no_spend");
    const a = campaignAdvice(input({ avgDailySpend: null, roasTarget: 11 }));
    expect(a.budgetUsedPct).toBeNull();
    expect(a.kind).toBe("healthy");
  });
});

describe("avgDailySpendOf", () => {
  it("chỉ lấy ngày TRỌN có tiêu tiền — bỏ hôm nay (chưa hết ngày) và ngày không tiêu", () => {
    const days = [
      { date: "2026-09-16", expense: 200_000 },
      { date: "2026-09-17", expense: 0 },
      { date: "2026-09-18", expense: 300_000 },
      { date: "2026-09-19", expense: 50_000 }, // hôm nay
    ];
    expect(avgDailySpendOf(days, "2026-09-19")).toBe(250_000);
    expect(avgDailySpendOf([{ date: "2026-09-19", expense: 50_000 }], "2026-09-19")).toBeNull();
  });
});
