import { describe, expect, it } from "vitest";
import { avgDailySpendOf, campaignAdvice, nextRoiTargetStep, targetWatchHoursLeft, type CampaignAdviceInput } from "../tiktok-ads/campaign-advice";
import type { TiktokBreakeven } from "../../lib/tiktok-breakeven";

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
    expect(a.text).toContain("Không xuống dưới hòa vốn 5");
    expect(a.editInSellerCenter).toBe(true);
  });

  // Anh Trung 08/10/2026: hạ mục tiêu phải ĐI TỪNG NẤC 10% rồi theo dõi 48 giờ — không nói chung chung "hạ về không dưới hòa vốn".
  describe("hạ ROI mục tiêu từng nấc 10% + khóa 48 giờ (cùng luật Shopee 04/10)", () => {
    it("mục tiêu 15 → đề xuất đúng MỘT nấc 13,5, theo dõi 48 giờ, không dưới hòa vốn", () => {
      const a = campaignAdvice(input());
      expect(a.nextTarget).toBe(13.5);
      expect(a.conclusion).toBe("Giảm ROI mục tiêu một nấc, từ 15 xuống 13,5, rồi theo dõi 48 giờ mới giảm tiếp. Không xuống dưới hòa vốn 5.");
      expect(a.watchHoursLeft).toBeNull();
    });

    it("nấc 10% thủng sàn thì dừng ở sàn (hòa vốn); đã sát sàn thì không còn nấc", () => {
      expect(nextRoiTargetStep(15, 5)).toBe(13.5);
      expect(nextRoiTargetStep(6, 5.58)).toBe(5.58); // 5,4 < hòa vốn → dừng ở hòa vốn
      expect(nextRoiTargetStep(5.58, 5.58)).toBeNull();
      expect(nextRoiTargetStep(5.6, 5.58)).toBe(5.58);
    });

    it("mục tiêu cách hòa vốn chưa tới một nấc → hạ về đúng hòa vốn; đã bằng hòa vốn → 'Đang lãi', nói rõ không còn nấc", () => {
      const beRoi = 5.58;
      // Mục tiêu 6, ROI thực 5,7 (< 90% × 6 = 5,4? không — 5,7 ≥ 5,4 là đạt) → dùng mục tiêu 6,5: 90% = 5,85 > 5,7 → chưa đạt.
      const e = campaignAdvice(input({ roasTarget: 6.5, breakeven: be({ breakevenRoi: beRoi }), gmv: 34_200_000 })); // ROI 5,7
      expect(e.kind).toBe("target_binding");
      expect(e.nextTarget).toBe(5.9); // 6,5 × 0,9 = 5,85 → 5,9 (> 5,58)
      const g = campaignAdvice(input({ roasTarget: 6.1, breakeven: be({ breakevenRoi: beRoi }), gmv: 33_900_000 })); // ROI 5,65 < 5,49? không → 5,65 ≥ 5,49 đạt
      expect(g.kind).toBe("healthy");
      // Mục tiêu 6,3: 90% = 5,67 > ROI 5,65 → chưa đạt; 6,3 × 0,9 = 5,67 → 5,7 > 5,58.
      const h = campaignAdvice(input({ roasTarget: 6.3, breakeven: be({ breakevenRoi: beRoi }), gmv: 33_900_000 }));
      expect(h.kind).toBe("target_binding");
      expect(h.nextTarget).toBe(5.7);
      // Mục tiêu đúng bằng hòa vốn 5,58, ROI 5,6 ≥ 90% → đạt → healthy. Ép "chưa đạt" bằng ROI thấp hơn mục tiêu nhưng trên hòa vốn:
      // không thể (ROI ≥ hòa vốn = mục tiêu ⇒ đạt) → nấc rỗng chỉ xảy ra khi mục tiêu ≤ hòa vốn + sai số làm tròn. Kiểm trực tiếp hàm nấc.
      expect(nextRoiTargetStep(beRoi, beRoi)).toBeNull();
    });

    it("mục tiêu vừa đổi < 48 giờ → 'Theo dõi sau đổi mục tiêu', không gợi ý hạ, nói còn bao nhiêu giờ", () => {
      const now = new Date("2026-10-08T10:00:00Z");
      const a = campaignAdvice(input({ roasTargetChangedAt: new Date("2026-10-07T12:00:00Z"), now })); // đổi cách 22 giờ
      expect(a.kind).toBe("target_watching");
      expect(a.tone).toBe("ok");
      expect(a.watchHoursLeft).toBe(26);
      expect(a.nextTarget).toBeNull();
      expect(a.editInSellerCenter).toBe(false);
      expect(a.conclusion).toContain("còn khoảng 26 giờ nữa mới xét hạ nấc tiếp");
      // Đủ 48 giờ → trở lại đề xuất nấc kế.
      expect(campaignAdvice(input({ roasTargetChangedAt: new Date("2026-10-06T09:00:00Z"), now })).kind).toBe("target_binding");
      expect(targetWatchHoursLeft(null, now)).toBe(0);
      expect(targetWatchHoursLeft(new Date("2026-10-08T09:30:00Z"), now)).toBe(48); // vừa đổi 30 phút → làm tròn lên 48
    });

    it("khóa 48 giờ KHÔNG che cảnh báo lỗ / mục tiêu dưới hòa vốn / ngân sách chặn (xét trước nấc hạ)", () => {
      const now = new Date("2026-10-08T10:00:00Z");
      const changed = new Date("2026-10-08T08:00:00Z");
      expect(campaignAdvice(input({ gmv: 24_000_000, roasTarget: 4, roasTargetChangedAt: changed, now })).kind).toBe("losing");
      expect(campaignAdvice(input({ roasTarget: 4, roasTargetChangedAt: changed, now })).kind).toBe("target_below");
      expect(campaignAdvice(input({ roasTarget: 12, avgDailySpend: 1_200_000, roasTargetChangedAt: changed, now })).kind).toBe("budget_capped");
    });
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
      "Đang lãi nhưng tiêu ít: nhiều khả năng mục tiêu cao đang làm TikTok phân phối dè dặt.",
    ]);
    expect(a.conclusion).toContain("Không xuống dưới hòa vốn 5");
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
