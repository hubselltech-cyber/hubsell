import { describe, expect, it } from "vitest";
import {
  TARGET_STEP_WAIT_HOURS,
  avgDailySpendOf,
  campaignAdvice,
  nextRoiTargetStep,
  targetWatchHoursLeft,
  type CampaignAdviceInput,
} from "../tiktok-ads/campaign-advice";
import type { TiktokBreakeven } from "../../lib/tiktok-breakeven";

// CHẨN ĐOÁN CHIẾN DỊCH GMV MAX — mọi kết luận ghép từ số đã có; hai mốc 80% ngân sách / 90% mục tiêu là số của TikTok.
// 08/10/2026: sàn hạ mục tiêu = sàn giữ lãi mong muốn (mặc định 5đ/100đ): biên 20% → 1/(0,2 − 0,05) = 6,67 → 6,7.
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
  it("TC054 thật: lãi, chưa đạt mục tiêu 15, mới tiêu 14% ngân sách → mục tiêu đang ghìm, hạ một nấc, không dưới sàn giữ lãi", () => {
    const a = campaignAdvice(input());
    expect(a.kind).toBe("target_binding");
    expect(a.budgetUsedPct).toBe(14);
    expect(a.keepPer100).toBe(11.3); // 20% − 1/11,5
    expect(a.safeTarget).toBe(6.7);
    expect(a.minKeepPer100).toBe(5);
    expect(a.nextTarget).toBe(13.5);
    expect(a.keepAtNextTarget).toBe(12.6); // 20% − 1/13,5
    expect(a.conclusion).toBe(
      `Giảm ROI mục tiêu một nấc, từ 15 xuống 13,5, rồi theo dõi ${TARGET_STEP_WAIT_HOURS} giờ mới giảm tiếp. Ở 13,5 mỗi 100đ doanh thu còn lãi khoảng 12,6đ. Không xuống dưới 6,7 (giữ lãi từ 5đ/100đ).`
    );
    expect(a.editInSellerCenter).toBe(true);
  });

  // Ca ANO 08/10/2026 (ảnh anh Trung): ROI thực 13,84 / mục tiêu 15 / hòa vốn 5,58 / tiêu 12% — bản cũ nói "chưa thấy gì cần sửa"
  // vì 13,84 ≥ 90% × 15. Mục tiêu đã đạt hay gần đạt mà ngân sách còn dư thì mục tiêu vẫn là thứ ghìm → phải khuyên hạ.
  it("ANO 08/10: ROI gần đạt mục tiêu + tiêu 12% ngân sách → vẫn là mục tiêu đang ghìm; sàn 7,8 (biên 17,9% giữ 5đ)", () => {
    const a = campaignAdvice(
      input({ breakeven: be({ breakevenRoi: 5.58, margin: 0.1793 }), spend: 1_000_000, gmv: 13_840_000, avgDailySpend: 180_000 })
    );
    expect(a.kind).toBe("target_binding");
    expect(a.label).toBe("Mục tiêu đang ghìm phân phối");
    expect(a.points).toContain("ROI mục tiêu đang đặt 15 — gần đạt (từ 90%).");
    expect(a.safeTarget).toBe(7.8); // 1/(0,1793 − 0,05) = 7,73 → 7,8
    expect(a.nextTarget).toBe(13.5);
    // Đã đạt hẳn (ROI 15,5 ≥ 15 nhưng < 16,5) → vẫn ghìm, chữ "đã đạt".
    const b = campaignAdvice(input({ breakeven: be({ breakevenRoi: 5.58, margin: 0.1793 }), spend: 1_000_000, gmv: 15_500_000, avgDailySpend: 180_000 }));
    expect(b.kind).toBe("target_binding");
    expect(b.points).toContain("ROI mục tiêu đang đặt 15 — đã đạt.");
  });

  it("ROI vượt mục tiêu quá 10% mà vẫn tiêu ít → mục tiêu không phải thứ chặn: không khuyên hạ, khuyên thêm video / sản phẩm", () => {
    const a = campaignAdvice(input({ spend: 1_000_000, gmv: 16_500_000 })); // ROI 16,5 = 15 × 1,1
    expect(a.kind).toBe("healthy");
    expect(a.nextTarget).toBeNull();
    expect(a.points.at(-1)).toContain("mục tiêu không phải thứ đang chặn");
    expect(a.conclusion).toContain("thêm video / sản phẩm");
    expect(a.editInSellerCenter).toBe(true);
  });

  describe("hạ ROI mục tiêu từng nấc 10% + khóa 72 giờ (TikTok: giữ mỗi mức ROI ít nhất 3 ngày trọn)", () => {
    it("nấc 10% thủng sàn thì dừng ở sàn; đã sát sàn thì không còn nấc", () => {
      expect(nextRoiTargetStep(15, 6.7)).toBe(13.5);
      expect(nextRoiTargetStep(7, 6.7)).toBe(6.7); // 6,3 < sàn → dừng ở sàn
      expect(nextRoiTargetStep(6.7, 6.7)).toBeNull();
      expect(nextRoiTargetStep(5.58, 5.58)).toBeNull();
    });

    it("mục tiêu đã sát sàn giữ lãi → 'Đang lãi', nói rõ không còn nấc và sàn là bao nhiêu", () => {
      const a = campaignAdvice(input({ roasTarget: 6.7, gmv: 39_000_000 })); // ROI 6,5 < 6,7 × 1,1
      expect(a.kind).toBe("healthy");
      expect(a.nextTarget).toBeNull();
      expect(a.conclusion).toContain("đã sát mức an toàn 6,7 (giữ lãi từ 5đ/100đ)");
    });

    it("lãi mong muốn do gian cấu hình: 0đ → sàn = hòa vốn; 12đ → sàn cao hơn (1/(0,2−0,12) = 12,5)", () => {
      const zero = campaignAdvice(input({ minKeepPer100: 0 }));
      expect(zero.safeTarget).toBe(5);
      expect(zero.conclusion).toContain("Không xuống dưới 5 (giữ lãi từ 0đ/100đ)");
      const high = campaignAdvice(input({ minKeepPer100: 12 }));
      expect(high.safeTarget).toBe(12.5);
      expect(high.nextTarget).toBe(13.5);
      // Mục tiêu 13 với sàn 12,5: nấc 11,7 thủng sàn → hạ về đúng 12,5.
      expect(campaignAdvice(input({ minKeepPer100: 12, roasTarget: 13 })).nextTarget).toBe(12.5);
    });

    it("biên không đủ cho lãi mong muốn → không có sàn hợp lệ, giữ mục tiêu và chỉ cách sửa", () => {
      const a = campaignAdvice(input({ breakeven: be({ breakevenRoi: 25, margin: 0.04 }), roasTarget: 30, gmv: 170_000_000 })); // ROI 28,3
      expect(a.kind).toBe("healthy");
      expect(a.safeTarget).toBeNull();
      expect(a.conclusion).toContain("Biên lãi 4% không đủ cho mức lãi mong muốn 5đ/100đ");
    });

    it("mục tiêu vừa đổi < 72 giờ → 'Theo dõi sau đổi mục tiêu', không gợi ý hạ, nói còn bao nhiêu giờ", () => {
      const now = new Date("2026-10-08T10:00:00Z");
      const a = campaignAdvice(input({ roasTargetChangedAt: new Date("2026-10-07T12:00:00Z"), now })); // đổi cách 22 giờ
      expect(a.kind).toBe("target_watching");
      expect(a.tone).toBe("ok");
      expect(a.watchHoursLeft).toBe(50);
      expect(a.nextTarget).toBeNull();
      expect(a.editInSellerCenter).toBe(false);
      expect(a.conclusion).toContain("chưa đủ 72 giờ");
      expect(a.conclusion).toContain("còn khoảng 50 giờ nữa mới xét hạ nấc tiếp");
      // Đủ 72 giờ → trở lại đề xuất nấc kế.
      expect(campaignAdvice(input({ roasTargetChangedAt: new Date("2026-10-05T09:00:00Z"), now })).kind).toBe("target_binding");
      expect(targetWatchHoursLeft(null, now)).toBe(0);
      expect(targetWatchHoursLeft(new Date("2026-10-08T09:30:00Z"), now)).toBe(72); // vừa đổi 30 phút → làm tròn lên 72
    });

    it("sau nấc hạ gần nhất lãi tuyệt đối không tăng → 'Giữ mục tiêu', không hạ tiếp; có tăng → hạ nấc kế", () => {
      const flat = { changedOn: "2026-10-04", before: 1_200_000, after: 1_150_000, days: 2, flat: true };
      const a = campaignAdvice(input({ stepCheck: flat }));
      expect(a.kind).toBe("target_hold");
      expect(a.tone).toBe("ok");
      expect(a.nextTarget).toBeNull();
      expect(a.points).toContain("Sau nấc hạ gần nhất (2026-10-04): lãi 2 ngày sau 1.150.000đ, 2 ngày trước 1.200.000đ.");
      expect(a.conclusion).toContain("Giữ ROI mục tiêu hiện tại");
      const up = campaignAdvice(input({ stepCheck: { ...flat, after: 1_400_000, flat: false } }));
      expect(up.kind).toBe("target_binding");
      expect(up.nextTarget).toBe(13.5);
    });

    it("khóa 72 giờ KHÔNG che cảnh báo lỗ / mục tiêu dưới hòa vốn / ngân sách chặn (xét trước nấc hạ)", () => {
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
      "Đang lãi nhưng tiêu ít: ROI bám sát mục tiêu nên mục tiêu đang ghìm TikTok phân phối dè dặt.",
    ]);
    expect(a.conclusion).toContain("Không xuống dưới 6,7");
    expect(a.text).toBe([...a.points, a.conclusion].join(" "));
  });

  it("đang lãi nhưng mục tiêu đặt dưới hòa vốn → cảnh báo trước khi TikTok kéo ROI xuống", () => {
    expect(campaignAdvice(input({ roasTarget: 4 })).kind).toBe("target_below");
  });

  it("đạt từ 90% mục tiêu VÀ tiêu từ 80% ngân sách → ngân sách đang chặn (hai mốc của TikTok)", () => {
    expect(campaignAdvice(input({ roasTarget: 12, avgDailySpend: 1_200_000 })).kind).toBe("budget_capped"); // 11,5 ≥ 10,8 · 80%
    expect(campaignAdvice(input({ roasTarget: 12, avgDailySpend: 1_190_000 })).kind).toBe("target_binding"); // 79% → ngân sách còn dư, mục tiêu ghìm
    expect(campaignAdvice(input({ roasTarget: 13, avgDailySpend: 1_200_000 })).kind).toBe("healthy"); // 11,5 < 11,7 chưa đạt, ngân sách đã 80% → không phán
  });

  it("phân phối tối đa (không có ROI mục tiêu) + tiêu gần hết ngân sách → vẫn là ngân sách đang chặn", () => {
    expect(campaignAdvice(input({ roasTarget: null, avgDailySpend: 1_400_000 })).kind).toBe("budget_capped");
  });

  it("chưa có hòa vốn tin được (mượn biên lãi toàn gian / thiếu giá vốn) → KHÔNG kết luận lãi lỗ, chỉ nói việc cần làm", () => {
    const a = campaignAdvice(input({ breakeven: be({ source: "shop" }) }));
    expect(a.kind).toBe("no_breakeven");
    expect(a.keepPer100).toBeNull();
    expect(a.safeTarget).toBeNull();
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
